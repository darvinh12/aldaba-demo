/** Cambio de clave y clave temporal obligatoria (migración 0013).
 *
 *  POR QUE IMPORTA: un condominio puede arrancar con decenas de cuentas creadas de golpe
 *  que comparten UNA clave temporal. Eso solo es defendible si la clave compartida muere en
 *  el primer ingreso. Estas pruebas fijan que el servidor —no la pantalla— sea quien lo
 *  exige, que cambiarla expulse a quien haya entrado con la clave vieja, y que el endpoint
 *  no se convierta en un oráculo para adivinar la clave actual sin freno. */
import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { hashPassword } from '../src/lib/crypto'
import { app } from '../src/index'

beforeAll(aplicarSchema)

const CLAVE = 'ClaveTemporal2026'

async function usuario(opts: { debeCambiar?: boolean; clave?: string } = {}) {
  const uid = uuid()
  const email = `${uid}@sincorreo.test`
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,debe_cambiar_clave) VALUES(?,?,?,?,?)`)
    .bind(uid, email, 'Apartamento 11A', await hashPassword(opts.clave ?? CLAVE), opts.debeCambiar ? 1 : 0).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, email, headers: { cookie: `${COOKIE}=${valor}` } }
}
const post = (path: string, headers: any, body?: any) =>
  app.request(path, { method: 'POST', headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env)
const login = (email: string, password: string) =>
  app.request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }, env)

describe('cambio de clave', () => {
  it('cambia la clave: la vieja deja de servir y la nueva entra', async () => {
    const u = await usuario()
    expect((await post('/api/clave', u.headers, { actual: CLAVE, nueva: 'MiClaveNueva123' })).status).toBe(200)
    expect((await login(u.email, CLAVE)).status).toBe(401)
    expect((await login(u.email, 'MiClaveNueva123')).status).toBe(200)
  })

  it('con la clave actual equivocada no cambia nada', async () => {
    const u = await usuario()
    expect((await post('/api/clave', u.headers, { actual: 'LaQueNoEs123', nueva: 'MiClaveNueva123' })).status).toBe(401)
    expect((await login(u.email, CLAVE)).status).toBe(200)   // la vieja sigue viva
  })

  it('rechaza claves cortas y la misma de antes', async () => {
    const u = await usuario()
    expect((await post('/api/clave', u.headers, { actual: CLAVE, nueva: 'corta' })).status).toBe(400)
    expect((await post('/api/clave', u.headers, { actual: CLAVE, nueva: CLAVE })).status).toBe(400)
  })

  it('expulsa a quien haya entrado con la clave compartida, y deja viva la sesión propia', async () => {
    const u = await usuario()
    // Un segundo ocupante entró al mismo apartamento con la clave que sabe todo el edificio.
    const intruso = await crearSesion(env.DB, u.uid, env.SESSION_SECRET, 30)
    const r = await post('/api/clave', u.headers, { actual: CLAVE, nueva: 'MiClaveNueva123' })
    expect((await r.json<any>()).otrasCerradas).toBe(1)
    // la del intruso murió...
    expect((await app.request('/api/me', { headers: { cookie: `${COOKIE}=${intruso.valor}` } }, env)).status).toBe(401)
    // ...y la propia sigue sirviendo, sin obligar a entrar de nuevo
    expect((await app.request('/api/me', { headers: u.headers }, env)).status).toBe(200)
  })
})

describe('clave temporal obligatoria', () => {
  it('/me avisa que hay que cambiarla, y deja de avisar cuando se cambió', async () => {
    const u = await usuario({ debeCambiar: true })
    const antes = await (await app.request('/api/me', { headers: u.headers }, env)).json<any>()
    expect(antes.debeCambiarClave).toBe(true)
    await post('/api/clave', u.headers, { actual: CLAVE, nueva: 'MiClaveNueva123' })
    const despues = await (await app.request('/api/me', { headers: u.headers }, env)).json<any>()
    expect(despues.debeCambiarClave).toBe(false)
  })

  it('una cuenta normal no queda marcada', async () => {
    const u = await usuario()
    expect((await (await app.request('/api/me', { headers: u.headers }, env)).json<any>()).debeCambiarClave).toBe(false)
  })
})

describe('mensajería: los correos de relleno no se escriben', () => {
  it('salta los @sincorreo.test y los cuenta aparte en vez de intentar enviarles', async () => {
    const { condoId } = await seedCondo()
    const unidad = uuid()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,'11A')`).bind(unidad, condoId).run()
    const unidad2 = uuid()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,'12A')`).bind(unidad2, condoId).run()

    // uno con correo de relleno, otro con correo de verdad
    for (const [id, email, ph, uni] of [['ph', 'relleno@sincorreo.test', 1, unidad], ['real', 'persona@gmail.com', 0, unidad2]] as const) {
      await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,correo_placeholder) VALUES(?,?,?,'h',?)`)
        .bind(`u-${id}-${condoId}`, email, 'X', ph).run()
      await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,'residente')`)
        .bind(uuid(), `u-${id}-${condoId}`, condoId, uni).run()
    }
    const admin = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,'h')`).bind(admin, `${admin}@t.com`, 'Admin').run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`).bind(uuid(), admin, condoId).run()
    const { valor } = await crearSesion(env.DB, admin, env.SESSION_SECRET, 30)
    const h = { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId }

    const r = await (await post('/api/mensajeria/enviar', h, { canal: 'email', cuerpo: 'hola' })).json<any>()
    expect(r.sinCorreoReal).toBe(1)          // el @sincorreo.test quedó fuera
    // Sin RESEND_API_KEY en pruebas no se envía nada; lo que importa es que el de relleno
    // ni siquiera entra en la lista de pendientes por enviar.
    expect(r.pendientes).toBe(1)
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, uuid } from './helpers'
import { hashPassword } from '../src/lib/crypto'
import { crearSesion, leerSesion } from '../src/lib/session'
import { app } from '../src/index'

// SESSION_SECRET de los tests (vitest.config.ts): las sesiones creadas a mano deben firmarse con él.
const SEC = 'test'

beforeAll(aplicarSchema)

async function crearUsuario(email: string, clave = 'Clave12345!') {
  const id = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(id, email, 'Test', await hashPassword(clave)).run()
  return id
}

/** Login como la app nativa: devuelve el token Bearer. */
async function loginApp(email: string, clave = 'Clave12345!') {
  const res = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: clave }),
    headers: { 'content-type': 'application/json', 'X-Cliente': 'app' },
  }, env)
  expect(res.status).toBe(200)
  const { token } = await res.json<{ token: string }>()
  expect(token).toBeTruthy()
  return token
}

const conBearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra })

const renovar = (token: string) =>
  app.request('/api/sesion/renovar', { method: 'POST', headers: conBearer(token, { 'X-Cliente': 'app' }) }, env)

const idDeToken = (token: string) => token.split('.')[0]

describe('sesión deslizante (leerSesion)', () => {
  it('extiende expira cuando queda menos de la mitad de la vida', async () => {
    const uid = await crearUsuario(`desl-${uuid()}@t.com`)
    const { valor, id } = await crearSesion(env.DB, uid, SEC, 30)
    // sesión de 30 días a la que le quedan 10 (menos de la mitad) y sin escritura reciente
    await env.DB.prepare(
      `UPDATE sesiones SET creada=datetime('now','-20 days'), expira=datetime('now','+10 days'), ultimo_uso=NULL WHERE id=?`,
    ).bind(id).run()
    expect((await leerSesion(env.DB, valor, SEC))?.usuario_id).toBe(uid)
    const s = await env.DB.prepare(
      `SELECT ultimo_uso, CAST(julianday(expira)-julianday('now') AS REAL) restante FROM sesiones WHERE id=?`,
    ).bind(id).first<{ ultimo_uso: string | null; restante: number }>()
    expect(s?.ultimo_uso).toBeTruthy()
    expect(s!.restante).toBeGreaterThan(29) // extendida a su duración original (~30 días)
  })
  it('NO extiende cuando queda más de la mitad (solo actualiza ultimo_uso)', async () => {
    const uid = await crearUsuario(`desl2-${uuid()}@t.com`)
    const { valor, id } = await crearSesion(env.DB, uid, SEC, 30)
    await env.DB.prepare(
      `UPDATE sesiones SET creada=datetime('now','-5 days'), expira=datetime('now','+25 days'), ultimo_uso=NULL WHERE id=?`,
    ).bind(id).run()
    await leerSesion(env.DB, valor, SEC)
    const s = await env.DB.prepare(
      `SELECT ultimo_uso, CAST(julianday(expira)-julianday('now') AS REAL) restante FROM sesiones WHERE id=?`,
    ).bind(id).first<{ ultimo_uso: string | null; restante: number }>()
    expect(s?.ultimo_uso).toBeTruthy()
    expect(s!.restante).toBeLessThan(25.5)
  })
  it('no escribe dos veces dentro de la misma hora', async () => {
    const uid = await crearUsuario(`desl3-${uuid()}@t.com`)
    const { valor, id } = await crearSesion(env.DB, uid, SEC, 30)
    await env.DB.prepare(
      `UPDATE sesiones SET creada=datetime('now','-20 days'), expira=datetime('now','+10 days'), ultimo_uso=NULL WHERE id=?`,
    ).bind(id).run()
    await leerSesion(env.DB, valor, SEC) // primera lectura: escribe (extiende + ultimo_uso)
    // se fuerza expira de nuevo a +10 días DEJANDO ultimo_uso reciente: si la segunda
    // lectura escribiera, volvería a extender a ~30; no debe hacerlo dentro de la hora
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','+10 days'), creada=datetime('now','-20 days') WHERE id=?`).bind(id).run()
    await leerSesion(env.DB, valor, SEC)
    const s = await env.DB.prepare(
      `SELECT CAST(julianday(expira)-julianday('now') AS REAL) restante FROM sesiones WHERE id=?`,
    ).bind(id).first<{ restante: number }>()
    expect(s!.restante).toBeLessThan(10.5) // sin segunda extensión
  })
})

describe('POST /api/sesion/renovar', () => {
  it('canjea un token vigente por uno nuevo y mata la sesión vieja', async () => {
    await crearUsuario('renueva1@t.com')
    const token = await loginApp('renueva1@t.com')
    const res = await renovar(token)
    expect(res.status).toBe(200)
    const { token: nuevo } = await res.json<{ token: string }>()
    expect(nuevo).toBeTruthy()
    expect(nuevo).not.toBe(token)
    // el nuevo sirve para /api/me; el viejo ya no existe ni vuelve a renovarse
    expect((await app.request('/api/me', { headers: conBearer(nuevo) }, env)).status).toBe(200)
    expect((await app.request('/api/me', { headers: conBearer(token) }, env)).status).toBe(401)
    expect((await renovar(token)).status).toBe(401)
  })
  it('renueva un token RECIÉN vencido (dentro de la tolerancia de 30 días)', async () => {
    await crearUsuario('renueva2@t.com')
    const token = await loginApp('renueva2@t.com')
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-5 days') WHERE id=?`).bind(idDeToken(token)).run()
    // vencido: cualquier endpoint normal responde 401 con el código para renovar
    const me = await app.request('/api/me', { headers: conBearer(token) }, env)
    expect(me.status).toBe(401)
    expect((await me.json<any>()).codigo).toBe('sesion_invalida')
    const res = await renovar(token)
    expect(res.status).toBe(200)
    const { token: nuevo } = await res.json<{ token: string }>()
    expect((await app.request('/api/me', { headers: conBearer(nuevo) }, env)).status).toBe(200)
  })
  it('rechaza un token vencido hace más de 30 días con codigo sesion_invalida', async () => {
    await crearUsuario('renueva3@t.com')
    const token = await loginApp('renueva3@t.com')
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-31 days') WHERE id=?`).bind(idDeToken(token)).run()
    const res = await renovar(token)
    expect(res.status).toBe(401)
    expect((await res.json<any>()).codigo).toBe('sesion_invalida')
  })
  it('rechaza tokens con firma inválida o inexistentes', async () => {
    expect((await renovar('basura.firma')).status).toBe(401)
    const sinHeader = await app.request('/api/sesion/renovar', { method: 'POST' }, env)
    expect(sinHeader.status).toBe(401)
    expect((await sinHeader.json<any>()).codigo).toBe('sesion_invalida')
  })
  it('la purga del login NO borra sesiones dentro de la ventana de renovación', async () => {
    await crearUsuario('renueva4@t.com')
    await crearUsuario('otro-login@t.com')
    const token = await loginApp('renueva4@t.com')
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-5 days') WHERE id=?`).bind(idDeToken(token)).run()
    await loginApp('otro-login@t.com') // dispara la purga oportunista
    expect((await renovar(token)).status).toBe(200)
  })
})

describe('dispositivos', () => {
  it('registra, ancla la sesión, lista con actual=1 y actualiza por id', async () => {
    await crearUsuario('disp1@t.com')
    const token = await loginApp('disp1@t.com')
    const alta = await app.request('/api/dispositivos', {
      method: 'POST',
      body: JSON.stringify({ plataforma: 'android', nombre: 'Teléfono del dueño', modelo: 'Pixel 6' }),
      headers: conBearer(token, { 'content-type': 'application/json' }),
    }, env)
    expect(alta.status).toBe(200)
    const { id } = await alta.json<{ id: string }>()
    // la sesión quedó anclada al dispositivo
    const ses = await env.DB.prepare(`SELECT dispositivo_id FROM sesiones WHERE id=?`).bind(idDeToken(token)).first<any>()
    expect(ses?.dispositivo_id).toBe(id)
    // lista con actual=1
    const lista = await app.request('/api/dispositivos', { headers: conBearer(token) }, env)
    const { dispositivos } = await lista.json<any>()
    expect(dispositivos).toHaveLength(1)
    expect(dispositivos[0]).toMatchObject({ id, plataforma: 'android', modelo: 'Pixel 6', actual: 1, revocado: 0 })
    // actualizar con el mismo id no crea otro
    const upd = await app.request('/api/dispositivos', {
      method: 'POST',
      body: JSON.stringify({ id, plataforma: 'android', nombre: 'Teléfono del dueño', modelo: 'Pixel 6 Pro' }),
      headers: conBearer(token, { 'content-type': 'application/json' }),
    }, env)
    expect((await upd.json<any>()).id).toBe(id)
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM dispositivos WHERE usuario_id=(SELECT usuario_id FROM sesiones WHERE id=?)`)
      .bind(idDeToken(token)).first<{ n: number }>()
    expect(n?.n).toBe(1)
  })
  it('rechaza plataformas fuera del catálogo', async () => {
    await crearUsuario('disp2@t.com')
    const token = await loginApp('disp2@t.com')
    const res = await app.request('/api/dispositivos', {
      method: 'POST', body: JSON.stringify({ plataforma: 'windows' }),
      headers: conBearer(token, { 'content-type': 'application/json' }),
    }, env)
    expect(res.status).toBe(400)
  })
  it('revocar mata las sesiones del dispositivo y niega la renovación para siempre', async () => {
    await crearUsuario('disp3@t.com')
    const token = await loginApp('disp3@t.com')
    const alta = await app.request('/api/dispositivos', {
      method: 'POST', body: JSON.stringify({ plataforma: 'android', modelo: 'Moto G' }),
      headers: conBearer(token, { 'content-type': 'application/json' }),
    }, env)
    const { id } = await alta.json<{ id: string }>()
    // segunda sesión del mismo usuario desde otro aparato para ejecutar la revocación
    const token2 = await loginApp('disp3@t.com')
    const del = await app.request(`/api/dispositivos/${id}`, { method: 'DELETE', headers: conBearer(token2) }, env)
    expect(del.status).toBe(200)
    // la sesión anclada al dispositivo murió; la otra sigue viva
    expect((await app.request('/api/me', { headers: conBearer(token) }, env)).status).toBe(401)
    expect((await app.request('/api/me', { headers: conBearer(token2) }, env)).status).toBe(200)
    // ni siquiera con tolerancia: renovar un token de dispositivo revocado da sesion_invalida
    const res = await renovar(token)
    expect(res.status).toBe(401)
    expect((await res.json<any>()).codigo).toBe('sesion_invalida')
    // y registrarlo de nuevo con el id revocado crea un dispositivo NUEVO (no lo resucita)
    const rereg = await app.request('/api/dispositivos', {
      method: 'POST', body: JSON.stringify({ id, plataforma: 'android', modelo: 'Moto G' }),
      headers: conBearer(token2, { 'content-type': 'application/json' }),
    }, env)
    expect((await rereg.json<any>()).id).not.toBe(id)
  })
  it('renovar con sesión de dispositivo revocado también muere aunque la sesión siga en la tabla', async () => {
    await crearUsuario('disp5@t.com')
    const token = await loginApp('disp5@t.com')
    const alta = await app.request('/api/dispositivos', {
      method: 'POST', body: JSON.stringify({ plataforma: 'ios', modelo: 'iPhone 13' }),
      headers: conBearer(token, { 'content-type': 'application/json' }),
    }, env)
    const { id } = await alta.json<{ id: string }>()
    // revocación directa en BD sin borrar la sesión (simula cualquier otra vía)
    await env.DB.prepare(`UPDATE dispositivos SET revocado=1 WHERE id=?`).bind(id).run()
    const res = await renovar(token)
    expect(res.status).toBe(401)
    expect((await res.json<any>()).codigo).toBe('sesion_invalida')
  })
  it('aislamiento: un usuario no ve ni revoca dispositivos ajenos', async () => {
    await crearUsuario('duenio@t.com')
    await crearUsuario('intruso@t.com')
    const tokenA = await loginApp('duenio@t.com')
    const tokenB = await loginApp('intruso@t.com')
    const alta = await app.request('/api/dispositivos', {
      method: 'POST', body: JSON.stringify({ plataforma: 'android', modelo: 'Galaxy A54' }),
      headers: conBearer(tokenA, { 'content-type': 'application/json' }),
    }, env)
    const { id } = await alta.json<{ id: string }>()
    // B no lo ve
    const listaB = await app.request('/api/dispositivos', { headers: conBearer(tokenB) }, env)
    const { dispositivos: dispB } = await listaB.json<any>()
    expect(dispB.find((d: any) => d.id === id)).toBeUndefined()
    // B no lo revoca (404) y el dispositivo y la sesión de A quedan intactos
    const del = await app.request(`/api/dispositivos/${id}`, { method: 'DELETE', headers: conBearer(tokenB) }, env)
    expect(del.status).toBe(404)
    const d = await env.DB.prepare(`SELECT revocado FROM dispositivos WHERE id=?`).bind(id).first<any>()
    expect(d?.revocado).toBe(0)
    expect((await app.request('/api/me', { headers: conBearer(tokenA) }, env)).status).toBe(200)
  })
})

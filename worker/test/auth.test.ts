import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { hashPassword } from '../src/lib/crypto'
import { DIAS_SESION, DIAS_SESION_SUPERADMIN_SIN_ANCLA, DIAS_TOLERANCIA_RENOVACION } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }, env)

async function crearUsuario(email: string, clave: string) {
  const id = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(id, email, 'Test', await hashPassword(clave)).run()
  return id
}

describe('auth', () => {
  it('login correcto devuelve cookie y /api/me funciona', async () => {
    await crearUsuario('ana@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'ana@test.com', password: 'Clave12345!' })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('__Host-aldaba_s=')
    const me = await app.request('/api/me', { headers: { cookie } }, env)
    expect(me.status).toBe(200)
    expect((await me.json<any>()).email).toBe('ana@test.com')
  })
  it('login es case-insensitive en el email', async () => {
    await crearUsuario('mixta@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'MiXtA@Test.com', password: 'Clave12345!' })
    expect(res.status).toBe(200)
  })
  it('login incorrecto da 401 y se bloquea al 6º intento (rate limit)', async () => {
    await crearUsuario('beto@test.com', 'Clave12345!')
    for (let i = 0; i < 5; i++) {
      const r = await post('/api/login', { email: 'beto@test.com', password: 'mal' })
      expect(r.status).toBe(401)
    }
    const bloqueado = await post('/api/login', { email: 'beto@test.com', password: 'Clave12345!' })
    expect(bloqueado.status).toBe(429)
  })
  it('registro por invitación crea usuario + membresía y quema el token', async () => {
    const { condoId } = await seedCondo()
    const token = 'tok-' + uuid()
    await env.DB.prepare(
      `INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`,
    ).bind(token, condoId, 'residente').run()
    const res = await post('/api/registro', {
      token, nombre: 'Caro', email: 'caro@test.com', password: 'Clave12345!',
    })
    expect(res.status).toBe(200)
    const m = await env.DB.prepare(
      `SELECT m.rol FROM membresias m JOIN usuarios u ON u.id=m.usuario_id WHERE u.email=?`,
    ).bind('caro@test.com').first<{ rol: string }>()
    expect(m?.rol).toBe('residente')
    const otra = await post('/api/registro', { token, nombre: 'X', email: 'x@test.com', password: 'Clave12345!' })
    expect(otra.status).toBe(410)
  })
  it('registro duplicado en la misma unidad da 409', async () => {
    const { condoId } = await seedCondo()
    const unidadId = uuid()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,?)`).bind(unidadId, condoId, '7-C').run()
    const mkInv = async () => {
      const t = 'tok-' + uuid()
      await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,unidad_id,rol,expira) VALUES(?,?,?,?,datetime('now','+7 days'))`)
        .bind(t, condoId, unidadId, 'residente').run()
      return t
    }
    const t1 = await mkInv(), t2 = await mkInv()
    expect((await post('/api/registro', { token: t1, nombre: 'D', email: 'dup@test.com', password: 'Clave12345!' })).status).toBe(200)
    expect((await post('/api/registro', { token: t2, nombre: 'D', email: 'dup@test.com', password: 'Clave12345!' })).status).toBe(409)
  })
  it('login exitoso resetea el contador de intentos', async () => {
    await crearUsuario('reset@test.com', 'Clave12345!')
    for (let i = 0; i < 4; i++) await post('/api/login', { email: 'reset@test.com', password: 'mal' })
    expect((await post('/api/login', { email: 'reset@test.com', password: 'Clave12345!' })).status).toBe(200)
    expect((await post('/api/login', { email: 'reset@test.com', password: 'Clave12345!' })).status).toBe(200)
  })
  it('registro contra email existente con clave equivocada se ratelimita', async () => {
    const { condoId } = await seedCondo()
    await crearUsuario('victima@test.com', 'Clave12345!')
    const mkInv = async () => {
      const t = 'tok-' + uuid()
      await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`)
        .bind(t, condoId, 'residente').run()
      return t
    }
    for (let i = 0; i < 5; i++) {
      const r = await post('/api/registro', { token: await mkInv(), nombre: 'X', email: 'victima@test.com', password: 'adivinanza' + i })
      expect(r.status).toBe(409)
    }
    const bloqueado = await post('/api/registro', { token: await mkInv(), nombre: 'X', email: 'victima@test.com', password: 'Clave12345!' })
    expect(bloqueado.status).toBe(429)
  })
  it('registro con invitación expirada da 410 y password corta da 400', async () => {
    const { condoId } = await seedCondo()
    const token = 'tok-' + uuid()
    await env.DB.prepare(
      `INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','-1 day'))`,
    ).bind(token, condoId, 'residente').run()
    expect((await post('/api/registro', { token, nombre: 'X', email: 'y@test.com', password: 'Clave12345!' })).status).toBe(410)
    const t2 = 'tok-' + uuid()
    await env.DB.prepare(
      `INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`,
    ).bind(t2, condoId, 'residente').run()
    expect((await post('/api/registro', { token: t2, nombre: 'X', email: 'z@test.com', password: 'corta' })).status).toBe(400)
  })
  it('logout borra la sesión: la cookie deja de servir y responde 401 después', async () => {
    await crearUsuario('sale@test.com', 'Clave12345!')
    const login = await post('/api/login', { email: 'sale@test.com', password: 'Clave12345!' })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await app.request('/api/me', { headers: { cookie } }, env)).status).toBe(200)
    const out = await app.request('/api/logout', { method: 'POST', headers: { cookie } }, env)
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    // la fila de sesión ya no existe y la cookie vieja da 401
    expect((await app.request('/api/me', { headers: { cookie } }, env)).status).toBe(401)
    const quedan = await env.DB.prepare(`SELECT COUNT(*) n FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email=?`)
      .bind('sale@test.com').first<{ n: number }>()
    expect(quedan!.n).toBe(0)
  })
  it('logout sin cookie responde 200 (no rompe)', async () => {
    const out = await app.request('/api/logout', { method: 'POST' }, env)
    expect(out.status).toBe(200)
  })
  it('usuario existente vincula una 2ª unidad con su clave correcta (200)', async () => {
    const { condoId } = await seedCondo()
    const u1 = uuid(), u2 = uuid()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,'A'),(?,?,'B')`).bind(u1, condoId, u2, condoId).run()
    const mkInv = async (unidadId: string) => {
      const t = 'tok-' + uuid()
      await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,unidad_id,rol,expira) VALUES(?,?,?,'residente',datetime('now','+7 days'))`)
        .bind(t, condoId, unidadId).run()
      return t
    }
    const r1 = await post('/api/registro', { token: await mkInv(u1), nombre: 'Multi', email: 'multi@test.com', password: 'Clave12345!' })
    expect(r1.status).toBe(200)
    const r2 = await post('/api/registro', { token: await mkInv(u2), nombre: 'Multi', email: 'multi@test.com', password: 'Clave12345!' })
    expect(r2.status).toBe(200) // misma persona, 2ª unidad, clave correcta
    const filas = await env.DB.prepare(
      `SELECT COUNT(*) usuarios FROM usuarios WHERE email=?`,
    ).bind('multi@test.com').first<{ usuarios: number }>()
    expect(filas!.usuarios).toBe(1) // un solo usuario
    const membresias = await env.DB.prepare(
      `SELECT COUNT(*) n FROM membresias m JOIN usuarios u ON u.id=m.usuario_id WHERE u.email=?`,
    ).bind('multi@test.com').first<{ n: number }>()
    expect(membresias!.n).toBe(2) // dos membresías (dos unidades)
  })
  it('la cookie del superadmin sin dispositivo anclado dura menos que la de una cuenta normal', async () => {
    const sid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,1)`)
      .bind(sid, 'root@test.com', 'Root', await hashPassword('Clave12345!')).run()
    const login = await post('/api/login', { email: 'root@test.com', password: 'Clave12345!' })
    expect(login.headers.get('set-cookie'))
      .toContain(`Max-Age=${(DIAS_SESION_SUPERADMIN_SIN_ANCLA + DIAS_TOLERANCIA_RENOVACION) * 86400}`)
    await crearUsuario('normal-cookie@test.com', 'Clave12345!')
    const normal = await post('/api/login', { email: 'normal-cookie@test.com', password: 'Clave12345!' })
    expect(normal.headers.get('set-cookie')).toContain(`Max-Age=${(DIAS_SESION + DIAS_TOLERANCIA_RENOVACION) * 86400}`)
  })
  it('el usuario Demo entra sin escribir arroba, en cualquier caja', async () => {
    await crearUsuario('demo@aldaba.demo', 'Demo1234')
    for (const ident of ['Demo', 'demo', 'DEMO', 'demo@aldaba.demo']) {
      const res = await post('/api/login', { email: ident, password: 'Demo1234' })
      expect(res.status, `fallo con "${ident}"`).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('__Host-aldaba_s=')
    }
  })
  it('un identificador sin arroba que no es cuenta demo sigue dando 401', async () => {
    const res = await post('/api/login', { email: 'inventado', password: 'Demo1234' })
    expect(res.status).toBe(401)
  })
})

describe('sesion por token Bearer (app nativa)', () => {
  it('login con X-Cliente: app devuelve token y ese Bearer autentica /api/me sin cookie', async () => {
    await crearUsuario('movil@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'movil@test.com', password: 'Clave12345!' }, { 'X-Cliente': 'app' })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(20)
    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${body.token}` } }, env)
    expect(me.status).toBe(200)
    expect((await me.json<any>()).email).toBe('movil@test.com')
  })
  it('login SIN X-Cliente no devuelve token (la web no cambia)', async () => {
    await crearUsuario('webonly@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'webonly@test.com', password: 'Clave12345!' })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.token).toBeUndefined()
    expect(res.headers.get('set-cookie')).toContain('__Host-aldaba_s=')
  })
  it('Bearer invalido o mal firmado da 401', async () => {
    await crearUsuario('firmas@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'firmas@test.com', password: 'Clave12345!' }, { 'X-Cliente': 'app' })
    const { token } = await res.json<any>()
    // basura total
    expect((await app.request('/api/me', { headers: { authorization: 'Bearer basura' } }, env)).status).toBe(401)
    // id real con firma alterada
    const [id] = token.split('.')
    expect((await app.request('/api/me', { headers: { authorization: `Bearer ${id}.firmafalsa` } }, env)).status).toBe(401)
    // esquema que no es Bearer
    expect((await app.request('/api/me', { headers: { authorization: `Basic ${token}` } }, env)).status).toBe(401)
  })
  it('logout con Bearer invalida la sesion', async () => {
    await crearUsuario('salemovil@test.com', 'Clave12345!')
    const res = await post('/api/login', { email: 'salemovil@test.com', password: 'Clave12345!' }, { 'X-Cliente': 'app' })
    const { token } = await res.json<any>()
    const auth = { authorization: `Bearer ${token}` }
    expect((await app.request('/api/me', { headers: auth }, env)).status).toBe(200)
    const out = await app.request('/api/logout', { method: 'POST', headers: auth }, env)
    expect(out.status).toBe(200)
    expect((await app.request('/api/me', { headers: auth }, env)).status).toBe(401)
    const quedan = await env.DB.prepare(`SELECT COUNT(*) n FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email=?`)
      .bind('salemovil@test.com').first<{ n: number }>()
    expect(quedan!.n).toBe(0)
  })
  it('registro por invitacion con X-Cliente: app devuelve token y sin la cabecera no', async () => {
    const { condoId } = await seedCondo()
    const mkInv = async () => {
      const t = 'tok-' + uuid()
      await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`)
        .bind(t, condoId, 'residente').run()
      return t
    }
    const r1 = await post('/api/registro', { token: await mkInv(), nombre: 'App', email: 'appreg@test.com', password: 'Clave12345!' }, { 'X-Cliente': 'app' })
    expect(r1.status).toBe(200)
    const b1 = await r1.json<any>()
    expect(typeof b1.token).toBe('string')
    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${b1.token}` } }, env)
    expect(me.status).toBe(200)
    // sin la cabecera, el registro sigue igual que la web (solo cookie)
    const r2 = await post('/api/registro', { token: await mkInv(), nombre: 'Web', email: 'webreg@test.com', password: 'Clave12345!' })
    expect(r2.status).toBe(200)
    expect((await r2.json<any>()).token).toBeUndefined()
  })
})

/* ── Blindaje de cuentas demo (auditoría 2026-08-18) ─────────────────────── */
describe('demo', () => {
  const seedCondoDemo = async () => {
    const s = await seedCondo('Demo ' + uuid())
    await env.DB.prepare(`UPDATE condominios SET es_demo=1 WHERE id=?`).bind(s.condoId).run()
    return s
  }
  const darMembresia = (usuarioId: string, condoId: string, rol = 'residente') =>
    env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,?)`)
      .bind(uuid(), usuarioId, condoId, rol).run()
  const mkInv = async (condoId: string) => {
    const t = 'tok-' + uuid()
    await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`)
      .bind(t, condoId, 'residente').run()
    return t
  }

  it('demo/login entra solo con el correo si TODAS las membresías son demo', async () => {
    const { condoId } = await seedCondoDemo()
    const uid = await crearUsuario('puro@avila.demo', 'ClaveServidor123!')
    await darMembresia(uid, condoId)
    const res = await post('/api/demo/login', { email: 'puro@avila.demo' })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.token).toBeUndefined() // nunca devuelve clave ni token en web
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('__Host-aldaba_s=')
    const me = await app.request('/api/me', { headers: { cookie: cookie.split(';')[0] } }, env)
    expect(me.status).toBe(200)
    const mb = await me.json<any>()
    expect(mb.email).toBe('puro@avila.demo')
    expect(mb.condominios.every((c: any) => c.es_demo === 1)).toBe(true) // /me expone es_demo para la SPA
    // en la app nativa sí entrega el token de sesión (mismo contrato que /login)
    const app2 = await post('/api/demo/login', { email: 'puro@avila.demo' }, { 'X-Cliente': 'app' })
    expect(app2.status).toBe(200)
    expect(typeof (await app2.json<any>()).token).toBe('string')
  })

  it('demo/login rechaza 403 cuentas con alguna membresía real, sin membresías o inexistentes', async () => {
    const { condoId: demoId } = await seedCondoDemo()
    const { condoId: realId } = await seedCondo()
    const mixto = await crearUsuario('mixto@avila.demo', 'ClaveServidor123!')
    await darMembresia(mixto, demoId)
    await darMembresia(mixto, realId)
    expect((await post('/api/demo/login', { email: 'mixto@avila.demo' })).status).toBe(403)
    const real = await crearUsuario('cliente@real.com', 'ClaveServidor123!')
    await darMembresia(real, realId)
    expect((await post('/api/demo/login', { email: 'cliente@real.com' })).status).toBe(403)
    await crearUsuario('huerfano@test.com', 'ClaveServidor123!') // sin membresías: tampoco
    expect((await post('/api/demo/login', { email: 'huerfano@test.com' })).status).toBe(403)
    expect((await post('/api/demo/login', { email: 'nadie@nunca.com' })).status).toBe(403)
  })

  it('demo/login rechaza superadmin y org_admin demo cuya organización tiene condominios reales', async () => {
    const { condoId } = await seedCondoDemo()
    const sa = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,1)`)
      .bind(sa, 'root@avila.demo', 'Root', await hashPassword('ClaveServidor123!')).run()
    await darMembresia(sa, condoId)
    expect((await post('/api/demo/login', { email: 'root@avila.demo' })).status).toBe(403)
    // org_admin en condominio demo, pero la org tiene además un condominio REAL alcanzable
    const { orgId, condoId: demoOrgCondo } = await seedCondoDemo()
    await env.DB.prepare(`INSERT INTO condominios(id,organizacion_id,nombre) VALUES(?,?,?)`)
      .bind(uuid(), orgId, 'Real de la org').run()
    const oa = await crearUsuario('orgadmin@avila.demo', 'ClaveServidor123!')
    await darMembresia(oa, demoOrgCondo, 'org_admin')
    expect((await post('/api/demo/login', { email: 'orgadmin@avila.demo' })).status).toBe(403)
  })

  it('registro: una cuenta 100% demo no puede vincularse a un condominio real (409)', async () => {
    const { condoId: demoId } = await seedCondoDemo()
    const { condoId: realId } = await seedCondo()
    const uid = await crearUsuario('atrapada@avila.demo', 'ClaveServidor123!')
    await darMembresia(uid, demoId)
    const res = await post('/api/registro', {
      token: await mkInv(realId), nombre: 'Demo', email: 'atrapada@avila.demo', password: 'ClaveServidor123!',
    })
    expect(res.status).toBe(409)
    expect(((await res.json<any>()).error as string)).toContain('demostración')
    // la invitación NO se quemó y ninguna membresía real se creó
    const m = await env.DB.prepare(`SELECT COUNT(*) n FROM membresias WHERE usuario_id=? AND condominio_id=?`)
      .bind(uid, realId).first<{ n: number }>()
    expect(m!.n).toBe(0)
  })

  it('registro: una cuenta real no entra a la demo (409) y demo→demo sí se permite', async () => {
    const { condoId: demoId } = await seedCondoDemo()
    const { condoId: demoId2 } = await seedCondoDemo()
    const { condoId: realId } = await seedCondo()
    const real = await crearUsuario('vecina@real.com', 'ClaveServidor123!')
    await darMembresia(real, realId)
    const r = await post('/api/registro', {
      token: await mkInv(demoId), nombre: 'Vecina', email: 'vecina@real.com', password: 'ClaveServidor123!',
    })
    expect(r.status).toBe(409)
    // control: demo → otro condominio demo sigue funcionando
    const dm = await crearUsuario('salta@avila.demo', 'ClaveServidor123!')
    await darMembresia(dm, demoId)
    const ok = await post('/api/registro', {
      token: await mkInv(demoId2), nombre: 'Salta', email: 'salta@avila.demo', password: 'ClaveServidor123!',
    })
    expect(ok.status).toBe(200)
  })
})

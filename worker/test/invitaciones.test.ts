import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function setup() {
  const { condoId } = await seedCondo()
  const unidadId = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,?)`)
    .bind(unidadId, condoId, '12-B').run()
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'A', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
    .bind(uuid(), uid, condoId).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { condoId, unidadId, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId, 'content-type': 'application/json' } }
}

describe('invitaciones', () => {
  it('genera invitación de residente para una unidad', async () => {
    const { unidadId, headers } = await setup()
    const res = await app.request('/api/invitaciones', {
      method: 'POST', headers, body: JSON.stringify({ unidad_id: unidadId }),
    }, env)
    expect(res.status).toBe(200)
    const inv = await res.json<any>()
    expect(inv.url).toContain('/registro?token=')
    expect(inv.unidad).toBe('12-B')
  })
  it('la info pública de la invitación no exige sesión', async () => {
    const { unidadId, headers } = await setup()
    const inv = await (await app.request('/api/invitaciones', {
      method: 'POST', headers, body: JSON.stringify({ unidad_id: unidadId }),
    }, env)).json<any>()
    const pub = await app.request(`/api/invitacion/${inv.token}`, {}, env)
    expect(pub.status).toBe(200)
    const data = await pub.json<any>()
    expect(data.condominio).toBe('Residencias Test')
    expect(data.unidad).toBe('12-B')
  })
  it('rechaza unidad de otro condominio', async () => {
    const a = await setup()
    const b = await setup()
    const res = await app.request('/api/invitaciones', {
      method: 'POST', headers: a.headers, body: JSON.stringify({ unidad_id: b.unidadId }),
    }, env)
    expect(res.status).toBe(404)
  })
  it('lista las invitaciones del condominio', async () => {
    const { unidadId, headers } = await setup()
    await app.request('/api/invitaciones', { method: 'POST', headers, body: JSON.stringify({ unidad_id: unidadId }) }, env)
    const res = await app.request('/api/invitaciones', { headers }, env)
    expect(res.status).toBe(200)
    const data = await res.json<any>()
    expect(data.invitaciones.length).toBe(1)
    expect(data.invitaciones[0].unidad).toBe('12-B')
    expect(data.invitaciones[0].usada).toBe(0)
  })
  it('la lista no expone invitaciones de admin', async () => {
    const { condoId, unidadId, headers } = await setup()
    await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,?,datetime('now','+7 days'))`)
      .bind('tok-admin-' + uuid(), condoId, 'admin').run()
    await app.request('/api/invitaciones', { method: 'POST', headers, body: JSON.stringify({ unidad_id: unidadId }) }, env)
    const data = await (await app.request('/api/invitaciones', { headers }, env)).json<any>()
    expect(data.invitaciones.length).toBe(1)
    expect(data.invitaciones[0].rol).toBe('residente')
    expect(data.invitaciones[0].creada).toBeTruthy()
  })
})

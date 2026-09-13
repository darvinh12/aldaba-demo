import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, uuid } from './helpers'
import { hashPassword } from '../src/lib/crypto'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function sesionDe(esSuper: number) {
  const id = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,?)`)
    .bind(id, `${id}@t.com`, 'S', await hashPassword('x'.repeat(12)), esSuper).run()
  const { valor } = await crearSesion(env.DB, id, env.SESSION_SECRET, 7)
  return `${COOKIE}=${valor}`
}

const llamar = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, env)

describe('superadmin', () => {
  it('usuario normal recibe 403', async () => {
    const cookie = await sesionDe(0)
    expect((await llamar(cookie, 'GET', '/api/sa/overview')).status).toBe(403)
  })
  it('flujo completo: org → condominio → invitación admin → suspender', async () => {
    const cookie = await sesionDe(1)
    const org = await (await llamar(cookie, 'POST', '/api/sa/organizaciones', { nombre: 'Admin C.A.' })).json<any>()
    expect(org.id).toBeTruthy()
    const condo = await (await llamar(cookie, 'POST', '/api/sa/condominios',
      { organizacion_id: org.id, nombre: 'Res. Prueba', direccion: 'Caracas' })).json<any>()
    expect(condo.id).toBeTruthy()
    const inv = await (await llamar(cookie, 'POST', '/api/sa/invitaciones',
      { condominio_id: condo.id, rol: 'admin' })).json<any>()
    expect(inv.url).toContain('/registro?token=')
    const susp = await llamar(cookie, 'POST', `/api/sa/condominios/${condo.id}/suspension`, { suspendido: 1 })
    expect(susp.status).toBe(200)
    const ov = await (await llamar(cookie, 'GET', '/api/sa/overview')).json<any>()
    const fila = ov.condominios.find((x: any) => x.id === condo.id)
    expect(fila.suspendido).toBe(1)
  })
  it('suspensión valida el body: sin body y string "false" dan 400', async () => {
    const cookie = await sesionDe(1)
    const org = await (await llamar(cookie, 'POST', '/api/sa/organizaciones', { nombre: 'V C.A.' })).json<any>()
    const condo = await (await llamar(cookie, 'POST', '/api/sa/condominios', { organizacion_id: org.id, nombre: 'Res. V' })).json<any>()
    expect((await llamar(cookie, 'POST', `/api/sa/condominios/${condo.id}/suspension`)).status).toBe(400)
    expect((await llamar(cookie, 'POST', `/api/sa/condominios/${condo.id}/suspension`, { suspendido: 'false' })).status).toBe(400)
    expect((await llamar(cookie, 'POST', `/api/sa/condominios/${condo.id}/suspension`, { suspendido: true })).status).toBe(200)
  })
  it('valida rol de invitación', async () => {
    const cookie = await sesionDe(1)
    const r = await llamar(cookie, 'POST', '/api/sa/invitaciones', { condominio_id: 'x', rol: 'residente' })
    expect(r.status).toBe(400)
  })
})

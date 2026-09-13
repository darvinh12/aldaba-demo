import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function adminDe(condoId: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'A', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
    .bind(uuid(), uid, condoId).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}

describe('estructura', () => {
  it('importa CSV: crea torres y unidades, idempotente', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await adminDe(condoId)
    const csv = 'torre,unidad,alicuota\nA,1-A,0.5\nA,1-B,0.5\nB,PH,1.0\n'
    const res = await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: csv,
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ torres: 2, unidades: 3, actualizadas: 0 })
    // re-importar el mismo CSV ahora ACTUALIZA (upsert de alícuota), no ignora
    const otra = await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: csv,
    }, env)
    expect(await otra.json()).toEqual({ torres: 0, unidades: 0, actualizadas: 3 })
  })
  it('re-importar con alícuota distinta actualiza el valor', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await adminDe(condoId)
    await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: 'A,1-A,0.5\n',
    }, env)
    const r2 = await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: 'A,1-A,0.9\n',
    }, env)
    expect(await r2.json()).toEqual({ torres: 0, unidades: 0, actualizadas: 1 })
    const est = await (await app.request('/api/estructura', { headers }, env)).json<any>()
    expect(est.torres[0].unidades[0].alicuota).toBe(0.9)
  })
  it('lista la estructura', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await adminDe(condoId)
    await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: 'A,1-A\n',
    }, env)
    const res = await app.request('/api/estructura', { headers }, env)
    const data = await res.json<any>()
    expect(data.torres[0].nombre).toBe('A')
    expect(data.torres[0].unidades[0].nombre).toBe('1-A')
  })
  it('importa 120 unidades en batches sin fallar', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await adminDe(condoId)
    const csv = Array.from({ length: 120 }, (_, i) => `T,${i + 1}-X,0.1`).join('\n')
    const res = await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: csv,
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ torres: 1, unidades: 120, actualizadas: 0 })
  })
  it('GET /estructura devuelve la suma de alícuotas del condominio (calculada en el backend)', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await adminDe(condoId)
    // sin unidades: la suma existe y es 0
    const vacio = await (await app.request('/api/estructura', { headers }, env)).json<any>()
    expect(vacio.suma_alicuotas).toBe(0)
    // con unidades que NO suman 1: la suma real llega tal cual
    await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...headers, 'content-type': 'text/csv' }, body: 'A,1-A,0.5\nA,1-B,0.3\n',
    }, env)
    const data = await (await app.request('/api/estructura', { headers }, env)).json<any>()
    expect(data.suma_alicuotas).toBeCloseTo(0.8, 6)
    // otro condominio no contamina la suma (aislamiento por tenant)
    const otro = await seedCondo()
    const h2 = await adminDe(otro.condoId)
    await app.request('/api/estructura/importar', {
      method: 'POST', headers: { ...h2.headers, 'content-type': 'text/csv' }, body: 'Z,9-Z,5\n',
    }, env)
    const data2 = await (await app.request('/api/estructura', { headers }, env)).json<any>()
    expect(data2.suma_alicuotas).toBeCloseTo(0.8, 6)
  })
  it('residente no puede importar (403)', async () => {
    const { condoId } = await seedCondo()
    const uid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
      .bind(uid, `${uid}@t.com`, 'R', 'h').run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'residente')`)
      .bind(uuid(), uid, condoId).run()
    const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
    const res = await app.request('/api/estructura/importar', {
      method: 'POST',
      headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId, 'content-type': 'text/csv' },
      body: 'A,1-A\n',
    }, env)
    expect(res.status).toBe(403)
  })
})

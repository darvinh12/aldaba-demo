import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'P', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,?)`)
    .bind(uuid(), uid, condoId, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId, 'content-type': 'application/json' } }
}

describe('comunicados', () => {
  it('admin publica; residente lo ve, lo marca leído y el % de lectura sube', async () => {
    const { condoId } = await seedCondo()
    const admin = await persona(condoId, 'admin')
    const res1 = await persona(condoId, 'residente')
    await persona(condoId, 'residente') // segundo residente que no leerá
    const crear = await app.request('/api/comunicados', {
      method: 'POST', headers: admin.headers,
      body: JSON.stringify({ titulo: 'Corte de agua', cuerpo: 'Mañana 9am torres A y B' }),
    }, env)
    expect(crear.status).toBe(200)
    const { id } = await crear.json<any>()
    const lista = await (await app.request('/api/comunicados', { headers: res1.headers }, env)).json<any>()
    expect(lista.comunicados[0].titulo).toBe('Corte de agua')
    expect(lista.comunicados[0].leido).toBe(0)
    await app.request(`/api/comunicados/${id}/leer`, { method: 'POST', headers: res1.headers }, env)
    const paraAdmin = await (await app.request('/api/comunicados', { headers: admin.headers }, env)).json<any>()
    expect(paraAdmin.comunicados[0].lectores).toBe(1)
    expect(paraAdmin.comunicados[0].destinatarios).toBe(2)
  })
  it('marcar leído dos veces no duplica y leer id ajeno da 404', async () => {
    const { condoId } = await seedCondo()
    const admin = await persona(condoId, 'admin')
    const res1 = await persona(condoId, 'residente')
    const { id } = await (await app.request('/api/comunicados', {
      method: 'POST', headers: admin.headers, body: JSON.stringify({ titulo: 'T', cuerpo: 'C' }),
    }, env)).json<any>()
    await app.request(`/api/comunicados/${id}/leer`, { method: 'POST', headers: res1.headers }, env)
    const dos = await app.request(`/api/comunicados/${id}/leer`, { method: 'POST', headers: res1.headers }, env)
    expect(dos.status).toBe(200)
    const paraAdmin = await (await app.request('/api/comunicados', { headers: admin.headers }, env)).json<any>()
    expect(paraAdmin.comunicados[0].lectores).toBe(1)
    const { condoId: otro } = await seedCondo()
    const adminOtro = await persona(otro, 'admin')
    const { id: idOtro } = await (await app.request('/api/comunicados', {
      method: 'POST', headers: adminOtro.headers, body: JSON.stringify({ titulo: 'X', cuerpo: 'Y' }),
    }, env)).json<any>()
    const cruzado = await app.request(`/api/comunicados/${idOtro}/leer`, { method: 'POST', headers: res1.headers }, env)
    expect(cruzado.status).toBe(404)
  })
  it('residente NO puede publicar', async () => {
    const { condoId } = await seedCondo()
    const r = await persona(condoId, 'residente')
    const res = await app.request('/api/comunicados', {
      method: 'POST', headers: r.headers, body: JSON.stringify({ titulo: 'x', cuerpo: 'y' }),
    }, env)
    expect(res.status).toBe(403)
  })
  it('lectura de portería no infla el métrico de lectores', async () => {
    const { condoId } = await seedCondo()
    const admin = await persona(condoId, 'admin')
    const guardia = await persona(condoId, 'porteria')
    await persona(condoId, 'residente')
    const { id } = await (await app.request('/api/comunicados', {
      method: 'POST', headers: admin.headers, body: JSON.stringify({ titulo: 'T', cuerpo: 'C' }),
    }, env)).json<any>()
    await app.request(`/api/comunicados/${id}/leer`, { method: 'POST', headers: guardia.headers }, env)
    const lista = await (await app.request('/api/comunicados', { headers: admin.headers }, env)).json<any>()
    expect(lista.comunicados[0].lectores).toBe(0)
    expect(lista.comunicados[0].destinatarios).toBe(1)
  })
  it('rechaza título/cuerpo excesivos', async () => {
    const { condoId } = await seedCondo()
    const admin = await persona(condoId, 'admin')
    const res = await app.request('/api/comunicados', {
      method: 'POST', headers: admin.headers,
      body: JSON.stringify({ titulo: 'x'.repeat(201), cuerpo: 'y' }),
    }, env)
    expect(res.status).toBe(400)
  })
  it('comunicados de un condominio no se ven desde otro', async () => {
    const { condoId: c1 } = await seedCondo()
    const { condoId: c2 } = await seedCondo()
    const a1 = await persona(c1, 'admin')
    const a2 = await persona(c2, 'admin')
    await app.request('/api/comunicados', {
      method: 'POST', headers: a1.headers, body: JSON.stringify({ titulo: 'solo c1', cuerpo: 'x' }),
    }, env)
    const lista2 = await (await app.request('/api/comunicados', { headers: a2.headers }, env)).json<any>()
    expect(lista2.comunicados.find((x: any) => x.titulo === 'solo c1')).toBeUndefined()
  })
})

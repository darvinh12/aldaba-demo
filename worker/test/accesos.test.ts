import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: 'admin' | 'porteria' | 'residente', unidadId?: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, rol, 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`)
    .bind(uuid(), uid, condoId, unidadId ?? null, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}
async function condo() {
  const { condoId } = await seedCondo()
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,'PB')`).bind(u, condoId).run()
  return { condoId, unidad: u }
}
const post = (path: string, headers: any, body?: any) =>
  app.request(path, { method: 'POST', headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env)
const get = (path: string, headers: any) => app.request(path, { headers }, env)

describe('accesos — pases QR', () => {
  it('residente crea pase, es público, y portería registra el ingreso (un solo uso)', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const cr = await post('/api/accesos/pases', res.headers, { visitante: 'Pedro Rojas', tipo: 'unico', horas: 5 })
    expect(cr.status).toBe(200)
    const token = (await cr.json<any>()).token
    // público sin sesión
    const pub = await app.request(`/api/accesos/pase-info/${token}`, {}, env)
    expect(pub.status).toBe(200)
    expect((await pub.json<any>()).visitante).toBe('Pedro Rojas')
    // portería lo ve en la cola y registra ingreso
    const cola = await (await get('/api/accesos/cola', port.headers)).json<any>()
    expect(cola.pases.some((p: any) => p.token === token)).toBe(true)
    expect((await post(`/api/accesos/pases/${token}/registrar`, port.headers)).status).toBe(200)
    // un pase de un uso no se puede volver a usar
    expect((await post(`/api/accesos/pases/${token}/registrar`, port.headers)).status).toBe(409)
  })
})

describe('accesos — citófono (visita sin cita)', () => {
  it('portería registra sin cita → queda pendiente → residente aprueba', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const v = await post('/api/accesos/sincita', port.headers, { visitante: 'Plomero', unidad_id: unidad, motivo: 'reparación' })
    expect(v.status).toBe(200)
    const pend = await (await get('/api/accesos/citofono', res.headers)).json<any>()
    expect(pend.pendientes).toHaveLength(1)
    const id = pend.pendientes[0].id
    expect((await post(`/api/accesos/citofono/${id}/responder`, res.headers, { aprobar: true })).status).toBe(200)
    // ya no está pendiente
    expect((await (await get('/api/accesos/citofono', res.headers)).json<any>()).pendientes).toHaveLength(0)
  })
})

describe('accesos — paquetería', () => {
  it('portería registra paquete, el residente lo ve, y se entrega', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const pk = await post('/api/accesos/paquetes', port.headers, { unidad_id: unidad, descripcion: 'Caja Amazon', remitente: 'Amazon' })
    const pid = (await pk.json<any>()).id
    expect((await (await get('/api/accesos/paquetes', res.headers)).json<any>()).paquetes).toHaveLength(1)
    expect((await post(`/api/accesos/paquetes/${pid}/entregar`, port.headers)).status).toBe(200)
    // ya no está en custodia (lista de portería vacía)
    expect((await (await get('/api/accesos/paquetes', port.headers)).json<any>()).paquetes).toHaveLength(0)
  })
})

describe('accesos — SOS y rondas', () => {
  it('residente activa SOS, portería la ve y la resuelve', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const s = await post('/api/accesos/sos', res.headers, { tipo: 'Médica' })
    const sid = (await s.json<any>()).id
    const activas = await (await get('/api/accesos/sos', port.headers)).json<any>()
    expect(activas.alertas.some((a: any) => a.id === sid)).toBe(true)
    expect((await post(`/api/accesos/sos/${sid}/atender`, port.headers, { estado: 'resuelta' })).status).toBe(200)
  })
  it('portería registra ronda con novedad y admin la ve en bitácora', async () => {
    const { condoId, unidad } = await condo()
    const port = await persona(condoId, 'porteria')
    const admin = await persona(condoId, 'admin')
    expect((await post('/api/accesos/rondas', port.headers, { checkpoint: 'Sótano', novedad: 'portón abierto' })).status).toBe(200)
    // una visita para la bitácora
    await post('/api/accesos/delivery', port.headers, { visitante: 'PedidosYa', unidad_id: unidad })
    const bit = await (await get('/api/accesos/bitacora', admin.headers)).json<any>()
    expect(bit.bitacora.length).toBeGreaterThan(0)
  })
  it('un residente NO puede registrar rondas ni ver la bitácora (403)', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    expect((await post('/api/accesos/rondas', res.headers, { checkpoint: 'x' })).status).toBe(403)
    expect((await get('/api/accesos/bitacora', res.headers)).status).toBe(403)
  })
})

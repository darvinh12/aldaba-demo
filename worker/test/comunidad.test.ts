import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: 'admin' | 'residente', unidadId?: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, rol, 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`).bind(uuid(), uid, condoId, unidadId ?? null, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}
async function condoUnidad(alicuota = 0.5) {
  const { condoId } = await seedCondo()
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre,alicuota) VALUES(?,?,'1A',?)`).bind(u, condoId, alicuota).run()
  return { condoId, unidad: u }
}
const post = (p: string, h: any, b?: any) => app.request(p, { method: 'POST', headers: { ...h, ...(b ? { 'content-type': 'application/json' } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }, env)
const patch = (p: string, h: any, b: any) => app.request(p, { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(b) }, env)
const get = (p: string, h: any) => app.request(p, { headers: h }, env)

describe('comunidad — reservas', () => {
  it('admin crea área, residente reserva, admin aprueba', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const area = await (await post('/api/comunidad/areas', admin.headers, { nombre: 'Salón', aforo: 40, costo_usd: 25 })).json<any>()
    const rv = await post('/api/comunidad/reservas', res.headers, { area_id: area.id, fecha: '2026-08-15', franja: 'noche', invitados: 20 })
    expect(rv.status).toBe(200)
    const id = (await rv.json<any>()).id
    const pend = await (await get('/api/comunidad/reservas?estado=solicitada', admin.headers)).json<any>()
    expect(pend.reservas).toHaveLength(1)
    expect((await post(`/api/comunidad/reservas/${id}/resolver`, admin.headers, { aprobar: true })).status).toBe(200)
    const mias = await (await get('/api/comunidad/reservas', res.headers)).json<any>()
    expect(mias.reservas[0].estado).toBe('aprobada')
  })
})

/** Agrega otra unidad al condominio (para que la suma de alícuotas tenga base real). */
async function otraUnidad(condoId: string, alicuota: number, nombre = '1B') {
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre,alicuota) VALUES(?,?,?,?)`).bind(u, condoId, nombre, alicuota).run()
  return u
}

describe('comunidad — votaciones ponderadas', () => {
  it('voto pesa por alícuota normalizada y no se puede votar dos veces', async () => {
    const { condoId, unidad } = await condoUnidad(0.7)
    await otraUnidad(condoId, 0.3) // suma = 1.0 → el peso normalizado coincide con la alícuota
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Color de fachada', opciones: ['Arena', 'Gris'] })).json<any>()
    let vs = await (await get('/api/comunidad/votaciones', res.headers)).json<any>()
    const opArena = vs.votaciones[0].opciones[0].id
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, res.headers, { opcion_id: opArena })).status).toBe(200)
    vs = await (await get('/api/comunidad/votaciones', res.headers)).json<any>()
    expect(vs.votaciones[0].opciones[0].peso).toBeCloseTo(0.7, 10) // alícuota / Σ alícuotas
    expect(vs.votaciones[0].miVoto).toBe(opArena)
    // segundo voto rechazado
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, res.headers, { opcion_id: opArena })).status).toBe(409)
    // cerrada → no admite votos
    await post(`/api/comunidad/votaciones/${v.id}/cerrar`, admin.headers)
    const res2 = await persona(condoId, 'residente', unidad)
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, res2.headers, { opcion_id: opArena })).status).toBe(409)
  })
  it('el voto pertenece a la unidad: un segundo residente de la misma unidad no puede votar de nuevo', async () => {
    const { condoId, unidad } = await condoUnidad(0.4)
    await otraUnidad(condoId, 0.6)
    const admin = await persona(condoId, 'admin')
    const r1 = await persona(condoId, 'residente', unidad)
    const r2 = await persona(condoId, 'residente', unidad) // misma unidad, otro ocupante
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Reja', opciones: ['Sí', 'No'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', r1.headers)).json<any>()
    const op = vs.votaciones[0].opciones[0].id
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, r1.headers, { opcion_id: op })).status).toBe(200)
    // el segundo ocupante de la MISMA unidad no puede votar: la unidad ya emitió su voto
    const rep = await post(`/api/comunidad/votaciones/${v.id}/votar`, r2.headers, { opcion_id: op })
    expect(rep.status).toBe(409)
    expect((await rep.json<any>()).error).toBe('esta unidad ya emitió su voto')
    // el peso sigue siendo una sola alícuota, no doble
    const vf = await (await get('/api/comunidad/votaciones', admin.headers)).json<any>()
    expect(vf.votaciones[0].opciones[0].peso).toBeCloseTo(0.4, 10)
  })
})

describe('comunidad — voto por unidad (persistencia y normalización)', () => {
  it('quien no tiene unidad en el condominio (admin, portería) NO puede votar: 403 con mensaje claro', async () => {
    const { condoId, unidad } = await condoUnidad(0.5)
    const admin = await persona(condoId, 'admin')
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Pintura', opciones: ['Blanco', 'Beige'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', admin.headers)).json<any>()
    const op = vs.votaciones[0].opciones[0].id
    // admin sin unidad
    const ra = await post(`/api/comunidad/votaciones/${v.id}/votar`, admin.headers, { opcion_id: op })
    expect(ra.status).toBe(403)
    expect((await ra.json<any>()).error).toBe('solo los propietarios/residentes con unidad asignada votan')
    // portería sin unidad
    const gid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(gid, `${gid}@t.com`, 'G', 'h').run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'porteria')`).bind(uuid(), gid, condoId).run()
    const { valor } = await crearSesion(env.DB, gid, env.SESSION_SECRET, 30)
    const rp = await post(`/api/comunidad/votaciones/${v.id}/votar`, { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId }, { opcion_id: op })
    expect(rp.status).toBe(403)
    expect((await rp.json<any>()).error).toBe('solo los propietarios/residentes con unidad asignada votan')
    // nadie votó: no se coló ningún peso fantasma
    const vf = await (await get('/api/comunidad/votaciones', admin.headers)).json<any>()
    expect(vf.votaciones[0].opciones[0].peso).toBe(0)
    void unidad
  })
  it('el peso se normaliza (alícuota/Σ) aunque las alícuotas del edificio no sumen 1, y el voto guarda unidad_id', async () => {
    const { condoId, unidad } = await condoUnidad(0.6) // Σ = 0.8: edificio mal cargado
    await otraUnidad(condoId, 0.2)
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Ascensor', opciones: ['Reparar', 'Cambiar'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', res.headers)).json<any>()
    const op = vs.votaciones[0].opciones[0].id
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, res.headers, { opcion_id: op })).status).toBe(200)
    const voto = await env.DB.prepare(`SELECT unidad_id, peso FROM votos WHERE votacion_id=?`).bind(v.id).first<{ unidad_id: string; peso: number }>()
    expect(voto?.unidad_id).toBe(unidad)          // la unidad queda persistida en el voto
    expect(voto?.peso).toBeCloseTo(0.75, 10)      // 0.6 / 0.8: el total posible siempre es 1
  })
  it('si las alícuotas del condominio suman 0, votar da un error claro (no divide por cero)', async () => {
    const { condoId, unidad } = await condoUnidad(0)
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Portón', opciones: ['Sí', 'No'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', res.headers)).json<any>()
    const op = vs.votaciones[0].opciones[0].id
    const r = await post(`/api/comunidad/votaciones/${v.id}/votar`, res.headers, { opcion_id: op })
    expect(r.status).toBe(409)
    expect((await r.json<any>()).error).toMatch(/alícuotas/)
  })
  it('resultados: porcentajes sobre la base normalizada y suman 100', async () => {
    const { condoId, unidad } = await condoUnidad(0.6) // Σ = 0.8 a propósito
    const u2 = await otraUnidad(condoId, 0.2)
    const admin = await persona(condoId, 'admin')
    const r1 = await persona(condoId, 'residente', unidad)
    const r2 = await persona(condoId, 'residente', u2)
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Cámaras', opciones: ['Entrada', 'Sótano'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', r1.headers)).json<any>()
    const [opA, opB] = vs.votaciones[0].opciones.map((o: any) => o.id)
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, r1.headers, { opcion_id: opA })).status).toBe(200)
    expect((await post(`/api/comunidad/votaciones/${v.id}/votar`, r2.headers, { opcion_id: opB })).status).toBe(200)
    const vf = await (await get('/api/comunidad/votaciones', admin.headers)).json<any>()
    const ops = vf.votaciones[0].opciones
    expect(ops[0].porcentaje).toBeCloseTo(75, 6)  // 0.75 de 0.75+0.25
    expect(ops[1].porcentaje).toBeCloseTo(25, 6)
    expect(ops[0].porcentaje + ops[1].porcentaje).toBeCloseTo(100, 6)
  })
})

describe('comunidad — solape de reservas', () => {
  it('no se pueden aprobar dos reservas para la misma área, fecha y franja', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const area = await (await post('/api/comunidad/areas', admin.headers, { nombre: 'Cancha', aforo: 10 })).json<any>()
    const r1 = await (await post('/api/comunidad/reservas', res.headers, { area_id: area.id, fecha: '2026-09-01', franja: 'mañana', invitados: 4 })).json<any>()
    const r2 = await (await post('/api/comunidad/reservas', res.headers, { area_id: area.id, fecha: '2026-09-01', franja: 'mañana', invitados: 4 })).json<any>()
    expect((await post(`/api/comunidad/reservas/${r1.id}/resolver`, admin.headers, { aprobar: true })).status).toBe(200)
    // la segunda, misma área/fecha/franja, choca al aprobar
    expect((await post(`/api/comunidad/reservas/${r2.id}/resolver`, admin.headers, { aprobar: true })).status).toBe(409)
  })
  it('reservar por encima del aforo del área es rechazado', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const area = await (await post('/api/comunidad/areas', admin.headers, { nombre: 'Sala', aforo: 5 })).json<any>()
    expect((await post('/api/comunidad/reservas', res.headers, { area_id: area.id, fecha: '2026-09-02', franja: 'tarde', invitados: 8 })).status).toBe(400)
  })
})

describe('comunidad — seguridad por rol', () => {
  it('portería NO ve reservas ni tickets del condominio (403)', async () => {
    const { condoId } = await condoUnidad()
    const gid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(gid, `${gid}@t.com`, 'G', 'h').run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'porteria')`).bind(uuid(), gid, condoId).run()
    const { valor } = await crearSesion(env.DB, gid, env.SESSION_SECRET, 30)
    const h = { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId }
    expect((await get('/api/comunidad/reservas', h)).status).toBe(403)
    expect((await get('/api/comunidad/tickets', h)).status).toBe(403)
  })
})

describe('comunidad — tickets y directorio', () => {
  it('residente abre ticket y admin lo mueve a resuelto', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const t = await (await post('/api/comunidad/tickets', res.headers, { titulo: 'Bombillo pasillo', categoria: 'mantenimiento' })).json<any>()
    const todos = await (await get('/api/comunidad/tickets', admin.headers)).json<any>()
    expect(todos.tickets).toHaveLength(1)
    expect((await patch(`/api/comunidad/tickets/${t.id}`, admin.headers, { estado: 'resuelto', asignado: 'Mantenimiento' })).status).toBe(200)
    const mis = await (await get('/api/comunidad/tickets', res.headers)).json<any>()
    expect(mis.tickets[0].estado).toBe('resuelto')
  })
  it('directorio: admin agrega y borra; residente solo lee', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const d = await (await post('/api/comunidad/directorio', admin.headers, { nombre: 'Conserjería', cargo: 'Portería', telefono: '0212-5551234' })).json<any>()
    expect((await get('/api/comunidad/directorio', res.headers)).status).toBe(200)
    expect((await post('/api/comunidad/directorio', res.headers, { nombre: 'X' })).status).toBe(403)
    expect((await app.request(`/api/comunidad/directorio/${d.id}`, { method: 'DELETE', headers: admin.headers }, env)).status).toBe(200)
  })
})

describe('comunidad — votos históricos sin unidad (backfill 0009)', () => {
  it('un voto histórico con unidad NULL del mismo usuario bloquea el revoto (no cuenta doble)', async () => {
    const { condoId, unidad } = await condoUnidad(0.5)
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    const v = await (await post('/api/comunidad/votaciones', admin.headers, { titulo: 'Portón', opciones: ['Sí', 'No'] })).json<any>()
    const vs = await (await get('/api/comunidad/votaciones', res.headers)).json<any>()
    const op = vs.votaciones[0].opciones[0].id
    // Voto pre-migración cuyo backfill no pudo deducir la unidad (unidad_id NULL):
    // el usuario YA votó; si vota de nuevo por la API, la votación contaría doble.
    await env.DB.prepare(`INSERT INTO votos(id,votacion_id,opcion_id,usuario_id,unidad_id,peso) VALUES(?,?,?,?,NULL,1)`)
      .bind(uuid(), v.id, op, res.uid).run()
    const rep = await post(`/api/comunidad/votaciones/${v.id}/votar`, res.headers, { opcion_id: op })
    expect(rep.status).toBe(409)
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM votos WHERE votacion_id=?`).bind(v.id).first<{ n: number }>()
    expect(n!.n).toBe(1)
  })
})

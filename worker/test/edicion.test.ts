import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function usuario(es_superadmin = 0) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,?)`).bind(uid, `${uid}@t.com`, 'U', 'h', es_superadmin).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, cookie: `${COOKIE}=${valor}` }
}
async function persona(condoId: string, rol: 'admin' | 'residente' | 'porteria', unidadId?: string) {
  const u = await usuario()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`).bind(uuid(), u.uid, condoId, unidadId ?? null, rol).run()
  return { ...u, headers: { cookie: u.cookie, 'X-Condominio': condoId } }
}
async function condoUnidad() {
  const { condoId } = await seedCondo()
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre,alicuota) VALUES(?,?,'1A',0.5)`).bind(u, condoId).run()
  return { condoId, unidad: u }
}
const post = (p: string, h: any, b?: any) => app.request(p, { method: 'POST', headers: { ...h, ...(b ? { 'content-type': 'application/json' } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }, env)
const patch = (p: string, h: any, b: any) => app.request(p, { method: 'PATCH', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(b) }, env)
const del = (p: string, h: any) => app.request(p, { method: 'DELETE', headers: h }, env)
const get = (p: string, h: any) => app.request(p, { headers: h }, env)

describe('edición/eliminación — admin', () => {
  it('editar y borrar comunicado', async () => {
    const { condoId } = await condoUnidad(); const a = await persona(condoId, 'admin')
    const com = await (await post('/api/comunicados', a.headers, { titulo: 'A', cuerpo: 'x' })).json<any>()
    expect((await patch(`/api/comunicados/${com.id}`, a.headers, { titulo: 'B' })).status).toBe(200)
    expect((await del(`/api/comunicados/${com.id}`, a.headers)).status).toBe(200)
    const lista = await (await get('/api/comunicados', a.headers)).json<any>()
    expect(lista.comunicados.find((x: any) => x.id === com.id)).toBeUndefined()
  })
  it('residente NO puede borrar comunicado (403)', async () => {
    const { condoId, unidad } = await condoUnidad(); const a = await persona(condoId, 'admin'); const r = await persona(condoId, 'residente', unidad)
    const com = await (await post('/api/comunicados', a.headers, { titulo: 'A', cuerpo: 'x' })).json<any>()
    expect((await del(`/api/comunicados/${com.id}`, r.headers)).status).toBe(403)
  })
  it('anular cuota', async () => {
    const { condoId } = await condoUnidad(); const a = await persona(condoId, 'admin')
    await post('/api/finanzas/cuotas', a.headers, { periodo: '2026-07', modo: 'fijo', monto: 50 })
    const q = (await (await get('/api/finanzas/cuotas?periodo=2026-07', a.headers)).json<any>()).cuotas[0]
    expect((await del(`/api/finanzas/cuotas/${q.id}`, a.headers)).status).toBe(200)
    const resumen = await (await get('/api/finanzas/resumen', a.headers)).json<any>()
    expect(resumen.facturado).toBe(0)
  })
  it('editar y borrar gasto', async () => {
    const { condoId } = await condoUnidad(); const a = await persona(condoId, 'admin')
    const g = await (await post('/api/finanzas/gastos', a.headers, { tipo: 'gasto', categoria: 'otro', descripcion: 'x', monto: 10, fecha: '2026-07-01' })).json<any>()
    expect((await patch(`/api/finanzas/gastos/${g.id}`, a.headers, { monto: 25 })).status).toBe(200)
    let resumen = await (await get('/api/finanzas/resumen', a.headers)).json<any>(); expect(resumen.egresos).toBe(25)
    expect((await del(`/api/finanzas/gastos/${g.id}`, a.headers)).status).toBe(200)
    resumen = await (await get('/api/finanzas/resumen', a.headers)).json<any>(); expect(resumen.egresos).toBe(0)
  })
  it('quitar residente de su unidad (offboarding) y readmitir después', async () => {
    const { condoId, unidad } = await condoUnidad(); const a = await persona(condoId, 'admin'); const r = await persona(condoId, 'residente', unidad)
    const det = await (await get(`/api/finanzas/propietarios/${unidad}`, a.headers)).json<any>()
    expect(det.residentes).toHaveLength(1)
    const memId = det.residentes[0].id
    expect((await del(`/api/finanzas/miembros/${memId}`, a.headers)).status).toBe(200)
    const det2 = await (await get(`/api/finanzas/propietarios/${unidad}`, a.headers)).json<any>()
    expect(det2.residentes).toHaveLength(0)
    // ya se puede borrar la unidad (sin residentes)
    expect((await del(`/api/estructura/unidades/${unidad}`, a.headers)).status).toBe(200)
  })
  it('renombrar torre y organización', async () => {
    const { condoId } = await condoUnidad(); const a = await persona(condoId, 'admin'); const sa = await usuario(1)
    const t = uuid(); await env.DB.prepare(`INSERT INTO torres(id,condominio_id,nombre) VALUES(?,?,'T1')`).bind(t, condoId).run()
    expect((await patch(`/api/estructura/torres/${t}`, a.headers, { nombre: 'Torre Renombrada' })).status).toBe(200)
    const org = await env.DB.prepare(`SELECT organizacion_id o FROM condominios WHERE id=?`).bind(condoId).first<{ o: string }>()
    expect((await patch(`/api/sa/organizaciones/${org!.o}`, { cookie: sa.cookie }, { nombre: `Org ${uuid()}` })).status).toBe(200)
  })
  it('borrar área (con guarda si tiene reservas) y votación', async () => {
    const { condoId, unidad } = await condoUnidad(); const a = await persona(condoId, 'admin'); const r = await persona(condoId, 'residente', unidad)
    const area = await (await post('/api/comunidad/areas', a.headers, { nombre: 'Salón' })).json<any>()
    await post('/api/comunidad/reservas', r.headers, { area_id: area.id, fecha: '2026-09-01' })
    expect((await del(`/api/comunidad/areas/${area.id}`, a.headers)).status).toBe(409) // tiene reserva
    const v = await (await post('/api/comunidad/votaciones', a.headers, { titulo: 'V', opciones: ['a', 'b'] })).json<any>()
    expect((await del(`/api/comunidad/votaciones/${v.id}`, a.headers)).status).toBe(200)
    const vs = await (await get('/api/comunidad/votaciones', a.headers)).json<any>()
    expect(vs.votaciones.find((x: any) => x.id === v.id)).toBeUndefined()
  })
  it('editar directorio y borrar plantilla', async () => {
    const { condoId } = await condoUnidad(); const a = await persona(condoId, 'admin')
    const d = await (await post('/api/comunidad/directorio', a.headers, { nombre: 'Portería' })).json<any>()
    expect((await patch(`/api/comunidad/directorio/${d.id}`, a.headers, { telefono: '0212' })).status).toBe(200)
    const pl = await (await post('/api/mensajeria/plantillas', a.headers, { nombre: 'P', cuerpo: 'hola' })).json<any>()
    expect((await del(`/api/mensajeria/plantillas/${pl.id}`, a.headers)).status).toBe(200)
  })
})

describe('cancelaciones — residente', () => {
  it('cancela su pase (queda vencido para portería)', async () => {
    const { condoId, unidad } = await condoUnidad(); const r = await persona(condoId, 'residente', unidad); const p = await persona(condoId, 'porteria')
    const pase = await (await post('/api/accesos/pases', r.headers, { visitante: 'X', horas: 5 })).json<any>()
    expect((await del(`/api/accesos/pases/${pase.token}`, r.headers)).status).toBe(200)
    const cola = await (await get('/api/accesos/cola', p.headers)).json<any>()
    expect(cola.pases.find((x: any) => x.token === pase.token)).toBeUndefined()
  })
  it('cancela su reserva y su SOS; cierra su ticket', async () => {
    const { condoId, unidad } = await condoUnidad(); const a = await persona(condoId, 'admin'); const r = await persona(condoId, 'residente', unidad)
    const area = await (await post('/api/comunidad/areas', a.headers, { nombre: 'Salón' })).json<any>()
    const rv = await (await post('/api/comunidad/reservas', r.headers, { area_id: area.id, fecha: '2026-09-01' })).json<any>()
    expect((await del(`/api/comunidad/reservas/${rv.id}`, r.headers)).status).toBe(200)
    const sos = await (await post('/api/accesos/sos', r.headers, { tipo: 'x' })).json<any>()
    expect((await post(`/api/accesos/sos/${sos.id}/cancelar`, r.headers)).status).toBe(200)
    const tk = await (await post('/api/comunidad/tickets', r.headers, { titulo: 'T' })).json<any>()
    expect((await post(`/api/comunidad/tickets/${tk.id}/cerrar`, r.headers)).status).toBe(200)
    const mis = await (await get('/api/comunidad/tickets', r.headers)).json<any>()
    expect(mis.tickets.find((x: any) => x.id === tk.id).estado).toBe('resuelto')
  })
})

describe('org_admin org-wide', () => {
  it('ve y administra TODOS los condominios de su organización, sin membresía directa', async () => {
    const { orgId, condoId } = await seedCondo()
    const condo2 = uuid()
    await env.DB.prepare(`INSERT INTO condominios(id,organizacion_id,nombre) VALUES(?,?,?)`).bind(condo2, orgId, `C2 ${uuid()}`).run()
    const u = await usuario()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'org_admin')`).bind(uuid(), u.uid, condoId).run()
    // /me lista AMBOS condominios de la organización
    const me = await (await app.request('/api/me', { headers: { cookie: u.cookie } }, env)).json<any>()
    expect(me.condominios.map((c: any) => c.id).sort()).toEqual([condoId, condo2].sort())
    // puede operar el 2º condominio (sin membresía directa) — estructura es admin/org_admin
    const est = await app.request('/api/estructura', { headers: { cookie: u.cookie, 'X-Condominio': condo2 } }, env)
    expect(est.status).toBe(200)
  })
})

describe('borrar unidad con dependencias devuelve 409 (no 500 por FK)', () => {
  it('unidad con paquete o nota CRM no se puede borrar → 409', async () => {
    const { condoId, unidad } = await condoUnidad()
    const a = await persona(condoId, 'admin')
    const g = await persona(condoId, 'porteria')
    // paquete colgando de la unidad
    await post('/api/accesos/paquetes', g.headers, { unidad_id: unidad, descripcion: 'Amazon' })
    const r1 = await del(`/api/estructura/unidades/${unidad}`, a.headers)
    expect(r1.status).toBe(409)
    // limpiamos el paquete pero dejamos una nota CRM
    await env.DB.prepare(`DELETE FROM paquetes WHERE unidad_id=?`).bind(unidad).run()
    await post('/api/finanzas/notas', a.headers, { unidad_id: unidad, texto: 'ok' })
    const r2 = await del(`/api/estructura/unidades/${unidad}`, a.headers)
    expect(r2.status).toBe(409)
    // sin dependencias sí se borra
    await env.DB.prepare(`DELETE FROM notas_crm WHERE unidad_id=?`).bind(unidad).run()
    expect((await del(`/api/estructura/unidades/${unidad}`, a.headers)).status).toBe(200)
  })
})

describe('offboarding — superadmin borra condominio con todos sus datos', () => {
  it('DELETE condominio elimina el condo y sus dependencias', async () => {
    const { condoId, unidad } = await condoUnidad()
    const a = await persona(condoId, 'admin'); const r = await persona(condoId, 'residente', unidad)
    const sa = await usuario(1)
    await post('/api/comunicados', a.headers, { titulo: 'A', cuerpo: 'x' })
    await post('/api/finanzas/cuotas', a.headers, { periodo: '2026-07', modo: 'fijo', monto: 10 })
    await post('/api/finanzas/pagos', r.headers, { monto: 10, metodo: 'zelle' })
    // archivo guardado en D1 (fallback sin R2): el offboarding también debe limpiarlo
    await env.DB.prepare(`INSERT INTO archivos(key,condominio_id,mime,datos) VALUES(?,?,?,?)`)
      .bind(`${condoId}/x-a.png`, condoId, 'image/png', new Uint8Array([1, 2, 3]).buffer).run()
    const res = await del(`/api/sa/condominios/${condoId}`, { cookie: sa.cookie })
    expect(res.status).toBe(200)
    // el condominio y sus datos ya no existen
    expect(await env.DB.prepare(`SELECT id FROM condominios WHERE id=?`).bind(condoId).first()).toBeNull()
    for (const t of ['unidades', 'comunicados', 'cuotas', 'pagos', 'membresias', 'torres', 'archivos']) {
      const n = await env.DB.prepare(`SELECT COUNT(*) c FROM ${t} WHERE condominio_id=?`).bind(condoId).first<{ c: number }>()
      expect(n!.c).toBe(0)
    }
    // el usuario sobrevive (puede estar en otros condominios)
    expect(await env.DB.prepare(`SELECT id FROM usuarios WHERE id=?`).bind(r.uid).first()).not.toBeNull()
  })
})

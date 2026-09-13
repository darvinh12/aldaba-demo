import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: 'admin' | 'residente', unidadId?: string, telefono?: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,telefono) VALUES(?,?,?,?,?)`).bind(uid, `${uid}@t.com`, 'P', 'h', telefono ?? null).run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`).bind(uuid(), uid, condoId, unidadId ?? null, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}
async function condoUnidad() {
  const { condoId } = await seedCondo()
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre,alicuota) VALUES(?,?,'1A',0.5)`).bind(u, condoId).run()
  return { condoId, unidad: u }
}
const post = (p: string, h: any, b?: any) => app.request(p, { method: 'POST', headers: { ...h, ...(b ? { 'content-type': 'application/json' } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }, env)
const get = (p: string, h: any) => app.request(p, { headers: h }, env)

describe('CRM — multas', () => {
  it('una multa aumenta la morosidad y aparece en el estado de cuenta', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    await post('/api/finanzas/multas', admin.headers, { unidad_id: unidad, tipo: 'multa', motivo: 'Ruido nocturno', monto: 25 })
    const s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.multas).toBe(25); expect(s.morosidad).toBe(25); expect(s.morosos).toBe(1)
    const ec = await (await get('/api/finanzas/estado-cuenta', res.headers)).json<any>()
    expect(ec.multas).toBe(25); expect(ec.saldo).toBe(25)
    expect(ec.susMultas[0].motivo).toBe('Ruido nocturno')
  })
  it('amonestación no suma monto; anular una multa la quita de la deuda', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    await post('/api/finanzas/multas', admin.headers, { unidad_id: unidad, tipo: 'amonestacion', motivo: 'Aviso' })
    const m = await (await post('/api/finanzas/multas', admin.headers, { unidad_id: unidad, tipo: 'multa', motivo: 'X', monto: 40 })).json<any>()
    let s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.multas).toBe(40)
    await post(`/api/finanzas/multas/${m.id}/anular`, admin.headers)
    s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.multas).toBe(0)
  })
})

describe('CRM — propietarios y recibo', () => {
  it('la lista de propietarios trae contacto y saldo; el recibo trae el membrete', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad, '04141234567')
    await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-07', modo: 'fijo', monto: 50 })
    const pago = await (await post('/api/finanzas/pagos', res.headers, { monto: 50, metodo: 'zelle' })).json<any>()
    await post(`/api/finanzas/pagos/${pago.id}/conciliar`, admin.headers, { aprobar: true })
    const props = await (await get('/api/finanzas/propietarios', admin.headers)).json<any>()
    const p = props.propietarios.find((x: any) => x.unidad_id === unidad)
    expect(p.telefono).toBe('04141234567'); expect(p.saldo).toBe(0)
    const recibo = await (await get(`/api/finanzas/pagos/${pago.id}/recibo`, admin.headers)).json<any>()
    expect(recibo.condominio).toBeTruthy(); expect(recibo.organizacion).toBeTruthy(); expect(recibo.monto_usd).toBe(50)
  })
  it('admin agrega nota CRM y actualiza teléfono', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', unidad)
    await post('/api/finanzas/notas', admin.headers, { unidad_id: unidad, texto: 'Prometió pagar el viernes' })
    await post('/api/finanzas/contacto', admin.headers, { usuario_id: res.uid, telefono: '04149998888' })
    const det = await (await get(`/api/finanzas/propietarios/${unidad}`, admin.headers)).json<any>()
    expect(det.notas[0].texto).toBe('Prometió pagar el viernes')
  })
})

describe('mensajería', () => {
  it('WhatsApp genera enlaces wa.me solo para quien tiene teléfono; filtro morosos', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    await persona(condoId, 'residente', unidad, '0414-111-2233')
    await post('/api/finanzas/multas', admin.headers, { unidad_id: unidad, tipo: 'multa', motivo: 'x', monto: 10 })
    const r = await (await post('/api/mensajeria/enviar', admin.headers, { canal: 'whatsapp', cuerpo: 'Recordatorio de pago para {nombre}', filtro: 'morosos' })).json<any>()
    expect(r.canal).toBe('whatsapp'); expect(r.enviados).toBe(1)
    // El teléfono local 0414… se normaliza a formato internacional VE (58…) para que wa.me funcione.
    expect(r.links[0].url).toContain('wa.me/584141112233')
  })
  it('correo sin proveedor queda pendiente (no revienta)', async () => {
    const { condoId, unidad } = await condoUnidad()
    const admin = await persona(condoId, 'admin')
    await persona(condoId, 'residente', unidad)
    const r = await (await post('/api/mensajeria/enviar', admin.headers, { canal: 'email', asunto: 'Aviso', cuerpo: 'Hola' })).json<any>()
    expect(r.sinProveedor).toBe(true)
  })
})

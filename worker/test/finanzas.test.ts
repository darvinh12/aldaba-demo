import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: 'admin' | 'residente', unidadId?: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, 'P', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`)
    .bind(uuid(), uid, condoId, unidadId ?? null, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}
async function condoConUnidades() {
  const { condoId } = await seedCondo()
  const t = uuid()
  await env.DB.prepare(`INSERT INTO torres(id,condominio_id,nombre) VALUES(?,?,'T')`).bind(t, condoId).run()
  const u1 = uuid(), u2 = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,torre_id,nombre,alicuota) VALUES(?,?,?,'1A',0.5),(?,?,?,'2B',0.5)`)
    .bind(u1, condoId, t, u2, condoId, t).run()
  return { condoId, u1, u2 }
}
const post = (path: string, headers: any, body: any) =>
  app.request(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const get = (path: string, headers: any) => app.request(path, { headers }, env)

describe('finanzas — cuotas', () => {
  it('admin emite cuota fija a todas las unidades', async () => {
    const { condoId } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-07', modo: 'fijo', monto: 50 })
    expect(r.status).toBe(200)
    expect((await r.json<any>()).emitidas).toBe(2)
    // re-emitir el mismo periodo/concepto es idempotente
    const r2 = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-07', modo: 'fijo', monto: 50 })
    expect((await r2.json<any>()).emitidas).toBe(0)
  })
  it('emisión por alícuota = base * alicuota', async () => {
    const { condoId } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    const { cuotas } = await (await get('/api/finanzas/cuotas?periodo=2026-08', admin.headers)).json<any>()
    expect(cuotas).toHaveLength(2)
    expect(cuotas[0].monto_usd).toBe(500) // 1000 * 0.5
  })
  it('residente no puede emitir cuotas (403)', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const res = await persona(condoId, 'residente', u1)
    expect((await post('/api/finanzas/cuotas', res.headers, { periodo: '2026-07', monto: 10 })).status).toBe(403)
  })
})

describe('finanzas — pagos y conciliación', () => {
  it('residente reporta pago, admin lo aprueba y baja la morosidad', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-07', modo: 'fijo', monto: 80 })
    const rep = await post('/api/finanzas/pagos', res.headers, { monto: 80, metodo: 'pago_movil', referencia: '00123' })
    expect(rep.status).toBe(200)
    const pagoId = (await rep.json<any>()).id
    // pendiente en la cola del admin
    const pend = await (await get('/api/finanzas/pagos?estado=reportado', admin.headers)).json<any>()
    expect(pend.pagos).toHaveLength(1)
    // aprobar
    const con = await post(`/api/finanzas/pagos/${pagoId}/conciliar`, admin.headers, { aprobar: true })
    expect(con.status).toBe(200)
    // estado de cuenta del residente: saldo 0
    const ec = await (await get('/api/finanzas/estado-cuenta', res.headers)).json<any>()
    expect(ec.facturado).toBe(80); expect(ec.pagado).toBe(80); expect(ec.saldo).toBe(0)
    // no se puede re-conciliar
    expect((await post(`/api/finanzas/pagos/${pagoId}/conciliar`, admin.headers, { aprobar: false, motivo: 'x' })).status).toBe(404)
  })
  it('un residente NO ve los pagos de otra unidad', async () => {
    const { condoId, u1, u2 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const resA = await persona(condoId, 'residente', u1)
    const resB = await persona(condoId, 'residente', u2)
    await post('/api/finanzas/pagos', resA.headers, { monto: 10, metodo: 'zelle' })
    const delB = await (await get('/api/finanzas/pagos', resB.headers)).json<any>()
    expect(delB.pagos).toHaveLength(0) // B no ve el pago de A
  })
  it('rechazar guarda el motivo', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    const rep = await post('/api/finanzas/pagos', res.headers, { monto: 30, metodo: 'transferencia' })
    const id = (await rep.json<any>()).id
    await post(`/api/finanzas/pagos/${id}/conciliar`, admin.headers, { aprobar: false, motivo: 'referencia no coincide' })
    const mis = await (await get('/api/finanzas/pagos', res.headers)).json<any>()
    expect(mis.pagos[0].estado).toBe('rechazado')
    expect(mis.pagos[0].motivo).toBe('referencia no coincide')
  })
})

describe('finanzas — egresos y resumen', () => {
  it('admin registra gasto y compra; el resumen refleja capital y morosidad', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    // facturar 100 a cada unidad (200), cobrar 100 de una
    await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-07', modo: 'fijo', monto: 100 })
    const pago = await post('/api/finanzas/pagos', res.headers, { monto: 100, metodo: 'efectivo' })
    await post(`/api/finanzas/pagos/${(await pago.json<any>()).id}/conciliar`, admin.headers, { aprobar: true })
    // egresos
    await post('/api/finanzas/gastos', admin.headers, { tipo: 'compra', categoria: 'mantenimiento', descripcion: 'Bomba de agua', proveedor: 'HidroCA', monto: 40, fecha: '2026-07-10', factura_nro: 'F-001' })
    await post('/api/finanzas/gastos', admin.headers, { tipo: 'gasto', categoria: 'vigilancia', descripcion: 'Sueldo vigilante', monto: 30, fecha: '2026-07-15' })
    const s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.facturado).toBe(200)
    expect(s.cobrado).toBe(100)
    expect(s.egresos).toBe(70)
    expect(s.capital).toBe(30)        // 100 cobrado - 70 egresos
    expect(s.recaudacion).toBe(50)    // 100/200
    expect(s.morosidad).toBe(100)     // la otra unidad debe 100
    expect(s.morosos).toBe(1)
  })
  it('gasto con categoría inválida da 400; residente no puede registrar (403)', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    expect((await post('/api/finanzas/gastos', admin.headers, { tipo: 'gasto', categoria: 'xx', descripcion: 'y', monto: 1, fecha: '2026-07-01' })).status).toBe(400)
    expect((await post('/api/finanzas/gastos', res.headers, { tipo: 'gasto', categoria: 'otro', descripcion: 'y', monto: 1, fecha: '2026-07-01' })).status).toBe(403)
  })
})

// Crea una cuenta de portería en el condominio (el helper persona solo hace admin/residente).
async function porteria(condoId: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, 'G', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'porteria')`).bind(uuid(), uid, condoId).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}

describe('finanzas — seguridad por rol', () => {
  it('portería NO puede ver cuotas ni pagos del condominio (403)', async () => {
    const { condoId } = await condoConUnidades()
    const g = await porteria(condoId)
    expect((await get('/api/finanzas/cuotas', g.headers)).status).toBe(403)
    expect((await get('/api/finanzas/pagos', g.headers)).status).toBe(403)
  })
  it('nota CRM en una unidad de OTRO condominio es rechazada (no escritura cross-tenant)', async () => {
    const a = await condoConUnidades()
    const b = await condoConUnidades()
    const admin = await persona(a.condoId, 'admin')
    // el admin del condominio A intenta anotar sobre una unidad del condominio B
    const r = await post('/api/finanzas/notas', admin.headers, { unidad_id: b.u1, texto: 'intruso' })
    expect(r.status).toBe(404)
  })
  it('serie mensual: agrupa facturado/cobrado/egresos por mes', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-06', modo: 'fijo', monto: 40 })
    await post('/api/finanzas/pagos-admin', admin.headers, { unidad_id: u1, monto: 25, metodo: 'efectivo' })
    await post('/api/finanzas/gastos', admin.headers, { tipo: 'gasto', categoria: 'limpieza', descripcion: 'x', monto: 10, fecha: '2026-06-15' })
    const { series } = await (await get('/api/finanzas/series', admin.headers)).json<any>()
    expect(Array.isArray(series)).toBe(true)
    const jun = series.find((s: any) => s.periodo === '2026-06')
    expect(jun.facturado).toBe(80) // 2 unidades × 40, atribuido al periodo de la cuota
    expect(jun.egresos).toBe(10)   // gasto con fecha de junio
    // el pago se concilia HOY → el cobrado se atribuye al mes en curso, no a junio
    expect(series.reduce((a: number, s: any) => a + s.cobrado, 0)).toBe(25)
  })
  it('anular un pago aprobado lo saca de lo cobrado', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const pago = await (await post('/api/finanzas/pagos-admin', admin.headers, { unidad_id: u1, monto: 40, metodo: 'efectivo' })).json<any>()
    expect((await (await get('/api/finanzas/resumen', admin.headers)).json<any>()).cobrado).toBe(40)
    // anular sin motivo → 400
    expect((await post(`/api/finanzas/pagos/${pago.id}/anular`, admin.headers, {})).status).toBe(400)
    // anular con motivo → sale de lo cobrado
    expect((await post(`/api/finanzas/pagos/${pago.id}/anular`, admin.headers, { motivo: 'duplicado' })).status).toBe(200)
    expect((await (await get('/api/finanzas/resumen', admin.headers)).json<any>()).cobrado).toBe(0)
    // no se puede anular dos veces (ya no está aprobado)
    expect((await post(`/api/finanzas/pagos/${pago.id}/anular`, admin.headers, { motivo: 'x' })).status).toBe(404)
  })
  it('marcar una multa como pagada la saca de la morosidad', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const m = await (await post('/api/finanzas/multas', admin.headers, { unidad_id: u1, tipo: 'multa', motivo: 'ruido', monto: 25 })).json<any>()
    let s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.multas).toBe(25)
    expect((await post(`/api/finanzas/multas/${m.id}/pagar`, admin.headers, {})).status).toBe(200)
    s = await (await get('/api/finanzas/resumen', admin.headers)).json<any>()
    expect(s.multas).toBe(0) // ya no suma a la morosidad
    // no se puede pagar dos veces
    expect((await post(`/api/finanzas/multas/${m.id}/pagar`, admin.headers, {})).status).toBe(404)
  })
  it('admin registra un pago recibido en efectivo, aprobado al instante', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/pagos-admin', admin.headers, { unidad_id: u1, monto: 30, metodo: 'efectivo' })
    expect(r.status).toBe(200)
    expect((await r.json<any>()).estado).toBe('aprobado')
    // aparece ya aprobado en la lista de pagos del admin
    const { pagos } = await (await get('/api/finanzas/pagos?estado=aprobado', admin.headers)).json<any>()
    expect(pagos.some((p: any) => p.monto_usd === 30)).toBe(true)
  })
})

/* ---------- Alícuotas normalizadas, tasa histórica y anti-duplicado (auditoría 2026-08-18) ---------- */

// Condominio con unidades de alícuotas arbitrarias (para probar la normalización).
async function condoConAlicuotas(alicuotas: number[]) {
  const { condoId } = await seedCondo()
  const t = uuid()
  await env.DB.prepare(`INSERT INTO torres(id,condominio_id,nombre) VALUES(?,?,'T')`).bind(t, condoId).run()
  const ids: string[] = []
  for (let i = 0; i < alicuotas.length; i++) {
    const u = uuid(); ids.push(u)
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,torre_id,nombre,alicuota) VALUES(?,?,?,?,?)`)
      .bind(u, condoId, t, `U${i + 1}`, alicuotas[i]).run()
  }
  return { condoId, ids }
}
const patch = (path: string, headers: any, body: any) =>
  app.request(path, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)

describe('finanzas — alícuotas normalizadas (el total emitido siempre es la base)', () => {
  it('alícuotas que suman 2.0 NO facturan el doble: se reparten para dar exactamente la base', async () => {
    const { condoId } = await condoConAlicuotas([1.2, 0.8]) // suma 2.0
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    expect(r.status).toBe(200)
    const d = await r.json<any>()
    expect(d.emitidas).toBe(2)
    expect(d.suma_alicuotas).toBe(2)
    expect(d.factor).toBeCloseTo(0.5, 6)
    expect(d.total_emitido).toBe(1000)
    const { cuotas } = await (await get('/api/finanzas/cuotas?periodo=2026-08', admin.headers)).json<any>()
    const montos = cuotas.map((q: any) => q.monto_usd).sort((a: number, b: number) => a - b)
    expect(montos).toEqual([400, 600]) // 1000 × (0.8/2) y 1000 × (1.2/2)
    expect(montos.reduce((a: number, b: number) => a + b, 0)).toBe(1000)
  })
  it('alícuotas que suman 0.97 cuadran al centavo: el ajuste cae en la unidad mayor', async () => {
    const { condoId } = await condoConAlicuotas([0.32, 0.32, 0.33]) // suma 0.97
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    expect(r.status).toBe(200)
    const d = await r.json<any>()
    expect(d.suma_alicuotas).toBeCloseTo(0.97, 6)
    expect(d.total_emitido).toBe(1000)
    const { cuotas } = await (await get('/api/finanzas/cuotas?periodo=2026-08', admin.headers)).json<any>()
    const montos = cuotas.map((q: any) => q.monto_usd).sort((a: number, b: number) => a - b)
    // 0.32/0.97 → 329.90 (×2); la mayor (0.33/0.97 = 340.21) absorbe el centavo: 340.20
    expect(montos).toEqual([329.9, 329.9, 340.2])
    expect(Math.round(montos.reduce((a: number, b: number) => a + b, 0) * 100) / 100).toBe(1000)
  })
  it('suma de alícuotas 0 → 400 claro (no divide por cero)', async () => {
    const { condoId } = await condoConAlicuotas([0, 0])
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    expect(r.status).toBe(400)
    expect((await r.json<any>()).error).toMatch(/al[ií]cuotas/i)
  })
})

describe('finanzas — tasa Bs histórica en pagos', () => {
  it('el pago congela la tasa vigente; el recibo usa la del pago aunque la del condominio cambie', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    await patch('/api/finanzas/tasa', admin.headers, { tasa_bs: 36.5 })
    const pago = await (await post('/api/finanzas/pagos', res.headers, { monto: 50, metodo: 'pago_movil', referencia: 'T-1' })).json<any>()
    await post(`/api/finanzas/pagos/${pago.id}/conciliar`, admin.headers, { aprobar: true })
    // la tasa del condominio cambia después del pago
    await patch('/api/finanzas/tasa', admin.headers, { tasa_bs: 40 })
    const rec = await (await get(`/api/finanzas/pagos/${pago.id}/recibo`, res.headers)).json<any>()
    expect(rec.tasa_bs).toBe(36.5)          // tasa del día del pago, no la actual
    expect(rec.tasa_referencial).toBeFalsy()
    // el listado de pagos también trae la tasa congelada (conciliación/estado de cuenta)
    const { pagos } = await (await get('/api/finanzas/pagos', res.headers)).json<any>()
    expect(pagos[0].tasa_bs).toBe(36.5)
  })
  it('pago histórico sin tasa (NULL): el recibo cae a la tasa actual y lo marca como referencial', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    const res = await persona(condoId, 'residente', u1)
    await patch('/api/finanzas/tasa', admin.headers, { tasa_bs: 41.25 })
    // pago anterior a la migración: insert directo sin tasa_bs
    const pid = uuid()
    await env.DB.prepare(`INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,estado,reportado_por,conciliada) VALUES(?,?,?,20,'efectivo',NULL,'aprobado',?,datetime('now'))`)
      .bind(pid, condoId, u1, res.uid).run()
    const rec = await (await get(`/api/finanzas/pagos/${pid}/recibo`, res.headers)).json<any>()
    expect(rec.tasa_bs).toBe(41.25)        // fallback a la del condominio
    expect(rec.tasa_referencial).toBeTruthy()
  })
})

describe('finanzas — anti-duplicado de referencia', () => {
  it('misma referencia en la misma unidad → 409 con mensaje claro; en otra unidad no choca', async () => {
    const { condoId, u1, u2 } = await condoConUnidades()
    const resA = await persona(condoId, 'residente', u1)
    const resB = await persona(condoId, 'residente', u2)
    expect((await post('/api/finanzas/pagos', resA.headers, { monto: 10, metodo: 'zelle', referencia: 'REF-77' })).status).toBe(200)
    const dup = await post('/api/finanzas/pagos', resA.headers, { monto: 10, metodo: 'zelle', referencia: 'REF-77' })
    expect(dup.status).toBe(409)
    expect((await dup.json<any>()).error).toBe('ya existe un pago reportado con esa referencia')
    // otra unidad puede usar la misma referencia (bancos distintos, correlativo repetido)
    expect((await post('/api/finanzas/pagos', resB.headers, { monto: 10, metodo: 'zelle', referencia: 'REF-77' })).status).toBe(200)
    // sin referencia (efectivo) nunca choca
    expect((await post('/api/finanzas/pagos', resA.headers, { monto: 5, metodo: 'efectivo' })).status).toBe(200)
    expect((await post('/api/finanzas/pagos', resA.headers, { monto: 5, metodo: 'efectivo' })).status).toBe(200)
  })
  it('el pago de ventanilla del admin también respeta el anti-duplicado', async () => {
    const { condoId, u1 } = await condoConUnidades()
    const admin = await persona(condoId, 'admin')
    expect((await post('/api/finanzas/pagos-admin', admin.headers, { unidad_id: u1, monto: 15, metodo: 'transferencia', referencia: 'V-9' })).status).toBe(200)
    const dup = await post('/api/finanzas/pagos-admin', admin.headers, { unidad_id: u1, monto: 15, metodo: 'transferencia', referencia: 'V-9' })
    expect(dup.status).toBe(409)
    expect((await dup.json<any>()).error).toBe('ya existe un pago reportado con esa referencia')
  })
})

describe('finanzas — comprobación aritmética de la normalización (verificación adversarial)', () => {
  it('base=1000 con alícuotas 0.5/0.5/1.0 (suman 2.0) emite 250+250+500 = 1000, no 2000', async () => {
    const { condoId } = await condoConAlicuotas([0.5, 0.5, 1.0])
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    expect(r.status).toBe(200)
    const d = await r.json<any>()
    expect(d.total_emitido).toBe(1000)
    const { cuotas } = await (await get('/api/finanzas/cuotas?periodo=2026-08', admin.headers)).json<any>()
    const montos = cuotas.map((q: any) => q.monto_usd).sort((a: number, b: number) => a - b)
    expect(montos).toEqual([250, 250, 500])
  })
  it('alícuotas que YA suman 1.0 no cambian de comportamiento: base × alícuota exacto, sin ajuste', async () => {
    const { condoId } = await condoConAlicuotas([0.3, 0.3, 0.4]) // suma exactamente 1.0
    const admin = await persona(condoId, 'admin')
    const r = await post('/api/finanzas/cuotas', admin.headers, { periodo: '2026-08', modo: 'alicuota', base: 1000 })
    expect(r.status).toBe(200)
    const d = await r.json<any>()
    expect(d.suma_alicuotas).toBeCloseTo(1, 10)
    expect(d.factor).toBeCloseTo(1, 10)
    expect(d.total_emitido).toBe(1000)
    const { cuotas } = await (await get('/api/finanzas/cuotas?periodo=2026-08', admin.headers)).json<any>()
    const montos = cuotas.map((q: any) => q.monto_usd).sort((a: number, b: number) => a - b)
    expect(montos).toEqual([300, 300, 400]) // idéntico al comportamiento histórico base × alícuota
  })
})

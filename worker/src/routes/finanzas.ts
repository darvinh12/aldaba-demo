import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const finanzas = new Hono<{ Bindings: Env; Variables: Vars }>()
finanzas.use('*', requireAuth, conCondominio)

const soloAdmin = requireRol('admin', 'org_admin')
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const PERIODO_RE = /^\d{4}-\d{2}$/
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const METODOS = ['pago_movil', 'transferencia', 'zelle', 'efectivo', 'tarjeta']
const CATEGORIAS = ['vigilancia', 'limpieza', 'mantenimiento', 'servicios', 'administracion', 'fondo', 'otro']

/* ---------- RESUMEN / TESORERÍA (admin) ---------- */
finanzas.get('/resumen', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const facturado = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM cuotas WHERE condominio_id=?`).bind(id).first<{ v: number }>())!.v
  const cobrado = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM pagos WHERE condominio_id=? AND estado='aprobado'`).bind(id).first<{ v: number }>())!.v
  const porConciliar = (await c.env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(monto_usd),0) v FROM pagos WHERE condominio_id=? AND estado='reportado'`).bind(id).first<{ n: number; v: number }>())!
  const egresos = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM gastos WHERE condominio_id=?`).bind(id).first<{ v: number }>())!.v
  const { results: porCategoria } = await c.env.DB.prepare(
    `SELECT categoria, SUM(monto_usd) monto FROM gastos WHERE condominio_id=? GROUP BY categoria ORDER BY monto DESC`).bind(id).all()
  const multas = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM multas WHERE condominio_id=? AND estado='activa'`).bind(id).first<{ v: number }>())!.v
  // morosidad por unidad = cuotas emitidas + multas activas - pagos aprobados
  const { results: deuda } = await c.env.DB.prepare(
    `SELECT u.id, u.nombre,
       COALESCE((SELECT SUM(monto_usd) FROM cuotas q WHERE q.unidad_id=u.id),0)
       + COALESCE((SELECT SUM(monto_usd) FROM multas mu WHERE mu.unidad_id=u.id AND mu.estado='activa'),0)
       - COALESCE((SELECT SUM(monto_usd) FROM pagos p WHERE p.unidad_id=u.id AND p.estado='aprobado'),0) AS saldo
     FROM unidades u WHERE u.condominio_id=?`).bind(id).all<{ id: string; nombre: string; saldo: number }>()
  const morosos = deuda.filter((d) => d.saldo > 0.001)
  const morosidad = morosos.reduce((a, d) => a + d.saldo, 0)
  const tasa = (await c.env.DB.prepare(`SELECT tasa_bs FROM condominios WHERE id=?`).bind(id).first<{ tasa_bs: number }>())!.tasa_bs
  return c.json({
    facturado, cobrado, egresos,
    capital: cobrado - egresos,                       // fondo disponible
    recaudacion: facturado > 0 ? Math.round((cobrado / facturado) * 100) : 0,
    porConciliar: { n: porConciliar.n, monto: porConciliar.v },
    morosidad, morosos: morosos.length, multas,
    tasa_bs: tasa,
    gastosPorCategoria: porCategoria,
    topMorosos: morosos.sort((a, b) => b.saldo - a.saldo).slice(0, 10),
  })
})

// Serie mensual (últimos 8 meses) para las tendencias del dashboard: facturado, cobrado y egresos por mes.
finanzas.get('/series', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const { results: fact } = await c.env.DB.prepare(`SELECT periodo p, SUM(monto_usd) v FROM cuotas WHERE condominio_id=? GROUP BY periodo`).bind(id).all<{ p: string; v: number }>()
  const { results: cob } = await c.env.DB.prepare(`SELECT substr(COALESCE(conciliada,creada),1,7) p, SUM(monto_usd) v FROM pagos WHERE condominio_id=? AND estado='aprobado' GROUP BY p`).bind(id).all<{ p: string; v: number }>()
  const { results: egr } = await c.env.DB.prepare(`SELECT substr(fecha,1,7) p, SUM(monto_usd) v FROM gastos WHERE condominio_id=? GROUP BY p`).bind(id).all<{ p: string; v: number }>()
  const map = new Map<string, { periodo: string; facturado: number; cobrado: number; egresos: number }>()
  const add = (rows: { p: string; v: number }[], key: 'facturado' | 'cobrado' | 'egresos') => rows.forEach((r) => {
    if (!r.p) return
    const o = map.get(r.p) ?? { periodo: r.p, facturado: 0, cobrado: 0, egresos: 0 }
    o[key] = Math.round((r.v ?? 0) * 100) / 100; map.set(r.p, o)
  })
  add(fact, 'facturado'); add(cob, 'cobrado'); add(egr, 'egresos')
  const series = [...map.values()].sort((a, b) => (a.periodo < b.periodo ? -1 : 1)).slice(-8)
  return c.json({ series })
})

// Actualizar la tasa Bs/USD del condominio (la usa Finanzas para convertir). La tasa cambia a diario en VE.
finanzas.patch('/tasa', soloAdmin, async (c) => {
  const b = await c.req.json<{ tasa_bs?: number }>().catch(() => ({} as any))
  const t = num(b.tasa_bs)
  if (!Number.isFinite(t) || t < 0) return c.json({ error: 'tasa_bs debe ser un número ≥ 0' }, 400)
  await c.env.DB.prepare(`UPDATE condominios SET tasa_bs=? WHERE id=?`).bind(t, c.get('condo')!.id).run()
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.tasa', { tasa_bs: t })
  return c.json({ ok: true })
})

/* ---------- CUOTAS ---------- */
// Emitir cuotas a todas las unidades: monto fijo o proporcional a la alícuota (base * alicuota).
finanzas.post('/cuotas', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ periodo?: string; concepto?: string; modo?: string; monto?: number; base?: number }>().catch(() => ({} as any))
  if (!b.periodo || !PERIODO_RE.test(b.periodo)) return c.json({ error: 'periodo requerido (YYYY-MM)' }, 400)
  const modo = b.modo === 'alicuota' ? 'alicuota' : 'fijo'
  const concepto = (b.concepto?.trim() || 'Cuota de condominio').slice(0, 80)
  const base = num(modo === 'alicuota' ? b.base : b.monto)
  if (!Number.isFinite(base) || base < 0) return c.json({ error: 'monto/base debe ser un número ≥ 0' }, 400)
  const { results: unidades } = await c.env.DB.prepare(`SELECT id, alicuota FROM unidades WHERE condominio_id=?`).bind(id).all<{ id: string; alicuota: number }>()
  if (!unidades.length) return c.json({ error: 'no hay unidades a las que emitir' }, 400)
  const actor = c.get('auth')!.usuarioId
  let emitidas = 0
  // Modo alícuota NORMALIZADO (decisión del dueño): el sistema reparte proporcionalmente
  // para que el total emitido sea SIEMPRE exactamente la base, sumen lo que sumen las
  // alícuotas cargadas (2.0, 0.97, 100…): monto = base × (alícuota / Σ alícuotas).
  const suma = unidades.reduce((a, u) => a + (u.alicuota > 0 ? u.alicuota : 0), 0)
  if (modo === 'alicuota' && suma <= 0)
    return c.json({ error: 'la suma de alícuotas del condominio es 0: carga las alícuotas de las unidades en Estructura antes de emitir por alícuota' }, 400)
  // En modo alícuota, una unidad con alícuota 0 daría una cuota de $0: se omite (no es deuda real).
  const conMonto = unidades
    .map((u) => ({ id: u.id, alicuota: u.alicuota, monto: modo === 'alicuota' ? Math.round((base * u.alicuota / suma) * 100) / 100 : base }))
    .filter((u) => u.monto > 0)
  // Cuadre al centavo: el redondeo por unidad puede desviar la suma ±centavos de la base;
  // la diferencia se ajusta en la unidad de mayor alícuota (donde menos distorsiona).
  if (modo === 'alicuota' && conMonto.length) {
    const baseCent = Math.round(base * 100)
    const desvio = baseCent - conMonto.reduce((a, u) => a + Math.round(u.monto * 100), 0)
    if (desvio !== 0) {
      const mayor = conMonto.reduce((a, u) => (u.alicuota > a.alicuota ? u : a))
      mayor.monto = (Math.round(mayor.monto * 100) + desvio) / 100
    }
  }
  const totalEmitido = Math.round(conMonto.reduce((a, u) => a + Math.round(u.monto * 100), 0)) / 100
  const factor = modo === 'alicuota' ? 1 / suma : 1
  let omitidas = unidades.length - conMonto.length
  for (let i = 0; i < conMonto.length; i += 50) {
    const chunk = conMonto.slice(i, i + 50)
    const rs = await c.env.DB.batch(chunk.map((u) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO cuotas(id,condominio_id,unidad_id,periodo,concepto,monto_usd,emitida_por) VALUES(?,?,?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), id, u.id, b.periodo, concepto, u.monto, actor)))
    emitidas += rs.filter((r) => r.meta.changes).length
  }
  await registrarEvento(c.env.DB, id, actor, 'finanzas.cuotas_emitidas', {
    periodo: b.periodo, concepto, modo, base, emitidas,
    suma_alicuotas: suma, factor, total_emitido: totalEmitido,
  })
  return c.json({ emitidas, periodo: b.periodo, omitidas, suma_alicuotas: suma, factor, total_emitido: totalEmitido })
})

// Listar cuotas: admin ve todas (filtrable por periodo); residente ve las de su unidad.
finanzas.get('/cuotas', async (c) => {
  const condo = c.get('condo')!
  const periodo = c.req.query('periodo')
  if (condo.rol === 'residente') {
    if (!condo.unidadId) return c.json({ cuotas: [] })
    const { results } = await c.env.DB.prepare(
      `SELECT id, periodo, concepto, monto_usd, creada FROM cuotas WHERE unidad_id=? ORDER BY periodo DESC, creada DESC LIMIT 100`).bind(condo.unidadId).all()
    return c.json({ cuotas: results })
  }
  // Solo la administración ve las cuotas de todo el condominio; portería u otros roles, no.
  if (condo.rol !== 'admin' && condo.rol !== 'org_admin') return c.json({ error: 'sin permiso' }, 403)
  const q = periodo
    ? c.env.DB.prepare(`SELECT c.id,c.periodo,c.concepto,c.monto_usd,u.nombre AS unidad FROM cuotas c JOIN unidades u ON u.id=c.unidad_id WHERE c.condominio_id=? AND c.periodo=? ORDER BY u.nombre LIMIT 500`).bind(condo.id, periodo)
    : c.env.DB.prepare(`SELECT c.id,c.periodo,c.concepto,c.monto_usd,u.nombre AS unidad FROM cuotas c JOIN unidades u ON u.id=c.unidad_id WHERE c.condominio_id=? ORDER BY c.periodo DESC LIMIT 500`).bind(condo.id)
  const { results } = await q.all()
  return c.json({ cuotas: results })
})

/* ---------- PAGOS ---------- */
// Reportar pago (residente).
finanzas.post('/pagos', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  if (!condo.unidadId) return c.json({ error: 'tu cuenta no está asociada a una unidad' }, 400)
  const b = await c.req.json<{ monto?: number; metodo?: string; referencia?: string; comprobante_key?: string }>().catch(() => ({} as any))
  const monto = num(b.monto)
  if (!Number.isFinite(monto) || monto <= 0) return c.json({ error: 'monto debe ser un número > 0' }, 400)
  if (!METODOS.includes(b.metodo ?? '')) return c.json({ error: `método inválido (${METODOS.join(', ')})` }, 400)
  const key = b.comprobante_key?.trim() || null
  if (key && !key.startsWith(`${condo.id}/`)) return c.json({ error: 'comprobante inválido' }, 400)
  const referencia = (b.referencia ?? '').trim().slice(0, 80) || null
  // Anti-duplicado: doble tap / reintento con la misma referencia bancaria en la misma
  // unidad no crea un segundo pago (el índice único de 0009 es la red de seguridad).
  if (referencia) {
    const dup = await c.env.DB.prepare(`SELECT 1 FROM pagos WHERE condominio_id=? AND unidad_id=? AND referencia=? LIMIT 1`)
      .bind(condo.id, condo.unidadId, referencia).first()
    if (dup) return c.json({ error: 'ya existe un pago reportado con esa referencia' }, 409)
  }
  // Tasa histórica: se congela la tasa Bs vigente del condominio en el momento del reporte.
  const tasaHoy = (await c.env.DB.prepare(`SELECT tasa_bs FROM condominios WHERE id=?`).bind(condo.id).first<{ tasa_bs: number }>())?.tasa_bs
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,comprobante_key,reportado_por,tasa_bs) VALUES(?,?,?,?,?,?,?,?,?)`,
  ).bind(id, condo.id, condo.unidadId, monto, b.metodo, referencia, key, c.get('auth')!.usuarioId, tasaHoy && tasaHoy > 0 ? tasaHoy : null).run()
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'finanzas.pago_reportado', { id, monto, metodo: b.metodo })
  return c.json({ id, estado: 'reportado' })
})

// Listar pagos: admin (filtrable por estado); residente (los suyos).
finanzas.get('/pagos', async (c) => {
  const condo = c.get('condo')!
  if (condo.rol === 'residente') {
    const { results } = await c.env.DB.prepare(
      `SELECT id, monto_usd, metodo, referencia, estado, motivo, creada, conciliada, tasa_bs FROM pagos WHERE unidad_id=? ORDER BY creada DESC LIMIT 100`).bind(condo.unidadId ?? '').all()
    return c.json({ pagos: results })
  }
  // Solo la administración ve los pagos de todo el condominio; portería u otros roles, no.
  if (condo.rol !== 'admin' && condo.rol !== 'org_admin') return c.json({ error: 'sin permiso' }, 403)
  const estado = c.req.query('estado')
  const base = `SELECT p.id,p.monto_usd,p.metodo,p.referencia,p.comprobante_key,p.estado,p.motivo,p.creada,p.conciliada,p.tasa_bs,
                       u.nombre AS unidad, us.nombre AS residente
                FROM pagos p JOIN unidades u ON u.id=p.unidad_id JOIN usuarios us ON us.id=p.reportado_por
                WHERE p.condominio_id=?`
  const q = estado ? c.env.DB.prepare(`${base} AND p.estado=? ORDER BY p.creada DESC LIMIT 300`).bind(condo.id, estado)
    : c.env.DB.prepare(`${base} ORDER BY p.creada DESC LIMIT 300`).bind(condo.id)
  const { results } = await q.all()
  return c.json({ pagos: results })
})

// Conciliar (admin): aprobar o rechazar un pago reportado.
finanzas.post('/pagos/:id/conciliar', soloAdmin, async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ aprobar?: boolean; motivo?: string }>().catch(() => ({} as any))
  if (typeof b.aprobar !== 'boolean') return c.json({ error: 'aprobar (booleano) requerido' }, 400)
  const nuevo = b.aprobar ? 'aprobado' : 'rechazado'
  const r = await c.env.DB.prepare(
    `UPDATE pagos SET estado=?, motivo=?, conciliado_por=?, conciliada=datetime('now')
     WHERE id=? AND condominio_id=? AND estado='reportado'`,
  ).bind(nuevo, b.aprobar ? null : (b.motivo ?? '').slice(0, 200), c.get('auth')!.usuarioId, c.req.param('id'), condo.id).run()
  if (!r.meta.changes) return c.json({ error: 'pago no existe, es de otro condominio o ya fue conciliado' }, 404)
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'finanzas.pago_conciliado', { id: c.req.param('id'), estado: nuevo })
  return c.json({ ok: true, estado: nuevo })
})

// Registrar un pago recibido en ventanilla (efectivo/directo): lo carga el admin y queda aprobado al instante.
finanzas.post('/pagos-admin', soloAdmin, async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ unidad_id?: string; monto?: number; metodo?: string; referencia?: string }>().catch(() => ({} as any))
  const monto = num(b.monto)
  if (!b.unidad_id) return c.json({ error: 'unidad requerida' }, 400)
  if (!Number.isFinite(monto) || monto <= 0) return c.json({ error: 'monto debe ser un número > 0' }, 400)
  if (!METODOS.includes(b.metodo ?? '')) return c.json({ error: `método inválido (${METODOS.join(', ')})` }, 400)
  const uni = await c.env.DB.prepare(`SELECT id FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, condo.id).first()
  if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  const referencia = (b.referencia ?? '').trim().slice(0, 80) || null
  if (referencia) {
    const dup = await c.env.DB.prepare(`SELECT 1 FROM pagos WHERE condominio_id=? AND unidad_id=? AND referencia=? LIMIT 1`)
      .bind(condo.id, b.unidad_id, referencia).first()
    if (dup) return c.json({ error: 'ya existe un pago reportado con esa referencia' }, 409)
  }
  const tasaHoy = (await c.env.DB.prepare(`SELECT tasa_bs FROM condominios WHERE id=?`).bind(condo.id).first<{ tasa_bs: number }>())?.tasa_bs
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,estado,reportado_por,conciliado_por,conciliada,tasa_bs)
     VALUES(?,?,?,?,?,?,'aprobado',?,?,datetime('now'),?)`,
  ).bind(id, condo.id, b.unidad_id, monto, b.metodo, referencia, c.get('auth')!.usuarioId, c.get('auth')!.usuarioId, tasaHoy && tasaHoy > 0 ? tasaHoy : null).run()
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'finanzas.pago_registrado_admin', { id, unidad: b.unidad_id, monto, metodo: b.metodo })
  return c.json({ id, estado: 'aprobado' })
})

// Revertir un pago YA aprobado (se registró por error): pasa a 'rechazado' con motivo. Sale de lo cobrado.
finanzas.post('/pagos/:id/anular', soloAdmin, async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ motivo?: string }>().catch(() => ({} as any))
  if (!b.motivo?.trim()) return c.json({ error: 'indica el motivo de la anulación' }, 400)
  const r = await c.env.DB.prepare(
    `UPDATE pagos SET estado='rechazado', motivo=?, conciliado_por=?, conciliada=datetime('now')
     WHERE id=? AND condominio_id=? AND estado='aprobado'`,
  ).bind(`Anulado: ${b.motivo.trim().slice(0, 180)}`, c.get('auth')!.usuarioId, c.req.param('id'), condo.id).run()
  if (!r.meta.changes) return c.json({ error: 'pago no existe, es de otro condominio o no está aprobado' }, 404)
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'finanzas.pago_anulado', { id: c.req.param('id') })
  return c.json({ ok: true, estado: 'rechazado' })
})

/* ---------- GASTOS / COMPRAS (egresos con factura) ---------- */
finanzas.post('/gastos', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ tipo?: string; categoria?: string; descripcion?: string; proveedor?: string; monto?: number; fecha?: string; factura_key?: string; factura_nro?: string }>().catch(() => ({} as any))
  if (!['gasto', 'compra'].includes(b.tipo ?? '')) return c.json({ error: "tipo debe ser 'gasto' o 'compra'" }, 400)
  if (!CATEGORIAS.includes(b.categoria ?? '')) return c.json({ error: `categoría inválida (${CATEGORIAS.join(', ')})` }, 400)
  if (!b.descripcion?.trim()) return c.json({ error: 'descripción requerida' }, 400)
  const monto = num(b.monto)
  if (!Number.isFinite(monto) || monto < 0) return c.json({ error: 'monto debe ser un número ≥ 0' }, 400)
  if (!b.fecha || !FECHA_RE.test(b.fecha)) return c.json({ error: 'fecha requerida (YYYY-MM-DD)' }, 400)
  const key = b.factura_key?.trim() || null
  if (key && !key.startsWith(`${id}/`)) return c.json({ error: 'factura inválida' }, 400)
  const gid = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO gastos(id,condominio_id,tipo,categoria,descripcion,proveedor,monto_usd,factura_key,factura_nro,fecha,registrado_por)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(gid, id, b.tipo, b.categoria, b.descripcion.trim().slice(0, 200), (b.proveedor ?? '').slice(0, 120), monto, key, (b.factura_nro ?? '').slice(0, 60) || null, b.fecha, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'finanzas.egreso', { id: gid, tipo: b.tipo, categoria: b.categoria, monto, factura: !!key })
  return c.json({ id: gid })
})

finanzas.get('/gastos', soloAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id,g.tipo,g.categoria,g.descripcion,g.proveedor,g.monto_usd,g.factura_key,g.factura_nro,g.fecha,g.creada, u.nombre AS registrado
     FROM gastos g JOIN usuarios u ON u.id=g.registrado_por WHERE g.condominio_id=? ORDER BY g.fecha DESC, g.creada DESC LIMIT 300`,
  ).bind(c.get('condo')!.id).all()
  return c.json({ gastos: results })
})

/* ---------- ESTADO DE CUENTA (residente) ---------- */
finanzas.get('/estado-cuenta', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  if (!condo.unidadId) return c.json({ error: 'tu cuenta no está asociada a una unidad' }, 400)
  const facturado = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM cuotas WHERE unidad_id=?`).bind(condo.unidadId).first<{ v: number }>())!.v
  const multas = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM multas WHERE unidad_id=? AND estado='activa'`).bind(condo.unidadId).first<{ v: number }>())!.v
  const pagado = (await c.env.DB.prepare(`SELECT COALESCE(SUM(monto_usd),0) v FROM pagos WHERE unidad_id=? AND estado='aprobado'`).bind(condo.unidadId).first<{ v: number }>())!.v
  const tasa = (await c.env.DB.prepare(`SELECT tasa_bs FROM condominios WHERE id=?`).bind(condo.id).first<{ tasa_bs: number }>())!.tasa_bs
  const { results: susMultas } = await c.env.DB.prepare(`SELECT tipo, motivo, monto_usd, estado, creada FROM multas WHERE unidad_id=? ORDER BY creada DESC LIMIT 30`).bind(condo.unidadId).all()
  return c.json({ facturado, multas, pagado, saldo: facturado + multas - pagado, tasa_bs: tasa, susMultas })
})

/* ---------- MULTAS / AMONESTACIONES ---------- */
finanzas.post('/multas', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ unidad_id?: string; tipo?: string; motivo?: string; monto?: number }>().catch(() => ({} as any))
  if (!b.unidad_id || !b.motivo?.trim()) return c.json({ error: 'unidad y motivo requeridos' }, 400)
  const tipo = b.tipo === 'amonestacion' ? 'amonestacion' : 'multa'
  const monto = tipo === 'amonestacion' ? 0 : num(b.monto)
  if (!Number.isFinite(monto) || monto < 0) return c.json({ error: 'monto debe ser un número ≥ 0' }, 400)
  const uni = await c.env.DB.prepare(`SELECT id FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, id).first()
  if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  const mid = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO multas(id,condominio_id,unidad_id,tipo,motivo,monto_usd,creada_por) VALUES(?,?,?,?,?,?,?)`)
    .bind(mid, id, b.unidad_id, tipo, b.motivo.trim().slice(0, 200), monto, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'finanzas.multa', { unidad: b.unidad_id, tipo, monto })
  return c.json({ id: mid })
})
finanzas.get('/multas', soloAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.tipo, m.motivo, m.monto_usd, m.estado, m.creada, u.nombre AS unidad
     FROM multas m JOIN unidades u ON u.id=m.unidad_id WHERE m.condominio_id=? ORDER BY m.creada DESC LIMIT 200`).bind(c.get('condo')!.id).all()
  return c.json({ multas: results })
})
finanzas.post('/multas/:id/anular', soloAdmin, async (c) => {
  const r = await c.env.DB.prepare(`UPDATE multas SET estado='anulada' WHERE id=? AND condominio_id=? AND estado='activa'`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'multa no encontrada o ya anulada' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.multa_anulada', { id: c.req.param('id') })
  return c.json({ ok: true })
})
// Marcar una multa como pagada: deja de sumar a la morosidad y refleja que se cobró (no que se perdonó).
finanzas.post('/multas/:id/pagar', soloAdmin, async (c) => {
  const r = await c.env.DB.prepare(`UPDATE multas SET estado='pagada' WHERE id=? AND condominio_id=? AND estado='activa'`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'multa no encontrada o ya cerrada' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.multa_pagada', { id: c.req.param('id') })
  return c.json({ ok: true })
})

/* ---------- CRM: PROPIETARIOS ---------- */
finanzas.get('/propietarios', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS unidad_id, u.nombre AS unidad, u.torre_id,
       us.id AS usuario_id, us.nombre AS propietario, us.email, us.telefono,
       COUNT(m.id) AS residentes,
       MIN(us.nombre) AS _primero, -- fija el contacto "principal" al residente alfabéticamente primero (regla bare-columns de SQLite: determinista)
       COALESCE((SELECT SUM(monto_usd) FROM cuotas q WHERE q.unidad_id=u.id),0)
       + COALESCE((SELECT SUM(monto_usd) FROM multas mu WHERE mu.unidad_id=u.id AND mu.estado='activa'),0)
       - COALESCE((SELECT SUM(monto_usd) FROM pagos p WHERE p.unidad_id=u.id AND p.estado='aprobado'),0) AS saldo,
       (SELECT MAX(creada) FROM pagos p WHERE p.unidad_id=u.id AND p.estado='aprobado') AS ultimo_pago
     FROM unidades u
     LEFT JOIN membresias m ON m.unidad_id=u.id AND m.rol='residente'
     LEFT JOIN usuarios us ON us.id=m.usuario_id
     WHERE u.condominio_id=? GROUP BY u.id ORDER BY u.nombre`).bind(id).all()
  return c.json({ propietarios: results })
})
finanzas.get('/propietarios/:unidadId', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const uid = c.req.param('unidadId')
  const uni = await c.env.DB.prepare(`SELECT id, nombre FROM unidades WHERE id=? AND condominio_id=?`).bind(uid, id).first()
  if (!uni) return c.json({ error: 'unidad no existe' }, 404)
  const { results: cuotas } = await c.env.DB.prepare(`SELECT periodo, concepto, monto_usd FROM cuotas WHERE unidad_id=? ORDER BY periodo DESC LIMIT 24`).bind(uid).all()
  const { results: pagos } = await c.env.DB.prepare(`SELECT id, monto_usd, metodo, estado, creada FROM pagos WHERE unidad_id=? ORDER BY creada DESC LIMIT 24`).bind(uid).all()
  const { results: multas } = await c.env.DB.prepare(`SELECT id, tipo, motivo, monto_usd, estado, creada FROM multas WHERE unidad_id=? ORDER BY creada DESC LIMIT 24`).bind(uid).all()
  const { results: notas } = await c.env.DB.prepare(`SELECT n.texto, n.creada, u.nombre AS autor FROM notas_crm n LEFT JOIN usuarios u ON u.id=n.creada_por WHERE n.unidad_id=? ORDER BY n.creada DESC LIMIT 30`).bind(uid).all()
  const { results: residentes } = await c.env.DB.prepare(
    `SELECT m.id, u.nombre, u.email, u.telefono FROM membresias m JOIN usuarios u ON u.id=m.usuario_id
     WHERE m.unidad_id=? AND m.condominio_id=? AND m.rol='residente'`).bind(uid, id).all()
  return c.json({ unidad: uni, cuotas, pagos, multas, notas, residentes })
})

// Quitar a un residente de su unidad (offboarding). Solo membresías de rol residente de este condominio.
finanzas.delete('/miembros/:id', soloAdmin, async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM membresias WHERE id=? AND condominio_id=? AND rol='residente'`)
    .bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'membresía no encontrada o no es residente de este condominio' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'crm.residente_desvinculado', { id: c.req.param('id') })
  return c.json({ ok: true })
})

// Anular (borrar) una cuota mal emitida.
finanzas.delete('/cuotas/:id', soloAdmin, async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM cuotas WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'cuota no encontrada' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.cuota_anulada', { id: c.req.param('id') })
  return c.json({ ok: true })
})

// Editar un egreso (corregir monto/descripción/categoría/proveedor/fecha).
finanzas.patch('/gastos/:id', soloAdmin, async (c) => {
  const b = await c.req.json<{ descripcion?: string; categoria?: string; proveedor?: string; monto?: number; fecha?: string }>().catch(() => ({} as any))
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.descripcion === 'string' && b.descripcion.trim()) { sets.push('descripcion=?'); binds.push(b.descripcion.trim().slice(0, 200)) }
  if (b.categoria && CATEGORIAS.includes(b.categoria)) { sets.push('categoria=?'); binds.push(b.categoria) }
  if (typeof b.proveedor === 'string') { sets.push('proveedor=?'); binds.push(b.proveedor.slice(0, 120)) }
  if (b.monto !== undefined) { const m = num(b.monto); if (!Number.isFinite(m) || m < 0) return c.json({ error: 'monto ≥ 0' }, 400); sets.push('monto_usd=?'); binds.push(m) }
  if (b.fecha && FECHA_RE.test(b.fecha)) { sets.push('fecha=?'); binds.push(b.fecha) }
  if (!sets.length) return c.json({ error: 'nada que actualizar' }, 400)
  binds.push(c.req.param('id'), c.get('condo')!.id)
  const r = await c.env.DB.prepare(`UPDATE gastos SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'egreso no encontrado' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.egreso_editado', { id: c.req.param('id') })
  return c.json({ ok: true })
})
finanzas.delete('/gastos/:id', soloAdmin, async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM gastos WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'egreso no encontrado' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'finanzas.egreso_borrado', { id: c.req.param('id') })
  return c.json({ ok: true })
})
// Editar el teléfono de un propietario (para WhatsApp/CRM). Solo si es residente de este condominio.
finanzas.post('/contacto', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ usuario_id?: string; telefono?: string }>().catch(() => ({} as any))
  if (!b.usuario_id) return c.json({ error: 'usuario requerido' }, 400)
  // Solo el contacto de residentes de este condominio (el CRM no toca teléfonos de admins ni de otros tenants).
  const m = await c.env.DB.prepare(`SELECT 1 FROM membresias WHERE usuario_id=? AND condominio_id=? AND rol='residente' LIMIT 1`).bind(b.usuario_id, id).first()
  if (!m) return c.json({ error: 'ese usuario no es residente de este condominio' }, 404)
  await c.env.DB.prepare(`UPDATE usuarios SET telefono=? WHERE id=?`).bind((b.telefono ?? '').slice(0, 30) || null, b.usuario_id).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'crm.contacto', { usuario: b.usuario_id })
  return c.json({ ok: true })
})

finanzas.post('/notas', soloAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ unidad_id?: string; texto?: string }>().catch(() => ({} as any))
  if (!b.unidad_id || !b.texto?.trim()) return c.json({ error: 'unidad y texto requeridos' }, 400)
  // La unidad debe pertenecer al condominio activo (evita inyectar notas en unidades de otro tenant).
  const uni = await c.env.DB.prepare(`SELECT 1 FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, id).first()
  if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  await c.env.DB.prepare(`INSERT INTO notas_crm(id,condominio_id,unidad_id,texto,creada_por) VALUES(?,?,?,?,?)`)
    .bind(crypto.randomUUID(), id, b.unidad_id, b.texto.trim().slice(0, 500), c.get('auth')!.usuarioId).run()
  return c.json({ ok: true })
})

/* ---------- RECIBO MEMBRETADO ---------- */
// Admin: cualquier pago del condominio. Residente: solo el recibo de un pago APROBADO de su unidad.
finanzas.get('/pagos/:id/recibo', requireRol('residente', 'admin', 'org_admin'), async (c) => {
  const condo = c.get('condo')!
  const r = await c.env.DB.prepare(
    `SELECT p.id, p.unidad_id, p.monto_usd, p.metodo, p.referencia, p.estado, p.creada, p.conciliada,
            u.nombre AS unidad, us.nombre AS residente, us.email, c.nombre AS condominio, c.direccion,
            COALESCE(p.tasa_bs, c.tasa_bs) AS tasa_bs,          -- tasa del día del pago; si el pago es anterior a 0009, la actual
            (p.tasa_bs IS NULL) AS tasa_referencial,            -- 1 = conversión referencial a la tasa actual del condominio
            org.nombre AS organizacion
     FROM pagos p JOIN unidades u ON u.id=p.unidad_id JOIN usuarios us ON us.id=p.reportado_por
     JOIN condominios c ON c.id=p.condominio_id JOIN organizaciones org ON org.id=c.organizacion_id
     WHERE p.id=? AND p.condominio_id=?`).bind(c.req.param('id'), condo.id).first<any>()
  if (!r) return c.json({ error: 'pago no encontrado' }, 404)
  if (condo.rol === 'residente' && (r.unidad_id !== condo.unidadId || r.estado !== 'aprobado'))
    return c.json({ error: 'solo puedes ver el recibo de un pago aprobado de tu unidad' }, 403)
  return c.json(r)
})

import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { tokenAleatorio, codigoLegible, normalizarCodigo } from '../lib/crypto'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const accesos = new Hono<{ Bindings: Env; Variables: Vars }>()

/* ---------- PÚBLICO: info del pase (para la página /pase/:token, sin sesión) ---------- */
accesos.get('/pase-info/:token', async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT pv.token, pv.codigo, pv.visitante, pv.tipo, pv.ventana, pv.expira, pv.usos,
            c.nombre AS condominio, u.nombre AS unidad, us.nombre AS anfitrion
     FROM pases_visita pv JOIN condominios c ON c.id=pv.condominio_id
     LEFT JOIN unidades u ON u.id=pv.unidad_id JOIN usuarios us ON us.id=pv.creado_por
     WHERE pv.token=?`,
  ).bind(c.req.param('token')).first<any>()
  if (!p) return c.json({ error: 'pase no encontrado' }, 404)
  const vencido = new Date(p.expira.replace(' ', 'T') + 'Z') < new Date()
  return c.json({ ...p, vencido, usado: p.tipo === 'unico' && p.usos > 0 })
})

/* ---------- PROTEGIDO ---------- */
const p = new Hono<{ Bindings: Env; Variables: Vars }>()
p.use('*', requireAuth, conCondominio)

const esPorteria = requireRol('porteria', 'admin', 'org_admin')
const esAdmin = requireRol('admin', 'org_admin')

/* --- Residente: pases de visita --- */
p.post('/pases', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ visitante?: string; tipo?: string; ventana?: string; horas?: number }>().catch(() => ({} as any))
  if (!b.visitante?.trim()) return c.json({ error: 'nombre del visitante requerido' }, 400)
  // Un pase debe colgar de una unidad; si no, quedaría huérfano (visible en portería pero no para su creador).
  if (!condo.unidadId) return c.json({ error: 'tu cuenta no está asociada a una unidad' }, 400)
  const tipo = b.tipo === 'recurrente' ? 'recurrente' : 'unico'
  const horas = Math.min(Math.max(Number(b.horas) || 12, 1), 720)
  const token = tokenAleatorio()
  // El código corto es único POR CONDOMINIO (índice parcial de la 0012). La colisión es
  // rarísima (25^6) pero posible, y se resuelve reintentando: comprobar antes con un SELECT
  // sería una carrera entre dos residentes creando pases a la vez.
  let codigo = ''
  for (let intento = 0; intento < 5; intento++) {
    codigo = codigoLegible()
    try {
      await c.env.DB.prepare(
        `INSERT INTO pases_visita(token,condominio_id,unidad_id,creado_por,visitante,tipo,ventana,codigo,expira)
         VALUES(?,?,?,?,?,?,?,?,datetime('now','+' || ? || ' hours'))`,
      ).bind(token, condo.id, condo.unidadId, c.get('auth')!.usuarioId, b.visitante.trim().slice(0, 80), tipo, (b.ventana ?? '').slice(0, 80), codigo, String(horas)).run()
      break
    } catch (e) {
      if (!/UNIQUE constraint/i.test((e as Error)?.message ?? '')) throw e
      if (intento === 4) return c.json({ error: 'no se pudo generar un código libre, intenta de nuevo' }, 503)
    }
  }
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'acceso.pase_creado', { visitante: b.visitante, tipo })
  return c.json({ token, codigo, url: `/pase/${token}` })
})
p.get('/pases', requireRol('residente'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT token, codigo, visitante, tipo, ventana, usos, expira, creada FROM pases_visita
     WHERE unidad_id=? ORDER BY creada DESC LIMIT 50`).bind(c.get('condo')!.unidadId ?? '').all()
  return c.json({ pases: results })
})
// Cancelar un pase propio (lo invalida sin romper la bitácora si ya se usó).
p.delete('/pases/:token', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const r = await c.env.DB.prepare(
    `UPDATE pases_visita SET expira=datetime('now','-1 second') WHERE token=? AND condominio_id=? AND unidad_id=? AND expira > datetime('now')`,
  ).bind(c.req.param('token'), condo.id, condo.unidadId ?? '').run()
  if (!r.meta.changes) return c.json({ error: 'pase no encontrado, ajeno o ya vencido' }, 404)
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'acceso.pase_cancelado', { token: c.req.param('token').slice(0, 12) })
  return c.json({ ok: true })
})

/* --- Portería: cola, escaneo, sin cita, delivery --- */
p.get('/cola', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const { results: pases } = await c.env.DB.prepare(
    `SELECT pv.token, pv.codigo, pv.visitante, pv.tipo, pv.ventana, pv.usos, pv.expira, u.nombre AS unidad, us.nombre AS anfitrion
     FROM pases_visita pv LEFT JOIN unidades u ON u.id=pv.unidad_id JOIN usuarios us ON us.id=pv.creado_por
     WHERE pv.condominio_id=? AND pv.expira > datetime('now') AND NOT(pv.tipo='unico' AND pv.usos>0)
     ORDER BY pv.creada DESC LIMIT 50`).bind(id).all()
  const { results: pendientes } = await c.env.DB.prepare(
    `SELECT v.id, v.visitante, v.documento, v.motivo, u.nombre AS unidad, v.creada
     FROM visitas_log v LEFT JOIN unidades u ON u.id=v.unidad_id
     WHERE v.condominio_id=? AND v.estado='pendiente' ORDER BY v.creada DESC`).bind(id).all()
  // Cierre del citófono: decisiones recientes del residente (aprobó/denegó) para que el guardia las vea.
  const { results: resueltas } = await c.env.DB.prepare(
    `SELECT v.id, v.visitante, v.estado, u.nombre AS unidad, v.creada
     FROM visitas_log v LEFT JOIN unidades u ON u.id=v.unidad_id
     WHERE v.condominio_id=? AND v.tipo='sincita' AND v.estado IN ('ingreso','denegado')
       AND v.creada > datetime('now','-15 minutes') ORDER BY v.creada DESC LIMIT 20`).bind(id).all()
  return c.json({ pases, pendientes, resueltas })
})
// Registrar ingreso. El parámetro acepta LAS DOS COSAS: el token largo que viene del QR o
// el código corto que el guardia teclea cuando la cámara falla. El código se normaliza
// (mayúsculas, sin guiones ni espacios) y solo se busca si quedó algo: con la cadena vacía
// `codigo=''` no puede colarse ningún pase, y los anteriores a la 0012 tienen codigo NULL.
// La búsqueda va acotada al condominio del guardia, así que un código de otro edificio no
// entra aquí ni por accidente.
p.post('/pases/:token/registrar', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const entrada = c.req.param('token')
  const cod = normalizarCodigo(entrada)
  const pase = await c.env.DB.prepare(
    `SELECT token, unidad_id, visitante, tipo, usos FROM pases_visita
     WHERE condominio_id=? AND expira > datetime('now') AND (token=? OR (?<>'' AND codigo=?))`,
  ).bind(id, entrada, cod, cod).first<any>()
  if (!pase) return c.json({ error: 'pase inválido o vencido' }, 404)
  if (pase.tipo === 'unico' && pase.usos > 0) return c.json({ error: 'este pase de un uso ya fue utilizado' }, 409)
  const vid = crypto.randomUUID()
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE pases_visita SET usos=usos+1 WHERE token=?`).bind(pase.token),
    c.env.DB.prepare(`INSERT INTO visitas_log(id,condominio_id,unidad_id,pase_token,visitante,tipo,estado,guardia_id) VALUES(?,?,?,?,?,'qr','ingreso',?)`)
      .bind(vid, id, pase.unidad_id, pase.token, pase.visitante, c.get('auth')!.usuarioId),
  ])
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'acceso.qr_ingreso', { visitante: pase.visitante })
  return c.json({ ok: true, visitante: pase.visitante })
})
// visita sin cita → citófono (queda pendiente hasta que el residente responda)
p.post('/sincita', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ visitante?: string; documento?: string; unidad_id?: string; motivo?: string; foto_key?: string }>().catch(() => ({} as any))
  if (!b.visitante?.trim() || !b.unidad_id) return c.json({ error: 'visitante y unidad requeridos' }, 400)
  const uni = await c.env.DB.prepare(`SELECT id FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, id).first()
  if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  const key = b.foto_key?.trim() || null
  if (key && !key.startsWith(`${id}/`)) return c.json({ error: 'foto inválida' }, 400)
  const vid = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO visitas_log(id,condominio_id,unidad_id,visitante,tipo,estado,documento,motivo,foto_key,guardia_id)
     VALUES(?,?,?,?,'sincita','pendiente',?,?,?,?)`,
  ).bind(vid, id, b.unidad_id, b.visitante.trim().slice(0, 80), (b.documento ?? '').slice(0, 40), (b.motivo ?? '').slice(0, 120), key, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'acceso.sincita', { visitante: b.visitante })
  return c.json({ id: vid, estado: 'pendiente' })
})
p.post('/delivery', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ visitante?: string; unidad_id?: string }>().catch(() => ({} as any))
  if (!b.visitante?.trim()) return c.json({ error: 'descripción del delivery requerida' }, 400)
  // Si se indica unidad, debe ser de este condominio (evita colgar el delivery de una unidad ajena).
  if (b.unidad_id) {
    const uni = await c.env.DB.prepare(`SELECT id FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, id).first()
    if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  }
  const vid = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO visitas_log(id,condominio_id,unidad_id,visitante,tipo,estado,guardia_id) VALUES(?,?,?,?,'delivery','ingreso',?)`)
    .bind(vid, id, b.unidad_id ?? null, b.visitante.trim().slice(0, 80), c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'acceso.delivery', { desc: b.visitante })
  return c.json({ id: vid })
})

/* --- Citófono: residente responde a una visita pendiente --- */
p.get('/citofono', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const { results } = await c.env.DB.prepare(
    `SELECT id, visitante, documento, motivo, foto_key, creada FROM visitas_log
     WHERE condominio_id=? AND unidad_id=? AND estado='pendiente' ORDER BY creada DESC`).bind(condo.id, condo.unidadId ?? '').all()
  return c.json({ pendientes: results })
})
p.post('/citofono/:id/responder', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ aprobar?: boolean }>().catch(() => ({} as any))
  if (typeof b.aprobar !== 'boolean') return c.json({ error: 'aprobar (booleano) requerido' }, 400)
  const r = await c.env.DB.prepare(
    `UPDATE visitas_log SET estado=?, resuelto_por=? WHERE id=? AND condominio_id=? AND unidad_id=? AND estado='pendiente'`,
  ).bind(b.aprobar ? 'ingreso' : 'denegado', c.get('auth')!.usuarioId, c.req.param('id'), condo.id, condo.unidadId ?? '').run()
  if (!r.meta.changes) return c.json({ error: 'visita no encontrada o ya resuelta' }, 404)
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'acceso.citofono', { id: c.req.param('id'), aprobado: b.aprobar })
  return c.json({ ok: true })
})

/* --- Paquetería --- */
p.post('/paquetes', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ unidad_id?: string; descripcion?: string; remitente?: string; foto_key?: string }>().catch(() => ({} as any))
  if (!b.unidad_id || !b.descripcion?.trim()) return c.json({ error: 'unidad y descripción requeridas' }, 400)
  const uni = await c.env.DB.prepare(`SELECT id FROM unidades WHERE id=? AND condominio_id=?`).bind(b.unidad_id, id).first()
  if (!uni) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  const key = b.foto_key?.trim() || null
  if (key && !key.startsWith(`${id}/`)) return c.json({ error: 'foto inválida' }, 400)
  const pid = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO paquetes(id,condominio_id,unidad_id,descripcion,remitente,foto_key,recibido_por) VALUES(?,?,?,?,?,?,?)`,
  ).bind(pid, id, b.unidad_id, b.descripcion.trim().slice(0, 120), (b.remitente ?? '').slice(0, 80), key, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'acceso.paquete', { unidad: b.unidad_id })
  return c.json({ id: pid })
})
p.post('/paquetes/:id/entregar', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const r = await c.env.DB.prepare(
    `UPDATE paquetes SET estado='entregado', entregado_por=?, entregada=datetime('now') WHERE id=? AND condominio_id=? AND estado='custodia'`,
  ).bind(c.get('auth')!.usuarioId, c.req.param('id'), id).run()
  if (!r.meta.changes) return c.json({ error: 'paquete no existe o ya fue entregado' }, 404)
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'acceso.paquete_entregado', { id: c.req.param('id') })
  return c.json({ ok: true })
})
p.get('/paquetes', async (c) => {
  const condo = c.get('condo')!
  if (condo.rol === 'residente') {
    const { results } = await c.env.DB.prepare(
      `SELECT id, descripcion, remitente, foto_key, estado, creada, entregada FROM paquetes WHERE unidad_id=? ORDER BY creada DESC LIMIT 50`).bind(condo.unidadId ?? '').all()
    return c.json({ paquetes: results })
  }
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.descripcion, p.remitente, p.foto_key, p.estado, p.creada, u.nombre AS unidad
     FROM paquetes p JOIN unidades u ON u.id=p.unidad_id WHERE p.condominio_id=? AND p.estado='custodia' ORDER BY p.creada DESC LIMIT 100`).bind(condo.id).all()
  return c.json({ paquetes: results })
})

/* --- SOS --- */
p.post('/sos', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ tipo?: string }>().catch(() => ({} as any))
  const sid = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO sos_alertas(id,condominio_id,unidad_id,usuario_id,tipo) VALUES(?,?,?,?,?)`)
    .bind(sid, condo.id, condo.unidadId, c.get('auth')!.usuarioId, (b.tipo ?? 'Emergencia').slice(0, 40)).run()
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'sos.activada', { tipo: b.tipo })
  return c.json({ id: sid, estado: 'activa' })
})
p.get('/sos', async (c) => {
  const condo = c.get('condo')!
  const q = condo.rol === 'residente'
    ? c.env.DB.prepare(`SELECT id, tipo, estado, creada, resuelta FROM sos_alertas WHERE usuario_id=? AND condominio_id=? ORDER BY creada DESC LIMIT 20`).bind(c.get('auth')!.usuarioId, condo.id)
    : c.env.DB.prepare(`SELECT s.id, s.tipo, s.estado, s.creada, u.nombre AS unidad, us.nombre AS residente
        FROM sos_alertas s LEFT JOIN unidades u ON u.id=s.unidad_id JOIN usuarios us ON us.id=s.usuario_id
        WHERE s.condominio_id=? AND s.estado!='resuelta' ORDER BY s.creada DESC`).bind(condo.id)
  const { results } = await q.all()
  return c.json({ alertas: results })
})
// El residente cancela su propia alerta (falsa alarma).
p.post('/sos/:id/cancelar', requireRol('residente'), async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE sos_alertas SET estado='resuelta', resuelta=datetime('now') WHERE id=? AND usuario_id=? AND condominio_id=? AND estado!='resuelta'`,
  ).bind(c.req.param('id'), c.get('auth')!.usuarioId, c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'alerta no encontrada, ajena o ya cerrada' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'sos.cancelada', { id: c.req.param('id') })
  return c.json({ ok: true })
})
p.post('/sos/:id/atender', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ estado?: string }>().catch(() => ({} as any))
  const estado = b.estado === 'resuelta' ? 'resuelta' : 'atendida'
  const r = await c.env.DB.prepare(
    `UPDATE sos_alertas SET estado=?, atendida_por=?, resuelta=CASE WHEN ?='resuelta' THEN datetime('now') ELSE resuelta END
     WHERE id=? AND condominio_id=? AND estado!='resuelta'`,
  ).bind(estado, c.get('auth')!.usuarioId, estado, c.req.param('id'), id).run()
  if (!r.meta.changes) return c.json({ error: 'alerta no encontrada o ya resuelta' }, 404)
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'sos.atendida', { id: c.req.param('id'), estado })
  return c.json({ ok: true, estado })
})

/* --- Rondas --- */
p.post('/rondas', esPorteria, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ checkpoint?: string; novedad?: string; foto_key?: string }>().catch(() => ({} as any))
  if (!b.checkpoint?.trim()) return c.json({ error: 'checkpoint requerido' }, 400)
  const key = b.foto_key?.trim() || null
  if (key && !key.startsWith(`${id}/`)) return c.json({ error: 'foto inválida' }, 400)
  const rid = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO rondas(id,condominio_id,guardia_id,checkpoint,novedad,foto_key) VALUES(?,?,?,?,?,?)`)
    .bind(rid, id, c.get('auth')!.usuarioId, b.checkpoint.trim().slice(0, 80), (b.novedad ?? '').slice(0, 200) || null, key).run()
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'ronda.checkpoint', { checkpoint: b.checkpoint, novedad: !!b.novedad })
  return c.json({ id: rid })
})
p.get('/rondas', esPorteria, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.checkpoint, r.novedad, r.foto_key, r.creada, u.nombre AS guardia FROM rondas r JOIN usuarios u ON u.id=r.guardia_id
     WHERE r.condominio_id=? ORDER BY r.creada DESC LIMIT 50`).bind(c.get('condo')!.id).all()
  return c.json({ rondas: results })
})

/* --- Admin: bitácora de seguridad --- */
p.get('/bitacora', esAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.creada, v.tipo, v.estado, v.visitante, v.documento, v.foto_key, u.nombre AS unidad, g.nombre AS guardia
     FROM visitas_log v LEFT JOIN unidades u ON u.id=v.unidad_id LEFT JOIN usuarios g ON g.id=v.guardia_id
     WHERE v.condominio_id=? ORDER BY v.creada DESC LIMIT 200`).bind(c.get('condo')!.id).all()
  return c.json({ bitacora: results })
})

accesos.route('/', p)

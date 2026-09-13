import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const comunidad = new Hono<{ Bindings: Env; Variables: Vars }>()
comunidad.use('*', requireAuth, conCondominio)
const esAdmin = requireRol('admin', 'org_admin')

/* ---------- ÁREAS COMUNES ---------- */
comunidad.get('/areas', async (c) => {
  const condo = c.get('condo')!
  const q = condo.rol === 'residente'
    ? c.env.DB.prepare(`SELECT id,nombre,aforo,costo_usd,horario FROM areas_comunes WHERE condominio_id=? AND activa=1 ORDER BY nombre`).bind(condo.id)
    : c.env.DB.prepare(`SELECT id,nombre,aforo,costo_usd,horario,activa FROM areas_comunes WHERE condominio_id=? ORDER BY nombre`).bind(condo.id)
  return c.json({ areas: (await q.all()).results })
})
comunidad.post('/areas', esAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ nombre?: string; aforo?: number; costo_usd?: number; horario?: string }>().catch(() => ({} as any))
  if (!b.nombre?.trim()) return c.json({ error: 'nombre requerido' }, 400)
  const aid = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`INSERT INTO areas_comunes(id,condominio_id,nombre,aforo,costo_usd,horario) VALUES(?,?,?,?,?,?)`)
      .bind(aid, id, b.nombre.trim().slice(0, 60), Math.max(0, Number(b.aforo) || 0), Math.max(0, Number(b.costo_usd) || 0), (b.horario ?? '').slice(0, 60)).run()
  } catch (e) { if (/UNIQUE/i.test((e as Error).message)) return c.json({ error: 'ya existe un área con ese nombre' }, 409); throw e }
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'comunidad.area_creada', { nombre: b.nombre })
  return c.json({ id: aid })
})
comunidad.patch('/areas/:id', esAdmin, async (c) => {
  const b = await c.req.json<{ nombre?: string; aforo?: number; costo_usd?: number; horario?: string; activa?: boolean }>().catch(() => ({} as any))
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.nombre === 'string') { sets.push('nombre=?'); binds.push(b.nombre.slice(0, 60)) }
  if (b.aforo !== undefined) { sets.push('aforo=?'); binds.push(Math.max(0, Number(b.aforo) || 0)) }
  if (b.costo_usd !== undefined) { sets.push('costo_usd=?'); binds.push(Math.max(0, Number(b.costo_usd) || 0)) }
  if (typeof b.horario === 'string') { sets.push('horario=?'); binds.push(b.horario.slice(0, 60)) }
  if (typeof b.activa === 'boolean') { sets.push('activa=?'); binds.push(b.activa ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'nada que actualizar' }, 400)
  binds.push(c.req.param('id'), c.get('condo')!.id)
  const r = await c.env.DB.prepare(`UPDATE areas_comunes SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'área no encontrada' }, 404)
  return c.json({ ok: true })
})
comunidad.delete('/areas/:id', esAdmin, async (c) => {
  const id = c.get('condo')!.id
  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) n FROM reservas WHERE area_id=? AND condominio_id=?`).bind(c.req.param('id'), id).first<{ n: number }>()
  if (cnt && cnt.n) return c.json({ error: 'el área tiene reservas; desactívala en vez de borrarla' }, 409)
  const r = await c.env.DB.prepare(`DELETE FROM areas_comunes WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), id).run()
  if (!r.meta.changes) return c.json({ error: 'área no encontrada' }, 404)
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'comunidad.area_borrada', { id: c.req.param('id') })
  return c.json({ ok: true })
})

/* ---------- RESERVAS ---------- */
comunidad.post('/reservas', requireRol('residente'), async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ area_id?: string; fecha?: string; franja?: string; invitados?: number }>().catch(() => ({} as any))
  if (!b.area_id || !b.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return c.json({ error: 'área y fecha (YYYY-MM-DD) requeridas' }, 400)
  const area = await c.env.DB.prepare(`SELECT id, aforo FROM areas_comunes WHERE id=? AND condominio_id=? AND activa=1`).bind(b.area_id, condo.id).first<{ id: string; aforo: number }>()
  if (!area) return c.json({ error: 'área no disponible' }, 404)
  const invitados = Math.max(0, Number(b.invitados) || 0)
  if (area.aforo > 0 && invitados > area.aforo) return c.json({ error: `el aforo del área es ${area.aforo} personas` }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO reservas(id,condominio_id,area_id,unidad_id,usuario_id,fecha,franja,invitados) VALUES(?,?,?,?,?,?,?,?)`,
  ).bind(id, condo.id, b.area_id, condo.unidadId, c.get('auth')!.usuarioId, b.fecha, (b.franja ?? '').slice(0, 30), invitados).run()
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'comunidad.reserva_solicitada', { area: b.area_id, fecha: b.fecha })
  return c.json({ id, estado: 'solicitada' })
})
comunidad.get('/reservas', async (c) => {
  const condo = c.get('condo')!
  const base = `SELECT r.id, r.fecha, r.franja, r.invitados, r.estado, r.motivo, r.creada, a.nombre AS area`
  if (condo.rol === 'residente') {
    const { results } = await c.env.DB.prepare(`${base} FROM reservas r JOIN areas_comunes a ON a.id=r.area_id WHERE r.usuario_id=? AND r.condominio_id=? ORDER BY r.creada DESC LIMIT 50`).bind(c.get('auth')!.usuarioId, condo.id).all()
    return c.json({ reservas: results })
  }
  // La vista completa de reservas es de la administración; portería no ve las reservas del condominio.
  if (condo.rol !== 'admin' && condo.rol !== 'org_admin') return c.json({ error: 'sin permiso' }, 403)
  const estado = c.req.query('estado')
  const sql = `${base}, u.nombre AS residente, un.nombre AS unidad FROM reservas r JOIN areas_comunes a ON a.id=r.area_id JOIN usuarios u ON u.id=r.usuario_id LEFT JOIN unidades un ON un.id=r.unidad_id WHERE r.condominio_id=?${estado ? ' AND r.estado=?' : ''} ORDER BY r.creada DESC LIMIT 200`
  const q = estado ? c.env.DB.prepare(sql).bind(condo.id, estado) : c.env.DB.prepare(sql).bind(condo.id)
  return c.json({ reservas: (await q.all()).results })
})
comunidad.post('/reservas/:id/resolver', esAdmin, async (c) => {
  const b = await c.req.json<{ aprobar?: boolean; motivo?: string }>().catch(() => ({} as any))
  if (typeof b.aprobar !== 'boolean') return c.json({ error: 'aprobar requerido' }, 400)
  // Antes de aprobar: que no haya ya otra reserva aprobada para la misma área, fecha y franja (solape).
  if (b.aprobar) {
    const solicitada = await c.env.DB.prepare(`SELECT area_id, fecha, franja FROM reservas WHERE id=? AND condominio_id=?`)
      .bind(c.req.param('id'), c.get('condo')!.id).first<{ area_id: string; fecha: string; franja: string }>()
    if (solicitada) {
      const choque = await c.env.DB.prepare(
        `SELECT 1 FROM reservas WHERE condominio_id=? AND area_id=? AND fecha=? AND franja=? AND estado='aprobada' AND id!=? LIMIT 1`,
      ).bind(c.get('condo')!.id, solicitada.area_id, solicitada.fecha, solicitada.franja, c.req.param('id')).first()
      if (choque) return c.json({ error: 'ya hay una reserva aprobada para esa área, fecha y franja' }, 409)
    }
  }
  const r = await c.env.DB.prepare(
    `UPDATE reservas SET estado=?, motivo=?, resuelta_por=? WHERE id=? AND condominio_id=? AND estado='solicitada'`,
  ).bind(b.aprobar ? 'aprobada' : 'rechazada', (b.motivo ?? '').slice(0, 200) || null, c.get('auth')!.usuarioId, c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'reserva no encontrada o ya resuelta' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'comunidad.reserva_resuelta', { id: c.req.param('id'), aprobada: b.aprobar })
  return c.json({ ok: true })
})
// El residente cancela su propia reserva.
comunidad.delete('/reservas/:id', requireRol('residente'), async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM reservas WHERE id=? AND usuario_id=? AND condominio_id=? AND estado!='rechazada'`)
    .bind(c.req.param('id'), c.get('auth')!.usuarioId, c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'reserva no encontrada o no cancelable' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'comunidad.reserva_cancelada', { id: c.req.param('id') })
  return c.json({ ok: true })
})

/* ---------- VOTACIONES ---------- */
comunidad.post('/votaciones', esAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ titulo?: string; descripcion?: string; cierre?: string; opciones?: string[] }>().catch(() => ({} as any))
  if (!b.titulo?.trim()) return c.json({ error: 'título requerido' }, 400)
  const ops = ((b.opciones ?? []) as string[]).map((o: string) => (o ?? '').trim()).filter(Boolean).slice(0, 10)
  if (ops.length < 2) return c.json({ error: 'al menos 2 opciones' }, 400)
  // Fecha de cierre opcional: si viene, debe ser una fecha válida (YYYY-MM-DD, con hora opcional) y futura.
  if (b.cierre) {
    if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(b.cierre)) return c.json({ error: 'fecha de cierre inválida (usa YYYY-MM-DD)' }, 400)
    const pasada = (await c.env.DB.prepare(`SELECT (datetime(?) <= datetime('now')) AS ya`).bind(b.cierre).first<{ ya: number }>())?.ya
    if (pasada) return c.json({ error: 'la fecha de cierre debe ser futura' }, 400)
  }
  const vid = crypto.randomUUID()
  const stmts = [c.env.DB.prepare(`INSERT INTO votaciones(id,condominio_id,titulo,descripcion,cierre,creada_por) VALUES(?,?,?,?,?,?)`)
    .bind(vid, id, b.titulo.trim().slice(0, 120), (b.descripcion ?? '').slice(0, 500), b.cierre ?? null, c.get('auth')!.usuarioId)]
  ops.forEach((t: string, i: number) => stmts.push(c.env.DB.prepare(`INSERT INTO opciones_voto(id,votacion_id,texto,orden) VALUES(?,?,?,?)`).bind(crypto.randomUUID(), vid, t.slice(0, 80), i)))
  await c.env.DB.batch(stmts)
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'comunidad.votacion_creada', { titulo: b.titulo })
  return c.json({ id: vid })
})
comunidad.get('/votaciones', async (c) => {
  const condo = c.get('condo')!
  const uid = c.get('auth')!.usuarioId
  const { results: vs } = await c.env.DB.prepare(`SELECT id,titulo,descripcion,cierre,estado,creada FROM votaciones WHERE condominio_id=? ORDER BY creada DESC LIMIT 50`).bind(condo.id).all<any>()
  const out = []
  for (const v of vs) {
    const { results: ops } = await c.env.DB.prepare(
      `SELECT o.id, o.texto, COALESCE(SUM(vt.peso),0) AS peso, COUNT(vt.id) AS n
       FROM opciones_voto o LEFT JOIN votos vt ON vt.opcion_id=o.id WHERE o.votacion_id=? GROUP BY o.id ORDER BY o.orden`).bind(v.id).all<{ id: string; texto: string; peso: number; n: number }>()
    // Porcentaje sobre la base normalizada EMITIDA: las opciones siempre suman 100 % (salvo redondeo).
    const emitido = ops.reduce((a, o) => a + o.peso, 0)
    const opciones = ops.map((o) => ({ ...o, porcentaje: emitido > 0 ? (o.peso / emitido) * 100 : 0 }))
    const mio = await c.env.DB.prepare(`SELECT opcion_id FROM votos WHERE votacion_id=? AND usuario_id=?`).bind(v.id, uid).first<{ opcion_id: string }>()
    out.push({ ...v, opciones, miVoto: mio?.opcion_id ?? null })
  }
  return c.json({ votaciones: out })
})
comunidad.post('/votaciones/:id/votar', async (c) => {
  const condo = c.get('condo')!
  // El voto pertenece a la UNIDAD (propiedad): sin unidad asignada no hay voto.
  // Esto excluye a admin, portería y org_admin (antes entraban con peso 1 fantasma).
  if (condo.rol !== 'residente' || !condo.unidadId) {
    return c.json({ error: 'solo los propietarios/residentes con unidad asignada votan' }, 403)
  }
  const b = await c.req.json<{ opcion_id?: string }>().catch(() => ({} as any))
  const vid = c.req.param('id')
  const vot = await c.env.DB.prepare(`SELECT estado, cierre FROM votaciones WHERE id=? AND condominio_id=?`).bind(vid, condo.id).first<{ estado: string; cierre: string | null }>()
  if (!vot) return c.json({ error: 'votación no existe' }, 404)
  if (vot.estado !== 'abierta') return c.json({ error: 'la votación está cerrada' }, 409)
  // La fecha de cierre se aplica de verdad: pasada esa fecha ya no se admiten votos.
  if (vot.cierre) {
    const cerrada = (await c.env.DB.prepare(`SELECT (datetime('now') > datetime(?)) AS ya`).bind(vot.cierre).first<{ ya: number }>())?.ya
    if (cerrada) return c.json({ error: 'la votación ya cerró (venció su fecha límite)' }, 409)
  }
  const op = await c.env.DB.prepare(`SELECT id FROM opciones_voto WHERE id=? AND votacion_id=?`).bind(b.opcion_id, vid).first()
  if (!op) return c.json({ error: 'opción inválida' }, 400)
  // Una unidad emite UN solo voto, sin importar cuántos ocupantes tenga: la unidad
  // queda persistida en el voto (migración 0009) y la blinda el UNIQUE parcial.
  // También bloquea al usuario cuyo voto histórico quedó sin unidad deducible en el
  // backfill de la migración 0009 (unidad_id NULL): ya votó y contaría doble.
  const yaVoto = await c.env.DB.prepare(
    `SELECT 1 FROM votos WHERE votacion_id=? AND (unidad_id=? OR (unidad_id IS NULL AND usuario_id=?)) LIMIT 1`,
  ).bind(vid, condo.unidadId, c.get('auth')!.usuarioId).first()
  if (yaVoto) return c.json({ error: 'esta unidad ya emitió su voto' }, 409)
  // Peso NORMALIZADO: alícuota de la unidad / Σ alícuotas del condominio, de modo
  // que el total posible siempre sea 1 (100 %) aunque el edificio esté mal cargado.
  const uni = await c.env.DB.prepare(
    `SELECT u.alicuota, (SELECT SUM(alicuota) FROM unidades WHERE condominio_id=?) AS suma
     FROM unidades u WHERE u.id=? AND u.condominio_id=?`,
  ).bind(condo.id, condo.unidadId, condo.id).first<{ alicuota: number; suma: number | null }>()
  if (!uni) return c.json({ error: 'tu unidad no existe en este condominio' }, 403)
  if (!uni.suma || uni.suma <= 0) return c.json({ error: 'las alícuotas del condominio suman 0: el administrador debe cargarlas antes de votar' }, 409)
  const peso = uni.alicuota / uni.suma
  try {
    await c.env.DB.prepare(`INSERT INTO votos(id,votacion_id,opcion_id,usuario_id,unidad_id,peso) VALUES(?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), vid, b.opcion_id, c.get('auth')!.usuarioId, condo.unidadId, peso).run()
  } catch (e) { if (/UNIQUE/i.test((e as Error).message)) return c.json({ error: 'esta unidad ya emitió su voto' }, 409); throw e }
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'comunidad.voto', { votacion: vid })
  return c.json({ ok: true })
})
comunidad.post('/votaciones/:id/cerrar', esAdmin, async (c) => {
  const r = await c.env.DB.prepare(`UPDATE votaciones SET estado='cerrada' WHERE id=? AND condominio_id=? AND estado='abierta'`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'votación no encontrada o ya cerrada' }, 404)
  return c.json({ ok: true })
})
comunidad.delete('/votaciones/:id', esAdmin, async (c) => {
  const id = c.get('condo')!.id, vid = c.req.param('id')
  const v = await c.env.DB.prepare(`SELECT id FROM votaciones WHERE id=? AND condominio_id=?`).bind(vid, id).first()
  if (!v) return c.json({ error: 'votación no encontrada' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM votos WHERE votacion_id=?`).bind(vid),
    c.env.DB.prepare(`DELETE FROM opciones_voto WHERE votacion_id=?`).bind(vid),
    c.env.DB.prepare(`DELETE FROM votaciones WHERE id=? AND condominio_id=?`).bind(vid, id),
  ])
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'comunidad.votacion_borrada', { id: vid })
  return c.json({ ok: true })
})

/* ---------- TICKETS ---------- */
comunidad.post('/tickets', async (c) => {
  const condo = c.get('condo')!
  const b = await c.req.json<{ titulo?: string; descripcion?: string; categoria?: string }>().catch(() => ({} as any))
  if (!b.titulo?.trim()) return c.json({ error: 'título requerido' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO tickets(id,condominio_id,unidad_id,usuario_id,titulo,descripcion,categoria) VALUES(?,?,?,?,?,?,?)`)
    .bind(id, condo.id, condo.unidadId ?? null, c.get('auth')!.usuarioId, b.titulo.trim().slice(0, 120), (b.descripcion ?? '').slice(0, 1000), (b.categoria ?? 'general').slice(0, 40)).run()
  await registrarEvento(c.env.DB, condo.id, c.get('auth')!.usuarioId, 'comunidad.ticket', { titulo: b.titulo })
  return c.json({ id })
})
comunidad.get('/tickets', async (c) => {
  const condo = c.get('condo')!
  if (condo.rol === 'residente') {
    const { results } = await c.env.DB.prepare(`SELECT id,titulo,descripcion,categoria,estado,asignado,creada FROM tickets WHERE usuario_id=? AND condominio_id=? ORDER BY creada DESC LIMIT 50`).bind(c.get('auth')!.usuarioId, condo.id).all()
    return c.json({ tickets: results })
  }
  // Los tickets (quejas de residentes) son de la administración; portería no los ve.
  if (condo.rol !== 'admin' && condo.rol !== 'org_admin') return c.json({ error: 'sin permiso' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT t.id,t.titulo,t.descripcion,t.categoria,t.estado,t.asignado,t.creada, u.nombre AS reporta, un.nombre AS unidad
     FROM tickets t JOIN usuarios u ON u.id=t.usuario_id LEFT JOIN unidades un ON un.id=t.unidad_id WHERE t.condominio_id=? ORDER BY t.creada DESC LIMIT 200`).bind(condo.id).all()
  return c.json({ tickets: results })
})
comunidad.patch('/tickets/:id', esAdmin, async (c) => {
  const b = await c.req.json<{ estado?: string; asignado?: string }>().catch(() => ({} as any))
  const sets: string[] = ["actualizada=datetime('now')"], binds: unknown[] = []
  if (b.estado && ['abierto', 'en_curso', 'resuelto'].includes(b.estado)) { sets.push('estado=?'); binds.push(b.estado) }
  if (typeof b.asignado === 'string') { sets.push('asignado=?'); binds.push(b.asignado.slice(0, 80)) }
  binds.push(c.req.param('id'), c.get('condo')!.id)
  const r = await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'ticket no encontrado' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'comunidad.ticket_actualizado', { id: c.req.param('id'), estado: b.estado })
  return c.json({ ok: true })
})
// El residente cierra su propio ticket.
comunidad.post('/tickets/:id/cerrar', requireRol('residente'), async (c) => {
  const r = await c.env.DB.prepare(`UPDATE tickets SET estado='resuelto', actualizada=datetime('now') WHERE id=? AND usuario_id=? AND condominio_id=? AND estado!='resuelto'`)
    .bind(c.req.param('id'), c.get('auth')!.usuarioId, c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'ticket no encontrado o ya resuelto' }, 404)
  await registrarEvento(c.env.DB, c.get('condo')!.id, c.get('auth')!.usuarioId, 'comunidad.ticket_cerrado', { id: c.req.param('id') })
  return c.json({ ok: true })
})

/* ---------- DIRECTORIO ---------- */
comunidad.get('/directorio', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id,nombre,cargo,telefono,nota FROM directorio WHERE condominio_id=? ORDER BY orden, nombre`).bind(c.get('condo')!.id).all()
  return c.json({ directorio: results })
})
comunidad.post('/directorio', esAdmin, async (c) => {
  const id = c.get('condo')!.id
  const b = await c.req.json<{ nombre?: string; cargo?: string; telefono?: string; nota?: string; orden?: number }>().catch(() => ({} as any))
  if (!b.nombre?.trim()) return c.json({ error: 'nombre requerido' }, 400)
  const did = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO directorio(id,condominio_id,nombre,cargo,telefono,nota,orden) VALUES(?,?,?,?,?,?,?)`)
    .bind(did, id, b.nombre.trim().slice(0, 80), (b.cargo ?? '').slice(0, 60), (b.telefono ?? '').slice(0, 30), (b.nota ?? '').slice(0, 120), Number(b.orden) || 0).run()
  return c.json({ id: did })
})
comunidad.patch('/directorio/:id', esAdmin, async (c) => {
  const b = await c.req.json<{ nombre?: string; cargo?: string; telefono?: string; nota?: string }>().catch(() => ({} as any))
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.nombre === 'string' && b.nombre.trim()) { sets.push('nombre=?'); binds.push(b.nombre.trim().slice(0, 80)) }
  if (typeof b.cargo === 'string') { sets.push('cargo=?'); binds.push(b.cargo.slice(0, 60)) }
  if (typeof b.telefono === 'string') { sets.push('telefono=?'); binds.push(b.telefono.slice(0, 30)) }
  if (typeof b.nota === 'string') { sets.push('nota=?'); binds.push(b.nota.slice(0, 120)) }
  if (!sets.length) return c.json({ error: 'nada que actualizar' }, 400)
  binds.push(c.req.param('id'), c.get('condo')!.id)
  const r = await c.env.DB.prepare(`UPDATE directorio SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'contacto no encontrado' }, 404)
  return c.json({ ok: true })
})
comunidad.delete('/directorio/:id', esAdmin, async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM directorio WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'contacto no encontrado' }, 404)
  return c.json({ ok: true })
})

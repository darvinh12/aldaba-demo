import { Hono } from 'hono'
import { requireAuth, requireSuperadmin, type Vars } from '../lib/tenancy'
import { tokenAleatorio } from '../lib/crypto'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const superadmin = new Hono<{ Bindings: Env; Variables: Vars }>()
superadmin.use('*', requireAuth, requireSuperadmin)

const esConflicto = (e: unknown) => /UNIQUE constraint/i.test((e as Error)?.message ?? '')

superadmin.get('/overview', async (c) => {
  const { results: organizaciones } = await c.env.DB.prepare(`SELECT * FROM organizaciones ORDER BY creada DESC`).all()
  const { results: condominios } = await c.env.DB.prepare(
    `SELECT c.*, o.nombre AS organizacion,
       (SELECT COUNT(*) FROM unidades u WHERE u.condominio_id=c.id) AS unidades,
       (SELECT COUNT(DISTINCT m.usuario_id) FROM membresias m WHERE m.condominio_id=c.id AND m.rol='residente') AS residentes
     FROM condominios c JOIN organizaciones o ON o.id=c.organizacion_id ORDER BY c.creada DESC`,
  ).all()
  return c.json({ organizaciones, condominios })
})

superadmin.post('/organizaciones', async (c) => {
  const { nombre } = await c.req.json<{ nombre?: string }>().catch(() => ({}) as any)
  if (!nombre?.trim()) return c.json({ error: 'nombre requerido' }, 400)
  if (nombre.trim().length > 120) return c.json({ error: 'nombre máx 120 caracteres' }, 400)
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`INSERT INTO organizaciones(id,nombre) VALUES(?,?)`).bind(id, nombre.trim()).run()
  } catch (e) {
    if (esConflicto(e)) return c.json({ error: 'ya existe una organización con ese nombre' }, 409)
    throw e
  }
  await registrarEvento(c.env.DB, null, c.get('auth')!.usuarioId, 'sa.org_creada', { id, nombre })
  return c.json({ id, nombre })
})

superadmin.patch('/organizaciones/:id', async (c) => {
  const { nombre } = await c.req.json<{ nombre?: string }>().catch(() => ({} as any))
  if (!nombre?.trim()) return c.json({ error: 'nombre requerido' }, 400)
  try {
    const r = await c.env.DB.prepare(`UPDATE organizaciones SET nombre=? WHERE id=?`).bind(nombre.trim().slice(0, 120), c.req.param('id')).run()
    if (!r.meta.changes) return c.json({ error: 'organización no existe' }, 404)
  } catch (e) { if (esConflicto(e)) return c.json({ error: 'ya existe una organización con ese nombre' }, 409); throw e }
  await registrarEvento(c.env.DB, null, c.get('auth')!.usuarioId, 'sa.org_editada', { id: c.req.param('id'), nombre })
  return c.json({ ok: true })
})

// Borrar una organización vacía (sin condominios). Si tiene condominios, hay que hacer offboarding de cada uno primero.
superadmin.delete('/organizaciones/:id', async (c) => {
  const oid = c.req.param('id')
  const org = await c.env.DB.prepare(`SELECT id FROM organizaciones WHERE id=?`).bind(oid).first()
  if (!org) return c.json({ error: 'organización no existe' }, 404)
  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) n FROM condominios WHERE organizacion_id=?`).bind(oid).first<{ n: number }>()
  if (cnt && cnt.n) return c.json({ error: 'la organización tiene condominios; elimínalos (offboarding) primero' }, 409)
  await c.env.DB.prepare(`DELETE FROM organizaciones WHERE id=?`).bind(oid).run()
  await registrarEvento(c.env.DB, null, c.get('auth')!.usuarioId, 'sa.org_borrada', { id: oid })
  return c.json({ ok: true })
})

superadmin.post('/condominios', async (c) => {
  const b = await c.req.json<{ organizacion_id?: string; nombre?: string; direccion?: string }>().catch(() => ({}) as any)
  if (!b.organizacion_id || !b.nombre?.trim()) return c.json({ error: 'organizacion_id y nombre requeridos' }, 400)
  if (b.nombre.trim().length > 120) return c.json({ error: 'nombre máx 120 caracteres' }, 400)
  const org = await c.env.DB.prepare(`SELECT id FROM organizaciones WHERE id=?`).bind(b.organizacion_id).first()
  if (!org) return c.json({ error: 'organización no existe' }, 404)
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(`INSERT INTO condominios(id,organizacion_id,nombre,direccion) VALUES(?,?,?,?)`)
      .bind(id, b.organizacion_id, b.nombre.trim(), (b.direccion ?? '').slice(0, 200)).run()
  } catch (e) {
    if (esConflicto(e)) return c.json({ error: 'esa organización ya tiene un condominio con ese nombre' }, 409)
    throw e
  }
  await registrarEvento(c.env.DB, id, c.get('auth')!.usuarioId, 'sa.condo_creado', { nombre: b.nombre })
  return c.json({ id, nombre: b.nombre })
})

// Editar condominio: dirección y tasa Bs/USD (la tasa la consume F2 finanzas).
superadmin.patch('/condominios/:id', async (c) => {
  const b = await c.req.json<{ nombre?: string; direccion?: string; tasa_bs?: number }>().catch(() => ({}) as any)
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.nombre === 'string') {
    if (!b.nombre.trim()) return c.json({ error: 'nombre no puede quedar vacío' }, 400)
    sets.push('nombre=?'); binds.push(b.nombre.trim().slice(0, 120))
  }
  if (typeof b.direccion === 'string') { sets.push('direccion=?'); binds.push(b.direccion.slice(0, 200)) }
  if (b.tasa_bs !== undefined) {
    const t = Number(b.tasa_bs)
    if (!Number.isFinite(t) || t < 0) return c.json({ error: 'tasa_bs debe ser un número ≥ 0' }, 400)
    sets.push('tasa_bs=?'); binds.push(t)
  }
  if (!sets.length) return c.json({ error: 'nada que actualizar (nombre, direccion, tasa_bs)' }, 400)
  binds.push(c.req.param('id'))
  const r = await c.env.DB.prepare(`UPDATE condominios SET ${sets.join(',')} WHERE id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'condominio no existe' }, 404)
  await registrarEvento(c.env.DB, c.req.param('id'), c.get('auth')!.usuarioId, 'sa.condo_editado', b)
  return c.json({ ok: true })
})

// Offboarding: borra un condominio y TODOS sus datos, en orden de dependencia (transaccional).
// No borra usuarios (pueden pertenecer a otros condominios); conserva `eventos` (log de auditoría).
superadmin.delete('/condominios/:id', async (c) => {
  const id = c.req.param('id')
  const condo = await c.env.DB.prepare(`SELECT nombre FROM condominios WHERE id=?`).bind(id).first<{ nombre: string }>()
  if (!condo) return c.json({ error: 'condominio no existe' }, 404)
  const P = c.env.DB
  await P.batch([
    P.prepare(`DELETE FROM lecturas_comunicado WHERE comunicado_id IN (SELECT id FROM comunicados WHERE condominio_id=?)`).bind(id),
    P.prepare(`DELETE FROM votos WHERE votacion_id IN (SELECT id FROM votaciones WHERE condominio_id=?)`).bind(id),
    P.prepare(`DELETE FROM opciones_voto WHERE votacion_id IN (SELECT id FROM votaciones WHERE condominio_id=?)`).bind(id),
    P.prepare(`DELETE FROM visitas_log WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM reservas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM pases_visita WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM paquetes WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM sos_alertas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM rondas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM notas_crm WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM multas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM pagos WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM cuotas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM comunicados WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM votaciones WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM tickets WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM areas_comunes WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM directorio WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM plantillas WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM mensajes WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM gastos WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM archivos WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM invitaciones WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM membresias WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM unidades WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM torres WHERE condominio_id=?`).bind(id),
    P.prepare(`DELETE FROM condominios WHERE id=?`).bind(id),
  ])
  await registrarEvento(c.env.DB, null, c.get('auth')!.usuarioId, 'sa.condo_borrado', { id, nombre: condo.nombre })
  return c.json({ ok: true })
})

superadmin.post('/condominios/:id/suspension', async (c) => {
  const { suspendido } = await c.req.json<{ suspendido?: unknown }>().catch(() => ({}) as any)
  if (typeof suspendido !== 'boolean' && suspendido !== 0 && suspendido !== 1)
    return c.json({ error: 'suspendido debe ser booleano o 0/1' }, 400)
  const r = await c.env.DB.prepare(`UPDATE condominios SET suspendido=? WHERE id=?`)
    .bind(suspendido ? 1 : 0, c.req.param('id')).run()
  // meta.changes cuenta filas MATCHEADAS aunque el valor no cambie → re-suspender es idempotente (200)
  if (!r.meta.changes) return c.json({ error: 'condominio no existe' }, 404)
  await registrarEvento(c.env.DB, c.req.param('id'), c.get('auth')!.usuarioId, 'sa.suspension', { suspendido })
  return c.json({ ok: true })
})

superadmin.post('/invitaciones', async (c) => {
  const b = await c.req.json<{ condominio_id?: string; rol?: string }>().catch(() => ({}) as any)
  if (!b.condominio_id || !['admin', 'org_admin', 'porteria'].includes(b.rol ?? ''))
    return c.json({ error: 'condominio_id y rol admin|org_admin|porteria requeridos' }, 400)
  const condo = await c.env.DB.prepare(`SELECT id FROM condominios WHERE id=?`).bind(b.condominio_id).first()
  if (!condo) return c.json({ error: 'condominio no existe' }, 404)
  const token = tokenAleatorio()
  await c.env.DB.prepare(
    `INSERT INTO invitaciones(token,condominio_id,rol,expira,creado_por)
     VALUES(?,?,?,datetime('now','+7 days'),?)`,
  ).bind(token, b.condominio_id, b.rol, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, b.condominio_id, c.get('auth')!.usuarioId, 'sa.invitacion', { rol: b.rol })
  return c.json({ token, url: `/registro?token=${token}` })
})

// Desvincular CUALQUIER membresía (admin, org_admin, portería o residente) de un condominio.
// Complementa DELETE /finanzas/miembros/:id (que solo cubre residentes).
superadmin.delete('/membresias/:id', async (c) => {
  const m = await c.env.DB.prepare(`SELECT usuario_id, condominio_id, rol FROM membresias WHERE id=?`).bind(c.req.param('id')).first<{ usuario_id: string; condominio_id: string; rol: string }>()
  if (!m) return c.json({ error: 'membresía no encontrada' }, 404)
  await c.env.DB.prepare(`DELETE FROM membresias WHERE id=?`).bind(c.req.param('id')).run()
  await registrarEvento(c.env.DB, m.condominio_id, c.get('auth')!.usuarioId, 'sa.membresia_desvinculada', { rol: m.rol, usuario: m.usuario_id })
  return c.json({ ok: true })
})

// Listar invitaciones privilegiadas pendientes (para verlas y revocarlas desde la consola).
superadmin.get('/invitaciones', async (c) => {
  const condo = c.req.query('condominio')
  const base = `SELECT i.token, i.rol, i.condominio_id, i.expira, i.creada, c.nombre AS condominio,
                       (i.expira < datetime('now')) AS vencida
                FROM invitaciones i JOIN condominios c ON c.id=i.condominio_id
                WHERE i.usada=0 AND i.rol IN ('admin','org_admin','porteria')`
  const q = condo
    ? c.env.DB.prepare(`${base} AND i.condominio_id=? ORDER BY i.creada DESC LIMIT 100`).bind(condo)
    : c.env.DB.prepare(`${base} ORDER BY i.creada DESC LIMIT 200`)
  return c.json({ invitaciones: (await q.all()).results })
})

// Revocar cualquier invitación (incluye roles privilegiados admin/org_admin/porteria).
superadmin.delete('/invitaciones/:token', async (c) => {
  const r = await c.env.DB.prepare(`UPDATE invitaciones SET usada=1 WHERE token=? AND usada=0`)
    .bind(c.req.param('token')).run()
  if (!r.meta.changes) return c.json({ error: 'invitación no existe o ya usada' }, 404)
  await registrarEvento(c.env.DB, null, c.get('auth')!.usuarioId, 'sa.invitacion_revocada', { token: c.req.param('token').slice(0, 12) })
  return c.json({ ok: true })
})

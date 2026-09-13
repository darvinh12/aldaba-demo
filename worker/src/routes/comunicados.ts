import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const comunicados = new Hono<{ Bindings: Env; Variables: Vars }>()
comunicados.use('*', requireAuth, conCondominio)

comunicados.get('/', async (c) => {
  const condoId = c.get('condo')!.id
  const uid = c.get('auth')!.usuarioId
  const dest = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT usuario_id) AS n FROM membresias WHERE condominio_id=? AND rol='residente'`,
  ).bind(condoId).first<{ n: number }>()
  const { results } = await c.env.DB.prepare(
    `SELECT co.id, co.titulo, co.cuerpo, co.adjunto_key, co.creada, u.nombre AS autor,
       EXISTS(SELECT 1 FROM lecturas_comunicado l WHERE l.comunicado_id=co.id AND l.usuario_id=?) AS leido,
       (SELECT COUNT(DISTINCT l.usuario_id) FROM lecturas_comunicado l
         JOIN membresias m2 ON m2.usuario_id=l.usuario_id
          AND m2.condominio_id=co.condominio_id AND m2.rol='residente'
        WHERE l.comunicado_id=co.id) AS lectores
     FROM comunicados co JOIN usuarios u ON u.id=co.creado_por
     WHERE co.condominio_id=? ORDER BY co.creada DESC LIMIT 100`,
  ).bind(uid, condoId).all()
  return c.json({ comunicados: results.map((r) => ({ ...r, destinatarios: dest?.n ?? 0 })) })
})

comunicados.post('/', requireRol('admin', 'org_admin'), async (c) => {
  const condoId = c.get('condo')!.id
  const b = await c.req.json<{ titulo?: string; cuerpo?: string; adjunto_key?: string }>().catch(() => ({}) as any)
  if (!b.titulo?.trim() || !b.cuerpo?.trim()) return c.json({ error: 'título y cuerpo requeridos' }, 400)
  if (b.titulo.length > 200 || b.cuerpo.length > 10000)
    return c.json({ error: 'título máx 200 y cuerpo máx 10000 caracteres' }, 400)
  const adjunto = b.adjunto_key?.trim() || null
  if (adjunto && !adjunto.startsWith(`${condoId}/`))
    return c.json({ error: 'adjunto inválido' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO comunicados(id,condominio_id,titulo,cuerpo,adjunto_key,creado_por) VALUES(?,?,?,?,?,?)`,
  ).bind(id, condoId, b.titulo.trim(), b.cuerpo.trim(), adjunto, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'comunicado.publicado', { id, titulo: b.titulo })
  return c.json({ id })
})

comunicados.post('/:id/leer', async (c) => {
  const condoId = c.get('condo')!.id
  const existe = await c.env.DB.prepare(`SELECT id FROM comunicados WHERE id=? AND condominio_id=?`)
    .bind(c.req.param('id'), condoId).first()
  if (!existe) return c.json({ error: 'no existe' }, 404)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO lecturas_comunicado(comunicado_id,usuario_id) VALUES(?,?)`,
  ).bind(c.req.param('id'), c.get('auth')!.usuarioId).run()
  return c.json({ ok: true })
})

// Editar un comunicado (corregir título/cuerpo).
comunicados.patch('/:id', requireRol('admin', 'org_admin'), async (c) => {
  const condoId = c.get('condo')!.id
  const b = await c.req.json<{ titulo?: string; cuerpo?: string }>().catch(() => ({}) as any)
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.titulo === 'string') { if (!b.titulo.trim() || b.titulo.length > 200) return c.json({ error: 'título 1–200' }, 400); sets.push('titulo=?'); binds.push(b.titulo.trim()) }
  if (typeof b.cuerpo === 'string') { if (!b.cuerpo.trim() || b.cuerpo.length > 10000) return c.json({ error: 'cuerpo 1–10000' }, 400); sets.push('cuerpo=?'); binds.push(b.cuerpo.trim()) }
  if (!sets.length) return c.json({ error: 'nada que actualizar' }, 400)
  binds.push(c.req.param('id'), condoId)
  const r = await c.env.DB.prepare(`UPDATE comunicados SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'comunicado no encontrado' }, 404)
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'comunicado.editado', { id: c.req.param('id') })
  return c.json({ ok: true })
})
// Borrar un comunicado (y sus lecturas).
comunicados.delete('/:id', requireRol('admin', 'org_admin'), async (c) => {
  const condoId = c.get('condo')!.id
  const existe = await c.env.DB.prepare(`SELECT id FROM comunicados WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), condoId).first()
  if (!existe) return c.json({ error: 'comunicado no encontrado' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM lecturas_comunicado WHERE comunicado_id=?`).bind(c.req.param('id')),
    c.env.DB.prepare(`DELETE FROM comunicados WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), condoId),
  ])
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'comunicado.borrado', { id: c.req.param('id') })
  return c.json({ ok: true })
})

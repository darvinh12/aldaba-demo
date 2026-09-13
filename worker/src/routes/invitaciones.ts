import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { tokenAleatorio } from '../lib/crypto'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const invitaciones = new Hono<{ Bindings: Env; Variables: Vars }>()

// pública: la pantalla de registro muestra condominio/unidad sin sesión
invitaciones.get('/invitacion/:token', async (c) => {
  const inv = await c.env.DB.prepare(
    `SELECT i.rol, c.nombre AS condominio, u.nombre AS unidad
     FROM invitaciones i JOIN condominios c ON c.id=i.condominio_id
     LEFT JOIN unidades u ON u.id=i.unidad_id
     WHERE i.token=? AND i.usada=0 AND i.expira > datetime('now')`,
  ).bind(c.req.param('token')).first()
  if (!inv) return c.json({ error: 'invitación inválida o vencida' }, 410)
  return c.json(inv)
})

const protegidas = new Hono<{ Bindings: Env; Variables: Vars }>()
protegidas.use('*', requireAuth, conCondominio, requireRol('admin', 'org_admin'))

protegidas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.token, i.rol, i.usada, i.expira, i.creada, u.nombre AS unidad, cr.nombre AS creador
     FROM invitaciones i
     LEFT JOIN unidades u ON u.id=i.unidad_id
     LEFT JOIN usuarios cr ON cr.id=i.creado_por
     WHERE i.condominio_id=? AND i.rol='residente' ORDER BY i.creada DESC LIMIT 200`,
  ).bind(c.get('condo')!.id).all()
  return c.json({ invitaciones: results })
})

protegidas.post('/', async (c) => {
  const condoId = c.get('condo')!.id
  const { unidad_id } = await c.req.json<{ unidad_id?: string }>().catch(() => ({}) as any)
  if (!unidad_id) return c.json({ error: 'unidad_id requerido' }, 400)
  const unidad = await c.env.DB.prepare(`SELECT nombre FROM unidades WHERE id=? AND condominio_id=?`)
    .bind(unidad_id, condoId).first<{ nombre: string }>()
  if (!unidad) return c.json({ error: 'unidad no existe en este condominio' }, 404)
  const token = tokenAleatorio()
  await c.env.DB.prepare(
    `INSERT INTO invitaciones(token,condominio_id,unidad_id,rol,expira,creado_por)
     VALUES(?,?,?,'residente',datetime('now','+30 days'),?)`,
  ).bind(token, condoId, unidad_id, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'invitacion.residente', { unidad: unidad.nombre })
  return c.json({ token, unidad: unidad.nombre, url: `/registro?token=${token}` })
})

// Revocar (kill-switch): anula un token vigente de ESTE condominio. Idempotente sobre uno ya usado/anulado.
protegidas.delete('/:token', async (c) => {
  const condoId = c.get('condo')!.id
  const r = await c.env.DB.prepare(
    `UPDATE invitaciones SET usada=1 WHERE token=? AND condominio_id=? AND usada=0`,
  ).bind(c.req.param('token'), condoId).run()
  if (!r.meta.changes) return c.json({ error: 'invitación no existe, ya usada o de otro condominio' }, 404)
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'invitacion.revocada', { token: c.req.param('token').slice(0, 12) })
  return c.json({ ok: true })
})

invitaciones.route('/invitaciones', protegidas)

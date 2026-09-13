import { Hono } from 'hono'
import { anclarSesion } from '../lib/session'
import { requireAuth, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

// Gestión de dispositivos del PROPIO usuario (teléfono/tablet con la app, o navegador).
// Sin conCondominio a propósito: un dispositivo pertenece al usuario, no a un condominio.
// Aislamiento estricto: cada consulta y mutación lleva WHERE usuario_id=<el autenticado>.
export const dispositivos = new Hono<{ Bindings: Env; Variables: Vars }>()

dispositivos.use('*', requireAuth)

const PLATAFORMAS = ['android', 'ios', 'web'] as const

// Registra (o actualiza, si el cliente manda el id que recibió antes) el dispositivo
// desde el que se inició sesión, y ANCLA la sesión actual a él: revocar el dispositivo
// mata sus sesiones y le niega la renovación (auth.ts /sesion/renovar).
dispositivos.post('/', async (c) => {
  const a = c.get('auth')!
  const b = await c.req.json<{ id?: string; plataforma?: string; nombre?: string; modelo?: string }>().catch(() => ({}) as any)
  if (!b.plataforma || !PLATAFORMAS.includes(b.plataforma as any))
    return c.json({ error: "plataforma debe ser 'android', 'ios' o 'web'" }, 400)
  const nombre = (b.nombre ?? '').trim().slice(0, 120)
  const modelo = (b.modelo ?? '').trim().slice(0, 120)
  let id = typeof b.id === 'string' && b.id ? b.id : ''
  let creado = false
  if (id) {
    // Actualiza SOLO si es suyo y no está revocado; un id ajeno, inexistente o revocado
    // cae al alta de un dispositivo nuevo (la revocación nunca se "des-hace" por esta vía).
    const r = await c.env.DB.prepare(
      `UPDATE dispositivos SET plataforma=?, nombre=?, modelo=?, ultimo_uso=datetime('now') WHERE id=? AND usuario_id=? AND revocado=0`,
    ).bind(b.plataforma, nombre, modelo, id, a.usuarioId).run()
    if (!r.meta.changes) id = ''
  }
  if (!id) {
    id = crypto.randomUUID()
    creado = true
    await c.env.DB.prepare(`INSERT INTO dispositivos(id,usuario_id,plataforma,nombre,modelo) VALUES(?,?,?,?,?)`)
      .bind(id, a.usuarioId, b.plataforma, nombre, modelo).run()
  }
  const ses = c.get('sesion')
  // anclarSesion, no un UPDATE suelto: atar el dispositivo NO puede alargar una sesión ya
  // viva (ver session.ts). Con el token robado de un superadmin, auto-anclarse convertía
  // sus 30 días irrenovables en perpetuidad.
  if (ses) await anclarSesion(c.env.DB, ses.id, id)
  await registrarEvento(c.env.DB, null, a.usuarioId, creado ? 'dispositivo.registrado' : 'dispositivo.actualizado', {
    dispositivo: id, plataforma: b.plataforma, modelo,
  })
  return c.json({ id })
})

// Los dispositivos del usuario, con su último uso; `actual`=1 marca el de esta sesión.
dispositivos.get('/', async (c) => {
  const a = c.get('auth')!
  const actual = c.get('sesion')?.dispositivoId ?? null
  const { results } = await c.env.DB.prepare(
    `SELECT id, plataforma, nombre, modelo, creado, ultimo_uso, revocado FROM dispositivos WHERE usuario_id=? ORDER BY ultimo_uso DESC`,
  ).bind(a.usuarioId).all<{ id: string }>()
  return c.json({ dispositivos: results.map((d) => ({ ...d, actual: d.id === actual ? 1 : 0 })) })
})

// Revoca un dispositivo PROPIO: marca revocado=1 (definitivo) y mata todas sus sesiones.
// Si revoca el dispositivo de la sesión actual, esta misma sesión muere también (a propósito:
// "cerrar sesión en este teléfono" desde otro aparato debe funcionar igual que en remoto).
dispositivos.delete('/:id', async (c) => {
  const a = c.get('auth')!
  const id = c.req.param('id')
  const r = await c.env.DB.prepare(`UPDATE dispositivos SET revocado=1 WHERE id=? AND usuario_id=? AND revocado=0`)
    .bind(id, a.usuarioId).run()
  if (!r.meta.changes) return c.json({ error: 'dispositivo no encontrado' }, 404)
  await c.env.DB.prepare(`DELETE FROM sesiones WHERE dispositivo_id=?`).bind(id).run()
  await registrarEvento(c.env.DB, null, a.usuarioId, 'dispositivo.revocado', { dispositivo: id })
  return c.json({ ok: true })
})

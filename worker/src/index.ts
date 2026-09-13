import { Hono } from 'hono'
import { auth } from './routes/auth'
import { superadmin } from './routes/superadmin'
import { estructura } from './routes/estructura'
import { invitaciones } from './routes/invitaciones'
import { comunicados } from './routes/comunicados'
import { finanzas } from './routes/finanzas'
import { accesos } from './routes/accesos'
import { comunidad } from './routes/comunidad'
import { mensajeria } from './routes/mensajeria'
import { media } from './routes/media'
import { dispositivos } from './routes/dispositivos'
import { seguridad } from './lib/seguridad'
import type { Env } from './env.d'
import type { Vars } from './lib/tenancy'

export const app = new Hono<{ Bindings: Env; Variables: Vars }>()

app.use('*', seguridad)

app.onError((e, c) => {
  console.error('error no manejado', e)
  return c.json({ error: 'error interno' }, 500)
})

app.get('/api/salud', (c) => c.json({ ok: true, servicio: 'aldaba' }))
app.get('/api/version', (c) => c.json({ api: 1, demo: true }))
app.route('/api/sa', superadmin)
app.route('/api', invitaciones)
app.route('/api', auth)
app.route('/api/estructura', estructura)
app.route('/api/comunicados', comunicados)
app.route('/api/finanzas', finanzas)
app.route('/api/accesos', accesos)
app.route('/api/comunidad', comunidad)
app.route('/api/mensajeria', mensajeria)
app.route('/api/media', media)
app.route('/api/dispositivos', dispositivos)

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'no encontrado' }, 404) : c.env.ASSETS.fetch(c.req.raw),
)

export default app

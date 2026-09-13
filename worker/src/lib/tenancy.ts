import { createMiddleware } from 'hono/factory'
import { leerSesion, extraerCookie, extraerBearer, cookieSesion } from './session'
import { registrarEvento } from './eventos'
import type { Env } from '../env.d'

export type Membresia = { condominio_id: string; unidad_id: string | null; rol: string }
export type Auth = { usuarioId: string; nombre: string; email: string; esSuperadmin: boolean; membresias: Membresia[] }
export type CondoCtx = { id: string; rol: string; unidadId: string | null }
export type SesionCtx = { id: string; dispositivoId: string | null }
export type Vars = { auth?: Auth; condo?: CondoCtx; sesion?: SesionCtx }

type Ctx = { Bindings: Env; Variables: Vars }

export const requireAuth = createMiddleware<Ctx>(async (c, next) => {
  const deCookie = extraerCookie(c.req.header('cookie'))
  const valor = deCookie ?? extraerBearer(c.req.header('authorization'))
  if (!valor) return c.json({ error: 'no autenticado' }, 401)
  if (!c.env.SESSION_SECRET) return c.json({ error: 'configuración incompleta del servidor' }, 500)
  const ses = await leerSesion(c.env.DB, valor, c.env.SESSION_SECRET)
  // codigo 'sesion_invalida' = la sesión no existe o expiró: el cliente puede intentar
  // POST /api/sesion/renovar y, solo si también falla, borrar su token guardado.
  // Otros 401/403 NO llevan este código y el cliente no debe destruir la sesión por ellos.
  if (!ses) return c.json({ error: 'sesión inválida', codigo: 'sesion_invalida' }, 401)
  const u = await c.env.DB.prepare(`SELECT id,nombre,email,es_superadmin FROM usuarios WHERE id=?`)
    .bind(ses.usuario_id).first<{ id: string; nombre: string; email: string; es_superadmin: number }>()
  if (!u) return c.json({ error: 'sesión inválida', codigo: 'sesion_invalida' }, 401)
  c.set('sesion', { id: ses.id, dispositivoId: ses.dispositivo_id })
  // La WEB no tiene otro momento para refrescar su cookie: la sesión del servidor se
  // desliza sola, pero el navegador borra la cookie a los 395 días y el usuario cae al
  // login con la sesión viva del otro lado. Cada vez que la sesión se extiende se reemite
  // con vida fresca. Solo por cookie: el token de la app viaja en Authorization y no debe
  // aparecer en una cabecera Set-Cookie.
  if (deCookie && ses.extendida && ses.dias) c.header('Set-Cookie', cookieSesion(valor, ses.dias), { append: true })
  const { results: membresias } = await c.env.DB
    .prepare(`SELECT condominio_id, unidad_id, rol FROM membresias WHERE usuario_id=?
ORDER BY condominio_id, CASE rol WHEN 'org_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'porteria' THEN 2 ELSE 3 END, unidad_id`)
    .bind(u.id).all<Membresia>()
  c.set('auth', { usuarioId: u.id, nombre: u.nombre, email: u.email, esSuperadmin: !!u.es_superadmin, membresias })
  await next()
})

export const conCondominio = createMiddleware<Ctx>(async (c, next) => {
  const auth = c.get('auth')!
  // Varias unidades en el mismo condominio → gana la de mayor precedencia/orden (ORDER BY de requireAuth); multi-unidad explícito llega en F2.
  // El header X-Condominio lo pone el helper api(); pero las descargas de media (<a>/<img>) son
  // navegaciones del browser sin headers custom, así que aceptamos el condominio por query (?c=) como fallback.
  const pedido = c.req.header('X-Condominio') || c.req.query('c')
  // Un usuario multi-rol (p.ej. un miembro de junta que también es propietario) puede pedir actuar
  // con un rol concreto —típicamente 'residente'— para usar las funciones de ese rol en su unidad.
  const rolPedido = c.req.header('X-Rol')
  let m: Membresia | undefined
  if (pedido) {
    const propias = auth.membresias.filter((x) => x.condominio_id === pedido)
    // Si pide explícitamente un rol y tiene esa membresía directa aquí, se respeta (ver-como-residente).
    m = rolPedido ? propias.find((x) => x.rol === rolPedido) : undefined
    const explicito = !!m
    if (!m) m = propias[0] // por defecto la de mayor precedencia (ORDER BY de requireAuth)
    // Las elevaciones (org_admin org-wide / superadmin god-mode) NO aplican si el usuario pidió
    // explícitamente actuar con un rol menor que sí posee.
    const tieneOrg = auth.membresias.some((x) => x.rol === 'org_admin')
    if (!explicito && tieneOrg && (!m || (m.rol !== 'admin' && m.rol !== 'org_admin'))) {
      const esOrg = await c.env.DB.prepare(
        `SELECT 1 FROM membresias mo JOIN condominios c1 ON c1.id=mo.condominio_id
         JOIN condominios c2 ON c2.organizacion_id=c1.organizacion_id
         WHERE mo.usuario_id=? AND mo.rol='org_admin' AND c2.id=? LIMIT 1`,
      ).bind(auth.usuarioId, pedido).first()
      if (esOrg) m = { condominio_id: pedido, unidad_id: null, rol: 'org_admin' }
    }
    // Superadmin god-mode: su rol efectivo nunca es menor que admin, aunque tenga una membresía
    // propia de menor rango (residente/porteria) en este condominio. Sin esto, endpoints que
    // ramifican por rol le devolverían datos recortados y sus mutaciones quedarían sin auditar.
    if (!explicito && auth.esSuperadmin && (!m || (m.rol !== 'admin' && m.rol !== 'org_admin'))) {
      m = { condominio_id: pedido, unidad_id: null, rol: 'admin' }
      // auditar-o-denegar: el acceso cross-tenant de superadmin sin rastro de auditoría se rechaza
      try { await registrarEvento(c.env.DB, pedido, auth.usuarioId, 'sa.acceso_condominio') }
      catch { return c.json({ error: 'auditoría no disponible, intente de nuevo' }, 503) }
    }
  } else {
    const condosDistintos = [...new Set(auth.membresias.map((x) => x.condominio_id))]
    if (condosDistintos.length === 1) m = auth.membresias[0]
    else if (condosDistintos.length > 1) return c.json({ error: 'indique el condominio (header X-Condominio)' }, 400)
  }
  if (!m) return c.json({ error: 'sin acceso a ese condominio' }, 403)
  const condo = await c.env.DB.prepare(`SELECT suspendido FROM condominios WHERE id=?`)
    .bind(m.condominio_id).first<{ suspendido: number }>()
  if (!condo) return c.json({ error: 'condominio no existe' }, 404)
  if (condo.suspendido && !auth.esSuperadmin)
    return c.json({ error: 'condominio suspendido — contacte a su administradora' }, 403)
  c.set('condo', { id: m.condominio_id, rol: m.rol, unidadId: m.unidad_id })
  await next()
})

export const requireRol = (...roles: string[]) =>
  createMiddleware<Ctx>(async (c, next) => {
    const auth = c.get('auth')!
    if (auth.esSuperadmin) return next()
    const condo = c.get('condo')
    if (!condo || !roles.includes(condo.rol)) return c.json({ error: 'sin permiso' }, 403)
    await next()
  })

export const requireSuperadmin = createMiddleware<Ctx>(async (c, next) => {
  if (!c.get('auth')!.esSuperadmin) return c.json({ error: 'solo superadmin' }, 403)
  await next()
})

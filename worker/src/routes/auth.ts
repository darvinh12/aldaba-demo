import { Hono } from 'hono'
import { hashPassword, verifyPassword } from '../lib/crypto'
import { crearSesion, cerrarSesion, cookieVacia, extraerCookie, extraerBearer, leerSesion, DIAS_SESION, DIAS_SESION_SUPERADMIN_SIN_ANCLA, DIAS_TOLERANCIA_RENOVACION } from '../lib/session'
import { verificarFirma } from '../lib/crypto'
import { requireAuth, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>()

const conSecreto = (c: { env: Env }): string | null => c.env.SESSION_SECRET || null

const VENTANA_S = 600, MAX_INTENTOS = 5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailValido = (e: string) => e.length <= 254 && EMAIL_RE.test(e)

/** Dominio de las cuentas de demostración. Un identificador sin arroba se resuelve
 *  contra él, así "Demo", "demo" y "DEMO" entran todos con demo@aldaba.demo sin
 *  tocar el resto del flujo de autenticación. Nada más cambia: si el identificador
 *  ya trae arroba se usa tal cual, y si la cuenta resultante no existe el login
 *  responde 401 como siempre. */
const DOMINIO_DEMO = 'aldaba.demo'
export const normalizarIdentificador = (v: string) =>
  v.includes('@') ? v : `${v}@${DOMINIO_DEMO}`

// Atómico: incrementa y lee en un solo statement (RETURNING) — sin carrera read-then-write.
async function rateLimit(db: D1Database, clave: string): Promise<boolean> {
  const ventana = Math.floor(Date.now() / 1000 / VENTANA_S)
  const fila = await db.prepare(
    `INSERT INTO login_intentos(clave,ventana,intentos) VALUES(?,?,1)
     ON CONFLICT(clave) DO UPDATE SET
       intentos = CASE WHEN ventana=excluded.ventana THEN intentos+1 ELSE 1 END,
       ventana = excluded.ventana
     RETURNING intentos`,
  ).bind(clave, ventana).first<{ intentos: number }>()
  return !!fila && fila.intentos <= MAX_INTENTOS
}

// CLASE de la sesión: cuántos días vale y si ese vencimiento se corre con el uso. Se guarda
// en la fila (columnas `dias`/`desliza`, migración 0011) y no se recalcula a partir de las
// fechas. Perpetua (DIAS_SESION, deslizante) para todo el mundo. La única excepción es el
// superadmin SIN dispositivo anclado, cuya sesión sería una llave maestra irrevocable de
// todos los condominios: mientras no haya ancla es un plazo DURO y corto, que ni el uso
// corre (session.ts) ni el canje renueva (más abajo). O sea: vuelve a escribir su clave.
type Clase = { dias: number; desliza: boolean }
const CLASE_PERPETUA: Clase = { dias: DIAS_SESION, desliza: true }
const CLASE_SUPERADMIN_SIN_ANCLA: Clase = { dias: DIAS_SESION_SUPERADMIN_SIN_ANCLA, desliza: false }
const claseSesion = (esSuperadmin: boolean, dispositivoId: string | null): Clase =>
  esSuperadmin && !dispositivoId ? CLASE_SUPERADMIN_SIN_ANCLA : CLASE_PERPETUA

// Purga oportunista de sesiones muertas, en dos frentes:
//   1) vencidas por inactividad — respeta la ventana de renovación: una sesión vencida hace
//      menos de DIAS_TOLERANCIA_RENOVACION días aún es canjeable en /sesion/renovar;
//   2) sesiones de dispositivos revocados, que ya no autentican (session.ts) pero quedarían
//      ocupando tabla hasta cumplir el año de inactividad.
// No hace falta cazar sesiones de usuarios borrados: la FK sesiones.usuario_id -> usuarios
// impide borrar un usuario que todavía tenga sesiones (D1 aplica claves foráneas).
const purgarSesionesMuertas = (db: D1Database) =>
  db.prepare(
    `DELETE FROM sesiones WHERE expira <= datetime('now', ?)
       OR dispositivo_id IN (SELECT id FROM dispositivos WHERE revocado=1)`,
  ).bind(`-${DIAS_TOLERANCIA_RENOVACION} days`).run()

auth.post('/login', async (c) => {
  const secreto = conSecreto(c)
  if (!secreto) return c.json({ error: 'configuración incompleta del servidor' }, 500)
  const { email, password } = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as any)
  if (!email || !password) return c.json({ error: 'email y password requeridos' }, 400)
  const correo = normalizarIdentificador(email.trim().toLowerCase()).slice(0, 254)
  // purga incondicional de ventanas viejas: evita que emails aleatorios inflen la tabla
  await c.env.DB.prepare(`DELETE FROM login_intentos WHERE ventana < ?`)
    .bind(Math.floor(Date.now() / 1000 / VENTANA_S)).run()
  const clave = `${correo}|${c.req.header('cf-connecting-ip') ?? 'local'}`
  if (!(await rateLimit(c.env.DB, clave))) return c.json({ error: 'demasiados intentos, espere 10 minutos' }, 429)
  const u = await c.env.DB.prepare(`SELECT id,hash,es_superadmin FROM usuarios WHERE email=?`)
    .bind(correo).first<{ id: string; hash: string; es_superadmin: number }>()
  if (!u || !(await verifyPassword(password, u.hash))) return c.json({ error: 'credenciales inválidas' }, 401)
  // login exitoso: resetea el contador propio
  await c.env.DB.prepare(`DELETE FROM login_intentos WHERE clave=?`).bind(clave).run()
  // limpieza oportunista de sesiones muertas (barata, mantiene la tabla acotada)
  await purgarSesionesMuertas(c.env.DB)
  const cl = claseSesion(!!u.es_superadmin, null)
  const { cookie, valor } = await crearSesion(c.env.DB, u.id, secreto, cl.dias, null, cl.desliza)
  await registrarEvento(c.env.DB, null, u.id, 'auth.login')
  // La app nativa (WebView Capacitor) no puede usar la cookie __Host-: pide el token con X-Cliente: app.
  const esApp = c.req.header('X-Cliente') === 'app'
  return c.json(esApp ? { ok: true, token: valor } : { ok: true }, 200, { 'Set-Cookie': cookie })
})

/** Condominios ALCANZABLES por el usuario (membresías directas + org-wide vía
 *  org_admin, igual que /me) y cuántos de ellos son demo. Una cuenta es "pura
 *  demo" solo si alcanza al menos un condominio y TODOS tienen es_demo=1. */
async function alcanceDemo(db: D1Database, usuarioId: string): Promise<{ tot: number; demos: number }> {
  const f = await db.prepare(
    `SELECT COUNT(*) tot, COALESCE(SUM(es_demo),0) demos FROM (
       SELECT c.id, c.es_demo FROM membresias m JOIN condominios c ON c.id=m.condominio_id WHERE m.usuario_id=?1
       UNION
       SELECT c.id, c.es_demo FROM condominios c
       WHERE c.organizacion_id IN (SELECT c2.organizacion_id FROM membresias mo JOIN condominios c2 ON c2.id=mo.condominio_id WHERE mo.usuario_id=?1 AND mo.rol='org_admin'))`,
  ).bind(usuarioId).first<{ tot: number; demos: number }>()
  return f ?? { tot: 0, demos: 0 }
}

// Acceso de demostración: el cliente manda SOLO el correo (la clave demo nunca
// viaja ni vive en el bundle). Entra únicamente una cuenta cuyo alcance completo
// son condominios es_demo=1; superadmin y cualquier cuenta real quedan fuera.
auth.post('/demo/login', async (c) => {
  const secreto = conSecreto(c)
  if (!secreto) return c.json({ error: 'configuración incompleta del servidor' }, 500)
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({}) as any)
  if (!email) return c.json({ error: 'email requerido' }, 400)
  const correo = email.toLowerCase().slice(0, 254)
  const clave = `demo|${correo}|${c.req.header('cf-connecting-ip') ?? 'local'}`
  if (!(await rateLimit(c.env.DB, clave))) return c.json({ error: 'demasiados intentos, espere 10 minutos' }, 429)
  const u = await c.env.DB.prepare(`SELECT id,es_superadmin FROM usuarios WHERE email=?`)
    .bind(correo).first<{ id: string; es_superadmin: number }>()
  if (!u || u.es_superadmin) return c.json({ error: 'solo cuentas de demostración' }, 403)
  const alcance = await alcanceDemo(c.env.DB, u.id)
  if (!alcance.tot || alcance.demos !== alcance.tot) return c.json({ error: 'solo cuentas de demostración' }, 403)
  await c.env.DB.prepare(`DELETE FROM login_intentos WHERE clave=?`).bind(clave).run()
  await purgarSesionesMuertas(c.env.DB)
  const { cookie, valor } = await crearSesion(c.env.DB, u.id, secreto, DIAS_SESION)
  await registrarEvento(c.env.DB, null, u.id, 'auth.login', { demo: true })
  const esApp = c.req.header('X-Cliente') === 'app'
  return c.json(esApp ? { ok: true, token: valor } : { ok: true }, 200, { 'Set-Cookie': cookie })
})

auth.post('/logout', async (c) => {
  const secreto = conSecreto(c)
  const valor = extraerCookie(c.req.header('cookie')) ?? extraerBearer(c.req.header('authorization'))
  if (valor && secreto) {
    const ses = await leerSesion(c.env.DB, valor, secreto)
    if (ses) await cerrarSesion(c.env.DB, ses.id)
  }
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookieVacia })
})

// RENOVACIÓN EXPLÍCITA: canjea el token actual (aunque esté RECIÉN vencido, con
// tolerancia de hasta DIAS_TOLERANCIA_RENOVACION días tras expirar) por una sesión
// NUEVA. La app lo llama al arrancar: así "seguir logueado" no depende de que la
// sesión vieja siga viva al minuto. El 401 con codigo:'sesion_invalida' es la ÚNICA
// señal para que el cliente borre el token guardado y vuelva al login.
auth.post('/sesion/renovar', async (c) => {
  const secreto = conSecreto(c)
  if (!secreto) return c.json({ error: 'configuración incompleta del servidor' }, 500)
  const invalida = () => c.json({ error: 'sesión inválida', codigo: 'sesion_invalida' }, 401)
  const valor = extraerBearer(c.req.header('authorization')) ?? extraerCookie(c.req.header('cookie'))
  if (!valor) return invalida()
  const [id, firma] = valor.split('.')
  if (!id || !firma || !(await verificarFirma(id, firma, secreto))) return invalida()
  // No usa leerSesion a propósito: aquí una sesión vencida dentro de la tolerancia SÍ vale.
  const ses = await c.env.DB.prepare(`SELECT id, usuario_id, dispositivo_id, dias, desliza FROM sesiones WHERE id=? AND expira > datetime('now', ?)`)
    .bind(id, `-${DIAS_TOLERANCIA_RENOVACION} days`)
    .first<{ id: string; usuario_id: string; dispositivo_id: string | null; dias: number | null; desliza: number }>()
  if (!ses) return invalida()
  // Un dispositivo revocado no renueva jamás (la revocación debe ser definitiva).
  if (ses.dispositivo_id) {
    const disp = await c.env.DB.prepare(`SELECT revocado FROM dispositivos WHERE id=?`)
      .bind(ses.dispositivo_id).first<{ revocado: number }>()
    if (!disp || disp.revocado) return invalida()
  }
  const u = await c.env.DB.prepare(`SELECT id, es_superadmin FROM usuarios WHERE id=?`)
    .bind(ses.usuario_id).first<{ id: string; es_superadmin: number }>()
  if (!u) return invalida()
  // Compensación obligatoria de la sesión perpetua: un superadmin cuya sesión NO es de la
  // clase perpetua no canjea. Su cliente cae al login y escribe su clave, que es
  // exactamente lo que se busca. Se mira la clase de la sesión, no si hoy tiene ancla:
  // atarse un dispositivo después (POST /api/dispositivos con un token robado) no es
  // escribir la clave y no puede comprar renovación. Las filas anteriores a la 0011 no
  // guardan con qué regla nacieron, y su ancla la puede fabricar el propio ladrón del token
  // (la fila legada no tiene dispositivo_id, así que anclarSesion sí la escribe): al
  // superadmin no se le concede el beneficio de la duda y esas filas nunca canjean. Mueren
  // solas en ≤37 días y su dueño vuelve a entrar con su clave una vez.
  const eraPerpetua = ses.dias === null ? false : !!ses.desliza
  if (u.es_superadmin && !eraPerpetua) {
    await registrarEvento(c.env.DB, null, u.id, 'auth.renovacion_negada', {
      motivo: ses.dias === null ? 'superadmin con sesión anterior a la 0011' : 'superadmin sin sesión perpetua',
    })
    return invalida()
  }
  // El canje nunca SUBE de clase: la nueva sesión vale lo que la regla actual o lo que
  // valía la vieja, lo que sea menor. Renovar es prolongar, no ascender.
  const regla = claseSesion(!!u.es_superadmin, ses.dispositivo_id)
  const cl: Clase = ses.dias === null
    ? regla
    : { dias: Math.min(ses.dias, regla.dias), desliza: regla.desliza && !!ses.desliza }
  const { cookie, valor: nuevo } = await crearSesion(c.env.DB, u.id, secreto, cl.dias, ses.dispositivo_id, cl.desliza)
  // la sesión vieja muere al canjearse: un token vencido no puede renovarse dos veces
  await cerrarSesion(c.env.DB, ses.id)
  if (ses.dispositivo_id)
    await c.env.DB.prepare(`UPDATE dispositivos SET ultimo_uso=datetime('now') WHERE id=?`).bind(ses.dispositivo_id).run()
  await registrarEvento(c.env.DB, null, u.id, 'auth.renovacion', ses.dispositivo_id ? { dispositivo: ses.dispositivo_id } : undefined)
  const esApp = c.req.header('X-Cliente') === 'app'
  return c.json(esApp ? { ok: true, token: nuevo } : { ok: true }, 200, { 'Set-Cookie': cookie })
})

// CIERRE REMOTO: mata todas las sesiones del usuario menos la que hace la petición.
// Con sesiones perpetuas hace falta una salida de emergencia que no dependa de haber
// registrado el dispositivo: "me robaron el teléfono" o "me quedé logueado en la
// computadora de la junta" se resuelve desde cualquier aparato donde uno siga adentro.
auth.post('/sesion/cerrar-otras', requireAuth, async (c) => {
  const a = c.get('auth')!
  const actual = c.get('sesion')!
  const r = await c.env.DB.prepare(`DELETE FROM sesiones WHERE usuario_id=? AND id<>?`)
    .bind(a.usuarioId, actual.id).run()
  const cerradas = r.meta.changes ?? 0
  await registrarEvento(c.env.DB, null, a.usuarioId, 'auth.cierre_remoto', { cerradas })
  return c.json({ ok: true, cerradas })
})

/** Cambiar la propia clave. Pide la actual aunque haya sesión: si alguien deja el teléfono
 *  desbloqueado, no debería poder dejar al dueño afuera de su propia cuenta.
 *
 *  Al cambiarla se CIERRAN LAS DEMÁS SESIONES. Es el motivo principal por el que existe
 *  esto: el condominio arranca con una clave compartida, así que si dos personas entraron
 *  al mismo apartamento, la que cambie la clave se queda con la cuenta y la otra sale. */
auth.post('/clave', requireAuth, async (c) => {
  const a = c.get('auth')!
  const b = await c.req.json<{ actual?: string; nueva?: string }>().catch(() => ({}) as any)
  if (!b.actual || !b.nueva) return c.json({ error: 'clave actual y nueva requeridas' }, 400)
  if (b.nueva.length < 10) return c.json({ error: 'la clave nueva debe tener al menos 10 caracteres' }, 400)
  if (b.nueva.length > 128) return c.json({ error: 'la clave nueva máx 128 caracteres' }, 400)
  if (b.nueva === b.actual) return c.json({ error: 'la clave nueva no puede ser igual a la actual' }, 400)
  const u = await c.env.DB.prepare(`SELECT hash FROM usuarios WHERE id=?`).bind(a.usuarioId).first<{ hash: string }>()
  if (!u) return c.json({ error: 'usuario no encontrado' }, 404)
  // Rate limit con la MISMA cuenta que el login: si no, este endpoint sería un oráculo
  // para adivinar la clave actual sin freno, saltándose el de /login.
  const clave = `${a.email}|${c.req.header('cf-connecting-ip') ?? 'local'}`
  if (!(await rateLimit(c.env.DB, clave))) return c.json({ error: 'demasiados intentos, espere 10 minutos' }, 429)
  if (!(await verifyPassword(b.actual, u.hash))) return c.json({ error: 'la clave actual no es correcta' }, 401)
  await c.env.DB.prepare(`DELETE FROM login_intentos WHERE clave=?`).bind(clave).run()
  const actual = c.get('sesion')!
  const r = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE usuarios SET hash=?, debe_cambiar_clave=0 WHERE id=?`)
      .bind(await hashPassword(b.nueva), a.usuarioId),
    c.env.DB.prepare(`DELETE FROM sesiones WHERE usuario_id=? AND id<>?`).bind(a.usuarioId, actual.id),
  ])
  await registrarEvento(c.env.DB, null, a.usuarioId, 'auth.clave_cambiada', { otras_cerradas: r[1]?.meta.changes ?? 0 })
  return c.json({ ok: true, otrasCerradas: r[1]?.meta.changes ?? 0 })
})

auth.get('/me', requireAuth, async (c) => {
  const a = c.get('auth')!
  // Membresías directas + (org-wide) todos los condominios de las organizaciones donde el usuario es org_admin.
  const { results: condos } = await c.env.DB.prepare(
    `SELECT c.id, c.nombre, m.rol, m.unidad_id, c.suspendido, c.es_demo FROM membresias m JOIN condominios c ON c.id=m.condominio_id WHERE m.usuario_id=?
     UNION
     SELECT c.id, c.nombre, 'org_admin' AS rol, NULL AS unidad_id, c.suspendido, c.es_demo FROM condominios c
     WHERE c.organizacion_id IN (SELECT c2.organizacion_id FROM membresias mo JOIN condominios c2 ON c2.id=mo.condominio_id WHERE mo.usuario_id=? AND mo.rol='org_admin')`,
  ).bind(a.usuarioId, a.usuarioId).all()
  // `debeCambiarClave` lo decide el SERVIDOR, no el cliente: la pantalla que obliga a
  // cambiarla se puede saltar tocando el código del front, pero mientras la bandera siga
  // en 1 la cuenta sigue con la clave compartida y eso queda a la vista en la consola.
  const f = await c.env.DB.prepare(`SELECT debe_cambiar_clave FROM usuarios WHERE id=?`)
    .bind(a.usuarioId).first<{ debe_cambiar_clave: number }>()
  return c.json({
    nombre: a.nombre, email: a.email, esSuperadmin: a.esSuperadmin, condominios: condos,
    debeCambiarClave: !!f?.debe_cambiar_clave,
  })
})

auth.post('/registro', async (c) => {
  const secreto = conSecreto(c)
  if (!secreto) return c.json({ error: 'configuración incompleta del servidor' }, 500)
  const b = await c.req.json<{ token?: string; nombre?: string; email?: string; password?: string; telefono?: string }>().catch(() => ({}) as any)
  if (!b.token || !b.nombre?.trim() || !b.email || !b.password) return c.json({ error: 'faltan campos' }, 400)
  if (!emailValido(b.email)) return c.json({ error: 'email inválido' }, 400)
  if (b.nombre.trim().length > 120) return c.json({ error: 'nombre máx 120 caracteres' }, 400)
  if (b.password.length < 10) return c.json({ error: 'la clave debe tener al menos 10 caracteres' }, 400)
  if (b.password.length > 128) return c.json({ error: 'la clave máx 128 caracteres' }, 400)
  const inv = await c.env.DB.prepare(
    `SELECT token,condominio_id,unidad_id,rol FROM invitaciones WHERE token=? AND usada=0 AND expira > datetime('now')`,
  ).bind(b.token).first<{ token: string; condominio_id: string; unidad_id: string | null; rol: string }>()
  if (!inv) return c.json({ error: 'invitación inválida, usada o vencida' }, 410)
  const email = b.email.toLowerCase()
  let usuarioId: string
  const inserts: D1PreparedStatement[] = []
  const existente = await c.env.DB.prepare(`SELECT id,hash FROM usuarios WHERE email=?`).bind(email)
    .first<{ id: string; hash: string }>()
  if (existente) {
    const claveRl = `${email}|${c.req.header('cf-connecting-ip') ?? 'local'}`
    if (!(await rateLimit(c.env.DB, claveRl))) return c.json({ error: 'demasiados intentos, espere 10 minutos' }, 429)
    if (!(await verifyPassword(b.password, existente.hash)))
      return c.json({ error: 'ese email ya existe; usa tu clave actual para vincular la unidad' }, 409)
    usuarioId = existente.id
    const dup = await c.env.DB.prepare(
      `SELECT 1 FROM membresias WHERE usuario_id=? AND condominio_id=? AND unidad_id IS ? AND rol=?`,
    ).bind(usuarioId, inv.condominio_id, inv.unidad_id, inv.rol).first()
    if (dup) return c.json({ error: 'ya tienes esta membresía' }, 409)
    // Muro demo↔real en ambos sentidos: una cuenta de demostración (alcance 100%
    // demo) jamás se vincula a un condominio real, y una cuenta con condominios
    // reales jamás entra a la demo (sus datos quedarían visibles en el ambiente
    // público y al alcance de los seeds de limpieza).
    const invCondo = await c.env.DB.prepare(`SELECT es_demo FROM condominios WHERE id=?`)
      .bind(inv.condominio_id).first<{ es_demo: number }>()
    const alcance = await alcanceDemo(c.env.DB, usuarioId)
    if (alcance.tot > 0) {
      const puraDemo = alcance.demos === alcance.tot
      if (puraDemo && !invCondo?.es_demo)
        return c.json({ error: 'esa cuenta es de demostración y no puede vincularse a un condominio real' }, 409)
      if (!puraDemo && invCondo?.es_demo)
        return c.json({ error: 'una cuenta con condominios reales no puede vincularse a la demostración' }, 409)
    }
  } else {
    usuarioId = crypto.randomUUID()
    inserts.push(
      c.env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,telefono) VALUES(?,?,?,?,?)`)
        .bind(usuarioId, email, b.nombre.trim(), await hashPassword(b.password), (b.telefono ?? '').slice(0, 30) || null),
    )
  }
  // canje atómico del token ANTES de crear nada: de dos canjes concurrentes solo uno pasa
  const claim = await c.env.DB.prepare(
    `UPDATE invitaciones SET usada=1 WHERE token=? AND usada=0 AND expira > datetime('now')`,
  ).bind(inv.token).run()
  if (!claim.meta.changes) return c.json({ error: 'invitación inválida, usada o vencida' }, 410)
  inserts.push(
    c.env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`)
      .bind(crypto.randomUUID(), usuarioId, inv.condominio_id, inv.unidad_id, inv.rol),
  )
  // si el batch falla, el token queda quemado sin membresía = fail-closed (el admin re-invita)
  await c.env.DB.batch(inserts)
  await registrarEvento(c.env.DB, inv.condominio_id, usuarioId, 'auth.registro', { rol: inv.rol })
  const { cookie, valor } = await crearSesion(c.env.DB, usuarioId, secreto, DIAS_SESION)
  const esApp = c.req.header('X-Cliente') === 'app'
  return c.json(esApp ? { ok: true, token: valor } : { ok: true }, 200, { 'Set-Cookie': cookie })
})

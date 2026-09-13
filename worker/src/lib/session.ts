import { firmar, verificarFirma, tokenAleatorio } from './crypto'

/** SESIÓN PERPETUA. `expira` dejó de ser la vida de la sesión: ahora es la fecha LÍMITE
 *  DE INACTIVIDAD. Cada uso la corre hacia adelante (deslizante, más abajo), así que quien
 *  abre Aldaba al menos una vez al año no vuelve a escribir su clave jamás. El techo honesto
 *  para quien la abandona son 365 + 30 días de tolerancia de canje (~13 meses), como WhatsApp:
 *  sin ese techo la tabla `sesiones` crecería sin tope y quedarían tokens vivos de gente que
 *  ya no usa el sistema. Un solo valor para todos los roles a propósito (portería y residente
 *  llevaban 180/30 y no había razón para distinguirlos). */
export const DIAS_SESION = 365
/** ÚNICA excepción, y no es negociable: el superadmin es llave maestra de TODOS los
 *  condominios (tenancy.ts lo eleva a admin en cualquier tenant), así que su sesión solo
 *  es perpetua si nació anclada a un dispositivo revocable — es decir, si el teléfono se
 *  registró en el mismo acto del login (ver anclarSesion). Si no, estos días son un plazo
 *  DURO: el uso no lo corre y /sesion/renovar le niega el canje, o sea que vuelve a
 *  escribir su clave. Con el ancla del login pasa a DIAS_SESION y se corta desde la lista
 *  de dispositivos. */
export const DIAS_SESION_SUPERADMIN_SIN_ANCLA = 30
export const COOKIE = '__Host-aldaba_s'
/** Tolerancia de renovación: una sesión vencida hace menos de estos días aún puede
 *  canjearse por una nueva en POST /api/sesion/renovar (auth.ts). La purga oportunista
 *  de auth.ts respeta esta ventana: solo borra lo vencido hace MÁS de estos días. */
export const DIAS_TOLERANCIA_RENOVACION = 30
/** Cuánto vale un ancla como prueba de que la clave se acaba de escribir. La app registra
 *  el teléfono (POST /api/dispositivos) en el mismo acto del login, dentro de segundos;
 *  fuera de esta ventana el ancla se registra igual —el dispositivo queda listado y
 *  revocable— pero NO eleva la clase de la sesión. Sin este límite, quien roba un token
 *  de superadmin se auto-ancla y convierte 30 días irrenovables en perpetuidad. */
export const MINUTOS_ANCLA_TRAS_LOGIN = 10

/** `dias` es la CLASE de la sesión (su duración) y `extendida` avisa de que esta lectura
 *  corrió el vencimiento — la web usa eso para reemitir la cookie. `dias` es NULL solo en
 *  las filas anteriores a la migración 0011. */
export type Sesion = {
  id: string; usuario_id: string; dispositivo_id: string | null
  dias: number | null; extendida: boolean
}

/** La cookie vive la inactividad permitida MÁS la tolerancia de canje: si muriera junto con
 *  `expira`, el navegador la borraría justo cuando empieza la ventana de /sesion/renovar y la
 *  web perdería la segunda oportunidad que sí tiene la app (el 401 llegaría sin cookie, como
 *  "no autenticado" y sin codigo). Tope duro de Chrome/Edge a toda cookie: 400 días. */
export const cookieSesion = (valor: string, dias: number) =>
  `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${(dias + DIAS_TOLERANCIA_RENOVACION) * 86400}`

/** Crea la sesión con su CLASE guardada en la fila: `dias` (duración) y `desliza`.
 *  `desliza=false` = plazo DURO desde el login, que el uso no mueve (hoy solo el
 *  superadmin sin dispositivo anclado); `true` = `expira` es límite de inactividad. */
export async function crearSesion(
  db: D1Database, usuarioId: string, secreto: string, dias: number,
  dispositivoId: string | null = null, desliza = true,
) {
  const id = tokenAleatorio()
  await db
    .prepare(`INSERT INTO sesiones(id,usuario_id,expira,dispositivo_id,ultimo_uso,dias,desliza)
              VALUES(?,?,datetime('now','+' || ? || ' days'),?,datetime('now'),?,?)`)
    .bind(id, usuarioId, String(dias), dispositivoId, dias, desliza ? 1 : 0)
    .run()
  const valor = `${id}.${await firmar(id, secreto)}`
  return { id, valor, cookie: cookieSesion(valor, dias) }
}

/** Ata la sesión a un dispositivo. NUNCA alarga una sesión ya viva: solo cuando el ancla
 *  llega en el mismo acto del login (ventana de MINUTOS_ANCLA_TRAS_LOGIN) eleva una sesión
 *  de plazo duro a la clase perpetua — ese es el flujo real de la app, y es lo que hace que
 *  con el teléfono registrado no se vuelva a pedir la clave. Fuera de la ventana el
 *  dispositivo se registra y la sesión queda revocable, pero conserva clase y vencimiento.
 *  Tampoco RE-APUNTA un ancla existente a otro aparato (WHERE): si pudiera, quien roba un
 *  token se ataría su propio teléfono y revocar el del dueño ya no mataría esa sesión. */
export async function anclarSesion(db: D1Database, sesionId: string, dispositivoId: string) {
  const enElLogin = `desliza=0 AND creada > datetime('now','-' || ?2 || ' minutes')`
  await db
    .prepare(
      `UPDATE sesiones SET dispositivo_id=?1,
         dias    = CASE WHEN ${enElLogin} THEN ?3 ELSE dias END,
         expira  = CASE WHEN ${enElLogin} THEN datetime('now','+' || ?3 || ' days') ELSE expira END,
         desliza = CASE WHEN ${enElLogin} THEN 1 ELSE desliza END
       WHERE id=?4 AND (dispositivo_id IS NULL OR dispositivo_id=?1)`,
    )
    .bind(dispositivoId, String(MINUTOS_ANCLA_TRAS_LOGIN), DIAS_SESION, sesionId)
    .run()
}

/** 'YYYY-MM-DD HH:MM:SS' en UTC (mismo formato que datetime('now') de SQLite), hace `min` minutos. */
const haceMinutos = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace('T', ' ')

/** Días que faltan para una fecha de SQLite ('YYYY-MM-DD HH:MM:SS', siempre UTC). */
const diasHasta = (fecha: string) => (Date.parse(`${fecha.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000

export async function leerSesion(db: D1Database, valor: string, secreto: string): Promise<Sesion | null> {
  const [id, firma] = valor.split('.')
  if (!id || !firma || !(await verificarFirma(id, firma, secreto))) return null
  // El JOIN con dispositivos es el que hace que revocar un teléfono MUERDA en la siguiente
  // petición y no solo al renovar: con sesiones que duran un año, /sesion/renovar casi no se
  // llama, así que chequear la revocación solo allí dejaría el teléfono perdido con acceso.
  // Sale gratis: se resuelve por clave primaria de dispositivos. dispositivo_id NULL =
  // sesión sin ancla (web previa a este cambio), que sigue valiendo.
  const s = await db
    .prepare(
      `SELECT s.id, s.usuario_id, s.dispositivo_id, s.ultimo_uso, s.expira, s.dias, s.desliza FROM sesiones s
       LEFT JOIN dispositivos d ON d.id = s.dispositivo_id
       WHERE s.id=? AND s.expira > datetime('now')
         AND (s.dispositivo_id IS NULL OR (d.id IS NOT NULL AND d.revocado=0))`,
    )
    .bind(id)
    .first<{
      id: string; usuario_id: string; dispositivo_id: string | null
      ultimo_uso: string | null; expira: string; dias: number | null; desliza: number
    }>()
  if (!s) return null
  // Sesión DESLIZANTE: si le queda menos de la mitad de su CLASE (`dias`, guardada en la
  // fila), el vencimiento se corre a hoy + esa misma clase; así quien entra al menos una
  // vez por período no pierde la sesión jamás. Con DIAS_SESION=365 basta abrir Aldaba una
  // vez cada seis meses para que no se acabe nunca — esa es la perpetuidad.
  // La clase NO se deriva de (expira - creada): como `creada` no se mueve y cada extensión
  // aleja `expira`, ese span crecía en cada uso (365 -> 548 -> 823...) y además resucitaba
  // la sesión corta del superadmin sin ancla, que es justo la que no debe deslizarse
  // (desliza=0 = plazo duro desde el login).
  // Para no escribir en cada petición, la escritura (extensión + ultimo_uso) ocurre como
  // máximo UNA vez por hora por sesión: el chequeo barato es en memoria contra ultimo_uso
  // (formato/zona idénticos a datetime('now')) y el WHERE lo repite por si dos peticiones
  // concurrentes pasan el chequeo a la vez.
  let extendida = false
  if (!s.ultimo_uso || s.ultimo_uso <= haceMinutos(60)) {
    const stmts = [
      db.prepare(
        `UPDATE sesiones SET ultimo_uso=datetime('now'),
           expira=CASE WHEN desliza=1 AND dias IS NOT NULL AND julianday(expira) - julianday('now') < dias / 2.0
             THEN datetime('now', '+' || dias || ' days')
             ELSE expira END
         WHERE id=? AND (ultimo_uso IS NULL OR ultimo_uso <= datetime('now','-1 hour'))`,
      ).bind(s.id),
    ]
    if (s.dispositivo_id)
      stmts.push(db.prepare(`UPDATE dispositivos SET ultimo_uso=datetime('now') WHERE id=?`).bind(s.dispositivo_id))
    const [r] = await db.batch(stmts)
    // Mismo criterio que el CASE de arriba, para avisar a la web de que reemita su cookie.
    extendida = !!r.meta.changes && !!s.desliza && !!s.dias && diasHasta(s.expira) < s.dias / 2
  }
  return { id: s.id, usuario_id: s.usuario_id, dispositivo_id: s.dispositivo_id ?? null, dias: s.dias ?? null, extendida }
}

export async function cerrarSesion(db: D1Database, id: string) {
  await db.prepare(`DELETE FROM sesiones WHERE id=?`).bind(id).run()
}

export const cookieVacia = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export function extraerCookie(header: string | undefined): string | null {
  if (!header) return null
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? m[1] : null
}

// Sesión por token Bearer (WebView de Capacitor en https://localhost no puede enviar la cookie __Host-).
// El valor es el mismo id.HMAC firmado que va en la cookie; leerSesion lo valida igual.
export function extraerBearer(header: string | undefined): string | null {
  if (!header) return null
  const m = header.match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

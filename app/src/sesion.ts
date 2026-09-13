/** Sesión que sobrevive (app nativa y web).
 *
 *  Tres responsabilidades, ninguna más:
 *  1. cargarSesion(): deja el token en memoria ANTES de la primera petición, leyéndolo
 *     del almacén cifrado del dispositivo (@aparajita/capacitor-secure-storage:
 *     Keychain en iOS, AndroidKeyStore + AES/GCM en Android). localStorage queda como
 *     espejo (lo carga plataforma.ts al importar) y como fuente de migración para las
 *     instalaciones del APK 1.0.0, donde el token solo vivía en localStorage.
 *  2. renovarSesion(): canjea el token actual por uno nuevo en POST /api/sesion/renovar.
 *     Single-flight: si hay una renovación en curso, todas las peticiones esperan a esa.
 *     Solo el codigo 'sesion_invalida' del worker significa "la sesión murió de verdad";
 *     cualquier fallo de red o error del servidor es transitorio y NUNCA borra la sesión.
 *  3. registrarDispositivo(): tras un login nativo, da de alta el teléfono en
 *     POST /api/dispositivos (plataforma y modelo vía @capacitor/device) y guarda el id
 *     recibido para reutilizarlo en logins futuros (ancla la sesión al dispositivo:
 *     revocarlo desde otro aparato mata sus sesiones).
 *
 *  Los plugins de Capacitor se importan DINÁMICAMENTE y solo con EN_APP: la web no
 *  descarga estos chunks (mismo patrón que nativo.ts). */

import { EN_APP, API_BASE, getToken, setToken, setPersistidorToken } from './plataforma'

const CREDENCIALES: RequestCredentials = EN_APP ? 'omit' : 'same-origin'
const CLAVE_TOKEN = 'aldaba_token'
const CLAVE_DISPOSITIVO = 'aldaba_dispositivo'

// ── Almacén cifrado nativo (string puro; getItem/setItem/removeItem del plugin) ──
type Almacen = {
  getItem(k: string): Promise<string | null>
  setItem(k: string, v: string): Promise<void>
  removeItem(k: string): Promise<void>
}
let almacen: Almacen | null = null

async function abrirAlmacen(): Promise<Almacen | null> {
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    // OJO — NO devolver `SecureStorage` directamente: al retornarlo desde una
    // función `async`, el motor comprueba si es un "thenable" y le pide `.then`.
    // SecureStorage es un Proxy de Capacitor: cualquier propiedad se toma por un
    // método nativo, así que llama a `then(resolve, reject)` en el puente, nadie
    // responde y ESTA PROMESA NO SE RESUELVE NUNCA (ni lanza, así que ningún
    // try/catch salta). Eso dejaba el arranque colgado y la pantalla en el splash
    // #021627 — el "se queda en negro" del APK 1.1.0.
    // Se devuelve un objeto propio que delega método a método.
    return {
      getItem: (k) => SecureStorage.getItem(k),
      setItem: (k, v) => SecureStorage.setItem(k, v),
      removeItem: (k) => SecureStorage.removeItem(k),
    }
  } catch { return null /* plugin ausente o roto: se sigue con el espejo localStorage */ }
}

// ── 1. Carga inicial ──
// Memoizada: llamarla N veces devuelve siempre la misma promesa, así api() puede
// esperarla ante CADA petición sin costo (en web resuelve de inmediato).
let carga: Promise<void> | null = null

export async function cargarSesion(): Promise<void> {
  return (carga ??= (async () => {
    if (!EN_APP) return // web: la sesión vive en la cookie __Host-, nada que cargar
    almacen = await abrirAlmacen()
    if (!almacen) return
    try {
      const guardado = await almacen.getItem(CLAVE_TOKEN)
      if (guardado) setToken(guardado) // el almacén nativo manda sobre el espejo
      else {
        const espejo = getToken() // migración APK 1.0.0: token solo en localStorage
        if (espejo) await almacen.setItem(CLAVE_TOKEN, espejo)
      }
    } catch { /* almacén ilegible: la sesión queda la del espejo localStorage */ }
    // Desde aquí, todo setToken() se persiste también en el almacén cifrado.
    setPersistidorToken((t) => {
      const op = t ? almacen!.setItem(CLAVE_TOKEN, t) : almacen!.removeItem(CLAVE_TOKEN)
      op.catch(() => { /* fallo de escritura: el espejo localStorage sigue vivo */ })
    })
  })())
}

// ── 2. Renovación única y compartida ──
export type ResultadoRenovacion = 'renovada' | 'invalida' | 'red'

let renovacion: Promise<ResultadoRenovacion> | null = null

/** Cuántas renovaciones exitosas van. Sirve para descartar 401 REZAGADOS: una
 *  petición lenta que salió con la sesión vieja puede recibir su 401 cuando la
 *  renovación ya terminó; si canjeara otra vez, mataría la sesión nueva que las
 *  demás peticiones (y sus reintentos en vuelo) ya están usando. */
let generacion = 0
export function generacionSesion(): number { return generacion }

/** Canjea la sesión actual por una nueva. Si ya hay una renovación en curso, se
 *  comparte (todas las peticiones con 401 esperan el MISMO canje: cero bucles,
 *  cero canjes simultáneos — el worker mata la sesión vieja al canjearla).
 *  `desde` es la generación vigente cuando salió la petición que recibió el 401:
 *  si ya hubo un canje posterior, NO se canjea de nuevo — la sesión actual es
 *  más nueva que la que falló y el reintento debe usarla tal cual. */
export function renovarSesion(desde?: number): Promise<ResultadoRenovacion> {
  if (desde !== undefined && desde !== generacion) return Promise.resolve('renovada')
  return (renovacion ??= renovar().finally(() => { renovacion = null }))
}

async function renovar(): Promise<ResultadoRenovacion> {
  await cargarSesion()
  const headers: Record<string, string> = {}
  if (EN_APP) {
    const t = getToken()
    if (!t) return 'invalida' // sin token guardado no hay nada que canjear
    headers['X-Cliente'] = 'app'
    headers['authorization'] = `Bearer ${t}`
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/sesion/renovar`, { method: 'POST', headers, credentials: CREDENCIALES })
  } catch { return 'red' } // sin conexión: la sesión guardada NO se toca
  const data = await res.json().catch(() => ({} as any))
  if (res.ok) {
    // En nativo llega el token nuevo en el cuerpo; en web viaja como Set-Cookie.
    if (EN_APP && typeof (data as any).token === 'string') setToken((data as any).token)
    generacion++ // los 401 rezagados de la sesión anterior ya no canjean otra vez
    return 'renovada'
  }
  // Solo la señal explícita del worker mata la sesión; un 500/429/etc. es transitorio.
  return res.status === 401 && (data as any).codigo === 'sesion_invalida' ? 'invalida' : 'red'
}

// ── 3. Registro del dispositivo (solo nativo, tras login) ──
/** Best-effort: registra el teléfono y ancla la sesión actual a él. Jamás lanza
 *  (un fallo aquí no puede romper el login que acaba de funcionar). */
export async function registrarDispositivo(): Promise<void> {
  if (!EN_APP) return
  try {
    await cargarSesion()
    const t = getToken()
    if (!t) return
    const { Device } = await import('@capacitor/device')
    const info = await Device.getInfo()
    const idGuardado = almacen ? await almacen.getItem(CLAVE_DISPOSITIVO).catch(() => null) : null
    const res = await fetch(`${API_BASE}/api/dispositivos`, {
      method: 'POST',
      headers: { 'X-Cliente': 'app', authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      credentials: CREDENCIALES,
      body: JSON.stringify({
        id: idGuardado ?? undefined, // reutiliza el alta anterior; el worker valida que sea suyo
        plataforma: info.platform === 'ios' ? 'ios' : 'android',
        nombre: info.name ?? '',
        modelo: [info.manufacturer, info.model].filter(Boolean).join(' '),
      }),
    })
    if (!res.ok) return
    const data = await res.json().catch(() => ({} as any))
    if (typeof (data as any).id === 'string' && almacen)
      await almacen.setItem(CLAVE_DISPOSITIVO, (data as any).id).catch(() => {})
  } catch { /* sin plugin o sin red: el login sigue intacto */ }
}

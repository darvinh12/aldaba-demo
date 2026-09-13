/** Cache offline de LECTURA — solo app nativa (api.ts lo importa dinámicamente bajo EN_APP).
 *
 *  Por qué existe: en el teléfono se abre la app sin señal (sótano, ascensor, edificio sin
 *  cobertura) y sin esto toda pantalla queda vacía. Guardando la última respuesta de cada GET,
 *  el arranque sin red muestra lo último visto y la app sigue siendo útil.
 *
 *  Este módulo SOLO guarda y devuelve; quién ve una copia y cuándo lo decide api(). La regla que
 *  hay allí: la copia únicamente se pinta si el llamador se comprometió a recibir después el dato
 *  fresco (apiVivo), así que nunca se queda en pantalla haciéndose pasar por actual.
 *
 *  Por qué NO en web: la sesión web vive en la cookie __Host-, ilegible desde JS, así que no
 *  hay forma fiable de detectar "cambió el usuario" antes de pintar datos guardados; en una
 *  computadora compartida (conserjería, administradora) eso enseñaría las finanzas del
 *  anterior. La web no pierde nada: hoy tampoco tiene esta función y ni descarga este chunk.
 *
 *  La clave de cada entrada lleva SIEMPRE usuario + condominio + rol + ruta. Omitir cualquiera
 *  de las cuatro es una fuga entre inquilinos: sin u:, el segundo dueño del teléfono vería las
 *  cuotas del primero; sin c:, un org_admin multi-edificio mezclaría condominios; sin r:, el
 *  modo "ver como residente" leería la respuesta completa del rol admin.
 *
 *  Todo va en try/catch: sin IndexedDB, con la cuota llena o con el almacén corrupto, la app
 *  se comporta exactamente como antes (red y nada más). */

const BD_NOMBRE = 'aldaba-cache'
const ALMACEN = 'respuestas'
const BD_VERSION = 1

/** Huella del dueño de la cache. Se persiste porque en un arranque frío SIN RED hay que poder
 *  armar la clave del /me guardado antes de hablar con el servidor. */
const CLAVE_USUARIO = 'aldaba_cache_usuario'
/** Purga anotada de forma SÍNCRONA (localStorage) para que un location.reload() que
 *  interrumpa el borrado asíncrono de IndexedDB no deje datos del usuario/condominio viejo:
 *  el próximo arranque termina la purga ANTES de servir la primera lectura. */
const CLAVE_PURGA = 'aldaba_cache_purga'

const TTL = 14 * 24 * 60 * 60 * 1000 // 14 días: dato más viejo que esto no se sirve ni offline
const TOPE_ENTRADA = 256 * 1024      // bitácoras y series largas no pueden llenar el teléfono
const TOPE_ENTRADAS = 300

/** Nunca se guardan: escrituras (las filtra api.ts), secretos de sesión/dispositivo, la consola
 *  de plataforma, los binarios de R2 (peso y sensibilidad) y el pase público, que es de un
 *  tercero sin usuario dueño. '/me' SÍ se guarda: es la llave de todo el arranque offline. */
const VETADOS = ['/sa/', '/login', '/registro', '/logout', '/sesion/', '/dispositivos', '/demo/', '/media', '/pase/']

type Registro = { clave: string; datos: unknown; guardadoEn: number }

let huella: string | null = null
try { huella = localStorage.getItem(CLAVE_USUARIO) } catch { /* storage bloqueado: sin cache */ }

/** God-mode: un superadmin navega datos de TODOS los condominios; nada de eso puede quedar
 *  escrito en un teléfono. Se enciende al primer /me con esSuperadmin. */
let superadmin = false

// ── IndexedDB en crudo (unas pocas líneas; no justifica una dependencia) ──
//
// TODO lo que toca el almacén va acotado en el tiempo. En un WebView real una petición de
// IndexedDB puede quedarse sin resolver nunca (base bloqueada por otra pestaña/instancia, disco
// lleno, perfil corrupto) y aquí eso significaría una pantalla negra eterna: pasado el límite se
// sigue exactamente como si no hubiera cache.
const LIMITE_ABRIR = 3000
const LIMITE_OP = 3000
const LIMITE_ARRANQUE = 4000

function acotar<T>(p: Promise<T>, ms: number, porDefecto: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(porDefecto), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(porDefecto) })
  })
}

let conexion: Promise<IDBDatabase | null> | null = null

function abrir(): Promise<IDBDatabase | null> {
  return acotar(new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(BD_NOMBRE, BD_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(ALMACEN)) {
          const almacen = db.createObjectStore(ALMACEN, { keyPath: 'clave' })
          almacen.createIndex('guardadoEn', 'guardadoEn')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) /* WebView viejo o modo privado: se sigue sin cache */ }
  }), LIMITE_ABRIR, null)
}

function bd(): Promise<IDBDatabase | null> { return (conexion ??= abrir()) }

async function cerrarBd(): Promise<void> {
  const pendiente = conexion
  conexion = null
  try { (await pendiente)?.close() } catch { /* ya cerrada */ }
}

function pedir<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function conAlmacen<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T | undefined> {
  try {
    const db = await bd()
    if (!db) return undefined
    return await acotar<T | undefined>(fn(db.transaction(ALMACEN, modo).objectStore(ALMACEN)), LIMITE_OP, undefined)
  } catch { return undefined /* almacén corrupto o transacción abortada: se degrada a "sin cache" */ }
}

// ── Identidad del dueño de la cache ──

/** 16 hex del SHA-256 del correo. El token no sirve como identidad: rota en cada renovación. */
async function huellaDe(email: string): Promise<string> {
  const dato = email.trim().toLowerCase()
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dato))
    return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // WebView sin crypto.subtle: basta un hash que separe usuarios (no es un secreto).
    let h = 0x811c9dc5
    for (let i = 0; i < dato.length; i++) { h ^= dato.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return ('0000000' + h.toString(16)).slice(-8).repeat(2)
  }
}

/** Clave completa. Devuelve null si aún no se conoce al dueño (no hubo ningún /me todavía):
 *  sin identidad no se lee ni se escribe nada. */
export function armarClave(path: string, condo: string | null, rol: string | null): string | null {
  if (!huella) return null
  return `v1|u:${huella}|c:${condo || '-'}|r:${rol || '-'}|${path}`
}

function condoDeClave(clave: string): string {
  const partes = clave.split('|')
  return partes[2]?.startsWith('c:') ? partes[2].slice(2) : ''
}

// ── Qué se puede guardar ──

export function esCacheable(path: string, metodo = 'GET'): boolean {
  if (metodo.toUpperCase() !== 'GET') return false
  if (superadmin) return false
  return !VETADOS.some((p) => path.startsWith(p))
}

// ── Arranque del módulo: purgas pendientes ANTES de servir la primera lectura ──

// Se registra de forma SÍNCRONA al importar el módulo (no dentro del arranque asíncrono):
// cubre los tres caminos de muerte de sesión —logout de api.ts, sesionMuerta() y el
// "Entrar con mi clave" de Bloqueo.tsx— sin ventana en la que el evento se pierda.
window.addEventListener('aldaba:logout', () => { anotarPurga('todo'); void vaciarCacheOffline() })

const listo: Promise<void> = (async () => {
  let pendiente: string | null = null
  try { pendiente = localStorage.getItem(CLAVE_PURGA) } catch { /* sin storage */ }
  // Cada purga limpia (o conserva) la anotación según haya podido completarse: si el borrado
  // quedó bloqueado, el flag sobrevive y el arranque siguiente vuelve a intentarlo.
  if (pendiente === 'todo') await vaciarCacheOffline()
  else if (pendiente?.startsWith('otros:')) await purgarCondosDistintosDe(pendiente.slice(6))
  else if (pendiente) limpiarPurga()
  await purgarViejas()
})().catch(() => { /* nunca romper el arranque de la app por la cache */ })

let purgasHechas = false
listo.then(() => { purgasHechas = true })

/** Espera a las purgas del arranque, pero NUNCA para siempre. Si el almacén no responde a
 *  tiempo devuelve false y este arranque va sin cache: servir una copia con una purga a medias
 *  podría enseñar datos del usuario o del condominio anterior, y eso no se negocia. */
async function preparado(): Promise<boolean> {
  await acotar<void>(listo, LIMITE_ARRANQUE, undefined)
  return purgasHechas
}

/** Anota una purga de forma síncrona (la ejecuta este arranque o el siguiente). */
export function anotarPurga(valor: string): void {
  try { localStorage.setItem(CLAVE_PURGA, valor) } catch { /* sin storage: solo queda la purga en memoria */ }
}

function limpiarPurga(): void {
  try { localStorage.removeItem(CLAVE_PURGA) } catch { /* sin storage */ }
}

// ── Lectura y escritura ──

export type Guardado = { datos: unknown; guardadoEn: number }

export async function leerCache(path: string, condo: string | null, rol: string | null): Promise<Guardado | undefined> {
  if (!(await preparado())) return undefined
  if (!esCacheable(path)) return undefined
  const clave = armarClave(path, condo, rol)
  if (!clave) return undefined
  const reg = await conAlmacen('readonly', (s) => pedir<Registro | undefined>(s.get(clave)))
  if (!reg) return undefined
  if (Date.now() - reg.guardadoEn > TTL) { void olvidarClave(clave); return undefined }
  return { datos: reg.datos, guardadoEn: reg.guardadoEn }
}

/** Guarda la última respuesta fresca sin bloquear al que llamó. */
export function guardarCache(path: string, condo: string | null, rol: string | null, datos: unknown): void {
  void (async () => {
    if (!(await preparado())) return
    if (!esCacheable(path)) return
    const clave = armarClave(path, condo, rol)
    if (!clave) return
    let serializado: string
    try { serializado = JSON.stringify(datos) } catch { serializado = '' /* no serializable */ }
    // Una respuesta que no cabe (bitácora larga, serie histórica) BORRA la copia anterior en vez
    // de dejarla ahí: si no, esa clave quedaría congelada sirviendo lo viejo en cada arranque
    // durante los 14 días del TTL, justo la ruta que más crece y más cambia.
    if (!serializado || serializado.length > TOPE_ENTRADA) {
      await conAlmacen('readwrite', (s) => pedir(s.delete(clave)))
      return
    }
    await conAlmacen('readwrite', (s) => pedir(s.put({ clave, datos, guardadoEn: Date.now() } as Registro)))
  })().catch(() => { /* cuota llena: la app sigue igual, solo sin copia local */ })
}

async function olvidarClave(clave: string): Promise<void> {
  await conAlmacen('readwrite', (s) => pedir(s.delete(clave)))
}

/** El servidor negó este dato (403: ex-residente, condominio ajeno): la copia local no puede
 *  sobrevivir a la negativa. */
export async function olvidarCache(path: string, condo: string | null, rol: string | null): Promise<void> {
  await preparado()
  const clave = armarClave(path, condo, rol)
  if (clave) await olvidarClave(clave)
}

// ── Borrados ──

/** Borrado total: cierra la conexión y elimina la base entera (más barato y más seguro que
 *  recorrerla). No espera a `listo` porque el propio arranque la invoca. */
export async function vaciarCacheOffline(): Promise<void> {
  huella = null
  try { localStorage.removeItem(CLAVE_USUARIO) } catch { /* sin storage */ }
  let borrada = false
  try {
    await cerrarBd()
    // Acotado: el borrado se espera (api.ts lo hace antes de un login o un logout), y un
    // deleteDatabase que no responda nunca dejaría la app colgada en ese momento exacto.
    await acotar(new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(BD_NOMBRE)
      req.onsuccess = () => { borrada = true; resolve() }
      req.onerror = () => resolve()
      req.onblocked = () => resolve() // hay otra conexión abierta: se reintenta en el próximo arranque
    }), LIMITE_OP, undefined)
  } catch { borrada = true /* sin IndexedDB no había nada que borrar */ }
  // La anotación SOLO se retira si el borrado se completó de verdad.
  if (borrada) limpiarPurga(); else anotarPurga('todo')
}

/** Borra una lista de claves. Transacción propia y corta: leer y borrar en la MISMA
 *  transacción depende de que el motor no la cierre entre await y await, y ahí no se puede
 *  arriesgar un borrado a medias. */
async function borrarClaves(claves: string[]): Promise<void> {
  if (!claves.length) return
  await conAlmacen('readwrite', async (s) => { for (const c of claves) await pedir(s.delete(c)) })
}

async function todasLasClaves(): Promise<string[]> {
  const claves = await conAlmacen('readonly', (s) => pedir<IDBValidKey[]>(s.getAllKeys()))
  return (claves ?? []).filter((k): k is string => typeof k === 'string')
}

/** Cambio de condominio activo: se van TODAS las entradas de cualquier otro condominio. */
export async function purgarCondosDistintosDe(condo: string): Promise<void> {
  const ajena = (k: string) => condoDeClave(k) !== condo
  await borrarClaves((await todasLasClaves()).filter(ajena))
  // Se comprueba el resultado: si quedó algo del condominio anterior, la anotación sigue viva
  // para que el próximo arranque lo remate antes de servir cualquier lectura.
  if ((await todasLasClaves()).some(ajena)) anotarPurga(`otros:${condo}`); else limpiarPurga()
}

/** Tras cada /me fresco: se van las entradas de todo condominio en el que este usuario ya NO es
 *  miembro (lo sacaron de la junta, vendió el apartamento, le revocaron el acceso). Sin esto la
 *  copia sobreviviría los 14 días del TTL en un teléfono que ya no tiene derecho a verla.
 *  Las entradas sin condominio ('-', p.ej. el propio /me antes de tener uno activo) se quedan. */
export async function purgarCondosFuera(ids: string[]): Promise<void> {
  await preparado()
  const permitidos = new Set([...ids, '-'])
  await borrarClaves((await todasLasClaves()).filter((k) => !permitidos.has(condoDeClave(k))))
}

/** TTL y tope de entradas, una vez por arranque. */
async function purgarViejas(): Promise<void> {
  const corte = Date.now() - TTL
  const regs = (await conAlmacen('readonly', (s) => pedir<Registro[]>(s.getAll()))) ?? []
  const vencidas = regs.filter((r) => r.guardadoEn <= corte).map((r) => r.clave)
  const vivos = regs.filter((r) => r.guardadoEn > corte).sort((a, b) => a.guardadoEn - b.guardadoEn)
  const sobran = vivos.length > TOPE_ENTRADAS ? vivos.slice(0, vivos.length - TOPE_ENTRADAS).map((r) => r.clave) : []
  await borrarClaves([...vencidas, ...sobran])
}

/** Tras cada /me fresco. Si el correo no es el del dueño de la cache, se borra TODO antes de
 *  escribir nada: dos personas comparten teléfono más veces de lo que parece. */
export async function sincronizarUsuario(email: string, esSuperadmin: boolean): Promise<void> {
  await preparado() // una purga pendiente del arranque no puede pisar la huella que se escribe aquí
  if (esSuperadmin) {
    superadmin = true
    await vaciarCacheOffline()
    return
  }
  superadmin = false
  const nueva = await huellaDe(email)
  if (nueva === huella) return
  await vaciarCacheOffline() // deja huella en null
  huella = nueva
  try { localStorage.setItem(CLAVE_USUARIO, nueva) } catch { /* sin storage: cache solo en este arranque */ }
}

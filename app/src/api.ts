import { EN_APP, API_BASE, getToken, setToken } from './plataforma'
import { cargarSesion, renovarSesion, generacionSesion, registrarDispositivo } from './sesion'

let condoActivo: string | null = localStorage.getItem('condoActivo')
// Un usuario multi-rol (p.ej. junta que también es propietario) puede pedir actuar con un rol concreto.
let rolActivo: string | null = localStorage.getItem('rolActivo')

export function setCondoActivo(id: string) { condoActivo = id; localStorage.setItem('condoActivo', id) }
export function getCondoActivo() { return condoActivo }
export function setRolActivo(rol: string | null) {
  rolActivo = rol
  if (rol) localStorage.setItem('rolActivo', rol); else localStorage.removeItem('rolActivo')
}
export function getRolActivo() { return rolActivo }

// ── Cache offline de lectura (solo app nativa) ──
// El módulo se importa DINÁMICAMENTE y memoizado, igual que los plugins en sesion.ts: así la
// web ni siquiera descarga el chunk. La web queda fuera a propósito (ver cacheOffline.ts).
let cargaCache: Promise<typeof import('./cacheOffline')> | null = null
function moduloCache() { return (cargaCache ??= import('./cacheOffline')) }

/** Nombre duplicado de cacheOffline.ts a propósito: hay que poder anotar la purga de forma
 *  SÍNCRONA, sin esperar al import dinámico, porque location.reload() no espera a nadie. */
const CLAVE_PURGA_CACHE = 'aldaba_cache_purga'

/** Anota que hay una purga pendiente. Si el borrado asíncrono no alcanza a terminar antes de
 *  una recarga, el próximo arranque del módulo lo remata ANTES de servir cualquier lectura. */
export function anotarPurgaCache(valor: 'todo' | `otros:${string}`): void {
  if (!EN_APP) return
  try { localStorage.setItem(CLAVE_PURGA_CACHE, valor) } catch { /* sin storage: nada que purgar */ }
}

/** Cambio de condominio activo: borra lo guardado de cualquier OTRO condominio. */
export function purgarCacheOtrosCondos(condo: string): void {
  if (!EN_APP) return
  anotarPurgaCache(`otros:${condo}`)
  void moduloCache().then((m) => m.purgarCondosDistintosDe(condo)).catch(() => {})
}

/** Estado de la red para el chip del Shell. Se avisa en CADA petición terminada: una respuesta
 *  del servidor (aunque sea un 500) prueba que hay señal; solo un fallo de transporte no. */
function avisarRed(viva: boolean): void {
  window.dispatchEvent(new CustomEvent('aldaba:red', { detail: { viva } }))
}

// ── Orden de las respuestas ──
// Dos carreras reales, las dos con dinero de por medio:
//  a) una lectura que salió ANTES de una mutación puede llegar DESPUÉS: traería el saldo sin el
//     pago recién registrado y, peor, lo guardaría en la cache con marca de tiempo fresca;
//  b) dos lecturas de la misma ruta pueden llegar en orden inverso y la vieja pisaría a la nueva.
// Una respuesta solo se entrega a la pantalla y se guarda si sigue siendo la última palabra.
let generacionMutacion = 0
let secuencia = 0
const ultimaAplicada = new Map<string, number>()
/** Momento en que salió la última mutación. Una copia guardada ANTES de ese instante es, por
 *  definición, el estado previo a esa mutación: no se pinta ni un instante (es el cargar() que
 *  sigue a cada POST). Una copia guardada DESPUÉS sí, y por eso volver a una sección ya visitada
 *  vuelve a ser instantáneo en vez de quedarse en blanco esperando a la red. */
let ultimaMutacion = 0

/** Espera acotada: una promesa que no resuelve JAMÁS puede colgar el arranque (ya nos pasó).
 *  Pasado el límite se sigue con el valor por defecto — siempre "como si no hubiera cache". */
function acotar<T>(p: Promise<T>, ms: number, porDefecto: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(porDefecto), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(porDefecto) })
  })
}

/** Un fallo de red marcado. Solo estos errores autorizan servir la copia local: un 500 o un
 *  error de negocio debe subir tal cual, porque esconderlo tras datos viejos sería mentir. */
type ErrorDeRed = Error & { red?: true }
function fallaDeRed(): never { throw Object.assign(new Error('sin conexión con el servidor'), { red: true as const }) }
const esErrorDeRed = (e: unknown): boolean => !!(e as ErrorDeRed)?.red

// La sesión guardada SOLO se destruye aquí, cuando el worker confirmó que murió
// (codigo 'sesion_invalida' irrecuperable). Un 401 suelto o un fallo de red jamás
// pasan por esta función: primero se intenta renovar en sesion.ts.
function sesionMuerta(): never {
  // Antes de nada, y de forma síncrona: la sesión murió, los datos guardados se van con ella.
  // El evento 'aldaba:logout' dispara el vaciado; el flag cubre la recarga que lo interrumpa.
  anotarPurgaCache('todo')
  setToken(null)
  window.dispatchEvent(new Event('aldaba:logout'))
  throw new Error('sesión vencida')
}

/** ¿Este 401 es "sesión inválida" (renovable) o un 401 de negocio (p.ej. clave mala)? */
async function esSesionInvalida(res: Response): Promise<boolean> {
  const data = await res.clone().json().catch(() => ({} as any))
  return (data as any).codigo === 'sesion_invalida'
}

/** Ejecuta un fetch autenticado con UNA renovación de sesión ante 'sesion_invalida'.
 *  hacer() se re-invoca en el reintento para que arme cabeceras frescas (token nuevo). */
async function fetchConSesion(hacer: () => Promise<Response>): Promise<Response> {
  await cargarSesion() // en nativo espera el token del almacén cifrado; en web es inmediato
  const gen = generacionSesion() // generación de sesión con la que sale esta petición
  let res = await hacer()
  if (res.status !== 401 || !(await esSesionInvalida(res))) return res
  // Si otra petición ya canjeó la sesión después de que esta salió, renovarSesion(gen)
  // NO canjea de nuevo (mataría la sesión nueva): responde 'renovada' y se reintenta.
  const r = await renovarSesion(gen)
  if (r === 'invalida') sesionMuerta()
  if (r === 'red') fallaDeRed()
  res = await hacer() // reintento único con la sesión renovada
  if (res.status === 401 && (await esSesionInvalida(res))) sesionMuerta() // no se reintenta dos veces
  return res
}

/** Cabeceras de autenticación/tenant comunes a todo fetch contra el worker.
 *  El condominio y el rol se reciben CONGELADOS por quien lanzó la petición: si se leyeran aquí
 *  (o peor, al llegar la respuesta) un cambio de edificio a mitad de vuelo mezclaría inquilinos. */
function authHeaders(condo = condoActivo, rol = rolActivo): Record<string, string> {
  const h: Record<string, string> = {}
  if (condo) h['X-Condominio'] = condo
  if (rol) h['X-Rol'] = rol
  if (EN_APP) {
    h['X-Cliente'] = 'app'
    const t = getToken()
    if (t) h['authorization'] = `Bearer ${t}`
  }
  return h
}

// En la app nativa la cookie __Host- no viaja cross-origin: se omite y manda el Bearer.
const CREDENCIALES: RequestCredentials = EN_APP ? 'omit' : 'same-origin'

/** URL para abrir/descargar un archivo de media. Lleva el condominio activo como query (?c=) porque
 *  una navegación <a>/<img> no envía el header X-Condominio; sin esto, el org-admin multi-edificio
 *  recibiría 403 al abrir comprobantes/facturas/fotos de un edificio distinto al auto-resuelto. */
export function mediaUrl(key: string) {
  return `${API_BASE}/api/media/${key}${condoActivo ? `?c=${encodeURIComponent(condoActivo)}` : ''}`
}

/** Descarga media protegida con las cabeceras autenticadas y devuelve un blob: URL
 *  (para <img> y visores en la app nativa, donde la URL directa no lleva sesión).
 *  El que la usa debe liberarla con URL.revokeObjectURL cuando deje de mostrarla. */
export async function mediaBlobUrl(key: string): Promise<string> {
  const res = await fetchConSesion(() => fetch(mediaUrl(key), { headers: authHeaders(), credentials: CREDENCIALES }))
  if (!res.ok) throw new Error(`error ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

/** Lectura viva: la forma en que TODA pantalla debe pedir datos que va a mostrar.
 *
 *  `aplicar` se llama en cuanto hay algo que pintar y OTRA VEZ con la respuesta fresca si lo
 *  primero fue una copia guardada. Pasar `aplicar` es lo único que autoriza a api() a servir la
 *  copia local: una pantalla que no lo pase espera a la red, así que ninguna puede quedarse
 *  enseñando saldos de hace días como si fueran de ahora por olvido de quien la escribió.
 *
 *  La promesa resuelve cuando se aplicó el primer dato y rechaza si no hubo ninguno (ni red ni
 *  copia), para que la pantalla muestre su error como siempre. */
export function apiVivo<T = any>(path: string, aplicar: (datos: T) => void): Promise<void> {
  let yaFresco = false
  return api<T>(path, {}, (d) => { yaFresco = true; aplicar(d) })
    // Si el fresco ganó la carrera a la copia, la copia ya no se pinta: nunca se retrocede.
    .then((d) => { if (!yaFresco) aplicar(d) })
}

export async function api<T = any>(path: string, opts: RequestInit = {}, alRefrescar?: (datos: T) => void, _relectura = 0): Promise<T> {
  const metodo = (opts.method ?? 'GET').toUpperCase()
  // Identidad de tenant y orden de salida: se congelan AQUÍ, no al llegar la respuesta.
  const condo = condoActivo
  const rol = rolActivo
  const seq = ++secuencia
  if (metodo !== 'GET') { generacionMutacion++; ultimaMutacion = Date.now() }
  const genSalida = generacionMutacion
  const claveOrden = `${condo ?? '-'}|${rol ?? '-'}|${path}`

  // El import dinámico también se acota: un chunk que no llegue no puede dejar la app en negro.
  type ModuloCache = typeof import('./cacheOffline')
  const cache = EN_APP ? await acotar<ModuloCache | null>(moduloCache(), 4000, null) : null
  // Solo lecturas y solo rutas permitidas: las mutaciones y los secretos jamás se guardan.
  const cacheable = !!cache && metodo === 'GET' && cache.esCacheable(path, metodo)

  /** ¿Esta respuesta sigue siendo la última palabra sobre esta ruta? Si no, no se pinta ni se
   *  guarda: es dato anterior a una mutación o a una lectura más nueva. */
  const vigente = () => generacionMutacion === genSalida && (ultimaAplicada.get(claveOrden) ?? 0) <= seq

  /** Entrega al llamador SOLO lo que sigue siendo la última palabra sobre esta ruta. El guard
   *  de vigencia protegía la escritura en cache y la entrega por callback, pero el valor que
   *  api() devuelve directamente se aplicaba sin mirar: una lectura que salió antes de una
   *  mutación podía llegar después y repintar el estado previo (reportás un pago y el saldo
   *  vuelve al de antes). Si la respuesta ya quedó vieja se relee UNA vez — solo en lecturas:
   *  reintentar un POST duplicaría un pago. */
  const entregar = async (d: T): Promise<T> => {
    if (vigente() || _relectura > 0) { ultimaAplicada.set(claveOrden, seq); return d }
    return await api<T>(path, opts, alRefrescar, _relectura + 1)
  }

  /** Sirve la copia guardada avisando al Shell de qué antigüedad tiene lo que se ve. */
  const servirCopia = (g: { datos: unknown; guardadoEn: number }): T => {
    window.dispatchEvent(new CustomEvent('aldaba:copia', { detail: { path, guardadoEn: g.guardadoEn } }))
    return g.datos as T
  }

  const pedirFresco = async (): Promise<T> => {
    let res: Response
    try {
      res = await fetchConSesion(() => {
        const headers: Record<string, string> = { ...authHeaders(condo, rol), ...(opts.headers as any) }
        if (opts.body && typeof opts.body === 'string') headers['content-type'] ??= 'application/json'
        return fetch(`${API_BASE}/api${path}`, { ...opts, headers, credentials: CREDENCIALES }).catch(fallaDeRed)
      })
    } catch (e) {
      if (esErrorDeRed(e)) avisarRed(false)
      throw e
    }
    avisarRed(true) // hubo respuesta del servidor (aunque sea un error): la red está viva
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // El servidor ya niega este dato (ex-residente, condominio ajeno): la copia local no
      // puede sobrevivir a la negativa.
      if (res.status === 403 && cacheable) void cache!.olvidarCache(path, condo, rol)
      throw new Error((data as any).error ?? `error ${res.status}`)
    }
    // Un inicio de sesión puede ser de OTRA persona en el mismo teléfono (caso real: "Entrar
    // con mi clave" sin red, donde el /logout nunca llegó al servidor y no hubo purga). Nada
    // del dueño anterior puede sobrevivir a un login, ni los segundos que tarda /me en llegar.
    const esLogin = path === '/login' || path === '/registro' || path === '/demo/login'
    // La ANOTACIÓN va fuera del guard del módulo a propósito: es síncrona, no necesita el
    // chunk, y si el import se pasó de los 4 s (cache === null) tiene que quedar escrita
    // igual para que el próximo arranque remate la purga antes de servir nada.
    if (EN_APP && esLogin) anotarPurgaCache('todo')
    if (esLogin && cache) await cache.vaciarCacheOffline()
    // La app nativa recibe la sesión como token en el cuerpo (login/registro con X-Cliente: app)
    // y de inmediato registra este teléfono en /api/dispositivos (best-effort, no bloquea).
    if (EN_APP && esLogin && typeof (data as any).token === 'string') {
      setToken((data as any).token)
      void registrarDispositivo()
    }
    // Logout explícito exitoso: el token guardado (memoria + espejo + almacén nativo) se borra
    // y con él TODO lo guardado; se espera al vaciado porque App recarga justo después.
    if (path === '/logout') {
      anotarPurgaCache('todo')
      setToken(null)
      if (cache) await cache.vaciarCacheOffline()
    }
    // El /me fresco es donde se detecta el cambio de usuario y el god-mode del superadmin.
    // Va ANTES de escribir nada: la huella del dueño forma parte de todas las claves.
    if (cache && path === '/me') {
      await cache.sincronizarUsuario(String((data as any).email ?? ''), !!(data as any).esSuperadmin)
      // Perder la membresía de un condominio (te sacaron de la junta, vendiste el apartamento)
      // tiene que borrar sus datos del teléfono AHORA, no dentro de 14 días cuando venza el TTL.
      const ids = Array.isArray((data as any).condominios) ? (data as any).condominios.map((c: any) => String(c.id)) : []
      await cache.purgarCondosFuera(ids)
    }
    if (cacheable && vigente()) {
      ultimaAplicada.set(claveOrden, seq)
      cache!.guardarCache(path, condo, rol, data)
      // El Shell y las pantallas suscritas se enteran de que lo que hay en la mano es fresco.
      window.dispatchEvent(new CustomEvent('aldaba:datos-frescos', { detail: { path } }))
    }
    return data as T
  }

  // Sin cache posible (web, mutación, ruta vetada): red y nada más, como siempre.
  if (!cacheable) return await pedirFresco()

  // Sin compromiso de refresco no hay pintado instantáneo: se espera a la red y la copia queda
  // solo como respaldo si la red falla. Así, una pantalla que nadie cableó nunca puede enseñar
  // dinero viejo como si fuera de ahora — lo peor que le pasa es tardar lo que tarde el servidor.
  if (!alRefrescar) {
    try {
      return await entregar(await pedirFresco())
    } catch (e) {
      if (!esErrorDeRed(e)) throw e
      const guardado = await cache!.leerCache(path, condo, rol)
      if (!guardado) throw e
      return servirCopia(guardado)
    }
  }

  // Stale-while-revalidate. La red sale YA, en paralelo con la lectura de IndexedDB: un almacén
  // lento, lleno o roto puede dejarnos sin copia, pero jamás retrasar la respuesta real.
  let frescoListo = false
  const enCurso = pedirFresco().then(
    (d) => { frescoListo = true; return d },
    (e) => { frescoListo = true; throw e },
  )
  enCurso.catch(() => { /* el error se maneja abajo; esto solo evita el 'unhandled rejection' */ })

  const guardado = await cache!.leerCache(path, condo, rol)
  // Se pinta la copia solo si es POSTERIOR a la última mutación (si no, es el estado previo a
  // ella) y si la red no ganó ya la carrera (no se retrocede nunca a lo viejo).
  if (guardado && guardado.guardadoEn > ultimaMutacion && !frescoListo) {
    // La revalidación entra por la puerta del llamador. El guard de orden evita que una
    // respuesta lenta pise un estado ya actualizado por una mutación o por otra lectura.
    void enCurso.then((d) => {
      if (!vigente()) return
      ultimaAplicada.set(claveOrden, seq)
      alRefrescar(d)
    }, () => { /* sin red: se queda lo servido, con su chip de "sin conexión" */ })
    return servirCopia(guardado)
  }
  try {
    return await entregar(await enCurso)
  } catch (e) {
    if (!esErrorDeRed(e)) throw e
    const respaldo = guardado ?? await cache!.leerCache(path, condo, rol)
    if (!respaldo) throw e
    return servirCopia(respaldo)
  }
}

/** Sube un archivo a R2 vía PUT /api/media y devuelve su key. Lanza si R2 no está activo (503). */
export async function subirArchivo(file: File): Promise<string> {
  const res = await fetchConSesion(() => {
    const headers: Record<string, string> = { ...authHeaders(), 'content-type': file.type || 'application/octet-stream' }
    return fetch(`${API_BASE}/api/media?nombre=${encodeURIComponent(file.name)}`, { method: 'PUT', headers, body: file, credentials: CREDENCIALES })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error ?? `error ${res.status}`)
  return (data as any).key
}

/** Fechas SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) → Date válida también en Safari/iOS */
export const fechaUtc = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
export const usd = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ejecuta fn(); si lanza, reporta el error vía setMsg y devuelve undefined en vez de propagar. */
export async function conError<T>(fn: () => Promise<T>, setMsg: (m: string) => void): Promise<T | undefined> {
  try { return await fn() } catch (e) { setMsg(`⚠ ${(e as Error).message}`); return undefined }
}

export type Me = {
  nombre: string; email: string; esSuperadmin: boolean
  /** El servidor exige cambiar la clave temporal del arranque antes de dejar ver nada. */
  debeCambiarClave?: boolean
  condominios: { id: string; nombre: string; rol: string; unidad_id: string | null; suspendido?: number; es_demo?: number }[]
}

/** Capa de plataforma: un solo lugar donde la SPA distingue web (PWA en el dominio)
 *  de app nativa (WebView Capacitor, origen https://localhost). Contrato compartido
 *  por toda la app — no renombrar sin coordinar. */

const DOMINIO_REAL = 'https://aldaba-demo.arondon33.workers.dev'

/** true dentro de Capacitor nativo (Android/iOS); false en el navegador y en `npx cap serve`. */
export const EN_APP: boolean =
  typeof (globalThis as any).Capacitor !== 'undefined' && !!(globalThis as any).Capacitor.isNativePlatform?.()

/** Prefijo de toda llamada al worker: '' en web (mismo origen), dominio real en la app. */
export const API_BASE: string = EN_APP ? DOMINIO_REAL : ''

/** Origen para enlaces públicos y QR (pase, invitación): siempre uno que un tercero pueda abrir.
 *  En la app `location.origin` sería https://localhost → enlace muerto; se usa el dominio real. */
export const PUBLIC_ORIGIN: string = EN_APP ? DOMINIO_REAL : location.origin

// ── Token de sesión de la app nativa (en web la sesión vive en la cookie __Host-) ──
const CLAVE_TOKEN = 'aldaba_token'
let token: string | null = null
try { token = localStorage.getItem(CLAVE_TOKEN) } catch { /* storage bloqueado: sesión solo en memoria */ }

export function getToken(): string | null { return token }

export function setToken(t: string | null): void {
  token = t
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t)
    else localStorage.removeItem(CLAVE_TOKEN)
  } catch { /* storage bloqueado: queda solo en memoria */ }
  persistidor?.(t)
}

// ── Persistencia nativa del token ──
// En la app nativa el localStorage del WebView puede vaciarse (limpieza del sistema,
// "borrar datos"); sesion.ts registra aquí la escritura al almacén cifrado del
// dispositivo (Keychain/KeyStore). En web queda null y el token vive solo como espejo.
let persistidor: ((t: string | null) => void) | null = null
export function setPersistidorToken(fn: (t: string | null) => void): void { persistidor = fn }

/** Abre un enlace externo (WhatsApp, la web pública). En web: pestaña nueva sin opener.
 *
 *  EN LA APP NO SIRVE window.open, Y ESTE ERA UN BUG REAL. El WebChromeClient de Capacitor
 *  solo atiende `onCreateWindow` cuando el usuario toca un <a> de verdad — se apoya en
 *  `getHitTestResult()`, que para una llamada programática viene vacío. Resultado:
 *  `window.open()` devuelve null SIEMPRE, y el aviso de "el navegador bloqueó la ventana
 *  emergente" salía aunque no hubiera ningún bloqueador. Rompía compartir un pase por
 *  WhatsApp, la mensajería masiva, el botón WA del CRM y ver el QR.
 *
 *  En nativo se entrega al sistema con AppLauncher: WhatsApp abre en WhatsApp y una página
 *  web en el navegador, mientras Aldaba se queda viva detrás. Si nada sabe abrir ese enlace
 *  (`completed:false`) se cae a window.open, y solo entonces el aviso dice la verdad. */
export async function abrirExterno(url: string): Promise<void> {
  if (EN_APP) {
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher')
      const { completed } = await AppLauncher.openUrl({ url })
      if (completed) return
    } catch { /* plugin ausente en esta build: cae al camino de abajo */ }
  }
  const w = window.open(url, '_blank', 'noopener')
  if (!w) alert('No se pudo abrir el enlace. Copia la dirección y ábrela a mano.')
}

/** Copia texto al portapapeles y dice la verdad: true solo si realmente quedó copiado. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true }
  } catch { /* sin permiso o sin gesto: probar el fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/** Envuelve una promesa con un tope de tiempo. Existe por una lección cara: un
 *  plugin nativo que no responde deja la promesa colgada para siempre, y si el
 *  arranque la espera, la app se queda en el splash (pantalla negra). Ninguna
 *  llamada nativa del arranque debe poder bloquear la interfaz: si tarda más de
 *  `ms`, se sigue con el valor de respaldo. */
export function conTiempo<T>(promesa: Promise<T>, ms: number, respaldo: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let listo = false
    const t = setTimeout(() => { if (!listo) { listo = true; resolve(respaldo) } }, ms)
    promesa.then(
      (v) => { if (!listo) { listo = true; clearTimeout(t); resolve(v) } },
      () => { if (!listo) { listo = true; clearTimeout(t); resolve(respaldo) } },
    )
  })
}

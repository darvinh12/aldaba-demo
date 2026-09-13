/** Permisos del dispositivo (solo app nativa Capacitor).
 *
 *  HONESTO: Android e iOS NO permiten que una app se autoconceda permisos.
 *  Lo único posible es PEDIRLOS en el momento correcto (y una sola vez: el
 *  diálogo del sistema se quema) y, si el usuario los negó, guiarlo a los
 *  Ajustes de la app con abrirAjustesDeLaApp().
 *
 *  Política por rol (la aplica la pantalla Bienvenida al decidir qué filas pinta):
 *   - porteria: cámara al entrar (escanear QR es su trabajo diario) + notificaciones.
 *   - residente/admin/org_admin: NO se pide cámara al arrancar (pedir permisos sin
 *     motivo destruye la confianza); se pide la primera vez que va a usarla
 *     (pedirPermisoCamara desde el punto de uso). Notificaciones sí, explicando antes.
 *
 *  La explicación previa la da SIEMPRE interfaz propia (Bienvenida / AjustesApp), nunca
 *  un confirm() del WebView: ese cuadro sale en inglés, sin identidad y sin poder decir
 *  qué pasa si el usuario niega. Estas funciones solo hablan con el sistema.
 *
 *  En la web todo devuelve 'no_aplica' / no hace nada: el navegador gestiona
 *  sus propios permisos y este chunk ni siquiera carga los plugins. */
import { EN_APP } from './plataforma'

export type EstadoPermiso = 'concedido' | 'denegado' | 'no_pedido' | 'no_aplica'

/** PermissionState de Capacitor → estado propio ('prompt'/'prompt-with-rationale' = aún no pedido). */
const traducir = (s: string): EstadoPermiso =>
  s === 'granted' ? 'concedido' : s === 'denied' ? 'denegado' : 'no_pedido'

/** Pide el permiso de cámara del sistema (Android CAMERA / iOS NSCameraUsageDescription).
 *  Con él concedido, el getUserMedia del escáner QR funciona sin más diálogos: Capacitor
 *  puentea la petición del WebView. Si ya está denegado NO insiste (el diálogo del sistema
 *  ya no volvería a salir): el que llama debe ofrecer abrirAjustesDeLaApp(). */
export async function pedirPermisoCamara(): Promise<EstadoPermiso> {
  if (!EN_APP) return 'no_aplica'
  try {
    const { Camera } = await import('@capacitor/camera')
    const actual = (await Camera.checkPermissions()).camera
    if (actual === 'granted') return 'concedido'
    if (actual === 'denied') return 'denegado'
    const r = await Camera.requestPermissions({ permissions: ['camera'] })
    return traducir(r.camera)
  } catch { return 'no_pedido' }
}

/** Pide permiso de notificaciones (POST_NOTIFICATIONS en Android 13+; en Android ≤12 el
 *  sistema responde 'granted' solo). Solo se debe llamar desde un gesto del usuario que
 *  ya vio la explicación (Bienvenida o Ajustes de la app): el diálogo del sistema se
 *  muestra una sola vez y sin contexto la gente lo niega. Si ya está denegado NO insiste;
 *  el que llama debe ofrecer abrirAjustesDeLaApp(). */
export async function pedirPermisoNotificaciones(): Promise<EstadoPermiso> {
  if (!EN_APP) return 'no_aplica'
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const actual = (await LocalNotifications.checkPermissions()).display
    if (actual === 'granted') return 'concedido'
    if (actual === 'denied') return 'denegado'
    const r = await LocalNotifications.requestPermissions()
    return traducir(r.display)
  } catch { return 'no_pedido' }
}

/** Estado actual de los permisos que usa Aldaba, sin disparar ningún diálogo. */
export async function estadoPermisos(): Promise<{ camara: EstadoPermiso; notificaciones: EstadoPermiso }> {
  if (!EN_APP) return { camara: 'no_aplica', notificaciones: 'no_aplica' }
  let camara: EstadoPermiso = 'no_pedido'
  let notificaciones: EstadoPermiso = 'no_pedido'
  try {
    const { Camera } = await import('@capacitor/camera')
    camara = traducir((await Camera.checkPermissions()).camera)
  } catch { /* plugin ausente: queda 'no_pedido' */ }
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    notificaciones = traducir((await LocalNotifications.checkPermissions()).display)
  } catch { /* ídem */ }
  return { camara, notificaciones }
}

/** Abre la pantalla de Ajustes DE ESTA APP en el sistema (Android: "Información de la
 *  aplicación"; iOS: sus ajustes). Es el único camino legítimo cuando un permiso ya
 *  fue denegado: el sistema no vuelve a mostrar el diálogo. */
export async function abrirAjustesDeLaApp(): Promise<void> {
  if (!EN_APP) return
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings')
    await NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App })
  } catch { /* plugin ausente en esta build: no hay nada que abrir */ }
}

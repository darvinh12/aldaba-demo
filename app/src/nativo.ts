/** Comportamiento nativo (solo se ejecuta con EN_APP): botón atrás de Android,
 *  status bar acorde al tema y ocultar el splash tras el primer render.
 *  Este módulo se importa DINÁMICAMENTE desde main.tsx: la web nunca descarga
 *  este chunk ni el código de Capacitor. Los mismos plugins están instalados
 *  en movil/package.json (lado nativo); aquí va su puente JS. */

import { volverAtras } from './navegacion'

export async function iniciarNativo(): Promise<void> {
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ])

  // Botón atrás de Android: deshace la vista más reciente de la pila propia
  // (navegacion.ts) — cierra el modal u hoja abierta o vuelve a la sección
  // anterior. El canGoBack del WebView no sirve aquí: la SPA enruta por estado,
  // no empuja historial, y siempre reporta false. Solo en la raíz (pila vacía)
  // se ofrece SALIR con confirmación; jamás se cierra ni minimiza en seco.
  let dialogoSalida = false // un solo diálogo aunque el botón se toque repetido
  App.addListener('backButton', () => {
    if (volverAtras()) return // había una vista abierta: quedó deshecha
    if (dialogoSalida) return
    dialogoSalida = true
    void (async () => {
      try {
        const { Dialog } = await import('@capacitor/dialog')
        const { value } = await Dialog.confirm({
          title: '¿Salir de Aldaba?',
          message: 'La app se cerrará. Tu sesión queda guardada.',
          okButtonTitle: 'Salir',
          cancelButtonTitle: 'Cancelar',
        })
        if (value) {
          // ciclo.ts anota este motivo al pasar la app a segundo plano (diagnóstico).
          window.dispatchEvent(new CustomEvent('aldaba:motivo-salida', { detail: 'salida_confirmada' }))
          await App.exitApp()
        }
      } catch {
        // Sin el plugin Dialog (build vieja): al fondo, nunca cierre sin confirmar.
        window.dispatchEvent(new CustomEvent('aldaba:motivo-salida', { detail: 'boton_atras' }))
        App.minimizeApp().catch(() => { /* iOS no tiene botón atrás: no llega aquí */ })
      } finally { dialogoSalida = false }
    })()
  })

  // Status bar según el tema actual, y re-aplicada cada vez que el usuario lo alterna
  // (ThemeToggle escribe document.documentElement.dataset.theme).
  const aplicarStatusBar = () => {
    const oscuro = document.documentElement.dataset.theme === 'dark'
    // Style.Dark = fondo oscuro con texto claro; Style.Light = fondo claro con texto oscuro
    StatusBar.setStyle({ style: oscuro ? Style.Dark : Style.Light }).catch(() => {})
    StatusBar.setBackgroundColor({ color: oscuro ? '#080c11' : '#f4f6f8' }).catch(() => { /* iOS no lo implementa */ })
  }
  aplicarStatusBar()
  new MutationObserver(aplicarStatusBar)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  // El splash se configura con launchAutoHide:false (movil/capacitor.config.ts):
  // se oculta aquí, cuando React ya pintó el primer frame.
  await SplashScreen.hide()
}

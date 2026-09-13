import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import './tokens.css'
import { App } from './App'
import { ToastProvider } from './ui'
import { aplicarTemaInicial } from './components/brand'
import { EN_APP, getToken, setToken, conTiempo } from './plataforma'

aplicarTemaInicial() // tema claro/oscuro guardado o según el sistema, antes de pintar

;(window as any).__bip = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); (window as any).__bip = e })

/** Oculta el splash pase lo que pase. Se llama en cuanto React pintó el primer
 *  frame: el splash JAMÁS debe depender de que termine la cadena nativa. */
function bajarSplash() {
  if (!EN_APP) return
  import('@capacitor/splash-screen')
    .then(({ SplashScreen }) => SplashScreen.hide())
    .catch(() => { /* sin plugin: capacitor.config lo baja solo por tiempo */ })
}

/**
 * Arranque de la app nativa.
 *
 * REGLA DE ORO (aprendida con el APK 1.1.0, que se quedaba en negro): el primer
 * render NO puede depender de ninguna llamada nativa. Un plugin que no responde
 * deja su promesa colgada para siempre — no lanza, así que ningún try/catch
 * salta — y la pantalla se queda en el splash #021627, que se ve negro.
 *
 * Por eso aquí se pinta SIEMPRE algo de inmediato (el mismo spinner que ya usa
 * la app) y toda llamada nativa va con tope de tiempo: si tarda, se sigue sin
 * ella. La huella solo puede RETRASAR la decisión un máximo de 2,5 s; nunca
 * puede impedir que la app se dibuje.
 */
type Estado = 'decidiendo' | 'bloqueado' | 'abierto'

function Arranque() {
  const [estado, setEstado] = useState<Estado>(EN_APP ? 'decidiendo' : 'abierto')
  const [Bloqueo, setBloqueo] = useState<null | React.ComponentType<any>>(null)

  useEffect(() => {
    bajarSplash() // React ya pintó: fuera el splash, decida lo que decida el resto
    if (!EN_APP) return
    let vivo = true
    void (async () => {
      try {
        const [{ cargarSesion }, { biometriaActivada }, { iniciarCicloDeVida }, mod] = await conTiempo(
          Promise.all([
            import('./sesion'),
            import('./biometria'),
            import('./ciclo'),
            import('./components/Bloqueo'),
          ]),
          4000,
          [null, null, null, null] as any,
        )
        if (!vivo) return
        if (!cargarSesion) { setEstado('abierto'); return } // los chunks no cargaron: la app entra igual
        iniciarCicloDeVida?.()
        await conTiempo(cargarSesion(), 4000, undefined) // el almacén cifrado no puede colgar el arranque
        if (!vivo) return
        const bloquear = !!getToken() && await conTiempo(biometriaActivada(), 2500, false)
        if (!vivo) return
        if (bloquear && mod?.Bloqueo) { setBloqueo(() => mod.Bloqueo); setEstado('bloqueado') }
        else setEstado('abierto')
      } catch {
        if (vivo) setEstado('abierto') // cualquier tropiezo: la app se usa igual
      } finally {
        // El resto del arranque nativo (botón atrás, status bar) no bloquea nada.
        import('./nativo').then((m) => m.iniciarNativo()).catch(() => {})
      }
    })()
    return () => { vivo = false }
  }, [])

  if (estado === 'decidiendo')
    return <div className="centrado" style={{ background: 'var(--grad-primary)' }}><div className="spin" /></div>

  if (estado === 'bloqueado' && Bloqueo)
    return <Bloqueo
      onDesbloqueado={() => setEstado('abierto')}
      onSalir={async () => {
        // "Entrar con mi clave": Bloqueo ya desactivó la huella; aquí se revoca
        // la sesión del teléfono (best-effort) y se cae al login.
        try {
          const { api, anotarPurgaCache } = await import('./api')
          // Sin red el /logout no llega al servidor, pero la copia offline se va igual: si no,
          // el siguiente arranque sin señal pintaría los datos del dueño anterior sin pedir nada.
          anotarPurgaCache('todo')
          await api('/logout', { method: 'POST' })
        } catch { /* sin red: el token igual se descarta */ }
        window.dispatchEvent(new Event('aldaba:logout')) // vacía la cache aunque el /logout fallara
        setToken(null)
        setEstado('abierto')
      }}
    />

  return <App />
}

createRoot(document.getElementById('root')!).render(<ToastProvider><Arranque /></ToastProvider>)

if (!EN_APP && 'serviceWorker' in navigator) {
  // SW solo en la PWA web: en nativo los assets ya son locales y su fallback
  // caches.match('/') podría servir un index viejo dentro del WebView.
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

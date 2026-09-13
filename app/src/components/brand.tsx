import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EN_APP } from '../plataforma'

/* Logo = monograma genérico de Aldaba, sobre un badge claro para que luzca en ambos temas. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
      <span aria-label="Aldaba" style={{ fontSize: size * 0.5 }}>A</span>
    </span>
  )
}

const iconoSol = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
const iconoLuna = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

/* Aplica el tema guardado / preferencia del sistema (llamar una vez al arrancar) */
export function aplicarTemaInicial() {
  const guardado = localStorage.getItem('tema')
  const sistema = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = guardado || sistema
}

/* ¿estamos en iOS? (no dispara beforeinstallprompt → hay que guiar al usuario) */
export const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
/* dentro de la app nativa cuenta como "ya instalada": no se ofrece instalar nada */
const yaInstalada = () => EN_APP || matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

const iconoDescarga = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v11M8 10l4 4 4-4M5 20h14" />
  </svg>
)

/* Botón "Instalar app" para el topbar — visible en TODOS los roles.
   Android/Chrome: dispara el instalador nativo. iOS: muestra la guía de "Añadir a inicio". */
export function InstallButton() {
  const [evento, setEvento] = useState<any>((window as any).__bip ?? null)
  const [oculto, setOculto] = useState(yaInstalada())
  const [ayuda, setAyuda] = useState(false)
  useEffect(() => {
    if (yaInstalada()) { setOculto(true); return }
    const h = (e: Event) => { e.preventDefault(); (window as any).__bip = e; setEvento(e) }
    const inst = () => { setOculto(true); (window as any).__bip = null }
    window.addEventListener('beforeinstallprompt', h)
    window.addEventListener('appinstalled', inst)
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', inst) }
  }, [])
  if (oculto) return null // solo se oculta si ya está instalada
  const click = async () => {
    if (evento) {
      evento.prompt()
      const r = await evento.userChoice.catch(() => null)
      if (r?.outcome === 'accepted') setOculto(true)
      ;(window as any).__bip = null; setEvento(null)
    } else setAyuda(true) // sin instalador nativo → mostramos la guía
  }
  return (
    <>
      <button className="btn-install" onClick={click} title="Instalar la app" aria-label="Instalar la aplicación en tu dispositivo">
        {iconoDescarga}<span className="lbl">Instalar app</span>
      </button>
      {ayuda && createPortal(
        <div className="overlay" onClick={() => setAyuda(false)}>
          <div className="sheet" style={{ maxWidth: 430, position: 'relative' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Instalar la app">
            <button className="iconbtn close" style={{ background: 'var(--muted)', color: 'var(--fg)' }} onClick={() => setAyuda(false)} aria-label="Cerrar">✕</button>
            <h3>Instala Aldaba en tu teléfono</h3>
            <p className="sm muted-txt" style={{ marginTop: 10 }}>Es una app web: se instala en un toque, sin pasar por ninguna tienda.</p>
            <div style={{ marginTop: 16 }}>
              <div className="mono-label" style={{ marginBottom: 8 }}>En iPhone (Safari)</div>
              <ol style={{ paddingLeft: 20, display: 'grid', gap: 7, fontSize: '.9rem' }}>
                <li>Toca <b>Compartir</b> <span aria-hidden>⬆︎</span> en la barra inferior.</li>
                <li>Elige <b>«Añadir a pantalla de inicio»</b> y confirma.</li>
              </ol>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="mono-label" style={{ marginBottom: 8 }}>En Android (Chrome)</div>
              <ol style={{ paddingLeft: 20, display: 'grid', gap: 7, fontSize: '.9rem' }}>
                <li>Abre el menú <b>⋮</b> del navegador.</li>
                <li>Toca <b>«Instalar app»</b> o <b>«Añadir a pantalla de inicio»</b>.</li>
              </ol>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/* Botón de cambio claro/oscuro para el topbar */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark') }, [])
  const toggle = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('tema', next)
    setDark(!dark)
  }
  return (
    <button className="iconbtn theme-btn" onClick={toggle} title={dark ? 'Modo claro' : 'Modo oscuro'} aria-label="Cambiar tema claro u oscuro">
      {dark ? iconoSol : iconoLuna}
    </button>
  )
}

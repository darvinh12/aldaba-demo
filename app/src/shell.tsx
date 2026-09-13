import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './components/icons'
import { LogoMark, ThemeToggle, InstallButton } from './components/brand'
import { AjustesApp } from './components/AjustesApp'
import { CambiarClaveSheet } from './components/CambiarClave'
import { apilarVista, useVistaAtras } from './navegacion'
import { EN_APP } from './plataforma'

export type NavItem = { key: string; label: string; ico: string }

/** "hace 5 min", "hace 2 h", "ayer": el usuario tiene que saber SIEMPRE que lo que ve es una
 *  copia guardada y de cuándo, no confundirla con el estado real del edificio. */
function haceCuanto(desde: number): string {
  const min = Math.floor(Math.max(0, Date.now() - desde) / 60000)
  if (min < 1) return 'de hace un momento'
  if (min < 60) return `de hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `de hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'de ayer' : `de hace ${d} días`
}

/** Estado real de la conexión y antigüedad de la copia que se está viendo.
 *
 *  El chip solo puede decir "Sin conexión" cuando una petición falló DE VERDAD por transporte.
 *  Que la app pinte primero la copia guardada mientras revalida no es estar sin conexión: con
 *  señal viva el usuario no debe ver ninguna advertencia, porque el dato fresco llega solo.
 *
 *  - 'aldaba:red'            → una petición terminó: hubo respuesta del servidor o no la hubo.
 *  - 'aldaba:copia'          → se pintó una copia guardada, y de cuándo es.
 *  - 'aldaba:datos-frescos'  → llegó dato fresco: ya no se está viendo una copia.
 *  En web no se dispara ninguno de los dos últimos (la cache es solo de la app nativa). */
function useEstadoDatos(): { sinRed: boolean; copiaDe: number | null } {
  const [sinRed, setSinRed] = useState(false)
  const [copiaDe, setCopiaDe] = useState<number | null>(null)
  const [, redibujar] = useState(0)
  useEffect(() => {
    const red = (e: Event) => setSinRed(!(e as CustomEvent).detail?.viva)
    const copia = (e: Event) => setCopiaDe((e as CustomEvent).detail?.guardadoEn ?? null)
    const fresco = () => setCopiaDe(null)
    window.addEventListener('aldaba:red', red)
    window.addEventListener('aldaba:copia', copia)
    window.addEventListener('aldaba:datos-frescos', fresco)
    // Refresca el texto relativo mientras el chip esté visible (de "hace 1 min" a "hace 2 min").
    const t = setInterval(() => redibujar((n) => n + 1), 60000)
    return () => {
      window.removeEventListener('aldaba:red', red)
      window.removeEventListener('aldaba:copia', copia)
      window.removeEventListener('aldaba:datos-frescos', fresco)
      clearInterval(t)
    }
  }, [])
  return { sinRed, copiaDe }
}

export function Shell({
  brand = 'Aldaba', subtitle, meta, selector, onSalir, nav, activo, setActivo, dark, children, side = true, esDemo = false,
}: {
  brand?: string; subtitle?: string; meta?: ReactNode; selector?: ReactNode; onSalir: () => void
  nav: NavItem[]; activo: string; setActivo: (k: string) => void; dark?: boolean; side?: boolean; children: ReactNode
  /** true solo si el condominio activo tiene es_demo=1. No se usa dentro de Shell: el switcher de roles
   *  se arma en App.tsx y depende solo de rolesDisponibles.length > 1. */
  esDemo?: boolean
}) {
  const activa = nav.find((n) => n.key === activo)
  const { sinRed, copiaDe } = useEstadoDatos()
  const [masOpen, setMasOpen] = useState(false)
  const [ajustesOpen, setAjustesOpen] = useState(false)
  const [claveOpen, setClaveOpen] = useState(false)
  // El botón atrás nativo cierra la hoja "Más" antes de deshacer secciones (en web no cambia nada).
  useVistaAtras(masOpen, () => setMasOpen(false))

  // AL CAMBIAR DE SECCIÓN, ARRIBA DEL TODO.
  // El que scrollea es el documento entero (`.app` es min-height, no un panel con overflow),
  // así que al cambiar `activo` React sustituye el contenido pero el navegador se queda en la
  // misma posición. Viniendo de una sección larga a una corta, el usuario aterrizaba a media
  // pantalla y tenía que subir a mano — pasaba igual en Android y en iPhone.
  // `instant`: una sección nueva no se "desliza" desde donde estaba la anterior, aparece.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [activo])
  // Navegación de secciones consciente del botón atrás: cada cambio apila cómo
  // volver a la sección anterior; atrás las deshace en orden hasta la raíz.
  const irA = (k: string) => {
    if (k !== activo) {
      const previa = activo
      // El tag deduplica: alternar dos secciones N veces deja UNA entrada por sección.
      apilarVista(() => setActivo(previa), `seccion:${previa}`)
    } else {
      // Tocar la sección en la que ya estás sube al principio, como en las apps del sistema.
      // Sin esto no pasaba nada: `activo` no cambia, así que el efecto de abajo no corre y
      // el usuario se quedaba a mitad de una pantalla larga sin forma rápida de volver.
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    setActivo(k)
  }
  // Barra inferior (móvil): si hay más de 5 secciones, mostramos 4 + "Más" para que TODAS sean accesibles.
  const usarMas = nav.length > 5
  const enBarra = usarMas ? nav.slice(0, 4) : nav.slice(0, 5)
  const activoEnMas = usarMas && nav.slice(4).some((n) => n.key === activo)
  return (
    <div className={`app ${dark ? 'guardia' : ''}`}>
      <header className="topbar">
        <div className="row">
          <div className="brand">
            <LogoMark />
            <span>{brand}</span>
          </div>
          {selector}
          <div className="meta">
            {subtitle && <div><b>{subtitle}</b></div>}
            {meta}
          </div>
          {sinRed && (
            <span className="chip pend chip-red" role="status"
              title={copiaDe !== null
                ? `No hay conexión: se muestra la última copia guardada en este teléfono, ${haceCuanto(copiaDe)}.`
                : 'No hay conexión con el servidor. Se reintenta al volver la señal.'}>
              Sin conexión
              {copiaDe !== null && <span className="chip-detalle"> · datos {haceCuanto(copiaDe)}</span>}
            </span>
          )}
          <InstallButton />
          {/* Cambiar clave va en TODAS las plataformas, no solo en la app: los propietarios
              entran mayormente por la web, y la rueda de Ajustes es exclusiva del APK. */}
          <button className="iconbtn" onClick={() => setClaveOpen(true)} title="Cambiar mi clave" aria-label="Cambiar mi clave">
            <Icon name="key" size={18} />
          </button>
          {EN_APP && (
            <button className="iconbtn" onClick={() => setAjustesOpen(true)} title="Ajustes de la app" aria-label="Ajustes de la app">
              <Icon name="gear" size={18} />
            </button>
          )}
          {!dark && <ThemeToggle />}
          <button className="iconbtn" onClick={onSalir} title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
        </div>
      </header>

      <div className={`shell ${side ? 'with-side' : ''}`}>
        {side && (
          <nav className="sidenav" aria-label="Secciones">
            {nav.map((n) => (
              <button key={n.key} className={n.key === activo ? 'active' : ''} onClick={() => irA(n.key)}>
                <span className="ico"><Icon name={n.ico} size={19} /></span>{n.label}
              </button>
            ))}
          </nav>
        )}
        <main className="content">
          <div className={side ? 'wrap-wide' : 'wrap'}>
            {activa && (
              <div className="page-h">
                <h2>{activa.label}</h2>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>

      <nav className={`tabbar ${side ? 'hide-desktop' : ''}`} aria-label="Navegación">
        {enBarra.map((n) => (
          <button key={n.key} className={n.key === activo ? 'active' : ''} onClick={() => irA(n.key)} aria-current={n.key === activo}>
            <span className="ico"><Icon name={n.ico} size={21} /></span>{n.label}
          </button>
        ))}
        {usarMas && (
          <button className={activoEnMas ? 'active' : ''} onClick={() => setMasOpen(true)} aria-label="Más secciones">
            <span className="ico"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></span>Más
          </button>
        )}
      </nav>

      {masOpen && createPortal(
        <div className="overlay" onClick={() => setMasOpen(false)}>
          <div className="sheet menu-sheet" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menú">
            <button className="iconbtn close" style={{ background: 'var(--muted)', color: 'var(--fg)' }} onClick={() => setMasOpen(false)} aria-label="Cerrar">✕</button>
            <h3>Menú</h3>
            <div className="menu-grid">
              {nav.map((n) => (
                <button key={n.key} className={`menu-item ${n.key === activo ? 'on' : ''}`} onClick={() => { setMasOpen(false); irA(n.key) }}>
                  <span className="mi-ico"><Icon name={n.ico} size={20} /></span>{n.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {ajustesOpen && <AjustesApp onClose={() => setAjustesOpen(false)} />}
      {claveOpen && <CambiarClaveSheet onClose={() => setClaveOpen(false)} />}
    </div>
  )
}

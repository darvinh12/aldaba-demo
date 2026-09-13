/** E2.2 — Media protegida visible también dentro de la app nativa.
 *  En el APK una <img src="/api/media/…"> o un <a target="_blank"> no llevan la sesión
 *  (401/403) o abren una pestaña que no existe: aquí todo pasa por mediaBlobUrl(),
 *  que baja el archivo con las cabeceras autenticadas y lo sirve como blob: local. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { mediaBlobUrl } from '../api'
import { useVistaAtras } from '../navegacion'

/** Descarga la media como blob: URL; libera la URL al desmontar o cambiar de key. */
function useMediaBlob(keyMedia: string): { url: string | null; error: string | null } {
  const [estado, setEstado] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    let vivo = true
    let creada: string | null = null
    setEstado({ url: null, error: null })
    mediaBlobUrl(keyMedia)
      .then((u) => {
        if (vivo) { creada = u; setEstado({ url: u, error: null }) }
        else URL.revokeObjectURL(u) // llegó después del desmontaje: no filtrar memoria
      })
      .catch((e) => { if (vivo) setEstado({ url: null, error: (e as Error).message }) })
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada) }
  }, [keyMedia])
  return estado
}

/** Imagen protegida embebida: placeholder mientras baja, error legible si falla. */
export function ImagenMedia({ keyMedia, alt, className, style }: {
  keyMedia: string; alt: string; className?: string; style?: React.CSSProperties
}) {
  const { url, error } = useMediaBlob(keyMedia)
  if (error) return (
    <div className={className} role="img" aria-label={alt}
      style={{ display: 'grid', placeItems: 'center', minHeight: 90, padding: 12, borderRadius: 12, background: 'var(--muted)', color: 'var(--sub)', fontSize: '.8rem', textAlign: 'center', ...style }}>
      No se pudo cargar la imagen ({error})
    </div>
  )
  if (!url) return (
    <div className={className} aria-hidden
      style={{ display: 'grid', placeItems: 'center', minHeight: 90, borderRadius: 12, background: 'var(--muted)', color: 'var(--sub)', fontSize: '.8rem', ...style }}>
      Cargando…
    </div>
  )
  return <img src={url} alt={alt} className={className} style={style} />
}

/** Visor a pantalla completa. Va por createPortal a document.body: un ancestro con
 *  backdrop-filter (topbar/tarjetas) atrapa position:fixed y encoge el modal (ya nos
 *  pasó en 41af452). Cierra con clic fuera, botón ✕ o Escape. */
export function VisorMedia({ keyMedia, onCerrar }: { keyMedia: string; onCerrar: () => void }) {
  const { url, error } = useMediaBlob(keyMedia)
  const esPdf = /\.pdf$/i.test(keyMedia) // la key conserva el nombre original del archivo
  useVistaAtras(true, onCerrar) // botón atrás nativo cierra el visor, no la app
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar])
  return createPortal(
    <div className="overlay" style={{ zIndex: 90, alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onCerrar} role="dialog" aria-modal="true" aria-label="Archivo adjunto">
      <button className="iconbtn" aria-label="Cerrar" onClick={onCerrar}
        style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 14px)', right: 14, zIndex: 1, background: 'rgba(255,255,255,.18)', color: '#fff' }}>✕</button>
      {error
        ? <div style={{ color: '#fff', textAlign: 'center', padding: 20 }}>No se pudo cargar el archivo ({error})</div>
        : !url
          ? <div style={{ color: '#fff' }}>Cargando…</div>
          : esPdf
            ? <iframe src={url} title="Documento adjunto" onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', height: '90%', maxWidth: 900, border: 0, borderRadius: 12, background: '#fff' }} />
            : <img src={url} alt="Archivo adjunto" onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '100%', maxHeight: '92%', objectFit: 'contain', borderRadius: 12 }} />}
    </div>,
    document.body
  )
}

/** Estilo de "enlace" para botones que antes eran <a> (mismo color de link del tema). */
export const estiloEnlace: React.CSSProperties = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--brand)', cursor: 'pointer' }

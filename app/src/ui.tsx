import { createContext, useContext, useState, useCallback, useEffect, type ReactNode, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './components/icons'
import { useVistaAtras } from './navegacion'

/* ---------- Toasts ---------- */
type Toast = { id: number; msg: ReactNode; kind: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(msg: ReactNode, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((msg: ReactNode, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, msg, kind }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'ok' ? 'ok' : ''}`}>
            <span>{t.kind === 'ok' ? '✓' : t.kind === 'err' ? '⚠' : 'ℹ'}</span><span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- Sheet / Modal ---------- */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // En la app nativa el botón atrás cierra la hoja (pila de navegacion.ts); en web no cambia nada.
  useVistaAtras(true, onClose)
  // createPortal a document.body: un ancestro con backdrop-filter o transform (topbar,
  // tarjetas .lab, Tilt) atrapa position:fixed y encoge el modal (ya nos pasó en 41af452).
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <button className="iconbtn close" style={{ background: 'var(--muted)', color: 'var(--fg)' }} onClick={onClose} aria-label="Cerrar">✕</button>
        <h3>{title}</h3>
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>,
    document.body
  )
}

/* ---------- KPI ---------- */
export function Kpi({ label, val, delta, tint, ico }: { label: string; val: ReactNode; delta?: { txt: string; up?: boolean }; tint?: string; ico?: string }) {
  return (
    <div className={`kpi ${tint ? 'tint-' + tint : ''}`}>
      <div className="label">{ico && <Icon name={ico} size={13} className="ico" />}{label}</div>
      <div className="val">{val}</div>
      {delta && <div className={`delta ${delta.up ? 'up' : 'down'}`}>{delta.up ? '▲' : '▼'} {delta.txt}</div>}
    </div>
  )
}

/* ---------- Empty state ---------- */
export function Empty({ ico = '📭', children }: { ico?: string; children: ReactNode }) {
  return <div className="empty"><div className="ico"><Icon name={ico} size={30} /></div><p>{children}</p></div>
}

/* ---------- Progress bar ---------- */
export function Bar({ pct, green }: { pct: number; green?: boolean }) {
  return <div className={`bar ${green ? 'green' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
}

/* ---------- Async submit button ---------- */
export function SubmitBtn({ children, loading, className = 'btn btn-primary block', ...rest }:
  { children: ReactNode; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={className} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spin" /> : children}
    </button>
  )
}

/* ---------- Módulo aún no construido (navegable) ---------- */
export function EnConstruccion({ modulo, ico, detalle }: { modulo: string; ico: string; detalle: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ fontSize: '3rem', marginBottom: 10 }}>{ico}</div>
      <h3 style={{ justifyContent: 'center' }}>{modulo}</h3>
      <p className="muted-txt sm" style={{ maxWidth: 420, margin: '8px auto 0' }}>{detalle}</p>
      <div style={{ marginTop: 16 }}><span className="badge-soft">En construcción</span></div>
    </div>
  )
}

/* Glow que sigue el cursor sobre el fondo .lab (firma visual del tema) */
export function GlowSpot() {
  useEffect(() => {
    const el = document.querySelector('.lab') as HTMLElement | null
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  return null
}

/* helper: hook para manejar submit async con loading */
export function useAsync() {
  const [loading, setLoading] = useState(false)
  const run = useCallback(async (fn: () => Promise<void>, e?: FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    try { await fn() } finally { setLoading(false) }
  }, [])
  return { loading, run }
}

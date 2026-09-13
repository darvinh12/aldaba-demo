import { useEffect, useRef, useState } from 'react'
import { LogoMark } from './brand'
import { Aurora, CornerMarks } from './effects'
import { desactivarBiometria, pedirDesbloqueo } from '../biometria'

/** Pantalla de bloqueo de la app nativa: hay sesión guardada y el usuario dejó
 *  activado "entrar con huella", así que antes de mostrar nada se le pide el gesto.
 *
 *  - onDesbloqueado: la biometría pasó → el integrador muestra la app.
 *  - onSalir (opcional): "Entrar con mi clave". Si no se pasa, el componente
 *    desactiva la biometría, cierra la sesión local (evento 'aldaba:logout',
 *    que api.ts ya escucha para invalidar el token) y App cae sola al login.
 *
 *  Al montarse dispara el diálogo biométrico una vez; si el usuario cancela o
 *  falla, queda el botón grande para reintentar las veces que haga falta. */
export function Bloqueo({ onDesbloqueado, onSalir }: { onDesbloqueado: () => void; onSalir?: () => void }) {
  const [pidiendo, setPidiendo] = useState(false)
  const [fallo, setFallo] = useState(false)
  const botonRef = useRef<HTMLButtonElement>(null)
  const autoLanzado = useRef(false) // StrictMode monta dos veces: un solo diálogo automático

  const desbloquear = async () => {
    if (pidiendo) return
    setPidiendo(true)
    const ok = await pedirDesbloqueo()
    setPidiendo(false)
    if (ok) { onDesbloqueado(); return }
    setFallo(true)
    botonRef.current?.focus() // el foco vuelve al reintento tras cerrar el diálogo del sistema
  }

  useEffect(() => {
    if (autoLanzado.current) return
    autoLanzado.current = true
    void desbloquear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const salir = async () => {
    await desactivarBiometria()
    if (onSalir) onSalir()
    else window.dispatchEvent(new Event('aldaba:logout'))
  }

  return (
    <div className="centrado lab" role="dialog" aria-modal="true" aria-label="Aldaba bloqueada">
      <Aurora />
      <div className="auth-wrap">
        <div className="card corner-marks" style={{ padding: 30, textAlign: 'center' }}>
          <CornerMarks />
          <div className="eyebrow" style={{ marginBottom: 18 }}>Aldaba</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><LogoMark size={54} /></div>
          <div style={{ fontFamily: 'var(--font-h)', fontWeight: 600, fontSize: '1.5rem', letterSpacing: '-.04em', color: '#fff' }}>Aldaba</div>
          <p className="muted-txt" style={{ margin: '6px 0 22px', fontSize: '.88rem' }}>
            Tu sesión está protegida. Usa tu huella para entrar.
          </p>

          {/* El resultado del intento se anuncia también a lectores de pantalla */}
          <p role="status" aria-live="polite" style={{ minHeight: 20, margin: '0 0 14px', fontSize: '.82rem', color: fallo ? '#fca5a5' : 'var(--faint)' }}>
            {pidiendo ? 'Esperando tu huella…' : fallo ? 'No se pudo verificar. Inténtalo otra vez.' : ''}
          </p>

          <button ref={botonRef} className="btn btn-primary block" onClick={desbloquear} disabled={pidiendo} autoFocus
            style={{ padding: '15px 20px', fontSize: '1rem' }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6.5 4.6A9 9 0 0 1 21 11.7c0 2.5-.3 4.9-1 7.2" />
              <path d="M3.7 8A9 9 0 0 0 3 11.7c0 2.2 1.1 3.3 1.1 5.4" />
              <path d="M17.4 11.7a5.4 5.4 0 0 0-10.8 0c0 2.9-.6 5-1.6 6.9" />
              <path d="M13.8 11.7c0 3.6-.8 6.5-2.2 9.1" />
              <path d="M10.2 11.7a1.8 1.8 0 0 1 3.6 0" transform="translate(0 .2)" />
            </svg>
            {fallo ? 'Reintentar con huella' : 'Desbloquear con huella'}
          </button>

          <button className="btn btn-ghost block" onClick={salir} style={{ marginTop: 10 }}>
            Entrar con mi clave
          </button>
          <p className="muted-txt xs" style={{ marginTop: 12 }}>
            Entrar con la clave cierra esta sesión y desactiva la huella hasta que la vuelvas a activar.
          </p>
        </div>
      </div>
    </div>
  )
}

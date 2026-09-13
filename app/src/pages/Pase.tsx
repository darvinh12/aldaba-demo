import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { fechaUtc } from '../api'
import { API_BASE, PUBLIC_ORIGIN } from '../plataforma'
import { Aurora, CornerMarks } from '../components/effects'
import { formatearCodigo } from '../codigo'

export function Pase() {
  const token = location.pathname.split('/pase/')[1] ?? ''
  const [info, setInfo] = useState<any>(null)
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')
  useEffect(() => {
    fetch(`${API_BASE}/api/accesos/pase-info/${token}`).then((r) => r.json()).then((d) => {
      if ((d as any).error) setError((d as any).error); else setInfo(d)
    }).catch(() => setError('No se pudo cargar el pase'))
    QRCode.toDataURL(`${PUBLIC_ORIGIN}/pase/${token}`, { width: 240, margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } }).then(setQr).catch(() => {})
  }, [token])

  if (error) return <div className="centrado lab"><Aurora /><div className="card auth-wrap corner-marks" style={{ textAlign: 'center' }}><CornerMarks /><div style={{ fontSize: '2.2rem' }}>🎫</div><p className="muted-txt" style={{ marginTop: 8 }}>{error}</p></div></div>
  if (!info) return <div className="centrado lab" style={{ color: '#fff' }}><Aurora /><div className="spin" /></div>
  const inactivo = info.vencido || info.usado
  return (
    <div className="centrado lab">
      <Aurora />
      <div className="card auth-wrap corner-marks" style={{ textAlign: 'center', padding: 28 }}>
        <CornerMarks />
        <div className="eyebrow" style={{ justifyContent: 'center', marginBottom: 8 }}>Aldaba · Pase</div>
        <h2 style={{ fontSize: '1.4rem', margin: '10px 0 2px' }}>{info.visitante}</h2>
        <p className="muted-txt sm">{info.condominio}{info.unidad ? ` · ${info.unidad}` : ''}</p>
        <div style={{ margin: '18px auto', width: 240, height: 240, display: 'grid', placeItems: 'center', background: '#fff', borderRadius: 16, border: '1px solid var(--border)', filter: inactivo ? 'grayscale(1) opacity(.4)' : 'none' }}>
          {qr ? <img src={qr} alt="Código QR del pase" width={224} height={224} /> : <div className="spin dark" />}
        </div>
        {inactivo
          ? <span className="chip off">{info.usado ? 'Pase ya utilizado' : 'Pase vencido'}</span>
          : <span className="chip ok">✓ Pase activo</span>}
        {/* El código es el plan B del visitante: si la cámara de la portería no enfoca, lo dicta. */}
        {info.codigo && !inactivo && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ justifyContent: 'center' }}>o dicta este código</div>
            <div style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 30, fontWeight: 600, letterSpacing: '.16em', color: '#fff', marginTop: 4 }}>
              {formatearCodigo(info.codigo)}
            </div>
          </div>
        )}
        <div className="stack sm muted-txt" style={{ marginTop: 16, textAlign: 'left', gap: 6 }}>
          <div className="row between"><span>Anfitrión</span><b style={{ color: '#fff' }}>{info.anfitrion}</b></div>
          <div className="row between"><span>Tipo</span><b style={{ color: '#fff' }}>{info.tipo === 'recurrente' ? 'Recurrente' : 'Un solo uso'}</b></div>
          {info.ventana && <div className="row between"><span>Ventana</span><b style={{ color: '#fff' }}>{info.ventana}</b></div>}
          <div className="row between"><span>Válido hasta</span><b style={{ color: '#fff' }}>{fechaUtc(info.expira).toLocaleString('es-VE')}</b></div>
        </div>
        <p className="muted-txt xs" style={{ marginTop: 16 }}>Muestra este código en la portería. Aldaba</p>
      </div>
    </div>
  )
}

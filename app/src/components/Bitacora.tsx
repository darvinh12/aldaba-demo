import { useEffect, useState } from 'react'
import { apiVivo, fechaUtc } from '../api'
import { useToast, Empty } from '../ui'
import { Icon } from './icons'
import { VisorMedia } from './Media'

const ESTADO_CHIP: Record<string, string> = { ingreso: 'ok', denegado: 'off', pendiente: 'pend' }
const TIPO_TXT: Record<string, string> = { qr: 'Ingreso QR', sincita: 'Sin cita', delivery: 'Delivery' }

export function Bitacora() {
  const [log, setLog] = useState<any[]>([])
  const [verFoto, setVerFoto] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => { apiVivo('/accesos/bitacora', (d: any) => setLog(d.bitacora)).catch((e) => toast(e.message, 'err')) }, [])
  const csv = () => {
    const filas = [['Fecha', 'Tipo', 'Estado', 'Persona', 'Unidad', 'Guardia'].join(',')]
    log.forEach((r) => filas.push([fechaUtc(r.creada).toLocaleString('es-VE'), TIPO_TXT[r.tipo] ?? r.tipo, r.estado, r.visitante, r.unidad ?? '', r.guardia ?? ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')))
    const blob = new Blob([filas.join('\n')], { type: 'text/csv' })
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = u; a.download = 'bitacora-accesos.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(u), 4000) // liberar tras iniciar la descarga
  }
  return (
    <div className="card">
      <div className="card-head"><h3><Icon name="shield" className="h-ico" />Bitácora de accesos</h3>
        {!!log.length && <button className="chip info spacer" onClick={csv}>Exportar CSV</button>}</div>
      {!log.length && <Empty ico="🛡️">Aún no hay registros de acceso.</Empty>}
      {log.map((r, i) => (
        <div className="list-item" key={i}>
          <div className="li-ico" style={{ background: r.estado === 'denegado' ? 'var(--danger-bg)' : undefined, color: r.estado === 'denegado' ? 'var(--danger)' : undefined }}>
            <Icon name={r.tipo === 'delivery' ? 'cart' : r.tipo === 'sincita' ? 'bell' : 'ticket'} /></div>
          <div className="li-body">
            <div className="li-title">{r.visitante} <span className={`chip ${ESTADO_CHIP[r.estado] ?? 'neutral'}`}>{r.estado}</span></div>
            <div className="li-sub">{TIPO_TXT[r.tipo] ?? r.tipo}{r.unidad ? ` · ${r.unidad}` : ''}{r.guardia ? ` · ${r.guardia}` : ''} · {fechaUtc(r.creada).toLocaleString('es-VE')}</div>
          </div>
          {r.foto_key && <button className="chip info" onClick={() => setVerFoto(r.foto_key)}>Foto</button>}
        </div>
      ))}
      {verFoto && <VisorMedia keyMedia={verFoto} onCerrar={() => setVerFoto(null)} />}
    </div>
  )
}

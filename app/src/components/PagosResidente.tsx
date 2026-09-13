import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { api, apiVivo, conError, subirArchivo, usd, fechaUtc } from '../api'
import { useToast, Empty, SubmitBtn, useAsync } from '../ui'
import { CampoArchivo } from './CampoArchivo'
import { imprimirRecibo } from './recibo'

const METODOS = [['pago_movil', 'Pago móvil'], ['transferencia', 'Transferencia'], ['zelle', 'Zelle'], ['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta']] as const
const chipEstado = (e: string) => e === 'aprobado' ? 'ok' : e === 'rechazado' ? 'off' : 'pend'

export function PagosResidente() {
  const [ec, setEc] = useState<any>(null)
  const [cuotas, setCuotas] = useState<any[]>([])
  const [pagos, setPagos] = useState<any[]>([])
  const [f, setF] = useState({ monto: '', metodo: 'pago_movil', referencia: '' })
  const [comp, setComp] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => {
    apiVivo('/finanzas/estado-cuenta', setEc).catch(() => {})
    apiVivo('/finanzas/cuotas', (d: any) => setCuotas(d.cuotas)).catch(() => {})
    apiVivo('/finanzas/pagos', (d: any) => setPagos(d.pagos)).catch(() => {})
  }
  useEffect(() => { cargar() }, [])
  const subir = async (file?: File) => {
    if (!file) return
    setSubiendo(true)
    try { setComp(await subirArchivo(file)); toast('Comprobante adjuntado', 'ok') }
    catch (e) { toast(`No se pudo subir: ${(e as Error).message}`, 'err') }
    finally { setSubiendo(false) }
  }
  const reportar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/finanzas/pagos', { method: 'POST', body: JSON.stringify({ monto: Number(f.monto), metodo: f.metodo, referencia: f.referencia, comprobante_key: comp }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Pago reportado — pendiente de verificación', 'ok')
    setF({ monto: '', metodo: 'pago_movil', referencia: '' }); setComp(null); cargar()
  }, e)
  const tasa = ec?.tasa_bs || 0
  const saldoBs = tasa ? ` · Bs ${(ec.saldo * tasa).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : ''
  return (
    <>
      <div className="card hero">
        <div className="badge-soft" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>Estado de cuenta</div>
        <div className="big" style={{ margin: '12px 0 2px' }}>{ec ? usd(ec.saldo) : '—'}</div>
        <div className="sm" style={{ opacity: .95 }}>Saldo pendiente{ec && saldoBs}</div>
        {ec && <div className="row" style={{ gap: 18, marginTop: 12, fontSize: '.8rem', opacity: .95, flexWrap: 'wrap' }}>
          <span>Facturado {usd(ec.facturado)}</span><span>Pagado {usd(ec.pagado)}</span>
          {ec.multas > 0 && <span>Multas {usd(ec.multas)}</span>}
        </div>}
      </div>

      <div className="card">
        <h3><Icon name="card" className="h-ico" />Reportar un pago</h3>
        <form onSubmit={reportar} className="stack">
          <div className="grid2">
            <div className="field"><label>Monto (USD)</label><input className="inp" type="number" step="0.01" min="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>
            <div className="field"><label>Método</label>
              <select className="inp" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>
                {METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
          </div>
          <div className="field"><label>Referencia / N° de confirmación</label><input className="inp" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} placeholder="Ej. 00123456" /></div>
          <CampoArchivo etiqueta="Comprobante (captura)" nombreBase="comprobante" onArchivo={subir}
            onError={(m) => toast(m, 'err')} subiendo={subiendo} adjunto={!!comp} textoAdjunto="Comprobante adjuntado" />
          <SubmitBtn loading={loading} className="btn btn-primary block">Reportar pago</SubmitBtn>
        </form>
      </div>

      <div className="card">
        <h3><Icon name="receipt" className="h-ico" />Mis cuotas</h3>
        {!cuotas.length && <Empty ico="🧾">Aún no tienes cuotas emitidas.</Empty>}
        {cuotas.map((q) => (
          <div className="list-item" key={q.id}>
            <div className="li-body"><div className="li-title">{q.concepto}</div><div className="li-sub">{q.periodo}</div></div>
            <b>{usd(q.monto_usd)}</b>
          </div>
        ))}
      </div>

      {!!ec?.susMultas?.length && (
        <div className="card">
          <h3><Icon name="scale" className="h-ico" />Multas y amonestaciones</h3>
          {ec.susMultas.map((m: any, i: number) => (
            <div className="list-item" key={i}>
              <div className="li-ico" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><Icon name={m.tipo === 'multa' ? 'scale' : 'alert'} /></div>
              <div className="li-body">
                <div className="li-title">{m.motivo} {m.estado === 'anulada' && <span className="chip neutral">anulada</span>}</div>
                <div className="li-sub">{m.tipo === 'multa' ? usd(m.monto_usd) : 'amonestación'} · {fechaUtc(m.creada).toLocaleDateString('es-VE')}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3><Icon name="calendar" className="h-ico" />Mis pagos reportados</h3>
        {!pagos.length && <Empty ico="📭">Todavía no has reportado pagos.</Empty>}
        {pagos.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="li-body">
              <div className="li-title">{usd(p.monto_usd)} · {p.metodo.replace('_', ' ')}</div>
              <div className="li-sub">{fechaUtc(p.creada).toLocaleDateString('es-VE')}{p.motivo ? ` · ${p.motivo}` : ''}</div>
            </div>
            <div className="li-actions">
              <span className={`chip ${chipEstado(p.estado)}`}>{p.estado}</span>
              {p.estado === 'aprobado' && <button className="chip info" onClick={() => imprimirRecibo(p.id, (m) => toast(m, 'err'))} title="Descargar recibo"><Icon name="receipt" size={14} /></button>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

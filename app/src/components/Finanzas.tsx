import { useEffect, useState } from 'react'
import { api, apiVivo, conError, subirArchivo, usd, fechaUtc } from '../api'
import { useToast, Empty, SubmitBtn, useAsync, Sheet } from '../ui'
import { Icon } from './icons'
import { AreaLine, Donut, Gauge, BarsH, StatTile, COLORS } from './charts'
import { VisorMedia, estiloEnlace } from './Media'
import { CampoArchivo } from './CampoArchivo'

const CATS = ['vigilancia', 'limpieza', 'mantenimiento', 'servicios', 'administracion', 'fondo', 'otro']
const mesActual = () => new Date().toISOString().slice(0, 7)
const hoy = () => new Date().toISOString().slice(0, 10)

export function Finanzas() {
  const [tab, setTab] = useState<'resumen' | 'cuotas' | 'conciliacion' | 'egresos' | 'multas'>('resumen')
  return (
    <>
      <div className="seg">
        {([['resumen', 'dashboard', 'Resumen'], ['cuotas', 'receipt', 'Cuotas'], ['conciliacion', 'check', 'Conciliar'], ['egresos', 'expense', 'Egresos'], ['multas', 'scale', 'Multas']] as const).map(([k, ic, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon name={ic} size={13} style={{ marginRight: 6, verticalAlign: '-2px', opacity: .7 }} />{l}</button>
        ))}
      </div>
      {tab === 'resumen' && <Resumen />}
      {tab === 'cuotas' && <Cuotas />}
      {tab === 'conciliacion' && <Conciliacion />}
      {tab === 'egresos' && <Egresos />}
      {tab === 'multas' && <Multas />}
    </>
  )
}

function Multas() {
  const [f, setF] = useState({ unidad_id: '', tipo: 'multa', motivo: '', monto: '' })
  const [unidades, setUnidades] = useState<any[]>([])
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/finanzas/multas', (d: any) => setLista(d.multas)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { apiVivo('/estructura', (d: any) => setUnidades([...d.torres.flatMap((t: any) => t.unidades), ...(d.sinTorre ?? [])])).catch(() => {}); cargar() }, [])
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/finanzas/multas', { method: 'POST', body: JSON.stringify({ ...f, monto: Number(f.monto) }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast(f.tipo === 'multa' ? 'Multa aplicada' : 'Amonestación registrada', 'ok'); setF({ unidad_id: '', tipo: 'multa', motivo: '', monto: '' }); cargar()
  }, e)
  const anular = async (id: string) => { const r = await conError(() => api(`/finanzas/multas/${id}/anular`, { method: 'POST' }), (m) => toast(m, 'err')); if (r !== undefined) { toast('Registro anulado', 'ok'); cargar() } }
  const pagar = async (id: string) => { const r = await conError(() => api(`/finanzas/multas/${id}/pagar`, { method: 'POST' }), (m) => toast(m, 'err')); if (r !== undefined) { toast('Multa marcada como pagada', 'ok'); cargar() } }
  return (
    <>
      <div className="card">
        <h3><Icon name="scale" className="h-ico" />Aplicar multa o amonestación</h3>
        <form onSubmit={crear} className="stack">
          <div className="seg" style={{ margin: 0 }}>
            <button type="button" className={f.tipo === 'multa' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'multa' })}>Multa (con monto)</button>
            <button type="button" className={f.tipo === 'amonestacion' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'amonestacion' })}>Amonestación</button>
          </div>
          <div className="grid2">
            <div className="field"><label>Unidad</label>
              <select className="inp" value={f.unidad_id} onChange={(e) => setF({ ...f, unidad_id: e.target.value })} required>
                <option value="">— seleccionar —</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select></div>
            {f.tipo === 'multa' && <div className="field"><label>Monto (USD)</label><input className="inp" type="number" min="0" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>}
          </div>
          <div className="field"><label>Motivo</label><input className="inp" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Ruido nocturno, mascota sin correa…" required /></div>
          <SubmitBtn loading={loading} className="btn btn-primary block">{f.tipo === 'multa' ? 'Aplicar multa' : 'Registrar amonestación'}</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Historial</h3>
        {!lista.length && <Empty ico="⚖️">Sin multas ni amonestaciones.</Empty>}
        {lista.map((m) => (
          <div className="list-item" key={m.id}>
            <div className="li-ico" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><Icon name={m.tipo === 'multa' ? 'scale' : 'alert'} /></div>
            <div className="li-body"><div className="li-title">{m.unidad} · {m.motivo} {m.estado === 'anulada' && <span className="chip neutral">anulada</span>}{m.estado === 'pagada' && <span className="chip ok">pagada</span>}</div>
              <div className="li-sub">{m.tipo === 'multa' ? usd(m.monto_usd) : 'amonestación'} · {fechaUtc(m.creada).toLocaleDateString('es-VE')}</div></div>
            {m.estado === 'activa' && <div className="li-actions">
              {m.tipo === 'multa' && <button className="chip ok" onClick={() => pagar(m.id)}>Pagada</button>}
              <button className="chip off" onClick={() => anular(m.id)}>Anular</button>
            </div>}
          </div>
        ))}
      </div>
    </>
  )
}

function Resumen() {
  const [s, setS] = useState<any>(null)
  const [serie, setSerie] = useState<any[]>([])
  const [editT, setEditT] = useState(false), [tasa, setTasa] = useState('')
  const toast = useToast()
  const aplicar = (d: any) => { setS(d); setTasa(String(d.tasa_bs || 0)) }
  // Lectura viva: si el primer render sale de la copia offline, la revalidación vuelve a entrar
  // por `aplicar` en cuanto responde el servidor. Dinero a la vista: no puede quedarse viejo
  // esperando a que alguien recargue a mano.
  const cargar = () => apiVivo('/finanzas/resumen', aplicar).catch((e) => toast(e.message, 'err'))
  useEffect(() => {
    cargar()
    apiVivo('/finanzas/series', (d: any) => setSerie(d?.series ?? [])).catch(() => {})
  }, [])
  const guardarTasa = async () => {
    const r = await conError(() => api('/finanzas/tasa', { method: 'PATCH', body: JSON.stringify({ tasa_bs: Number(tasa) }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Tasa actualizada', 'ok'); setEditT(false); cargar() }
  }
  if (!s) return <div className="card"><div className="spin dark" /></div>
  return (
    <div className="bi">
      <StatTile className="c3" label="Facturado" value={usd(s.facturado)} ico={<Icon name="receipt" size={13} className="ico" />} spark={serie.map((x) => x.facturado)} />
      <StatTile className="c3" label="Cobrado" value={usd(s.cobrado)} ico={<Icon name="coins" size={13} className="ico" />} spark={serie.map((x) => x.cobrado)} />
      <StatTile className="c3" label="Egresos" value={usd(s.egresos)} ico={<Icon name="expense" size={13} className="ico" />} spark={serie.map((x) => x.egresos)} />
      <StatTile className="c3" label="Capital / fondo" value={usd(s.capital)} ico={<Icon name="coins" size={13} className="ico" />} />

      <div className="panel c4">
        <div className="panel-h"><Icon name="dashboard" size={15} style={{ opacity: .5 }} /><span className="t">Recaudación</span></div>
        <Gauge value={s.recaudacion} sub={`${usd(s.cobrado)} de ${usd(s.facturado)}`} id="fin" />
        <div className="row between xs muted-txt" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span>Por conciliar: {s.porConciliar.n} ({usd(s.porConciliar.monto)})</span>
          {editT ? (
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              Tasa Bs <input className="inp" style={{ width: 84, padding: '2px 6px', height: 28 }} type="number" min="0" step="0.01" value={tasa}
                onChange={(e) => setTasa(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && guardarTasa()} autoFocus />
              <button className="chip ok" onClick={guardarTasa}>OK</button>
              <button className="chip neutral" onClick={() => { setEditT(false); setTasa(String(s.tasa_bs || 0)) }}>✕</button>
            </span>
          ) : (
            <button className="chip neutral" onClick={() => setEditT(true)} title="Editar la tasa Bs/USD">Tasa Bs {s.tasa_bs || 0} · editar</button>
          )}
        </div>
      </div>

      <div className="panel c8">
        <div className="panel-h"><Icon name="dashboard" size={15} style={{ opacity: .5 }} /><span className="t">Tendencia mensual</span>
          <span className="s spacer">últimos {serie.length || 0} {serie.length === 1 ? 'mes' : 'meses'} · USD</span></div>
        <AreaLine series={serie} lines={[
          { key: 'facturado', color: COLORS[0], label: 'Facturado' },
          { key: 'cobrado', color: COLORS[5], label: 'Cobrado' },
          { key: 'egresos', color: COLORS[3], label: 'Egresos' },
        ]} />
      </div>

      <div className="panel c6">
        <div className="panel-h"><Icon name="expense" size={15} style={{ opacity: .5 }} /><span className="t">Egresos por categoría</span></div>
        <Donut data={(s.gastosPorCategoria ?? []).map((g: any) => ({ label: g.categoria, value: g.monto }))} />
      </div>

      <div className="panel c6">
        <div className="panel-h"><Icon name="alert" size={15} style={{ opacity: .5 }} /><span className="t">Morosidad</span>
          <span className="s spacer">{s.morosos} unidades · {usd(s.morosidad)}</span></div>
        <BarsH data={(s.topMorosos ?? []).map((m: any) => ({ label: m.nombre, value: m.saldo, id: m.id }))} />
      </div>
    </div>
  )
}

function Cuotas() {
  const [f, setF] = useState({ periodo: mesActual(), concepto: 'Cuota de condominio', modo: 'fijo', valor: '' })
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  const ver = (p: string) => apiVivo(`/finanzas/cuotas?periodo=${p}`, (d: any) => setLista(d.cuotas)).catch(() => {})
  useEffect(() => { ver(f.periodo) }, [])
  const emitir = (e: React.FormEvent) => run(async () => {
    const body: any = { periodo: f.periodo, concepto: f.concepto, modo: f.modo }
    if (f.modo === 'alicuota') body.base = Number(f.valor); else body.monto = Number(f.valor)
    const r = await conError(() => api('/finanzas/cuotas', { method: 'POST', body: JSON.stringify(body) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast(`${r.emitidas} cuotas emitidas para ${f.periodo}`, 'ok'); ver(f.periodo)
  }, e)
  const anular = async (id: string) => {
    if (!confirm('¿Anular esta cuota? Se eliminará del período.')) return
    const r = await conError(() => api(`/finanzas/cuotas/${id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Cuota anulada', 'ok'); ver(f.periodo) }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="receipt" className="h-ico" />Emitir cuotas</h3>
        <form onSubmit={emitir} className="stack">
          <div className="grid2">
            <div className="field"><label>Período</label><input className="inp" type="month" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} required /></div>
            <div className="field"><label>Concepto</label><input className="inp" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} /></div>
          </div>
          <div className="seg" style={{ margin: 0 }}>
            <button type="button" className={f.modo === 'fijo' ? 'active' : ''} onClick={() => setF({ ...f, modo: 'fijo' })}>Monto igual</button>
            <button type="button" className={f.modo === 'alicuota' ? 'active' : ''} onClick={() => setF({ ...f, modo: 'alicuota' })}>Por alícuota</button>
          </div>
          <div className="field">
            <label>{f.modo === 'alicuota' ? 'Base a repartir (USD) — cada unidad paga base × alícuota' : 'Monto por unidad (USD)'}</label>
            <input className="inp" type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} required />
          </div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Emitir a todas las unidades</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <div className="card-head"><h3>Cuotas de {f.periodo}</h3>
          <input className="inp spacer" style={{ width: 150 }} type="month" value={f.periodo} onChange={(e) => { setF({ ...f, periodo: e.target.value }); ver(e.target.value) }} /></div>
        {!lista.length && <Empty ico="🧾">Sin cuotas en este período.</Empty>}
        {lista.map((q) => (
          <div className="list-item" key={q.id}>
            <div className="li-body"><div className="li-title">{q.unidad}</div><div className="li-sub">{q.concepto}</div></div>
            <b>{usd(q.monto_usd)}</b>
            <button className="chip off" onClick={() => anular(q.id)}>Anular</button>
          </div>
        ))}
      </div>
    </>
  )
}

const METODOS_PAGO = [['pago_movil', 'Pago móvil'], ['transferencia', 'Transferencia'], ['zelle', 'Zelle'], ['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta']] as const

function RegistrarPagoRecibido({ onDone }: { onDone: () => void }) {
  const [unidades, setUnidades] = useState<any[]>([])
  const [f, setF] = useState({ unidad_id: '', monto: '', metodo: 'efectivo', referencia: '' })
  const toast = useToast(); const { loading, run } = useAsync()
  useEffect(() => { apiVivo('/estructura', (d: any) => setUnidades([
    ...d.torres.flatMap((t: any) => (t.unidades ?? []).map((u: any) => ({ ...u, torre: t.nombre }))),
    ...(d.sinTorre ?? []).map((u: any) => ({ ...u, torre: '' })),
  ])).catch(() => {}) }, [])
  const registrar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/finanzas/pagos-admin', { method: 'POST', body: JSON.stringify({ unidad_id: f.unidad_id, monto: Number(f.monto), metodo: f.metodo, referencia: f.referencia }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Pago registrado y aprobado', 'ok'); setF({ unidad_id: '', monto: '', metodo: 'efectivo', referencia: '' }); onDone()
  }, e)
  return (
    <div className="card">
      <h3><Icon name="card" className="h-ico" />Registrar pago recibido <span className="sub">efectivo o directo</span></h3>
      <form onSubmit={registrar} className="stack">
        <div className="field"><label>Unidad</label>
          <select className="inp" value={f.unidad_id} onChange={(e) => setF({ ...f, unidad_id: e.target.value })} required>
            <option value="">— seleccionar —</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.torre ? `${u.torre} · ${u.nombre}` : u.nombre}</option>)}
          </select></div>
        <div className="grid2">
          <div className="field"><label>Monto (USD)</label><input className="inp" type="number" min="0.01" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>
          <div className="field"><label>Método</label>
            <select className="inp" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>
              {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
        <div className="field"><label>Referencia (opcional)</label><input className="inp" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} placeholder="N° de recibo, confirmación…" /></div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Registrar pago</SubmitBtn>
      </form>
    </div>
  )
}

function Conciliacion() {
  const [pagos, setPagos] = useState<any[]>([])
  const [aprobados, setAprobados] = useState<any[]>([])
  const [verComp, setVerComp] = useState<string | null>(null)
  const toast = useToast()
  const cargar = () => {
    apiVivo('/finanzas/pagos?estado=reportado', (d: any) => setPagos(d.pagos)).catch((e) => toast(e.message, 'err'))
    apiVivo('/finanzas/pagos?estado=aprobado', (d: any) => setAprobados(d.pagos.slice(0, 20))).catch(() => {})
  }
  useEffect(() => { cargar() }, [])
  const conciliar = async (id: string, aprobar: boolean) => {
    let motivo = ''
    if (!aprobar) { motivo = prompt('Motivo del rechazo:') ?? ''; if (!motivo) return }
    const r = await conError(() => api(`/finanzas/pagos/${id}/conciliar`, { method: 'POST', body: JSON.stringify({ aprobar, motivo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(aprobar ? 'Pago aprobado' : 'Pago rechazado', 'ok'); cargar() }
  }
  const anular = async (id: string) => {
    const motivo = prompt('Motivo de la anulación (ej. pago rebotado, error de conciliación):') ?? ''
    if (!motivo.trim()) return
    const r = await conError(() => api(`/finanzas/pagos/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Pago anulado', 'ok'); cargar() }
  }
  return (
    <>
    <RegistrarPagoRecibido onDone={cargar} />
    <div className="card">
      <h3><Icon name="check" className="h-ico" />Pagos por verificar <span className="sub">{pagos.length}</span></h3>
      {!pagos.length && <Empty ico="✅">No hay pagos pendientes de conciliar.</Empty>}
      {pagos.map((p) => (
        <div className="list-item" key={p.id} style={{ alignItems: 'flex-start' }}>
          <div className="li-body">
            <div className="li-title">{p.unidad} · {usd(p.monto_usd)}</div>
            <div className="li-sub">{p.residente} · {p.metodo.replace('_', ' ')}{p.referencia ? ` · ref. ${p.referencia}` : ''} · {fechaUtc(p.creada).toLocaleDateString('es-VE')}</div>
            {p.comprobante_key && <button type="button" className="xs" style={estiloEnlace} onClick={() => setVerComp(p.comprobante_key)}>📎 Ver comprobante</button>}
          </div>
          <div className="li-actions">
            <button className="chip ok" onClick={() => conciliar(p.id, true)}>Aprobar</button>
            <button className="chip off" onClick={() => conciliar(p.id, false)}>Rechazar</button>
          </div>
        </div>
      ))}
    </div>
    <div className="card">
      <h3><Icon name="check" className="h-ico" />Pagos aprobados <span className="sub">{aprobados.length}</span></h3>
      {!aprobados.length && <Empty ico="🧾">Aún no hay pagos aprobados.</Empty>}
      {aprobados.map((p) => (
        <div className="list-item" key={p.id} style={{ alignItems: 'flex-start' }}>
          <div className="li-body">
            <div className="li-title">{p.unidad} · {usd(p.monto_usd)} <span className="chip ok">aprobado</span></div>
            <div className="li-sub">{p.residente} · {p.metodo.replace('_', ' ')}{p.referencia ? ` · ref. ${p.referencia}` : ''} · {fechaUtc(p.conciliada || p.creada).toLocaleDateString('es-VE')}</div>
          </div>
          <div className="li-actions">
            <button className="chip off" onClick={() => anular(p.id)} title="Revertir un pago aprobado por error o rebote bancario">Anular</button>
          </div>
        </div>
      ))}
    </div>
    {verComp && <VisorMedia keyMedia={verComp} onCerrar={() => setVerComp(null)} />}
    </>
  )
}

function Egresos() {
  const [f, setF] = useState({ tipo: 'gasto', categoria: 'mantenimiento', descripcion: '', proveedor: '', monto: '', fecha: hoy(), factura_nro: '' })
  const [verFactura, setVerFactura] = useState<string | null>(null)
  const [facturaKey, setFacturaKey] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [lista, setLista] = useState<any[]>([])
  const [editando, setEditando] = useState<any>(null)
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/finanzas/gastos', (d: any) => setLista(d.gastos)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const borrar = async (id: string) => {
    if (!confirm('¿Borrar este egreso? Esta acción no se puede deshacer.')) return
    const r = await conError(() => api(`/finanzas/gastos/${id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Egreso borrado', 'ok'); cargar() }
  }
  const subir = async (file?: File) => {
    if (!file) return
    setSubiendo(true)
    try { setFacturaKey(await subirArchivo(file)); toast('Factura adjuntada', 'ok') }
    catch (e) { toast(`No se pudo subir la factura: ${(e as Error).message}`, 'err') }
    finally { setSubiendo(false) }
  }
  const registrar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/finanzas/gastos', { method: 'POST', body: JSON.stringify({ ...f, monto: Number(f.monto), factura_key: facturaKey }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Egreso registrado', 'ok')
    setF({ tipo: 'gasto', categoria: 'mantenimiento', descripcion: '', proveedor: '', monto: '', fecha: hoy(), factura_nro: '' }); setFacturaKey(null); cargar()
  }, e)
  return (
    <>
      <div className="card">
        <h3><Icon name="expense" className="h-ico" />Registrar gasto o compra</h3>
        <form onSubmit={registrar} className="stack">
          <div className="seg" style={{ margin: 0 }}>
            <button type="button" className={f.tipo === 'gasto' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'gasto' })}>Gasto</button>
            <button type="button" className={f.tipo === 'compra' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'compra' })}>Compra</button>
          </div>
          <div className="grid2">
            <div className="field"><label>Categoría</label>
              <select className="inp" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
                {CATS.map((c) => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
              </select></div>
            <div className="field"><label>Monto (USD)</label><input className="inp" type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>
          </div>
          <div className="field"><label>Descripción</label><input className="inp" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></div>
          <div className="grid2">
            <div className="field"><label>Proveedor</label><input className="inp" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></div>
            <div className="field"><label>Fecha</label><input className="inp" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>N° de factura</label><input className="inp" value={f.factura_nro} onChange={(e) => setF({ ...f, factura_nro: e.target.value })} /></div>
            <CampoArchivo etiqueta="Factura (imagen/PDF)" nombreBase="factura" onArchivo={subir}
              onError={(m) => toast(m, 'err')} subiendo={subiendo} adjunto={!!facturaKey} textoAdjunto="Factura adjuntada" />
          </div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Registrar egreso</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Historial de egresos</h3>
        {!lista.length && <Empty ico="💸">Sin egresos todavía.</Empty>}
        {lista.map((g) => (
          <div className="list-item" key={g.id}>
            <div className="li-ico" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><Icon name={g.tipo === 'compra' ? 'cart' : 'expense'} /></div>
            <div className="li-body">
              <div className="li-title">{g.descripcion} {g.factura_key && <button type="button" className="xs" style={estiloEnlace} onClick={() => setVerFactura(g.factura_key)}>📎 factura</button>}</div>
              <div className="li-sub" style={{ textTransform: 'capitalize' }}>{g.categoria}{g.proveedor ? ` · ${g.proveedor}` : ''} · {g.fecha}{g.factura_nro ? ` · #${g.factura_nro}` : ''}</div>
            </div>
            <b style={{ color: 'var(--danger)' }}>−{usd(g.monto_usd)}</b>
            <div className="li-actions">
              <button className="chip neutral" onClick={() => setEditando(g)}>Editar</button>
              <button className="chip off" onClick={() => borrar(g.id)}>Borrar</button>
            </div>
          </div>
        ))}
      </div>
      {editando && <EditarGasto g={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); cargar() }} />}
      {verFactura && <VisorMedia keyMedia={verFactura} onCerrar={() => setVerFactura(null)} />}
    </>
  )
}

function EditarGasto({ g, onClose, onSaved }: { g: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ descripcion: g.descripcion ?? '', categoria: g.categoria ?? 'otro', proveedor: g.proveedor ?? '', monto: String(g.monto_usd ?? ''), fecha: g.fecha ?? hoy() })
  const toast = useToast(); const { loading, run } = useAsync()
  const guardar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api(`/finanzas/gastos/${g.id}`, { method: 'PATCH', body: JSON.stringify({ ...f, monto: Number(f.monto) }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Egreso actualizado', 'ok'); onSaved()
  }, e)
  return (
    <Sheet title="Editar egreso" onClose={onClose}>
      <form onSubmit={guardar} className="stack">
        <div className="field"><label>Descripción</label><input className="inp" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></div>
        <div className="grid2">
          <div className="field"><label>Categoría</label>
            <select className="inp" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
            </select></div>
          <div className="field"><label>Monto (USD)</label><input className="inp" type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>
        </div>
        <div className="grid2">
          <div className="field"><label>Proveedor</label><input className="inp" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></div>
          <div className="field"><label>Fecha</label><input className="inp" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></div>
        </div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Guardar cambios</SubmitBtn>
      </form>
    </Sheet>
  )
}

import { useEffect, useState } from 'react'
import { api, apiVivo, conError, usd, fechaUtc } from '../api'
import { useToast, Empty, Sheet, SubmitBtn, useAsync } from '../ui'
import { abrirExterno } from '../plataforma'
import { Icon } from './icons'
import { imprimirRecibo } from './recibo'

// Normaliza un teléfono venezolano a formato internacional para wa.me (0414… → 58414…).
const waNumero = (tel: string) => {
  const n = tel.replace(/[^0-9]/g, '')
  if (n.startsWith('58')) return n
  if (n.startsWith('0')) return '58' + n.slice(1)
  if (n.length === 10) return '58' + n
  return n
}
const waLink = (tel: string, nombre: string) => `https://wa.me/${waNumero(tel)}?text=${encodeURIComponent(`Hola ${nombre}, le escribimos de la administración del condominio.`)}`

export function Propietarios() {
  const [lista, setLista] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<any>(null)
  const toast = useToast()
  const cargar = () => apiVivo('/finanzas/propietarios', (d: any) => setLista(d.propietarios)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const filtro = lista.filter((p) => `${p.unidad} ${p.propietario ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="card">
        <div className="card-head"><h3><Icon name="contact" className="h-ico" />Propietarios <span className="sub">{lista.length} unidades</span></h3>
          <input className="inp spacer" style={{ width: 180 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!filtro.length && <Empty ico="📇">Sin resultados.</Empty>}
        {filtro.map((p) => (
          <div className="list-item" key={p.unidad_id}>
            <div className="li-ico"><Icon name={p.propietario ? 'user' : 'building'} /></div>
            <div className="li-body" onClick={() => setSel(p)} style={{ cursor: 'pointer' }}>
              <div className="li-title">{p.unidad} · {p.propietario ?? 'sin propietario'}{p.residentes > 1 ? <span className="chip neutral" style={{ marginLeft: 6 }}>+{p.residentes - 1}</span> : null}</div>
              <div className="li-sub">{p.telefono ?? 'sin teléfono'}{p.ultimo_pago ? ` · últ. pago ${fechaUtc(p.ultimo_pago).toLocaleDateString('es-VE')}` : ' · sin pagos'}</div>
            </div>
            <div className="li-actions">
              <span className="chip" style={{ background: p.saldo > 0.01 ? 'var(--danger-bg)' : 'var(--success-bg)', color: p.saldo > 0.01 ? 'var(--danger)' : '#166534' }}>{usd(p.saldo)}</span>
              {p.telefono && <button className="chip ok" onClick={() => abrirExterno(waLink(p.telefono, p.propietario ?? ''))}>WA</button>}
            </div>
          </div>
        ))}
      </div>
      {sel && <Detalle p={sel} onClose={() => setSel(null)} onChange={cargar} />}
    </>
  )
}

function Detalle({ p, onClose, onChange }: { p: any; onClose: () => void; onChange: () => void }) {
  const [d, setD] = useState<any>(null)
  const [tel, setTel] = useState(p.telefono ?? '')
  const [nota, setNota] = useState('')
  const toast = useToast(); const acc = useAsync()
  const cargar = () => apiVivo(`/finanzas/propietarios/${p.unidad_id}`, setD).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const guardarTel = () => acc.run(async () => {
    if (!p.usuario_id) { toast('La unidad no tiene propietario registrado', 'err'); return }
    const r = await conError(() => api('/finanzas/contacto', { method: 'POST', body: JSON.stringify({ usuario_id: p.usuario_id, telefono: tel }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Teléfono actualizado', 'ok'); onChange() }
  })
  const quitarResidente = (m: any) => acc.run(async () => {
    if (!confirm('¿Quitar a este residente de la unidad?')) return
    const r = await conError(() => api('/finanzas/miembros/' + m.id, { method: 'DELETE' }), (msg) => toast(msg, 'err'))
    if (r !== undefined) { toast('Residente quitado', 'ok'); cargar(); onChange() }
  })
  const agregarNota = () => acc.run(async () => {
    if (!nota.trim()) return
    const r = await conError(() => api('/finanzas/notas', { method: 'POST', body: JSON.stringify({ unidad_id: p.unidad_id, texto: nota }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { setNota(''); toast('Nota agregada', 'ok'); cargar() }
  })
  return (
    <Sheet title={`${p.unidad} · ${p.propietario ?? 'sin propietario'}`} onClose={onClose}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div><div className="xs muted-txt">Saldo</div><div className="big" style={{ fontSize: '1.5rem', color: p.saldo > 0.01 ? 'var(--danger)' : 'var(--success)' }}>{usd(p.saldo)}</div></div>
        {p.email && <div style={{ textAlign: 'right' }}><div className="xs muted-txt">Correo</div><div className="sm">{p.email}</div></div>}
      </div>
      <div className="field"><label>Teléfono (WhatsApp)</label>
        <div className="row"><input className="inp" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="0414…" />
          <button className="btn btn-sm btn-primary" onClick={guardarTel} disabled={acc.loading}>Guardar</button></div></div>

      {!d ? <div className="spin dark" /> : (
        <>
          <h4 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-h)' }}>Pagos</h4>
          {!d.pagos.length && <p className="hint">Sin pagos.</p>}
          {d.pagos.map((pg: any, i: number) => (
            <div className="list-item" key={i}>
              <div className="li-body"><div className="li-title">{usd(pg.monto_usd)} · {String(pg.metodo).replace('_', ' ')}</div>
                <div className="li-sub">{fechaUtc(pg.creada).toLocaleDateString('es-VE')}</div></div>
              <div className="li-actions"><span className={`chip ${pg.estado === 'aprobado' ? 'ok' : pg.estado === 'rechazado' ? 'off' : 'pend'}`}>{pg.estado}</span>
                {pg.estado === 'aprobado' && <button className="chip info" onClick={() => imprimirRecibo(pg.id ?? '', (m) => toast(m, 'err'))} title="Recibo"><Icon name="receipt" size={14} /></button>}</div>
            </div>
          ))}
          {!!d.multas.length && <><h4 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-h)' }}>Multas</h4>
            {d.multas.map((m: any) => (
              <div className="list-item" key={m.id}><div className="li-body"><div className="li-title">{m.motivo}</div>
                <div className="li-sub">{m.tipo === 'multa' ? usd(m.monto_usd) : 'amonestación'} · {m.estado}</div></div></div>
            ))}</>}

          <h4 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-h)' }}>Residentes</h4>
          {!(d.residentes ?? []).length && <p className="hint">Sin residentes.</p>}
          {(d.residentes ?? []).map((m: any) => (
            <div className="list-item" key={m.id}>
              <div className="li-ico"><Icon name="user" /></div>
              <div className="li-body"><div className="li-title">{m.nombre}</div>
                <div className="li-sub">{m.email ?? 'sin correo'}{m.telefono ? ` · ${m.telefono}` : ''}</div></div>
              <div className="li-actions"><button className="chip off" onClick={() => quitarResidente(m)} disabled={acc.loading}>Quitar</button></div>
            </div>
          ))}

          <h4 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-h)' }}>Notas internas</h4>
          <div className="row" style={{ marginBottom: 8 }}><input className="inp" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Agregar nota…" />
            <button className="btn btn-sm btn-primary" onClick={agregarNota} disabled={acc.loading}>+</button></div>
          {d.notas.map((n: any, i: number) => (
            <div className="list-item" key={i}><div className="li-body"><div className="li-title" style={{ fontWeight: 500 }}>{n.texto}</div>
              <div className="li-sub">{n.autor ?? '—'} · {fechaUtc(n.creada).toLocaleDateString('es-VE')}</div></div></div>
          ))}
        </>
      )}
    </Sheet>
  )
}

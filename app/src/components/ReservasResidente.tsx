import { useEffect, useState } from 'react'
import { api, apiVivo, conError, usd } from '../api'
import { useToast, Empty, Sheet, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'

export function ReservasResidente() {
  const [areas, setAreas] = useState<any[]>([])
  const [reservas, setReservas] = useState<any[]>([])
  const [reservar, setReservar] = useState<any>(null)
  const toast = useToast()
  const cargar = () => {
    apiVivo('/comunidad/areas', (d: any) => setAreas(d.areas)).catch(() => {})
    apiVivo('/comunidad/reservas', (d: any) => setReservas(d.reservas)).catch(() => {})
  }
  useEffect(() => { cargar() }, [])
  const cancelar = async (r: any) => {
    if (!confirm(`¿Cancelar la reserva de ${r.area} del ${r.fecha}?`)) return
    const res = await conError(() => api('/comunidad/reservas/' + r.id, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (res !== undefined) { toast('Reserva cancelada', 'ok'); cargar() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="bank" className="h-ico" />Áreas comunes</h3>
        {!areas.length && <Empty ico="🏛️">Este condominio aún no tiene áreas para reservar.</Empty>}
        {areas.map((a) => (
          <div className="list-item" key={a.id}>
            <div className="li-ico"><Icon name={a.nombre.toLowerCase().includes('pisc') ? 'pool' : a.nombre.toLowerCase().includes('gim') ? 'dumbbell' : 'sparkle'} /></div>
            <div className="li-body"><div className="li-title">{a.nombre}</div>
              <div className="li-sub">Aforo {a.aforo} · {a.costo_usd ? usd(a.costo_usd) : 'sin costo'}{a.horario ? ` · ${a.horario}` : ''}</div></div>
            <button className="chip info" onClick={() => setReservar(a)}>Reservar</button>
          </div>
        ))}
      </div>
      <div className="card">
        <h3><Icon name="calendar" className="h-ico" />Mis reservas</h3>
        {!reservas.length && <Empty ico="📅">Aún no tienes reservas.</Empty>}
        {reservas.map((r) => (
          <div className="list-item" key={r.id}>
            <div className="li-body"><div className="li-title">{r.area} · {r.fecha}</div><div className="li-sub">{r.franja}{r.motivo ? ` · ${r.motivo}` : ''}</div></div>
            <span className={`chip ${r.estado === 'aprobada' ? 'ok' : r.estado === 'rechazada' ? 'off' : 'pend'}`}>{r.estado}</span>
            {r.estado !== 'rechazada' && <button className="chip off" onClick={() => cancelar(r)}>Cancelar</button>}
          </div>
        ))}
      </div>
      {reservar && <Reservar area={reservar} onClose={() => setReservar(null)} onDone={() => { setReservar(null); cargar() }} />}
    </>
  )
}

function Reservar({ area, onClose, onDone }: { area: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fecha: '', franja: 'noche', invitados: '' })
  const toast = useToast(); const { loading, run } = useAsync()
  const enviar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunidad/reservas', { method: 'POST', body: JSON.stringify({ area_id: area.id, fecha: f.fecha, franja: f.franja, invitados: Number(f.invitados) }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Reserva solicitada — pendiente de aprobación', 'ok'); onDone() }
  }, e)
  return (
    <Sheet title={`Reservar ${area.nombre}`} onClose={onClose}>
      <form onSubmit={enviar} className="stack">
        <div className="field"><label>Fecha</label><input className="inp" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></div>
        <div className="field"><label>Franja</label>
          <select className="inp" value={f.franja} onChange={(e) => setF({ ...f, franja: e.target.value })}>
            <option value="mañana">Mañana</option><option value="tarde">Tarde</option><option value="noche">Noche</option><option value="todo el día">Todo el día</option>
          </select></div>
        <div className="field"><label>N° de invitados (aforo {area.aforo})</label><input className="inp" type="number" min="0" max={area.aforo || undefined} value={f.invitados} onChange={(e) => setF({ ...f, invitados: e.target.value })} /></div>
        {!!area.costo_usd && <p className="hint">Costo del área: {usd(area.costo_usd)}.</p>}
        <SubmitBtn loading={loading} className="btn btn-primary block">Solicitar reserva</SubmitBtn>
      </form>
    </Sheet>
  )
}

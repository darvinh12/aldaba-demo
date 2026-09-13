import { useEffect, useState } from 'react'
import { api, apiVivo, conError, usd, fechaUtc } from '../api'
import { useToast, Empty, Bar, Sheet, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'

export function ComunidadAdmin() {
  const [tab, setTab] = useState<'reservas' | 'votaciones' | 'tickets' | 'areas' | 'directorio'>('reservas')
  return (
    <>
      <div className="seg">
        {([['reservas', 'calendar', 'Reservas'], ['votaciones', 'vote', 'Votaciones'], ['tickets', 'wrench', 'Tickets'], ['areas', 'bank', 'Áreas'], ['directorio', 'contact', 'Directorio']] as const).map(([k, ic, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon name={ic} size={13} style={{ marginRight: 6, verticalAlign: '-2px', opacity: .7 }} />{l}</button>
        ))}
      </div>
      {tab === 'reservas' && <Reservas />}
      {tab === 'votaciones' && <Votaciones />}
      {tab === 'tickets' && <Tickets />}
      {tab === 'areas' && <Areas />}
      {tab === 'directorio' && <Directorio />}
    </>
  )
}

function Reservas() {
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast()
  const cargar = () => apiVivo('/comunidad/reservas', (d: any) => setLista(d.reservas)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const resolver = async (id: string, aprobar: boolean) => {
    let motivo = ''
    if (!aprobar) { motivo = prompt('Motivo del rechazo:') ?? ''; if (!motivo) return }
    const r = await conError(() => api(`/comunidad/reservas/${id}/resolver`, { method: 'POST', body: JSON.stringify({ aprobar, motivo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(aprobar ? 'Reserva aprobada' : 'Reserva rechazada', 'ok'); cargar() }
  }
  return (
    <div className="card">
      <h3><Icon name="calendar" className="h-ico" />Reservas</h3>
      {!lista.length && <Empty ico="📅">Sin reservas todavía.</Empty>}
      {lista.map((r) => (
        <div className="list-item" key={r.id}>
          <div className="li-body">
            <div className="li-title">{r.area} · {r.fecha} <span className={`chip ${r.estado === 'aprobada' ? 'ok' : r.estado === 'rechazada' ? 'off' : 'pend'}`}>{r.estado}</span></div>
            <div className="li-sub">{r.residente}{r.unidad ? ` · ${r.unidad}` : ''}{r.franja ? ` · ${r.franja}` : ''} · {r.invitados} invitados</div>
          </div>
          {r.estado === 'solicitada' && <div className="li-actions">
            <button className="chip ok" onClick={() => resolver(r.id, true)}>Aprobar</button>
            <button className="chip off" onClick={() => resolver(r.id, false)}>Rechazar</button>
          </div>}
        </div>
      ))}
    </div>
  )
}

function Votaciones() {
  const [lista, setLista] = useState<any[]>([])
  const [f, setF] = useState({ titulo: '', descripcion: '', opciones: ['', ''] })
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/comunidad/votaciones', (d: any) => setLista(d.votaciones)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunidad/votaciones', { method: 'POST', body: JSON.stringify({ ...f, opciones: f.opciones.filter(Boolean) }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Votación creada', 'ok'); setF({ titulo: '', descripcion: '', opciones: ['', ''] }); cargar()
  }, e)
  const cerrar = async (id: string) => { const r = await conError(() => api(`/comunidad/votaciones/${id}/cerrar`, { method: 'POST' }), (m) => toast(m, 'err')); if (r !== undefined) { toast('Votación cerrada', 'ok'); cargar() } }
  const borrar = async (v: any) => {
    if (!confirm(`¿Borrar la votación "${v.titulo}"?`)) return
    const r = await conError(() => api(`/comunidad/votaciones/${v.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Votación borrada', 'ok'); cargar() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="vote" className="h-ico" />Nueva votación</h3>
        <form onSubmit={crear} className="stack">
          <div className="field"><label>Pregunta</label><input className="inp" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} required /></div>
          <div className="field"><label>Descripción</label><input className="inp" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
          {f.opciones.map((o, i) => (
            <input key={i} className="inp" placeholder={`Opción ${i + 1}`} value={o} onChange={(e) => { const n = [...f.opciones]; n[i] = e.target.value; setF({ ...f, opciones: n }) }} />
          ))}
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setF({ ...f, opciones: [...f.opciones, ''] })}>+ Opción</button>
            <SubmitBtn loading={loading} className="btn btn-primary" style={{ flex: 1 }}>Crear votación</SubmitBtn>
          </div>
        </form>
      </div>
      {lista.map((v) => {
        return (
          <div className="card" key={v.id}>
            <div className="card-head"><h3>{v.titulo}</h3>
              {v.estado === 'abierta' ? <button className="chip pend spacer" onClick={() => cerrar(v.id)}>Cerrar</button> : <span className="chip neutral spacer">cerrada</span>}
              <button className="chip off" onClick={() => borrar(v)}>Borrar</button></div>
            {v.descripcion && <p className="li-sub" style={{ marginBottom: 10 }}>{v.descripcion}</p>}
            {v.opciones.map((o: any) => (
              <div key={o.id} style={{ marginBottom: 10 }}>
                <div className="row between xs" style={{ marginBottom: 3 }}><span>{o.texto}</span><b>{Math.round(o.porcentaje ?? 0)}% · {o.n} votos</b></div>
                <Bar pct={o.porcentaje ?? 0} />
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}

function Tickets() {
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast()
  const cargar = () => apiVivo('/comunidad/tickets', (d: any) => setLista(d.tickets)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const mover = async (id: string, estado: string) => {
    const r = await conError(() => api(`/comunidad/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ estado }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Ticket actualizado', 'ok'); cargar() }
  }
  return (
    <div className="card">
      <h3><Icon name="wrench" className="h-ico" />Tickets de mantenimiento</h3>
      {!lista.length && <Empty ico="🔧">Sin tickets.</Empty>}
      {lista.map((t) => (
        <div className="list-item" key={t.id} style={{ alignItems: 'flex-start' }}>
          <div className="li-ico" style={{ background: t.estado === 'resuelto' ? 'var(--success-bg)' : 'var(--warn-bg)', color: t.estado === 'resuelto' ? 'var(--success)' : 'var(--warn)' }}>🔧</div>
          <div className="li-body">
            <div className="li-title">{t.titulo} <span className={`chip ${t.estado === 'resuelto' ? 'ok' : t.estado === 'en_curso' ? 'info' : 'pend'}`}>{t.estado.replace('_', ' ')}</span></div>
            <div className="li-sub">{t.reporta}{t.unidad ? ` · ${t.unidad}` : ''} · {t.categoria}{t.descripcion ? ` · ${t.descripcion}` : ''}</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {t.estado === 'abierto' && <button className="btn btn-sm btn-ghost" onClick={() => mover(t.id, 'en_curso')}>Tomar</button>}
              {t.estado !== 'resuelto' && <button className="btn btn-sm btn-success" onClick={() => mover(t.id, 'resuelto')}>Resolver</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Areas() {
  const [lista, setLista] = useState<any[]>([])
  const [f, setF] = useState({ nombre: '', aforo: '', costo_usd: '', horario: '' })
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/comunidad/areas', (d: any) => setLista(d.areas)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunidad/areas', { method: 'POST', body: JSON.stringify({ nombre: f.nombre, aforo: Number(f.aforo), costo_usd: Number(f.costo_usd), horario: f.horario }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Área creada', 'ok'); setF({ nombre: '', aforo: '', costo_usd: '', horario: '' }); cargar()
  }, e)
  const toggle = async (a: any) => { await conError(() => api(`/comunidad/areas/${a.id}`, { method: 'PATCH', body: JSON.stringify({ activa: !a.activa }) }), (m) => toast(m, 'err')); cargar() }
  const borrar = async (a: any) => {
    if (!confirm(`¿Borrar el área "${a.nombre}"?`)) return
    const r = await conError(() => api(`/comunidad/areas/${a.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Área borrada', 'ok'); cargar() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="bank" className="h-ico" />Nueva área común</h3>
        <form onSubmit={crear} className="stack">
          <div className="grid2">
            <div className="field"><label>Nombre</label><input className="inp" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></div>
            <div className="field"><label>Aforo</label><input className="inp" type="number" min="0" value={f.aforo} onChange={(e) => setF({ ...f, aforo: e.target.value })} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Costo (USD)</label><input className="inp" type="number" min="0" step="0.01" value={f.costo_usd} onChange={(e) => setF({ ...f, costo_usd: e.target.value })} /></div>
            <div className="field"><label>Horario</label><input className="inp" value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} placeholder="10am–11pm" /></div>
          </div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Crear área</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Áreas</h3>
        {!lista.length && <Empty ico="🏛️">Sin áreas configuradas.</Empty>}
        {lista.map((a) => (
          <div className="list-item" key={a.id}>
            <div className="li-body"><div className="li-title">{a.nombre} {!a.activa && <span className="chip off">inactiva</span>}</div>
              <div className="li-sub">Aforo {a.aforo} · {a.costo_usd ? usd(a.costo_usd) : 'sin costo'}{a.horario ? ` · ${a.horario}` : ''}</div></div>
            <div className="li-actions">
              <button className="chip neutral" onClick={() => toggle(a)}>{a.activa ? 'Desactivar' : 'Activar'}</button>
              <button className="chip off" onClick={() => borrar(a)}>Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Directorio() {
  const [lista, setLista] = useState<any[]>([])
  const [f, setF] = useState({ nombre: '', cargo: '', telefono: '' })
  const [editar, setEditar] = useState<any>(null)
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/comunidad/directorio', (d: any) => setLista(d.directorio)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunidad/directorio', { method: 'POST', body: JSON.stringify(f) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Contacto agregado', 'ok'); setF({ nombre: '', cargo: '', telefono: '' }); cargar()
  }, e)
  const borrar = async (d: any) => {
    if (!confirm(`¿Borrar el contacto "${d.nombre}"?`)) return
    const r = await conError(() => api(`/comunidad/directorio/${d.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Contacto borrado', 'ok'); cargar() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="contact" className="h-ico" />Agregar contacto</h3>
        <form onSubmit={crear} className="stack">
          <div className="grid2">
            <div className="field"><label>Nombre</label><input className="inp" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></div>
            <div className="field"><label>Cargo</label><input className="inp" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} placeholder="Portería, administración…" /></div>
          </div>
          <div className="field"><label>Teléfono</label><input className="inp" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Agregar</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Directorio</h3>
        {!lista.length && <Empty ico="📇">Sin contactos.</Empty>}
        {lista.map((d) => (
          <div className="list-item" key={d.id}>
            <div className="li-ico"><Icon name="contact" /></div>
            <div className="li-body"><div className="li-title">{d.nombre}</div><div className="li-sub">{d.cargo}{d.telefono ? ` · ${d.telefono}` : ''}</div></div>
            <div className="li-actions">
              <button className="chip neutral" onClick={() => setEditar(d)}>Editar</button>
              <button className="chip off" onClick={() => borrar(d)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {editar && <EditarContacto d={editar} onClose={() => setEditar(null)} onDone={() => { setEditar(null); cargar() }} />}
    </>
  )
}

function EditarContacto({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [nombre, setNombre] = useState(d.nombre), [cargo, setCargo] = useState(d.cargo ?? ''), [telefono, setTelefono] = useState(d.telefono ?? '')
  const toast = useToast(); const { loading, run } = useAsync()
  const guardar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api(`/comunidad/directorio/${d.id}`, { method: 'PATCH', body: JSON.stringify({ nombre, cargo, telefono }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Contacto actualizado', 'ok'); onDone() }
  }, e)
  return (
    <Sheet title={`Editar contacto`} onClose={onClose}>
      <form onSubmit={guardar} className="stack">
        <div className="field"><label>Nombre</label><input className="inp" value={nombre} onChange={(e) => setNombre(e.target.value)} required /></div>
        <div className="field"><label>Cargo</label><input className="inp" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Portería, administración…" /></div>
        <div className="field"><label>Teléfono</label><input className="inp" value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Guardar</SubmitBtn>
      </form>
    </Sheet>
  )
}

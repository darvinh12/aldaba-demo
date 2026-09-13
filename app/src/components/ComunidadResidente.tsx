import { useEffect, useState } from 'react'
import { api, apiVivo, conError } from '../api'
import { useToast, Empty, Bar, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'
import { Comunicados } from './Comunicados'

export function ComunidadResidente() {
  const [tab, setTab] = useState<'cartelera' | 'votaciones' | 'tickets' | 'directorio'>('cartelera')
  return (
    <>
      <div className="seg">
        {([['cartelera', 'megaphone', 'Cartelera'], ['votaciones', 'vote', 'Votaciones'], ['tickets', 'wrench', 'Reportes'], ['directorio', 'contact', 'Directorio']] as const).map(([k, ic, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon name={ic} size={13} style={{ marginRight: 6, verticalAlign: '-2px', opacity: .7 }} />{l}</button>
        ))}
      </div>
      {tab === 'cartelera' && <Comunicados esAdmin={false} />}
      {tab === 'votaciones' && <VotarLista />}
      {tab === 'tickets' && <MisTickets />}
      {tab === 'directorio' && <Directorio />}
    </>
  )
}

function VotarLista() {
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast()
  const cargar = () => apiVivo('/comunidad/votaciones', (d: any) => setLista(d.votaciones)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const votar = async (vid: string, opcion_id: string) => {
    const r = await conError(() => api(`/comunidad/votaciones/${vid}/votar`, { method: 'POST', body: JSON.stringify({ opcion_id }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('¡Voto registrado!', 'ok'); cargar() }
  }
  if (!lista.length) return <Empty ico="🗳️">No hay votaciones activas.</Empty>
  return (
    <>
      {lista.map((v) => {
        const votado = !!v.miVoto || v.estado !== 'abierta'
        return (
          <div className="card" key={v.id}>
            <h3>{v.titulo} {v.estado !== 'abierta' && <span className="chip neutral">cerrada</span>}</h3>
            {v.descripcion && <p className="li-sub" style={{ marginBottom: 12 }}>{v.descripcion}</p>}
            {v.opciones.map((o: any) => (
              <div key={o.id} style={{ marginBottom: 10 }}>
                {votado ? (
                  <>
                    <div className="row between xs" style={{ marginBottom: 3 }}>
                      <span>{o.texto} {v.miVoto === o.id && <b style={{ color: 'var(--primary)' }}>· tu voto</b>}</span>
                      <b>{Math.round(o.porcentaje ?? 0)}%</b>
                    </div>
                    <Bar pct={o.porcentaje ?? 0} />
                  </>
                ) : (
                  <button className="btn btn-ghost block" style={{ justifyContent: 'flex-start' }} onClick={() => votar(v.id, o.id)}>{o.texto}</button>
                )}
              </div>
            ))}
            <p className="hint">Tu voto pesa según tu alícuota. Resultados auditables.</p>
          </div>
        )
      })}
    </>
  )
}

function MisTickets() {
  const [lista, setLista] = useState<any[]>([])
  const [f, setF] = useState({ titulo: '', descripcion: '', categoria: 'mantenimiento' })
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/comunidad/tickets', (d: any) => setLista(d.tickets)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar() }, [])
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunidad/tickets', { method: 'POST', body: JSON.stringify(f) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Reporte enviado', 'ok'); setF({ titulo: '', descripcion: '', categoria: 'mantenimiento' }); cargar()
  }, e)
  const cerrar = async (id: string) => {
    if (!confirm('¿Cerrar este reporte?')) return
    const r = await conError(() => api(`/comunidad/tickets/${id}/cerrar`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Reporte cerrado', 'ok'); cargar() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="wrench" className="h-ico" />Reportar una incidencia</h3>
        <form onSubmit={crear} className="stack">
          <div className="field"><label>Asunto</label><input className="inp" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Bombillo del pasillo, fuga…" required /></div>
          <div className="field"><label>Detalle</label><textarea className="inp" rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Enviar reporte</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Mis reportes</h3>
        {!lista.length && <Empty ico="🔧">No has reportado nada aún.</Empty>}
        {lista.map((t) => (
          <div className="list-item" key={t.id}>
            <div className="li-body"><div className="li-title">{t.titulo}</div><div className="li-sub">{t.categoria}{t.asignado ? ` · ${t.asignado}` : ''}</div></div>
            <span className={`chip ${t.estado === 'resuelto' ? 'ok' : t.estado === 'en_curso' ? 'info' : 'pend'}`}>{t.estado.replace('_', ' ')}</span>
            {t.estado !== 'resuelto' && <button className="chip info" onClick={() => cerrar(t.id)}><Icon name="check" size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />Cerrar</button>}
          </div>
        ))}
      </div>
    </>
  )
}

function Directorio() {
  const [lista, setLista] = useState<any[]>([])
  useEffect(() => { apiVivo('/comunidad/directorio', (d: any) => setLista(d.directorio)).catch(() => {}) }, [])
  return (
    <div className="card">
      <h3><Icon name="contact" className="h-ico" />Directorio del condominio</h3>
      {!lista.length && <Empty ico="📇">El directorio está vacío.</Empty>}
      {lista.map((d) => (
        <div className="list-item" key={d.id}>
          <div className="li-ico"><Icon name="contact" /></div>
          <div className="li-body"><div className="li-title">{d.nombre}</div><div className="li-sub">{d.cargo}{d.nota ? ` · ${d.nota}` : ''}</div></div>
          {d.telefono && <a className="chip ok" href={`tel:${d.telefono}`}>📞 {d.telefono}</a>}
        </div>
      ))}
    </div>
  )
}

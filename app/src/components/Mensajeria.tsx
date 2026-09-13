import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { api, apiVivo, conError } from '../api'
import { useToast, Empty, SubmitBtn, useAsync } from '../ui'
import { abrirExterno } from '../plataforma'

const DEFAULTS = [
  { nombre: 'Recordatorio de pago', cuerpo: 'Hola {nombre}, le recordamos que su unidad {unidad} tiene un saldo pendiente. Puede reportar su pago desde la app de Aldaba. ¡Gracias!' },
  { nombre: 'Corte de agua', cuerpo: 'Estimado {nombre}, mañana habrá corte de agua de 9:00 am a 1:00 pm por mantenimiento del tanque. Le recomendamos almacenar agua.' },
  { nombre: 'Convocatoria a asamblea', cuerpo: 'Estimado {nombre}, se convoca a asamblea de propietarios este sábado a las 7:00 pm en el salón. Su asistencia es muy importante.' },
  { nombre: 'Aviso de morosidad', cuerpo: 'Hola {nombre}, su unidad {unidad} presenta un saldo moroso. Le agradecemos regularizar su pago a la brevedad para no afectar los servicios del condominio.' },
]

export function Mensajeria() {
  const [canal, setCanal] = useState('whatsapp')
  const [filtro, setFiltro] = useState('todos')
  const [cuerpo, setCuerpo] = useState('')
  const [asunto, setAsunto] = useState('')
  const [dest, setDest] = useState<any[]>([])
  const [custom, setCustom] = useState<any[]>([])
  const [resultado, setResultado] = useState<any>(null)
  const [waIdx, setWaIdx] = useState(0) // próximo link de WhatsApp a abrir (apertura de uno en uno)
  const toast = useToast(); const { loading, run } = useAsync()
  const cargarDest = (fl: string) => apiVivo(`/mensajeria/destinatarios?filtro=${fl}`, (d: any) => setDest(d.destinatarios)).catch(() => {})
  const cargarPlant = () => apiVivo('/mensajeria/plantillas', (d: any) => setCustom(d.plantillas)).catch(() => {})
  useEffect(() => { cargarDest(filtro); cargarPlant() }, [])
  useEffect(() => { cargarDest(filtro) }, [filtro])

  const enviar = (e: React.FormEvent) => run(async () => {
    if (!cuerpo.trim()) { toast('Escribe el mensaje', 'err'); return }
    const r = await conError(() => api('/mensajeria/enviar', { method: 'POST', body: JSON.stringify({ canal, filtro, cuerpo, asunto }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    setResultado(r); setWaIdx(0)
    if (r.sinProveedor) toast('Correo pendiente: configura un proveedor (RESEND_API_KEY) para enviar', 'info')
    else toast(`${r.enviados} destinatarios`, 'ok')
  }, e)
  const guardarPlantilla = async () => {
    const nombre = prompt('Nombre de la plantilla:'); if (!nombre) return
    const r = await conError(() => api('/mensajeria/plantillas', { method: 'POST', body: JSON.stringify({ nombre, cuerpo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Plantilla guardada', 'ok'); cargarPlant() }
  }
  const borrarPlantilla = async (p: any) => {
    if (!confirm(`¿Eliminar la plantilla "${p.nombre}"?`)) return
    const r = await conError(() => api('/mensajeria/plantillas/' + p.id, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Plantilla eliminada', 'ok'); cargarPlant() }
  }
  const editarPlantilla = async (p: any) => {
    const nombre = prompt('Nombre de la plantilla:', p.nombre); if (nombre === null) return
    const cuerpoNuevo = prompt('Contenido de la plantilla:', p.cuerpo); if (cuerpoNuevo === null) return
    const body: any = {}
    if (nombre.trim() && nombre !== p.nombre) body.nombre = nombre.trim()
    if (cuerpoNuevo !== p.cuerpo) body.cuerpo = cuerpoNuevo
    if (!Object.keys(body).length) return
    const r = await conError(() => api('/mensajeria/plantillas/' + p.id, { method: 'PATCH', body: JSON.stringify(body) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Plantilla actualizada', 'ok'); cargarPlant() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="mail" className="h-ico" />Mensaje masivo</h3>
        <form onSubmit={enviar} className="stack">
          <div>
            <div className="lbl">Plantillas</div>
            <div className="btn-row">
              {[...DEFAULTS, ...custom].map((p: any, i) => (
                <span key={p.id ?? `def-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button type="button" className="chip info" onClick={() => setCuerpo(p.cuerpo)}>{p.nombre}</button>
                  {p.id && <button type="button" className="chip neutral" title="Editar plantilla" aria-label={`Editar plantilla ${p.nombre}`} onClick={() => editarPlantilla(p)}>✎</button>}
                  {p.id && <button type="button" className="chip off" title="Eliminar plantilla" aria-label={`Eliminar plantilla ${p.nombre}`} onClick={() => borrarPlantilla(p)}>×</button>}
                </span>
              ))}
            </div>
          </div>
          <div className="grid2">
            <div className="field"><label>Canal</label>
              <div className="seg" style={{ margin: 0 }}>
                <button type="button" className={canal === 'whatsapp' ? 'active' : ''} onClick={() => setCanal('whatsapp')}>WhatsApp</button>
                <button type="button" className={canal === 'email' ? 'active' : ''} onClick={() => setCanal('email')}>Correo</button>
              </div></div>
            <div className="field"><label>Destinatarios</label>
              <select className="inp" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="todos">Todos los residentes</option>
                <option value="morosos">Solo morosos</option>
              </select></div>
          </div>
          {canal === 'email' && <div className="field"><label>Asunto</label><input className="inp" value={asunto} onChange={(e) => setAsunto(e.target.value)} /></div>}
          <div className="field"><label>Mensaje <span className="hint" style={{ display: 'inline' }}>· usa {'{nombre}'} y {'{unidad}'}</span></label>
            <textarea className="inp" rows={4} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} required /></div>
          <div className="row between">
            <span className="hint">{dest.length} destinatario(s){canal === 'whatsapp' ? ` · ${dest.filter((d) => d.telefono).length} con teléfono` : ` · ${dest.filter((d) => d.email).length} con correo`}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={guardarPlantilla}>Guardar plantilla</button>
          </div>
          <SubmitBtn loading={loading} className="btn btn-primary block">{canal === 'whatsapp' ? 'Generar mensajes de WhatsApp' : 'Enviar correos'}</SubmitBtn>
        </form>
      </div>

      {resultado && resultado.canal === 'whatsapp' && (
        <div className="card">
          <div className="card-head"><h3><Icon name="phone" className="h-ico" />Enviar por WhatsApp <span className="sub">{resultado.links.length}</span></h3>
            {resultado.links.length > 1 && (waIdx < resultado.links.length
              ? <button className="chip info spacer" onClick={() => { abrirExterno(resultado.links[waIdx].url); setWaIdx(waIdx + 1) }}>Abrir siguiente ({waIdx + 1}/{resultado.links.length})</button>
              : <button className="chip info spacer" onClick={() => setWaIdx(0)}>Volver a empezar</button>)}</div>
          {!resultado.links.length && <Empty ico="📱">Ningún destinatario tiene teléfono cargado. Agrégalos en el CRM de Propietarios.</Empty>}
          {resultado.links.map((l: any, i: number) => (
            <div className="list-item" key={i}>
              <div className="li-body"><div className="li-title">{l.nombre}</div><div className="li-sub">{l.unidad}</div></div>
              <button className="chip ok" onClick={() => abrirExterno(l.url)}>Abrir chat</button>
            </div>
          ))}
          {resultado.pendientes > 0 && <p className="hint" style={{ marginTop: 10 }}>{resultado.pendientes} sin teléfono — cárgalos en Propietarios.</p>}
        </div>
      )}
      {resultado && resultado.canal === 'email' && (
        <div className="card">
          <h3><Icon name="mail" className="h-ico" />Correo</h3>
          {resultado.sinProveedor
            ? <p className="sm">Los correos quedaron <b>preparados</b>. Para enviarlos automáticamente, configura la variable <code>RESEND_API_KEY</code> del worker. Mientras tanto puedes usar WhatsApp.</p>
            : <p className="sm">✓ {resultado.enviados} correos enviados{resultado.pendientes ? ` · ${resultado.pendientes} sin correo` : ''}.</p>}
        </div>
      )}
    </>
  )
}

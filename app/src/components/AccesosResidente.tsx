import { useEffect, useRef, useState } from 'react'
import { api, apiVivo, conError, fechaUtc } from '../api'
import { PUBLIC_ORIGIN, abrirExterno, copiar } from '../plataforma'
import { useToast, Empty, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'
import { ImagenMedia, VisorMedia } from './Media'
import { PaseQR } from './PaseQR'
import { formatearCodigo } from '../codigo'
import { registrarSondeo } from '../ciclo'

export function AccesosResidente() {
  const [pases, setPases] = useState<any[]>([])
  const [citofono, setCitofono] = useState<any[]>([])
  const [paquetes, setPaquetes] = useState<any[]>([])
  const [sosActivos, setSosActivos] = useState<any[]>([])
  const [f, setF] = useState({ visitante: '', tipo: 'unico', horas: '12', ventana: '' })
  const [verFoto, setVerFoto] = useState<string | null>(null)
  const [verPase, setVerPase] = useState<any>(null)
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => {
    apiVivo('/accesos/pases', (d: any) => setPases(d.pases)).catch(() => {})
    apiVivo('/accesos/citofono', (d: any) => setCitofono(d.pendientes)).catch(() => {})
    apiVivo('/accesos/paquetes', (d: any) => setPaquetes(d.paquetes)).catch(() => {})
    apiVivo('/accesos/sos', (d: any) => setSosActivos(d.alertas.filter((a: any) => a.estado !== 'resuelta'))).catch(() => {})
  }
  useEffect(() => { cargar(); return registrarSondeo(() => api('/accesos/citofono').then((d) => setCitofono(d.pendientes)).catch(() => {}), 10000) }, [])

  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/accesos/pases', { method: 'POST', body: JSON.stringify({ ...f, horas: Number(f.horas) }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    setF({ visitante: '', tipo: 'unico', horas: '12', ventana: '' }); toast('Pase creado', 'ok')
    // Antes esto disparaba WhatsApp de una y no enseñaba nada. Ahora abre el pase recién
    // creado: el QR y el código en pantalla, y desde ahí se comparte si se quiere. Se releen
    // los pases del servidor en vez de armar el objeto acá, para no inventar la fecha de
    // vencimiento (la calcula el worker con SU reloj, no el del teléfono).
    const d = await api('/accesos/pases').catch(() => null)
    if (d) { setPases(d.pases); const nuevo = d.pases.find((p: any) => p.token === r.token); if (nuevo) setVerPase(nuevo) }
    cargar()
  }, e)
  const compartir = (url: string, visitante: string, codigo?: string | null) => {
    const abs = `${PUBLIC_ORIGIN}${url}`
    const texto = `Hola ${visitante}, este es tu pase de entrada: ${abs}`
      + (codigo ? `\nSi el QR no lee, el código es ${formatearCodigo(codigo)}` : '')
    const wa = `https://wa.me/?text=${encodeURIComponent(texto)}`
    copiar(abs).then((ok) => { if (!ok) toast('No se pudo copiar el enlace al portapapeles', 'err') })
    abrirExterno(wa)
  }
  const responder = async (id: string, aprobar: boolean) => {
    const r = await conError(() => api(`/accesos/citofono/${id}/responder`, { method: 'POST', body: JSON.stringify({ aprobar }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(aprobar ? 'Visita autorizada' : 'Visita denegada', 'ok'); cargar() }
  }
  const cancelarPase = async (p: any) => {
    if (!confirm(`¿Cancelar el pase de ${p.visitante}?`)) return
    const r = await conError(() => api(`/accesos/pases/${p.token}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Pase cancelado', 'ok'); cargar() }
  }
  const cancelarSOS = async (s: any) => {
    if (!confirm('¿Cancelar esta alerta SOS (falsa alarma)?')) return
    const r = await conError(() => api(`/accesos/sos/${s.id}/cancelar`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Alerta SOS cancelada', 'ok'); cargar() }
  }
  return (
    <>
      {citofono.map((v) => (
        <div className="sos-banner" key={v.id} style={{ background: 'linear-gradient(135deg,#1D4ED8,#1E40AF)', boxShadow: '0 0 0 3px rgba(37,99,235,.2)' }}>
          <h3><Icon name="phone" className="h-ico" />Visitante en portería</h3>
          <p className="sm" style={{ margin: '4px 0 10px' }}><b>{v.visitante}</b>{v.documento ? ` · ${v.documento}` : ''}{v.motivo ? ` · ${v.motivo}` : ''}</p>
          {v.foto_key && <button type="button" onClick={() => setVerFoto(v.foto_key)} aria-label="Ver documento del visitante"
            style={{ display: 'block', width: '100%', marginBottom: 12, padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
            <ImagenMedia keyMedia={v.foto_key} alt="Documento del visitante" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, border: '1px solid rgba(255,255,255,.25)' }} /></button>}
          <div className="btn-row">
            <button className="btn btn-sm btn-success" onClick={() => responder(v.id, true)}>Autorizar</button>
            <button className="btn btn-sm btn-danger" onClick={() => responder(v.id, false)}>Denegar</button>
          </div>
        </div>
      ))}

      <BotonSOS onSOS={cargar} />

      {sosActivos.map((s) => (
        <div className="sos-banner" key={s.id}>
          <h3><Icon name="alert" className="h-ico" />Mi SOS activo{s.tipo ? ` — ${s.tipo}` : ''}</h3>
          <p className="sm" style={{ margin: '4px 0 12px' }}>{s.estado === 'atendida' ? 'Atendida por portería' : 'Enviada a portería'}{s.creada ? ` · ${fechaUtc(s.creada).toLocaleString('es-VE')}` : ''}</p>
          <button className="btn btn-sm btn-ghost" onClick={() => cancelarSOS(s)}>Cancelar (falsa alarma)</button>
        </div>
      ))}

      <div className="card">
        <h3><Icon name="ticket" className="h-ico" />Invitar una visita</h3>
        <form onSubmit={crear} className="stack">
          <div className="field"><label>Nombre del visitante</label><input className="inp" value={f.visitante} onChange={(e) => setF({ ...f, visitante: e.target.value })} required /></div>
          <div className="seg" style={{ margin: 0 }}>
            <button type="button" className={f.tipo === 'unico' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'unico' })}>Un solo uso</button>
            <button type="button" className={f.tipo === 'recurrente' ? 'active' : ''} onClick={() => setF({ ...f, tipo: 'recurrente' })}>Recurrente</button>
          </div>
          <div className="grid2">
            <div className="field"><label>Válido por (horas)</label><input className="inp" type="number" min="1" max="720" value={f.horas} onChange={(e) => setF({ ...f, horas: e.target.value })} /></div>
            <div className="field"><label>Ventana (opcional)</label><input className="inp" placeholder="Ej. 6–9 pm" value={f.ventana} onChange={(e) => setF({ ...f, ventana: e.target.value })} /></div>
          </div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Generar pase y compartir</SubmitBtn>
        </form>
      </div>

      <div className="card">
        <h3><Icon name="ticket" className="h-ico" />Mis pases</h3>
        {!pases.length && <Empty ico="🎫">Aún no has creado pases.</Empty>}
        {pases.map((p) => {
          const venc = new Date(p.expira.replace(' ', 'T') + 'Z') < new Date()
          const usado = p.tipo === 'unico' && p.usos > 0
          return (
            <div className="list-item" key={p.token}>
              <div className="li-ico"><Icon name="ticket" /></div>
              <div className="li-body">
                <div className="li-title">{p.visitante} {usado ? <span className="chip neutral">usado</span> : venc ? <span className="chip off">vencido</span> : <span className="chip ok">activo</span>}</div>
                <div className="li-sub">
                  {p.codigo && <><span style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', letterSpacing: '.06em' }}>{formatearCodigo(p.codigo)}</span> · </>}
                  {p.tipo === 'recurrente' ? 'Recurrente' : 'Un uso'} · vence {fechaUtc(p.expira).toLocaleDateString('es-VE')}
                </div>
              </div>
              <div className="li-actions">
                <button className="chip info" onClick={() => setVerPase(p)}>Ver QR</button>
                {!venc && !usado && <button className="chip info" onClick={() => compartir(`/pase/${p.token}`, p.visitante, p.codigo)}>Compartir</button>}
                {!venc && !usado && <button className="chip off" onClick={() => cancelarPase(p)}>Cancelar</button>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3><Icon name="box" className="h-ico" />Mis paquetes</h3>
        {!paquetes.length && <Empty ico="📦">Sin paquetes en portería.</Empty>}
        {paquetes.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="li-ico"><Icon name="box" /></div>
            <div className="li-body"><div className="li-title">{p.descripcion}</div>
              <div className="li-sub">{p.remitente ? `${p.remitente} · ` : ''}{fechaUtc(p.creada).toLocaleDateString('es-VE')}</div></div>
            <span className={`chip ${p.estado === 'entregado' ? 'ok' : 'pend'}`}>{p.estado === 'entregado' ? 'Entregado' : 'Por retirar'}</span>
          </div>
        ))}
      </div>

      {verFoto && <VisorMedia keyMedia={verFoto} onCerrar={() => setVerFoto(null)} />}
      {verPase && <PaseQR pase={verPase} onClose={() => setVerPase(null)} />}
    </>
  )
}

function BotonSOS({ onSOS }: { onSOS: () => void }) {
  const [prog, setProg] = useState(0)
  const timer = useRef<any>(null)
  const toast = useToast()
  const start = () => {
    let p = 0
    timer.current = setInterval(() => { p += 5; setProg(p); if (p >= 100) { clearInterval(timer.current); disparar() } }, 75)
  }
  const stop = () => { clearInterval(timer.current); setProg(0) }
  const disparar = async () => {
    setProg(0)
    const tipo = prompt('Tipo de emergencia (médica, seguridad, incendio…):') || 'Emergencia'
    try { await api('/accesos/sos', { method: 'POST', body: JSON.stringify({ tipo }) }); toast('🚨 SOS enviado a portería', 'ok'); onSOS() }
    catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <button
      className="btn btn-danger block" style={{ position: 'relative', overflow: 'hidden', minHeight: 56, fontSize: '1rem' }}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${prog}%`, background: 'rgba(0,0,0,.25)' }} />
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="alert" size={18} /> {prog > 0 ? 'Mantén presionado…' : 'SOS — mantén presionado'}</span>
    </button>
  )
}

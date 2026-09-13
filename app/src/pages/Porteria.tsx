import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { api, apiVivo, conError, fechaUtc, subirArchivo, type Me } from '../api'
import { Shell, type NavItem } from '../shell'
import { VisorMedia } from '../components/Media'
import { Kpi, Empty, SubmitBtn, useToast, useAsync } from '../ui'
import { Icon } from '../components/icons'
import { formatearCodigo } from '../codigo'
import { registrarSondeo } from '../ciclo'
import { EN_APP } from '../plataforma'
import { pedirPermisoCamara, abrirAjustesDeLaApp } from '../permisos'

const NAV: NavItem[] = [
  { key: 'cola', label: 'Cola', ico: '🚦' },
  { key: 'escanear', label: 'Escanear', ico: '📷' },
  { key: 'sincita', label: 'Sin cita', ico: '🔔' },
  { key: 'delivery', label: 'Delivery', ico: '🛵' },
  { key: 'paqueteria', label: 'Paquetes', ico: '📦' },
  { key: 'rondas', label: 'Rondas', ico: '🗺️' },
]

// Carga las unidades del condominio con el nombre de su torre, para distinguir "1A" de dos torres distintas.
const cargarUnidades = (setter: (u: any[]) => void) => apiVivo('/estructura', (d: any) => setter([
  ...d.torres.flatMap((t: any) => (t.unidades ?? []).map((u: any) => ({ ...u, torre: t.nombre }))),
  ...(d.sinTorre ?? []).map((u: any) => ({ ...u, torre: '' })),
])).catch(() => {})
const etiquetaUnidad = (u: any) => (u.torre ? `${u.torre} · ${u.nombre}` : u.nombre)

export function Porteria({ me, condo, selector, onSalir }: { me: Me; condo: any; selector?: React.ReactNode; onSalir: () => void }) {
  const [activo, setActivo] = useState('cola')
  const [sos, setSos] = useState<any[]>([])
  const [kpi, setKpi] = useState({ pases: 0, paquetes: 0 })
  const toast = useToast()
  const pollSos = () => apiVivo('/accesos/sos', (d: any) => setSos(d.alertas)).catch(() => {})
  const cargarKpi = () => {
    apiVivo('/accesos/cola', (d: any) => setKpi((k) => ({ ...k, pases: d.pases.length + d.pendientes.length }))).catch(() => {})
    apiVivo('/accesos/paquetes', (d: any) => setKpi((k) => ({ ...k, paquetes: d.paquetes.length }))).catch(() => {})
  }
  useEffect(() => { pollSos(); cargarKpi(); return registrarSondeo(pollSos, 8000) }, [])
  const atender = async (id: string, estado: string) => {
    const r = await conError(() => api(`/accesos/sos/${id}/atender`, { method: 'POST', body: JSON.stringify({ estado }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(estado === 'resuelta' ? 'SOS resuelto' : 'En camino', 'ok'); pollSos() }
  }
  return (
    <Shell brand="Aldaba Guardia" subtitle={condo.nombre} selector={selector} onSalir={onSalir} dark side={false} esDemo={condo.es_demo === 1}
      meta={<span className="xs">Turno · {me.nombre}</span>} nav={NAV} activo={activo} setActivo={setActivo}>
      {sos.filter((s) => s.estado !== 'resuelta').map((s) => (
        <div className="sos-banner" key={s.id}>
          <h3><Icon name="alert" className="h-ico" />Alerta SOS · {s.tipo}</h3>
          <p className="sm" style={{ margin: '4px 0 12px' }}>{s.residente}{s.unidad ? ` · ${s.unidad}` : ''} · {fechaUtc(s.creada).toLocaleTimeString('es-VE')}</p>
          <div className="btn-row">
            {s.estado === 'activa' && <button className="btn btn-sm" style={{ background: '#fff', color: '#B91C1C' }} onClick={() => atender(s.id, 'atendida')}>Voy en camino</button>}
            <button className="btn btn-sm btn-ghost" onClick={() => atender(s.id, 'resuelta')}>Marcar resuelta</button>
          </div>
        </div>
      ))}
      <div className="kpis">
        <Kpi label="En cola" val={kpi.pases} ico="🚦" />
        <Kpi label="Paquetes" val={kpi.paquetes} ico="📦" />
        <Kpi label="Alertas SOS" val={sos.filter((s) => s.estado !== 'resuelta').length} ico="🚨" />
        <Kpi label="Turno" val={me.nombre.split(' ')[0]} ico="👮" />
      </div>
      {activo === 'cola' && <Cola onChange={cargarKpi} />}
      {activo === 'escanear' && <Escanear onChange={cargarKpi} />}
      {activo === 'sincita' && <SinCita />}
      {activo === 'delivery' && <Delivery />}
      {activo === 'paqueteria' && <Paqueteria onChange={cargarKpi} />}
      {activo === 'rondas' && <Rondas />}
    </Shell>
  )
}

function Cola({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<any>({ pases: [], pendientes: [], resueltas: [] })
  const toast = useToast()
  const cargar = () => apiVivo('/accesos/cola', setData).catch((e) => toast(e.message, 'err'))
  useEffect(() => { cargar(); return registrarSondeo(cargar, 10000) }, [])
  const registrar = async (token: string) => {
    const r = await conError(() => api(`/accesos/pases/${token}/registrar`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(`Ingreso registrado: ${r.visitante}`, 'ok'); cargar(); onChange() }
  }
  return (
    <div className="card">
      <h3><Icon name="queue" className="h-ico" />Cola de accesos</h3>
      {!data.pases.length && !data.pendientes.length && !data.resueltas?.length && <Empty ico="✅">Nadie esperando ahora mismo.</Empty>}
      {(data.resueltas ?? []).map((v: any) => (
        <div className="list-item" key={v.id}>
          <div className="li-ico" style={{ background: v.estado === 'ingreso' ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: v.estado === 'ingreso' ? '#86EFAC' : '#FCA5A5' }}>
            <Icon name={v.estado === 'ingreso' ? 'check' : 'alert'} /></div>
          <div className="li-body"><div className="li-title">{v.visitante} <span className={`chip ${v.estado === 'ingreso' ? 'ok' : 'off'}`}>{v.estado === 'ingreso' ? 'el residente autorizó el ingreso' : 'el residente denegó el ingreso'}</span></div>
            <div className="li-sub">{v.unidad ?? '—'} · {fechaUtc(v.creada).toLocaleTimeString('es-VE')}</div></div>
        </div>
      ))}
      {data.pendientes.map((v: any) => (
        <div className="list-item" key={v.id}>
          <div className="li-ico" style={{ background: 'rgba(37,99,235,.2)', color: '#93C5FD' }}><Icon name="bell" /></div>
          <div className="li-body"><div className="li-title">{v.visitante} <span className="chip pend">esperando al residente</span></div>
            <div className="li-sub">{v.unidad ?? '—'}{v.motivo ? ` · ${v.motivo}` : ''}</div></div>
        </div>
      ))}
      {data.pases.map((p: any) => (
        <div className="list-item" key={p.token}>
          <div className="li-ico" style={{ background: 'rgba(34,197,94,.15)', color: '#86EFAC' }}><Icon name="ticket" /></div>
          <div className="li-body"><div className="li-title">{p.visitante} <span className="chip info">{p.tipo === 'recurrente' ? 'recurrente' : 'QR un uso'}</span></div>
            <div className="li-sub">
              {p.codigo && <><span style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', letterSpacing: '.06em' }}>{formatearCodigo(p.codigo)}</span> · </>}
              {p.unidad ?? '—'} · {p.anfitrion}{p.ventana ? ` · ${p.ventana}` : ''}
            </div></div>
          <button className="chip ok" onClick={() => registrar(p.token)}>Dejar pasar</button>
        </div>
      ))}
    </div>
  )
}

function Escanear({ onChange }: { onChange: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [activo, setActivo] = useState(false)
  const [codigo, setCodigo] = useState('')
  const toast = useToast()
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const extraerToken = (txt: string) => txt.includes('/pase/') ? txt.split('/pase/')[1].split(/[/?#]/)[0] : txt.trim()
  const registrar = async (token: string) => {
    if (!token) return
    // encodeURIComponent porque el guardia puede teclear el código con el espacio del
    // formato "A4K 7TM": sin escapar, ese espacio parte el segmento de la ruta.
    const r = await conError(() => api(`/accesos/pases/${encodeURIComponent(token)}/registrar`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(`✓ Ingreso: ${r.visitante}`, 'ok'); onChange() }
    setCodigo('')
  }
  const parar = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null; setActivo(false)
  }
  const iniciar = async () => {
    // App nativa: el permiso de cámara se pide AQUÍ, en el punto de uso — no basta con el
    // que se pidió tras el login (la sesión persistente hace que el login sea raro, y el
    // portero pudo negarlo entonces). Sin el permiso nativo, getUserMedia falla en seco.
    if (EN_APP) {
      const permiso = await pedirPermisoCamara()
      if (permiso === 'denegado') {
        toast('La cámara está bloqueada para Aldaba. Actívala en Permisos → Cámara.', 'err')
        void abrirAjustesDeLaApp() // único camino legítimo: el diálogo del sistema ya no vuelve a salir
        return
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream; setActivo(true)
      const v = videoRef.current!; v.srcObject = stream; await v.play()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const tick = () => {
        if (v.readyState === v.HAVE_ENOUGH_DATA) {
          canvas.width = v.videoWidth; canvas.height = v.videoHeight
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height)
          if (code?.data) { parar(); registrar(extraerToken(code.data)); return }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch { toast('No se pudo acceder a la cámara. Usa el código manual.', 'err') }
  }
  useEffect(() => () => parar(), [])
  return (
    <div className="card">
      <h3><Icon name="camera" className="h-ico" />Escanear pase QR</h3>
      <div style={{ background: '#000', borderRadius: 14, overflow: 'hidden', aspectRatio: '4/3', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: activo ? 'block' : 'none' }} />
        {!activo && <div style={{ color: '#93A4C0', textAlign: 'center', padding: 20 }}>📷<br />Apunta el QR del visitante a la cámara</div>}
      </div>
      {activo ? <button className="btn btn-ghost block" onClick={parar}>Detener cámara</button>
        : <button className="btn btn-primary block" onClick={iniciar}>Encender cámara</button>}
      <div style={{ margin: '16px 0 8px', textAlign: 'center' }} className="xs muted-txt">
        — o escribe el código de 6 caracteres que te dicte el visitante —
      </div>
      <form onSubmit={(e) => { e.preventDefault(); registrar(extraerToken(codigo)) }} className="row">
        <input className="inp" placeholder="Ej. A4K 7TM" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', letterSpacing: '.08em' }}
          value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <button className="btn btn-primary">Validar</button>
      </form>
    </div>
  )
}

function SinCita() {
  const [f, setF] = useState({ visitante: '', documento: '', unidad_id: '', motivo: '' })
  const [foto, setFoto] = useState<string | null>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  useEffect(() => { cargarUnidades(setUnidades) }, [])
  const subir = async (file?: File) => { if (!file) return; try { setFoto(await subirArchivo(file)); toast('Foto adjuntada', 'ok') } catch (e) { toast((e as Error).message, 'err') } }
  const llamar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/accesos/sincita', { method: 'POST', body: JSON.stringify({ ...f, foto_key: foto }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Llamando al residente por citófono…', 'ok'); setF({ visitante: '', documento: '', unidad_id: '', motivo: '' }); setFoto(null)
  }, e)
  return (
    <div className="card">
      <h3><Icon name="bell" className="h-ico" />Visita sin cita</h3>
      <p className="li-sub" style={{ marginBottom: 12 }}>Se notifica al residente por citófono virtual.</p>
      <form onSubmit={llamar} className="stack">
        <div className="grid2">
          <div className="field"><label>Visitante</label><input className="inp" value={f.visitante} onChange={(e) => setF({ ...f, visitante: e.target.value })} required /></div>
          <div className="field"><label>Documento</label><input className="inp" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
        </div>
        <div className="field"><label>Unidad de destino</label>
          <select className="inp" value={f.unidad_id} onChange={(e) => setF({ ...f, unidad_id: e.target.value })} required>
            <option value="">— seleccionar —</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{etiquetaUnidad(u)}</option>)}
          </select></div>
        <div className="field"><label>Motivo</label><input className="inp" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Visita personal, servicio…" /></div>
        <div className="field"><label>Foto del documento</label><input className="inp" type="file" accept="image/*" onChange={(e) => subir(e.target.files?.[0])} />{foto && <div className="hint" style={{ color: 'var(--success)' }}>✓ adjuntada</div>}</div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Llamar al residente</SubmitBtn>
      </form>
    </div>
  )
}

function Delivery() {
  const [f, setF] = useState({ visitante: '', unidad_id: '' })
  const [unidades, setUnidades] = useState<any[]>([])
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  useEffect(() => { cargarUnidades(setUnidades) }, [])
  const registrar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/accesos/delivery', { method: 'POST', body: JSON.stringify({ visitante: f.visitante, unidad_id: f.unidad_id || undefined }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    const u = unidades.find((x) => x.id === f.unidad_id)
    setLista((l) => [{ visitante: f.visitante, unidad: u ? etiquetaUnidad(u) : '', hora: new Date().toLocaleTimeString('es-VE') }, ...l].slice(0, 20))
    toast('Delivery registrado en bitácora', 'ok'); setF({ visitante: '', unidad_id: '' })
  }, e)
  return (
    <>
      <div className="card">
        <h3><Icon name="bell" className="h-ico" />Registrar delivery</h3>
        <p className="li-sub" style={{ marginBottom: 12 }}>Repartidor de comida o mensajería que entra y sale (queda en la bitácora de seguridad).</p>
        <form onSubmit={registrar} className="stack">
          <div className="field"><label>Descripción</label><input className="inp" value={f.visitante} onChange={(e) => setF({ ...f, visitante: e.target.value })} placeholder="PedidosYa · pizza para…" required /></div>
          <div className="field"><label>Unidad de destino (opcional)</label>
            <select className="inp" value={f.unidad_id} onChange={(e) => setF({ ...f, unidad_id: e.target.value })}>
              <option value="">— sin especificar —</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{etiquetaUnidad(u)}</option>)}
            </select></div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Registrar delivery</SubmitBtn>
        </form>
      </div>
      {!!lista.length && (
        <div className="card">
          <h3>Registrados este turno <span className="sub">{lista.length}</span></h3>
          {lista.map((d, i) => (
            <div className="list-item" key={i}>
              <div className="li-ico"><Icon name="check" /></div>
              <div className="li-body"><div className="li-title">{d.visitante}</div><div className="li-sub">{d.unidad || 'sin unidad'} · {d.hora}</div></div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Paqueteria({ onChange }: { onChange: () => void }) {
  const [f, setF] = useState({ unidad_id: '', descripcion: '', remitente: '' })
  const [foto, setFoto] = useState<string | null>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/accesos/paquetes', (d: any) => setLista(d.paquetes)).catch(() => {})
  useEffect(() => { cargarUnidades(setUnidades); cargar() }, [])
  const subir = async (file?: File) => { if (!file) return; try { setFoto(await subirArchivo(file)); toast('Foto adjuntada', 'ok') } catch (e) { toast((e as Error).message, 'err') } }
  const registrar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/accesos/paquetes', { method: 'POST', body: JSON.stringify({ ...f, foto_key: foto }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Paquete registrado · residente notificado', 'ok'); setF({ unidad_id: '', descripcion: '', remitente: '' }); setFoto(null); cargar(); onChange()
  }, e)
  const entregar = async (id: string) => {
    const r = await conError(() => api(`/accesos/paquetes/${id}/entregar`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Paquete entregado', 'ok'); cargar(); onChange() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="box" className="h-ico" />Registrar paquete</h3>
        <form onSubmit={registrar} className="stack">
          <div className="field"><label>Unidad</label>
            <select className="inp" value={f.unidad_id} onChange={(e) => setF({ ...f, unidad_id: e.target.value })} required>
              <option value="">— seleccionar —</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{etiquetaUnidad(u)}</option>)}
            </select></div>
          <div className="grid2">
            <div className="field"><label>Descripción</label><input className="inp" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></div>
            <div className="field"><label>Remitente</label><input className="inp" value={f.remitente} onChange={(e) => setF({ ...f, remitente: e.target.value })} placeholder="Amazon, MRW…" /></div>
          </div>
          <div className="field"><label>Foto</label><input className="inp" type="file" accept="image/*" onChange={(e) => subir(e.target.files?.[0])} />{foto && <div className="hint" style={{ color: 'var(--success)' }}>✓ adjuntada</div>}</div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Registrar y avisar</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>En custodia <span className="sub">{lista.length}</span></h3>
        {!lista.length && <Empty ico="📦">Sin paquetes en custodia.</Empty>}
        {lista.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="li-ico"><Icon name="box" /></div>
            <div className="li-body"><div className="li-title">{p.unidad} · {p.descripcion}</div>
              <div className="li-sub">{p.remitente ? `${p.remitente} · ` : ''}{fechaUtc(p.creada).toLocaleString('es-VE')}</div></div>
            <button className="chip ok" onClick={() => entregar(p.id)}>Entregar</button>
          </div>
        ))}
      </div>
    </>
  )
}

function Rondas() {
  const [f, setF] = useState({ checkpoint: '', novedad: '' })
  const [foto, setFoto] = useState<string | null>(null)
  const [verFoto, setVerFoto] = useState<string | null>(null)
  const [lista, setLista] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  const cargar = () => apiVivo('/accesos/rondas', (d: any) => setLista(d.rondas)).catch(() => {})
  useEffect(() => { cargar() }, [])
  const subir = async (file?: File) => { if (!file) return; try { setFoto(await subirArchivo(file)); toast('Foto adjuntada', 'ok') } catch (e) { toast((e as Error).message, 'err') } }
  const registrar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/accesos/rondas', { method: 'POST', body: JSON.stringify({ ...f, foto_key: foto }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast('Checkpoint registrado', 'ok'); setF({ checkpoint: '', novedad: '' }); setFoto(null); cargar()
  }, e)
  return (
    <>
      <div className="card">
        <h3><Icon name="map" className="h-ico" />Registrar checkpoint</h3>
        <form onSubmit={registrar} className="stack">
          <div className="field"><label>Punto</label><input className="inp" value={f.checkpoint} onChange={(e) => setF({ ...f, checkpoint: e.target.value })} placeholder="Sótano, azotea, lobby…" required /></div>
          <div className="field"><label>Novedad (opcional)</label><input className="inp" value={f.novedad} onChange={(e) => setF({ ...f, novedad: e.target.value })} placeholder="Sin novedad / portón abierto…" /></div>
          <div className="field"><label>Foto (si hay novedad)</label><input className="inp" type="file" accept="image/*" onChange={(e) => subir(e.target.files?.[0])} />{foto && <div className="hint" style={{ color: 'var(--success)' }}>✓ adjuntada</div>}</div>
          <SubmitBtn loading={loading} className="btn btn-primary block">Registrar checkpoint</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3>Rondas recientes</h3>
        {!lista.length && <Empty ico="🗺️">Aún no hay checkpoints registrados.</Empty>}
        {lista.map((r, i) => (
          <div className="list-item" key={i}>
            <div className="li-ico" style={{ background: r.novedad ? 'var(--warn-bg)' : undefined, color: r.novedad ? 'var(--warn)' : undefined }}><Icon name={r.novedad ? 'alert' : 'check'} /></div>
            <div className="li-body"><div className="li-title">{r.checkpoint}</div>
              <div className="li-sub">{r.novedad || 'Sin novedad'} · {r.guardia} · {fechaUtc(r.creada).toLocaleTimeString('es-VE')}</div></div>
            {r.foto_key && <button className="chip info" onClick={() => setVerFoto(r.foto_key)}>Foto</button>}
          </div>
        ))}
      </div>
      {verFoto && <VisorMedia keyMedia={verFoto} onCerrar={() => setVerFoto(null)} />}
    </>
  )
}

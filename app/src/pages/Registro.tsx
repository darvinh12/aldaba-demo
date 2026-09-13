import { useEffect, useState } from 'react'
import { api } from '../api'
import { SubmitBtn } from '../ui'
import { Aurora, CornerMarks } from '../components/effects'

const ROL_TXT: Record<string, string> = { admin: 'Administrador', org_admin: 'Administrador de organización', porteria: 'Portería', residente: 'Residente' }

export function Registro({ onListo }: { onListo: () => void }) {
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const [info, setInfo] = useState<any>(null), [error, setError] = useState('')
  const [nombre, setNombre] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [telefono, setTelefono] = useState('')
  const [cargando, setCargando] = useState(false)
  useEffect(() => { api(`/invitacion/${token}`).then(setInfo).catch((e) => setError(e.message)) }, [token])
  const registrar = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setCargando(true)
    try { await api('/registro', { method: 'POST', body: JSON.stringify({ token, nombre, email, password, telefono }) }); onListo() }
    catch (err) { setError((err as Error).message); setCargando(false) }
  }
  if (error && !info) return <div className="centrado lab"><Aurora /><div className="card auth-wrap corner-marks" style={{ textAlign: 'center' }}><CornerMarks /><div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🔒</div><p className="muted-txt">{error}</p></div></div>
  if (!info) return <div className="centrado lab" style={{ color: '#fff' }}><Aurora /><div className="spin" /></div>
  return (
    <div className="centrado lab">
      <Aurora />
      <form className="card auth-wrap corner-marks" style={{ padding: 30 }} onSubmit={registrar}>
        <CornerMarks />
        <span className="badge-soft">Invitación válida</span>
        <h2 style={{ fontSize: '1.35rem', margin: '10px 0 3px' }}>Bienvenido a {info.condominio}</h2>
        <p className="muted-txt sm" style={{ marginBottom: 16 }}>
          {info.unidad ? `Unidad ${info.unidad} · crea tu cuenta` : `Acceso como ${ROL_TXT[info.rol] ?? info.rol} · crea tu cuenta`}
        </p>
        <div className="field"><label>Nombre y apellido</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" maxLength={120} /></div>
        <div className="field"><label>Correo</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></div>
        <div className="field"><label>Teléfono (WhatsApp)</label>
          <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="tel" placeholder="0414…" /></div>
        <div className="field"><label>Clave</label>
          <input type="password" value={password} minLength={10} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
          <div className="hint">Mínimo 10 caracteres.</div></div>
        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: '.82rem', margin: '2px 0 12px' }}>⚠ {error}</p>}
        <SubmitBtn loading={cargando}>Crear cuenta</SubmitBtn>
      </form>
    </div>
  )
}

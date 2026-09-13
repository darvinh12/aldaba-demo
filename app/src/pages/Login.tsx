import { useState } from 'react'
import { api } from '../api'
import { setToken } from '../plataforma'
import { SubmitBtn } from '../ui'
import { CornerMarks } from '../components/effects'
import { LogoMark } from '../components/brand'

export function Login({ onListo }: { onListo: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [error, setError] = useState(''), [cargando, setCargando] = useState(false)
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setCargando(true)
    try {
      // En la app nativa el login devuelve la sesión como token (la cookie __Host- no viaja cross-origin).
      const r = await api<{ token?: string }>('/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (r.token) setToken(r.token)
      onListo()
    }
    catch (err) { setError((err as Error).message); setCargando(false) }
  }
  return (
    <div className="centrado lab">
      <div className="auth-wrap">
      <div className="card" style={{ padding: 14, marginBottom: 16, textAlign: 'center' }}>
        <div className="mono-label" style={{ marginBottom: 6 }}>Demostración pública</div>
        <p className="sm" style={{ margin: 0 }}>
          Usuario <strong>Demo</strong> · Clave <strong>Demo1234</strong>
        </p>
        <p className="muted-txt xs" style={{ margin: '6px 0 0' }}>
          Datos ficticios. Ya dentro, un selector te deja recorrer los cuatro roles: junta, administración, portería y residente.
        </p>
      </div>
      <form className="card corner-marks" style={{ padding: 30 }} onSubmit={entrar}>
        <CornerMarks />
        <div className="eyebrow" style={{ marginBottom: 18 }}>Aldaba</div>
        <div className="row" style={{ marginBottom: 22 }}>
          <LogoMark size={46} />
          <div>
            <div style={{ fontFamily: 'var(--font-h)', fontWeight: 600, fontSize: '1.5rem', letterSpacing: '-.04em', color: '#fff' }}>Aldaba</div>
            <div className="muted-txt xs">Tu condominio en orden</div>
          </div>
        </div>
        {/* type="text", NO "email": el worker acepta un identificador sin arroba y lo
            resuelve contra el dominio de las cuentas de demostración (normalizarIdentificador
            en routes/auth.ts). Con type="email" el navegador valida en el cliente y bloquea
            "Demo" antes de enviar el formulario, así que la cuenta publicada no entraba. */}
        <div className="field"><label>Usuario o correo</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required
            autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Demo" /></div>
        <div className="field"><label>Clave</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" /></div>
        {error && <p role="alert" style={{ color: '#fca5a5', fontSize: '.82rem', margin: '2px 0 12px' }}>⚠ {error}</p>}
        <SubmitBtn loading={cargando}>Entrar</SubmitBtn>
        <p className="muted-txt xs" style={{ textAlign: 'center', marginTop: 16, fontFamily: 'var(--font-mono)', letterSpacing: '.05em' }}>Acceso privado · cifrado extremo a extremo</p>
      </form>
      </div>
    </div>
  )
}

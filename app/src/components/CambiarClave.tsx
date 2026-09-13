/** Cambio de clave. Sirve para las dos situaciones:
 *
 *   · OBLIGATORIO (`forzado`): el condominio arrancó con una clave temporal compartida por
 *     todas las cuentas. Mientras alguien no la cambie, cualquiera que sepa esa clave entra
 *     a su apartamento. Por eso esta pantalla tapa la app entera y no se puede saltar.
 *   · VOLUNTARIO: desde Ajustes, cuando uno quiere.
 *
 *  El servidor CIERRA LAS DEMÁS SESIONES al cambiarla, así que si dos personas habían
 *  entrado al mismo apartamento con la clave compartida, la que cambia se queda con la
 *  cuenta. Eso se avisa acá, porque si no parece un fallo. */
import { useState } from 'react'
import { api, conError } from '../api'
import { Sheet, SubmitBtn, useAsync, useToast } from '../ui'
import { Aurora, CornerMarks } from './effects'
import { LogoMark } from './brand'

function Formulario({ forzado, onListo }: { forzado: boolean; onListo: () => void }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [ver, setVer] = useState(false)
  const toast = useToast()
  const { loading, run } = useAsync()

  // Se valida acá lo mismo que valida el worker, para no gastar un viaje ni un intento del
  // rate limit en un error que se ve a simple vista.
  const corta = nueva.length > 0 && nueva.length < 10
  const distintas = repetida.length > 0 && nueva !== repetida
  const igualALaVieja = nueva.length > 0 && nueva === actual

  const enviar = (e: React.FormEvent) => run(async () => {
    if (corta || distintas || igualALaVieja) return
    const r = await conError(
      () => api('/clave', { method: 'POST', body: JSON.stringify({ actual, nueva }) }),
      (m) => toast(m, 'err'),
    )
    if (r === undefined) return
    toast(r.otrasCerradas ? `Clave cambiada. Se cerraron ${r.otrasCerradas} sesión(es) en otros equipos.` : 'Clave cambiada', 'ok')
    onListo()
  }, e)

  return (
    <form onSubmit={enviar} className="stack">
      <div className="field">
        <label>{forzado ? 'Clave temporal (la que te dieron)' : 'Clave actual'}</label>
        <input className="inp" type={ver ? 'text' : 'password'} autoComplete="current-password"
          value={actual} onChange={(e) => setActual(e.target.value)} required />
      </div>
      <div className="field">
        <label>Clave nueva</label>
        <input className="inp" type={ver ? 'text' : 'password'} autoComplete="new-password"
          value={nueva} onChange={(e) => setNueva(e.target.value)} required />
        <span className="hint" style={corta || igualALaVieja ? { color: 'var(--danger, #DC2626)' } : undefined}>
          {corta ? 'Mínimo 10 caracteres.'
            : igualALaVieja ? 'Tiene que ser distinta de la actual.'
            : 'Mínimo 10 caracteres. Que no sea tu apartamento ni tu cédula.'}
        </span>
      </div>
      <div className="field">
        <label>Repetí la clave nueva</label>
        <input className="inp" type={ver ? 'text' : 'password'} autoComplete="new-password"
          value={repetida} onChange={(e) => setRepetida(e.target.value)} required />
        {distintas && <span className="hint" style={{ color: 'var(--danger, #DC2626)' }}>Las dos claves no coinciden.</span>}
      </div>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
        <span className="sm">Ver lo que escribo</span>
      </label>
      <SubmitBtn loading={loading} className="btn btn-primary block">Cambiar mi clave</SubmitBtn>
    </form>
  )
}

/** Pantalla completa que tapa la app hasta que la clave compartida deje de existir. */
export function CambiarClaveForzado({ nombre, onListo, onSalir }: { nombre: string; onListo: () => void; onSalir: () => void }) {
  return (
    <div className="centrado lab">
      <Aurora />
      <div className="card auth-wrap corner-marks" style={{ maxWidth: 420 }}>
        <CornerMarks />
        <div className="eyebrow" style={{ marginBottom: 10 }}>Aldaba · Primer ingreso</div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 6 }}>
          <LogoMark />
          <h2 style={{ fontSize: '1.3rem', margin: 0 }}>Elegí tu clave</h2>
        </div>
        <p className="sm muted-txt" style={{ margin: '6px 0 18px' }}>
          {/* Nombre COMPLETO, no el primer trozo: las cuentas se llaman "Apartamento 11A" y
              cortar por el espacio dejaba un "Hola Apartamento." que suena a error. */}
          Hola, {nombre}. Entraste con la clave temporal que le dieron a todo el edificio, así que
          por ahora <b>cualquiera que la sepa puede entrar a tu apartamento</b>. Poné una tuya y
          eso se acaba.
        </p>
        <Formulario forzado onListo={onListo} />
        <button className="btn btn-ghost block" style={{ marginTop: 12 }} onClick={onSalir}>Salir</button>
      </div>
    </div>
  )
}

/** El mismo formulario, en una hoja, para cambiarla cuando uno quiera. */
export function CambiarClaveSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Cambiar mi clave" onClose={onClose}>
      <Formulario forzado={false} onListo={onClose} />
    </Sheet>
  )
}

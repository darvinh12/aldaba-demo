import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, apiVivo, type Me, getCondoActivo, setCondoActivo, getRolActivo, setRolActivo, purgarCacheOtrosCondos, anotarPurgaCache } from './api'
import { EN_APP, getToken } from './plataforma'
import { estadoPermisos } from './permisos'
import { useVistaAtras } from './navegacion'
import { Login } from './pages/Login'
import { Registro } from './pages/Registro'
import { SuperAdmin } from './pages/SuperAdmin'
import { Admin } from './pages/Admin'
import { Residente } from './pages/Residente'
import { Porteria } from './pages/Porteria'
import { Pase } from './pages/Pase'
import { Icon } from './components/icons'
import { apagarDemoSiSesionReal } from './components/demo'
import { Bienvenida } from './components/Bienvenida'
import { CambiarClaveForzado } from './components/CambiarClave'

// Marca de instalación: la bienvenida de permisos se muestra una sola vez por instalación.
// Si el sistema borra los datos del WebView también revoca los permisos, así que volver a
// mostrarla en ese caso es correcto, no un error.
const CLAVE_BIENVENIDA = 'aldaba_bienvenida'

const prec = (rol: string) => ({ org_admin: 0, admin: 1, porteria: 2, residente: 3 } as Record<string, number>)[rol] ?? 9

// Cierre de sesión efectivo (ya confirmado por el usuario). En nativo, api()
// también borra el token guardado al responder /logout.
// La purga se anota ANTES de pedir nada: si el /logout no llega (sin red) el usuario sigue con
// sesión, pero la copia offline se borra igual en el arranque siguiente — pidió salir.
const cerrarSesionYa = async () => {
  anotarPurgaCache('todo')
  try { await api('/logout', { method: 'POST' }) } finally { location.reload() }
}

export function App() {
  // 'sinred' (solo app nativa): /me falló pero el token guardado sigue vivo — un arranque
  // sin señal NO debe botar al dueño al Login como si hubiera perdido la sesión.
  // sesionMuerta() (api.ts) borra el token ANTES de lanzar, así que aquí getToken()
  // distingue con certeza "sesión muerta" (null → Login) de "fallo transitorio".
  // Con la cache offline activa, api('/me') resuelve con la copia guardada y esta pantalla
  // queda para el único caso que no tiene remedio: primer arranque sin red y sin /me guardado.
  const [me, setMe] = useState<Me | null | 'cargando' | 'sinred'>('cargando')
  // Lectura viva: si /me se sirve desde la copia guardada, la revalidación vuelve a entrar por
  // aquí con el estado real (rol o membresía revocados incluidos) sin pedirlo otra vez.
  const recargar = () => apiVivo<Me>('/me', (m) => { if (m?.condominios) { apagarDemoSiSesionReal(m.condominios); setMe(m) } })
    .catch(() => setMe(EN_APP && getToken() ? 'sinred' : null))
  useEffect(() => {
    recargar()
    const s = () => setMe(null)
    window.addEventListener('aldaba:logout', s)
    return () => { window.removeEventListener('aldaba:logout', s) }
  }, [])

  // ── Cerrar sesión SIEMPRE con confirmación (lo pidió el dueño) ──
  // En la app nativa: diálogo del sistema (@capacitor/dialog). En web: modal propio.
  const [confirmandoSalida, setConfirmandoSalida] = useState(false)
  useVistaAtras(confirmandoSalida, () => setConfirmandoSalida(false))
  const salir = () => {
    if (!EN_APP) { setConfirmandoSalida(true); return }
    void (async () => {
      try {
        const { Dialog } = await import('@capacitor/dialog')
        const { value } = await Dialog.confirm({
          title: '¿Cerrar sesión?',
          message: 'Tendrás que volver a entrar con tu clave.',
          okButtonTitle: 'Cerrar sesión',
          cancelButtonTitle: 'Cancelar',
        })
        if (value) await cerrarSesionYa()
      } catch { setConfirmandoSalida(true) } // sin plugin Dialog: cae al modal propio
    })()
  }
  const modalSalida = confirmandoSalida ? createPortal(
    <div className="overlay" onClick={() => setConfirmandoSalida(false)}>
      <div className="sheet" style={{ maxWidth: 380, position: 'relative' }} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Cerrar sesión">
        <h3>¿Cerrar sesión?</h3>
        <p className="sm muted-txt" style={{ marginTop: 8 }}>Tendrás que volver a entrar con tu clave.</p>
        <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setConfirmandoSalida(false)} autoFocus>Cancelar</button>
          <button className="btn btn-primary" onClick={() => { void cerrarSesionYa() }}>Cerrar sesión</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  // ── Bienvenida y permisos del dispositivo (solo app nativa) ──
  // Los diálogos del sistema se queman (una sola vez), así que primero se explica con
  // pantalla propia y con el rol efectivo ya resuelto por /me.
  //
  // OJO, ESTO ERA UN BUG: antes esto exigía además `loginFresco`, o sea que la bienvenida
  // solo salía justo después de escribir usuario y clave. Con la sesión perpetua de la
  // 1.2.0 eso no vuelve a pasar casi nunca — quien actualizó desde la 1.1.1 entró con la
  // sesión ya migrada, nunca pasó por el Login, y por eso la app NUNCA le pidió permisos.
  // El "una sola vez" no lo daba ese gesto: lo da la marca CLAVE_BIENVENIDA de abajo.
  const [rolBienvenida, setRolBienvenida] = useState<string | null>(null)
  useEffect(() => {
    if (!EN_APP || !me || me === 'cargando' || me === 'sinred') return
    const lista = me.condominios
    const delActivo = lista.filter((c) => c.id === (getCondoActivo() ?? lista[0]?.id))
    const pool = delActivo.length ? delActivo : lista
    const rol = me.esSuperadmin ? 'admin' : ([...pool].sort((a, b) => prec(a.rol) - prec(b.rol))[0]?.rol ?? 'residente')
    let visto = false
    try { visto = localStorage.getItem(CLAVE_BIENVENIDA) === '1' } catch { /* storage bloqueado: se mostrará otra vez */ }
    if (visto) return
    void (async () => {
      // Reinstalación o limpieza solo del localStorage: si el sistema ya tiene concedido
      // todo lo que ese rol necesita, no hay nada que explicar — se marca y se sigue.
      const p = await estadoPermisos()
      const listos = p.notificaciones === 'concedido' && (rol !== 'porteria' || p.camara === 'concedido')
      if (listos) { try { localStorage.setItem(CLAVE_BIENVENIDA, '1') } catch { /* noop */ } return }
      setRolBienvenida(rol)
    })()
  }, [me])

  const condos: Me['condominios'] = me && me !== 'cargando' && me !== 'sinred' ? me.condominios : []
  const activo = useMemo(() => {
    if (!condos.length) return null
    const delActivo = condos.filter((c) => c.id === (getCondoActivo() ?? condos[0].id))
    const pool = delActivo.length ? delActivo : condos
    const elegido = [...pool].sort((a, b) => prec(a.rol) - prec(b.rol))[0]
    if (elegido && elegido.id !== getCondoActivo()) setCondoActivo(elegido.id)
    return elegido
  }, [condos])

  if (location.pathname.startsWith('/pase/')) return <Pase />
  if (location.pathname === '/registro') return <Registro onListo={() => { history.replaceState(null, '', '/'); recargar() }} />
  if (me === 'cargando') return <div className="centrado" style={{ background: 'var(--grad-primary)' }}><div className="spin" /></div>
  if (me === 'sinred') return (
    <div className="centrado"><div className="card" style={{ textAlign: 'center', maxWidth: 400 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', opacity: .5 }}><Icon name="alert" size={40} /></div>
      <h3 style={{ margin: '4px 0' }}>Sin conexión</h3>
      <p style={{ marginTop: 8 }}>Tu sesión sigue guardada, pero no hay señal para cargar tus datos.</p>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setMe('cargando'); recargar() }}>Reintentar</button>
    </div></div>
  )
  if (!me) return <Login onListo={() => recargar()} />

  // ANTES QUE NADA, incluso antes de los permisos: si la cuenta sigue con la clave temporal
  // compartida del arranque, no se ve un solo dato hasta cambiarla. Lo decide el servidor
  // (`debeCambiarClave` en /me), no una marca local que se pueda borrar. El superadmin nunca
  // entra acá: su cuenta no se creó en masa.
  if (me.debeCambiarClave) return (
    <CambiarClaveForzado nombre={me.nombre} onSalir={salir} onListo={() => { setMe('cargando'); recargar() }} />
  )

  // Pantalla completa antes de cualquier ruta por rol: primero se explican los permisos.
  // Se puede saltar con "Continuar"; el reencuentro queda en Ajustes de la app.
  if (rolBienvenida) return (
    <Bienvenida rol={rolBienvenida} onListo={() => {
      try { localStorage.setItem(CLAVE_BIENVENIDA, '1') } catch { /* storage bloqueado: se mostrará otra vez */ }
      setRolBienvenida(null)
    }} />
  )

  if (me.esSuperadmin) return <>{<SuperAdmin me={me} onSalir={salir} />}{modalSalida}</>

  if (!condos.length || !activo)
    return <><div className="centrado"><div className="card" style={{ textAlign: 'center', maxWidth: 400 }}><div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', opacity: .5 }}><Icon name="building" size={40} /></div><p style={{ marginTop: 8 }}>Tu cuenta aún no tiene condominios asignados.</p><button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={salir}>Salir</button></div></div>{modalSalida}</>

  const distintos = [...new Map(condos.map((c) => [c.id, c])).values()]

  const memsActivo = condos.filter((c) => c.id === activo.id)
  // Roles que esta cuenta posee en el condominio activo, de mayor a menor alcance.
  // Con la cuenta de demostración son los cuatro; con una cuenta real, los que de
  // verdad tenga. El selector solo aparece si hay más de uno que elegir.
  const rolesDisponibles = [...new Set(memsActivo.map((m) => m.rol))].sort((a, b) => prec(a) - prec(b))
  const rolPedido = getRolActivo()
  if (rolPedido && !rolesDisponibles.includes(rolPedido)) setRolActivo(null) // rol que ya no aplica
  const rolVigente = (rolPedido && rolesDisponibles.includes(rolPedido)) ? rolPedido : rolesDisponibles[0]
  const efectivo = memsActivo.find((m) => m.rol === rolVigente) ?? activo

  const selector = (
    <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
      {distintos.length > 1 && (
        // Cambiar de condominio borra lo guardado de todos los demás: la recarga no puede
        // dejar en el teléfono ni una cuota del edificio anterior (la anotación es síncrona,
        // así que si el reload interrumpe el borrado, el próximo arranque lo termina).
        <select value={activo.id} onChange={(e) => { purgarCacheOtrosCondos(e.target.value); setCondoActivo(e.target.value); setRolActivo(null); location.reload() }} aria-label="Cambiar condominio">
          {distintos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      )}
      {rolesDisponibles.length > 1 && (
        <select className="chip neutral" value={rolVigente} aria-label="Cambiar de rol"
          onChange={(e) => { purgarCacheOtrosCondos(activo.id); setRolActivo(e.target.value); location.reload() }}>
          {rolesDisponibles.map((r) => (
            <option key={r} value={r}>
              {{ org_admin: 'Junta de condominio', admin: 'Administración', porteria: 'Portería', residente: 'Residente' }[r] ?? r}
            </option>
          ))}
        </select>
      )}
    </div>
  )

  // Condominio suspendido: el backend niega todo (403). En vez de dejar la app cargando en vacío, avisamos.
  if (efectivo.suspendido) return (
    <><div className="centrado"><div className="card" style={{ textAlign: 'center', maxWidth: 420 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', color: 'var(--danger)' }}><Icon name="alert" size={40} /></div>
      <h3 style={{ margin: '4px 0' }}>{efectivo.nombre}</h3>
      <p style={{ marginTop: 8 }}>Este condominio está <b>suspendido</b>. Contacta a tu administradora para reactivarlo.</p>
      {distintos.length > 1 && <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>{selector}</div>}
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={salir}>Salir</button>
    </div></div>{modalSalida}</>
  )

  const props = { me, condo: efectivo, selector, onSalir: salir }
  if (rolVigente === 'admin' || rolVigente === 'org_admin') return <>{<Admin {...props} />}{modalSalida}</>
  if (rolVigente === 'porteria') return <>{<Porteria {...props} />}{modalSalida}</>
  return <>{<Residente {...props} />}{modalSalida}</>
}

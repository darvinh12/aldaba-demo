/** Pantalla de bienvenida y permisos de la app nativa (solo EN_APP).
 *
 *  POR QUÉ existe: el diálogo de permisos del sistema se quema — se muestra una sola
 *  vez y, si el usuario niega, Android no lo vuelve a mostrar nunca. Por eso la
 *  explicación tiene que ir ANTES y con interfaz propia (antes esto era un confirm()
 *  del WebView: cuadro blanco, en inglés y sin identidad). Aquí cada permiso se explica
 *  con el motivo real del rol y el usuario decide con un botón.
 *
 *  HONESTO: ninguna app puede autoconcederse permisos. El estado que se pinta sale
 *  SIEMPRE de estadoPermisos() después de la petición, nunca del clic; y si el sistema
 *  ya negó, la única vía que se ofrece es abrir los Ajustes de la app.
 *
 *  Se puede saltar: "Continuar" está siempre habilitado (conceder cero permisos es una
 *  respuesta válida) y el reencuentro queda en Ajustes de la app. No dispara ningún
 *  diálogo automático al montar — solo por clic —, así que el doble montaje de
 *  StrictMode es inocuo por diseño. */
import { useEffect, useState } from 'react'
import { LogoMark } from './brand'
import { Aurora, CornerMarks } from './effects'
import { estadoPermisos, pedirPermisoCamara, pedirPermisoNotificaciones, abrirAjustesDeLaApp, type EstadoPermiso } from '../permisos'

type Clave = 'camara' | 'notificaciones'

/** Subtítulo y copy por rol: el motivo tiene que ser el del trabajo real de quien lee. */
const SUBTITULO: Record<string, string> = {
  porteria: 'Antes de empezar tu turno, dos permisos que necesita tu puesto.',
  admin: 'Antes de entrar, un permiso para no perderte lo que pasa en el condominio.',
  org_admin: 'Antes de entrar, un permiso para no perderte lo que pasa en el condominio.',
  residente: 'Antes de entrar, un permiso para avisarte de lo que pasa en tu edificio.',
}
const COPY_NOTIFICACIONES: Record<string, string> = {
  porteria: 'Alertas SOS de los residentes y anuncios de la administración, aunque la app esté cerrada.',
  admin: 'Alertas SOS y actividad del condominio.',
  org_admin: 'Alertas SOS y actividad del condominio.',
  residente: 'Cuando tu visitante llegue a portería, un paquete quede en custodia o haya una alerta.',
}
const porRol = (tabla: Record<string, string>, rol: string) => tabla[rol] ?? tabla.residente

/** Texto para el anuncio a lectores de pantalla (la etiqueta visible es el chip). */
const ETIQUETA: Record<EstadoPermiso, string> = {
  concedido: 'concedido',
  denegado: 'denegado, se activa desde los Ajustes',
  no_pedido: 'aún sin pedir',
  no_aplica: 'no aplica',
}

function Fila({ titulo, detalle, estado, ocupado, onPermitir }: {
  titulo: string
  detalle: string
  estado: EstadoPermiso
  ocupado: boolean
  onPermitir: () => void
}) {
  const denegado = estado === 'denegado'
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--muted)', textAlign: 'left' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0, fontWeight: 600, fontSize: '.92rem' }}>{titulo}</div>
        {ocupado ? <span className="spin" aria-hidden="true" />
          : estado === 'concedido' ? <span className="chip ok">Concedido</span>
          : denegado ? <span className="chip off">Denegado</span>
          : (
            <button className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={onPermitir}>
              Permitir
            </button>
          )}
      </div>
      <div className="muted-txt" style={{ fontSize: '.8rem', marginTop: 4 }}>
        {denegado ? 'El sistema ya no volverá a preguntar; se activa desde los Ajustes de la app.' : detalle}
      </div>
      {denegado && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { void abrirAjustesDeLaApp() }}>
          Abrir Ajustes
        </button>
      )}
    </div>
  )
}

export function Bienvenida({ rol, onListo }: { rol: string; onListo: () => void }) {
  const [permisos, setPermisos] = useState<{ camara: EstadoPermiso; notificaciones: EstadoPermiso } | null>(null)
  const [ocupado, setOcupado] = useState<Clave | null>(null)
  const pideCamara = rol === 'porteria'

  const cargar = async () => setPermisos(await estadoPermisos())

  useEffect(() => {
    void cargar()
    // Si el usuario fue a los Ajustes del sistema y volvió, el estado real pudo cambiar.
    const alVolver = () => { if (!document.hidden) void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  // El estado pintado NUNCA sale del clic: se pide al sistema y después se re-consulta.
  const pedir = async (clave: Clave) => {
    if (ocupado) return
    setOcupado(clave)
    try {
      if (clave === 'camara') await pedirPermisoCamara()
      else await pedirPermisoNotificaciones()
    } finally {
      await cargar()
      setOcupado(null)
    }
  }

  const notificaciones = permisos?.notificaciones ?? 'no_pedido'
  const camara = permisos?.camara ?? 'no_pedido'
  const anuncio = ocupado ? 'Esperando tu respuesta en el diálogo del sistema…'
    : permisos ? `Notificaciones: ${ETIQUETA[notificaciones]}.${pideCamara ? ` Cámara: ${ETIQUETA[camara]}.` : ''}`
    : ''

  return (
    <div className="centrado lab" role="dialog" aria-modal="true" aria-label="Bienvenida a Aldaba">
      <Aurora />
      <div className="auth-wrap">
        <div className="card corner-marks" style={{ padding: 26, textAlign: 'center' }}>
          <CornerMarks />
          <div className="eyebrow" style={{ marginBottom: 16 }}>Aldaba</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><LogoMark size={54} /></div>
          <div style={{ fontFamily: 'var(--font-h)', fontWeight: 600, fontSize: '1.4rem', letterSpacing: '-.04em', color: '#fff' }}>
            Bienvenido a Aldaba
          </div>
          <p className="muted-txt" style={{ margin: '6px 0 14px', fontSize: '.88rem' }}>{porRol(SUBTITULO, rol)}</p>

          {pideCamara && (
            <Fila titulo="Cámara"
              detalle="Escanear los pases QR de los visitantes es tu trabajo diario."
              estado={camara} ocupado={ocupado === 'camara'} onPermitir={() => { void pedir('camara') }} />
          )}
          <Fila titulo="Notificaciones"
            detalle={porRol(COPY_NOTIFICACIONES, rol)}
            estado={notificaciones} ocupado={ocupado === 'notificaciones'} onPermitir={() => { void pedir('notificaciones') }} />
          {!pideCamara && (
            <p className="muted-txt xs" style={{ margin: '10px 0 0', textAlign: 'left' }}>
              La cámara se pedirá la primera vez que vayas a usarla.
            </p>
          )}

          {/* Los cambios de estado se anuncian también a lectores de pantalla */}
          <p role="status" aria-live="polite" className="muted-txt xs" style={{ minHeight: 16, margin: '12px 0 4px' }}>
            {anuncio}
          </p>

          <button className="btn btn-primary block" onClick={onListo} style={{ padding: '14px 20px', fontSize: '1rem' }}>
            Continuar
          </button>
          <p className="muted-txt xs" style={{ marginTop: 10 }}>
            Puedes revisar estos permisos cuando quieras en Ajustes de la app.
          </p>
        </div>
      </div>
    </div>
  )
}

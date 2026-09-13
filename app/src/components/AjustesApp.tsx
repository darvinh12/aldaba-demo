/** Ajustes de la app nativa (hoja del topbar, solo EN_APP).
 *
 *  Todo lo que muestra es REAL, consultado al abrirse:
 *   - Huella: disponibilidad del sensor (biometria.ts) y preferencia guardada;
 *     el interruptor activa (con verificación biométrica) o desactiva.
 *   - Permisos del dispositivo: estado actual de cámara y notificaciones
 *     (permisos.ts, sin disparar diálogos al abrir) y, si alguno está denegado, el
 *     botón que abre los Ajustes del sistema de ESTA app — único camino
 *     legítimo: Android/iOS no dejan autoconcederse permisos. Aquí se reencuentra
 *     el que saltó la pantalla de bienvenida: si un permiso sigue "aún sin pedir",
 *     el botón "Permitir" dispara el diálogo del sistema y la fila pinta el
 *     resultado REAL de la reconsulta, nunca lo que el usuario tocó.
 *   - Versión instalada: App.getInfo() del binario (no un texto quemado).
 *   - Diagnóstico: ultimoCierre() — por qué dejó el primer plano la última vez.
 *
 *  Al volver de los Ajustes del sistema (visibilitychange) se reconsulta todo,
 *  así el estado en pantalla refleja lo que el dueño acaba de conceder. */
import { useEffect, useState } from 'react'
import { Sheet } from '../ui'
import { EN_APP } from '../plataforma'
import { biometriaDisponible, biometriaActivada, activarBiometria, desactivarBiometria } from '../biometria'
import { estadoPermisos, abrirAjustesDeLaApp, pedirPermisoCamara, pedirPermisoNotificaciones, type EstadoPermiso } from '../permisos'
import { ultimoCierre } from '../ciclo'

const ETIQUETA: Record<EstadoPermiso, string> = {
  concedido: 'Concedido',
  denegado: 'Denegado',
  no_pedido: 'Aún sin pedir',
  no_aplica: 'No aplica',
}
const COLOR: Record<EstadoPermiso, string> = {
  concedido: 'var(--ok, #34d399)',
  denegado: 'var(--danger, #f87171)',
  no_pedido: 'var(--sub)',
  no_aplica: 'var(--sub)',
}

function Fila({ titulo, detalle, accion }: { titulo: string; detalle: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--muted)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{titulo}</div>
        <div className="muted-txt" style={{ fontSize: '.8rem', marginTop: 2 }}>{detalle}</div>
      </div>
      {accion}
    </div>
  )
}

export function AjustesApp({ onClose }: { onClose: () => void }) {
  const [bio, setBio] = useState<{ ok: boolean; tipo: 'huella' | 'rostro' | 'ninguna'; motivo?: string } | null>(null)
  const [bioOn, setBioOn] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [pidiendo, setPidiendo] = useState<'camara' | 'notificaciones' | null>(null)
  const [permisos, setPermisos] = useState<{ camara: EstadoPermiso; notificaciones: EstadoPermiso } | null>(null)
  const [version, setVersion] = useState<string>('')
  const [cierre, setCierre] = useState<string | null>(null)

  const cargar = async () => {
    const [d, on, p, c] = await Promise.all([biometriaDisponible(), biometriaActivada(), estadoPermisos(), ultimoCierre()])
    setBio(d); setBioOn(on); setPermisos(p); setCierre(c)
  }

  useEffect(() => {
    void cargar()
    if (EN_APP) {
      void (async () => {
        try {
          const { App } = await import('@capacitor/app')
          const info = await App.getInfo()
          setVersion(`${info.version} (build ${info.build})`)
        } catch { /* fuera de Capacitor no hay versión nativa que leer */ }
      })()
    }
    // Al volver de los Ajustes del sistema, refrescar los estados reales.
    const alVolver = () => { if (!document.hidden) void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  const alternarHuella = async () => {
    if (ocupado) return
    setOcupado(true)
    try {
      if (bioOn) { await desactivarBiometria(); setBioOn(false) }
      else setBioOn(await activarBiometria()) // pide el gesto; si cancela queda apagada
    } finally { setOcupado(false) }
  }

  // El estado que se pinta sale SIEMPRE de la reconsulta posterior: el usuario puede
  // negar en el diálogo del sistema, así que el clic no prueba nada.
  const pedir = async (cual: 'camara' | 'notificaciones') => {
    if (pidiendo) return
    setPidiendo(cual)
    try {
      if (cual === 'camara') await pedirPermisoCamara()
      else await pedirPermisoNotificaciones()
    } finally {
      await cargar()
      setPidiendo(null)
    }
  }

  // Etiqueta de estado y, mientras siga "aún sin pedir", el botón que lo pide.
  // Función y no componente: así el botón no se remonta (ni pierde el foco) en cada render.
  const accionPermiso = (cual: 'camara' | 'notificaciones', estado: EstadoPermiso) => (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: '.82rem', fontWeight: 600, color: COLOR[estado] }}>{ETIQUETA[estado]}</span>
      {estado === 'no_pedido' && (
        <button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}
          onClick={() => { void pedir(cual) }} disabled={pidiendo !== null}>
          {pidiendo === cual ? <span className="spin dark" /> : 'Permitir'}
        </button>
      )}
    </div>
  )

  const gestoBio = bio?.tipo === 'rostro' ? 'rostro' : 'huella'
  const algunoDenegado = permisos && (permisos.camara === 'denegado' || permisos.notificaciones === 'denegado')

  return (
    <Sheet title="Ajustes de la app" onClose={onClose}>
      <div className="mono-label" style={{ marginBottom: 2 }}>Seguridad</div>
      <Fila
        titulo={`Entrar con ${gestoBio}`}
        detalle={bio === null ? 'Consultando…'
          : bio.ok ? (bioOn ? `Activado: al abrir la app se pide tu ${gestoBio}.` : 'Desactivado: se entra directo con la sesión guardada.')
          : (bio.motivo || 'Este dispositivo no tiene biometría configurada.')}
        accion={
          <button className={`btn ${bioOn ? 'btn-primary' : 'btn-ghost'}`} style={{ whiteSpace: 'nowrap' }}
            onClick={() => { void alternarHuella() }} disabled={ocupado || !bio?.ok}
            aria-pressed={bioOn} aria-label={`Entrar con ${gestoBio}: ${bioOn ? 'activado' : 'desactivado'}`}>
            {ocupado ? <span className="spin" /> : bioOn ? 'Activado' : 'Activar'}
          </button>
        }
      />

      <div className="mono-label" style={{ margin: '16px 0 2px' }}>Permisos del dispositivo</div>
      <Fila titulo="Cámara" detalle="Para escanear códigos QR y tomar fotos de visitantes."
        accion={accionPermiso('camara', permisos?.camara ?? 'no_pedido')} />
      <Fila titulo="Notificaciones" detalle="Avisos de portería, paquetes y alertas SOS."
        accion={accionPermiso('notificaciones', permisos?.notificaciones ?? 'no_pedido')} />
      {algunoDenegado && (
        <p className="muted-txt" style={{ fontSize: '.8rem', margin: '8px 0 0' }}>
          Un permiso denegado solo se puede conceder desde los Ajustes del sistema (Android no vuelve a mostrar el diálogo).
        </p>
      )}
      <button className="btn btn-ghost block" style={{ marginTop: 10 }} onClick={() => { void abrirAjustesDeLaApp() }}>
        Abrir los Ajustes del sistema de Aldaba
      </button>

      <div className="mono-label" style={{ margin: '16px 0 2px' }}>Acerca de</div>
      <Fila titulo="Versión instalada" detalle={version || 'Consultando…'} />
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontWeight: 600, fontSize: '.92rem' }}>Diagnóstico</div>
        <div className="muted-txt" style={{ fontSize: '.8rem', marginTop: 2 }}>
          {cierre ?? 'Sin registro todavía: se anota cada vez que la app deja el primer plano.'}
        </div>
      </div>
    </Sheet>
  )
}

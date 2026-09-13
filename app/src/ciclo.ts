/** Ciclo de vida de la app nativa: sondeos que se PAUSAN en segundo plano y
 *  diagnóstico de por qué se cerró la app la última vez.
 *
 *  Causa real que ataca: Portería consulta cada 8–10 s y Accesos del residente
 *  cada 10 s; si esos setInterval siguen disparando red con la app al fondo,
 *  Android la marca como consumidora de batería y la mata (y el dueño lo vive
 *  como "la app se cierra sola"). registrarSondeo() detiene todo al pasar a
 *  segundo plano y, al volver, refresca de inmediato y reanuda.
 *
 *  En la WEB el comportamiento es idéntico a setInterval: aquí nunca se instala
 *  el listener nativo (EN_APP=false) y nada se pausa. */
import { EN_APP } from './plataforma'

type Sondeo = { fn: () => void; ms: number; timer: ReturnType<typeof setInterval> | null }

const CLAVE_CIERRE = 'aldaba_ultimo_cierre'
const sondeos = new Set<Sondeo>()
let enSegundoPlano = false
let iniciado = false
/** Motivo anotado por otros módulos (botón atrás / salida confirmada) justo antes
 *  de que la app pase a segundo plano; caduca a los 8 s. */
let motivoPendiente: { motivo: string; cuando: number } | null = null
const MOTIVOS = ['segundo_plano', 'boton_atras', 'salida_confirmada'] as const

async function anotarCierre(motivo: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: CLAVE_CIERRE, value: JSON.stringify({ cuando: new Date().toISOString(), motivo }) })
  } catch { /* sin Preferences no hay diagnóstico, pero la app sigue */ }
}

/** Arranca la escucha del ciclo de vida nativo. Idempotente; en la web no hace nada.
 *  registrarSondeo() la llama solo también, así que no depende de ningún wiring externo. */
export function iniciarCicloDeVida(): void {
  if (!EN_APP || iniciado) return
  iniciado = true

  // Quien minimiza por botón atrás o confirma la salida lo anuncia con este evento
  // ANTES de minimizar: window.dispatchEvent(new CustomEvent('aldaba:motivo-salida',
  // { detail: 'boton_atras' | 'salida_confirmada' })). Si nadie lo anuncia, el
  // motivo registrado es 'segundo_plano' (Home, otra app, bloqueo o el sistema).
  window.addEventListener('aldaba:motivo-salida', (e) => {
    const detalle = (e as CustomEvent<string>).detail
    if ((MOTIVOS as readonly string[]).includes(detalle)) motivoPendiente = { motivo: detalle, cuando: Date.now() }
  })

  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        // A segundo plano: detener TODOS los sondeos y dejar constancia de por qué.
        enSegundoPlano = true
        for (const s of sondeos) { if (s.timer !== null) { clearInterval(s.timer); s.timer = null } }
        const fresco = motivoPendiente && Date.now() - motivoPendiente.cuando < 8000
        void anotarCierre(fresco ? motivoPendiente!.motivo : 'segundo_plano')
        motivoPendiente = null
      } else {
        // De vuelta: refresco inmediato (la garita no puede esperar el próximo tic) y reanudar.
        enSegundoPlano = false
        for (const s of sondeos) {
          if (s.timer === null) {
            try { s.fn() } catch { /* un sondeo roto no debe tumbar el resto */ }
            s.timer = setInterval(s.fn, s.ms)
          }
        }
      }
    })
  }).catch(() => { /* fuera de Capacitor no hay ciclo nativo que escuchar */ })
}

/** Reemplazo de setInterval consciente del ciclo de vida: en primer plano es un
 *  setInterval normal (web idéntica); en la app nativa se pausa en segundo plano
 *  y al volver ejecuta fn una vez de inmediato. Devuelve la función de limpieza
 *  (para el return del useEffect). NO ejecuta fn al registrar: los componentes
 *  ya hacen su primera carga aparte. */
export function registrarSondeo(fn: () => void, ms: number): () => void {
  iniciarCicloDeVida()
  const s: Sondeo = { fn, ms, timer: enSegundoPlano ? null : setInterval(fn, ms) }
  sondeos.add(s)
  return () => {
    if (s.timer !== null) clearInterval(s.timer)
    s.timer = null
    sondeos.delete(s)
  }
}

/** Diagnóstico legible en español de la última vez que la app dejó el primer plano,
 *  para responder con datos "¿por qué se cerró?" en vez de adivinar. null si no hay
 *  registro (o en la web, donde no aplica). */
export async function ultimoCierre(): Promise<string | null> {
  if (!EN_APP) return null
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: CLAVE_CIERRE })
    if (!value) return null
    const { cuando, motivo } = JSON.parse(value) as { cuando: string; motivo: string }
    const fecha = new Date(cuando)
    if (isNaN(fecha.getTime())) return null
    const cuandoTxt = fecha.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const textos: Record<string, string> = {
      segundo_plano: 'la app pasó a segundo plano (Home, otra app o pantalla bloqueada); si después ya no estaba, fue Android quien la cerró para ahorrar batería — con los sondeos en pausa, cada vez tiene menos motivos',
      boton_atras: 'se minimizó con el botón atrás (no se cerró: quedó al fondo)',
      salida_confirmada: 'saliste de la app y confirmaste la salida',
    }
    return `Última salida: ${cuandoTxt} — ${textos[motivo] ?? `motivo desconocido (${motivo})`}.`
  } catch { return null }
}

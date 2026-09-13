/** Biometría (huella/rostro) para la app nativa — plugin @aparajita/capacitor-biometric-auth 9.x
 *  (línea compatible con Capacitor 7; la 10.x exige Capacitor 8).
 *
 *  Contrato consumido por la capa de arranque/bloqueo (no renombrar sin coordinar):
 *    biometriaDisponible() · biometriaActivada() · activarBiometria()
 *    desactivarBiometria() · pedirDesbloqueo()
 *
 *  Todo el código nativo se carga con import() dinámico y SOLO cuando EN_APP:
 *  la web nunca descarga estos chunks y todas las funciones responden
 *  "no disponible" sin romper nada.
 *
 *  La preferencia "el usuario quiere entrar con huella" se guarda con
 *  @capacitor/preferences (clave 'aldaba_biometria'), que persiste en
 *  SharedPreferences/UserDefaults — NO en localStorage del WebView. */

import { EN_APP } from './plataforma'
import type { CheckBiometryResult } from '@aparajita/capacitor-biometric-auth'

const CLAVE_PREF = 'aldaba_biometria'

// ── Carga perezosa de plugins (una sola vez por sesión) ──
const plugin = () => import('@aparajita/capacitor-biometric-auth')
const prefs = async () => (await import('@capacitor/preferences')).Preferences

/** Traduce el tipo del plugin al contrato de la app.
 *  touchId/fingerprint → huella · faceId/face/iris → rostro. */
function tipoLegible(info: CheckBiometryResult, BiometryType: typeof import('@aparajita/capacitor-biometric-auth').BiometryType): 'huella' | 'rostro' | 'ninguna' {
  const tipos = info.biometryTypes.length ? info.biometryTypes : [info.biometryType]
  // Si el equipo tiene varias (Android), la huella manda: es el gesto que pidió el dueño.
  if (tipos.includes(BiometryType.touchId) || tipos.includes(BiometryType.fingerprintAuthentication)) return 'huella'
  if (tipos.includes(BiometryType.faceId) || tipos.includes(BiometryType.faceAuthentication) || tipos.includes(BiometryType.irisAuthentication)) return 'rostro'
  return 'ninguna'
}

/** ¿El dispositivo puede autenticar con biometría ahora mismo (sensor + huella/rostro enrolado)? */
export async function biometriaDisponible(): Promise<{ ok: boolean; tipo: 'huella' | 'rostro' | 'ninguna'; motivo?: string }> {
  if (!EN_APP) return { ok: false, tipo: 'ninguna', motivo: 'Solo disponible en la app instalada' }
  try {
    const { BiometricAuth, BiometryType } = await plugin()
    const info = await BiometricAuth.checkBiometry()
    const tipo = tipoLegible(info, BiometryType)
    if (info.isAvailable) return { ok: true, tipo }
    return { ok: false, tipo, motivo: info.reason || 'El dispositivo no tiene biometría configurada' }
  } catch (e) {
    return { ok: false, tipo: 'ninguna', motivo: (e as Error).message || 'No se pudo consultar la biometría' }
  }
}

/** ¿El usuario dejó activado "entrar con huella"? (preferencia nativa persistente) */
export async function biometriaActivada(): Promise<boolean> {
  if (!EN_APP) return false
  try {
    const { value } = await (await prefs()).get({ key: CLAVE_PREF })
    return value === 'on'
  } catch { return false }
}

/** Pide una confirmación biométrica y, si pasa, deja guardada la preferencia.
 *  false si no hay biometría, el usuario cancela o la verificación falla. */
export async function activarBiometria(): Promise<boolean> {
  if (!EN_APP) return false
  const disp = await biometriaDisponible()
  if (!disp.ok) return false
  const ok = await autenticar('Confirma tu identidad para activar el inicio con huella')
  if (!ok) return false
  try {
    await (await prefs()).set({ key: CLAVE_PREF, value: 'on' })
    return true
  } catch { return false }
}

/** Borra la preferencia; la app vuelve a entrar solo con la clave. */
export async function desactivarBiometria(): Promise<void> {
  if (!EN_APP) return
  try { await (await prefs()).remove({ key: CLAVE_PREF }) } catch { /* sin preferencia que borrar */ }
}

/** El gesto de entrada: muestra el diálogo biométrico del sistema.
 *  true si el usuario se verificó; false si cancela o falla (sin lanzar). */
export async function pedirDesbloqueo(): Promise<boolean> {
  if (!EN_APP) return false
  return autenticar('Desbloquea Aldaba')
}

// ── Núcleo compartido del diálogo biométrico ──
async function autenticar(motivo: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await plugin()
    await BiometricAuth.authenticate({
      reason: motivo,
      cancelTitle: 'Cancelar',
      // PIN/patrón del equipo como respaldo: sin esto, un dedo mojado o el
      // bloqueo por intentos (biometryLockout) dejarían al usuario afuera.
      allowDeviceCredential: true,
      iosFallbackTitle: 'Usar código del equipo',
      androidTitle: 'Aldaba',
      androidSubtitle: motivo,
      // La huella ya identifica: no pedir un tap extra de "Confirmar".
      androidConfirmationRequired: false,
    })
    return true
  } catch {
    // BiometryError (userCancel, authenticationFailed, lockout…): el que llama
    // decide si reintenta; aquí solo se responde la verdad.
    return false
  }
}

const enc = new TextEncoder()
const ITER = 100_000

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const ub64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (b: Uint8Array) => b64(b).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const ub64url = (s: string) => {
  const std = s.replaceAll('-', '+').replaceAll('_', '/')
  return ub64(std + '='.repeat((4 - (std.length % 4)) % 4))
}

async function derivar(pw: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256),
  )
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${ITER}$${b64(salt)}$${b64(await derivar(pw, salt, ITER))}`
}

export async function verifyPassword(pw: string, guardado: string): Promise<boolean> {
  const [iterS, saltB64, hashB64] = guardado.split('$')
  if (!iterS || !saltB64 || !hashB64) return false
  const iter = parseInt(iterS, 10)
  if (!Number.isInteger(iter) || iter <= 0 || iter > 1_000_000) return false
  try {
    const calc = await derivar(pw, ub64(saltB64), iter)
    const ref = ub64(hashB64)
    if (calc.length !== ref.length) return false
    let diff = 0
    for (let i = 0; i < calc.length; i++) diff |= calc[i] ^ ref[i]
    return diff === 0
  } catch {
    return false
  }
}

async function hmacKey(secreto: string) {
  return crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function firmar(dato: string, secreto: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secreto), enc.encode(dato))
  return b64url(new Uint8Array(sig))
}

export async function verificarFirma(dato: string, firma: string, secreto: string): Promise<boolean> {
  try {
    const key = await hmacKey(secreto)
    return await crypto.subtle.verify('HMAC', key, ub64url(firma) as BufferSource, enc.encode(dato))
  } catch {
    return false
  }
}

export function tokenAleatorio(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Alfabeto para códigos que una persona va a DICTAR por teléfono o teclear en una tablet.
 *  Fuera van los pares que se confunden al leerlos o al oírlos: I/1/L, O/0, S/5, Z/2, B/8.
 *  Quedan 24 símbolos; con 6 posiciones dan 191 millones de combinaciones, de sobra para
 *  los pases vivos de un edificio y corto para leerlo en voz alta. */
const ALFABETO_LEGIBLE = 'ACDEFGHJKMNPQRTUVWXY34679'

/** Código corto y legible. Muestreo por RECHAZO, no por módulo: `byte % 25` daría a los
 *  primeros símbolos del alfabeto más probabilidad que a los últimos (256 no es múltiplo
 *  de 25) y el código dejaría de ser uniforme. Se descartan los bytes del sobrante. */
export function codigoLegible(largo = 6): string {
  const n = ALFABETO_LEGIBLE.length
  const tope = Math.floor(256 / n) * n // 250: por encima de esto el byte se descarta
  let salida = ''
  while (salida.length < largo) {
    for (const b of crypto.getRandomValues(new Uint8Array(largo * 2))) {
      if (b >= tope) continue
      salida += ALFABETO_LEGIBLE[b % n]
      if (salida.length === largo) break
    }
  }
  return salida
}

/** Normaliza lo que teclea el guardia para compararlo con `pases_visita.codigo`:
 *  mayúsculas y fuera todo lo que no sea del alfabeto (espacios, guiones del formato
 *  `ABC-123`, saltos de línea del pegado). Devuelve '' si no queda nada utilizable. */
export function normalizarCodigo(entrada: string): string {
  return entrada.toUpperCase().split('').filter((ch) => ALFABETO_LEGIBLE.includes(ch)).join('')
}

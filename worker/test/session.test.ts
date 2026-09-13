import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, uuid } from './helpers'
import { crearSesion, leerSesion, cerrarSesion, extraerCookie, COOKIE, DIAS_SESION, DIAS_TOLERANCIA_RENOVACION } from '../src/lib/session'

const SEC = 'secreto-test'
beforeAll(aplicarSchema)

async function usuarioDePrueba() {
  const id = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(id, `${id}@t.com`, 'T', 'h').run()
  return id
}

describe('session', () => {
  it('crea sesión y la lee desde la cookie', async () => {
    const uid = await usuarioDePrueba()
    const { cookie } = await crearSesion(env.DB, uid, SEC, DIAS_SESION)
    expect(cookie).toContain('aldaba_s=')
    expect(cookie).toContain('HttpOnly')
    // la cookie sobrevive a la sesión por la ventana de canje: si muriera junto con `expira`,
    // la web perdería la tolerancia de /sesion/renovar que la app sí tiene
    expect(cookie).toContain(`Max-Age=${(DIAS_SESION + DIAS_TOLERANCIA_RENOVACION) * 86400}`)
    const ses = await leerSesion(env.DB, cookie.split(';')[0].split('=')[1], SEC)
    expect(ses?.usuario_id).toBe(uid)
  })
  it('rechaza cookie con firma manipulada', async () => {
    const uid = await usuarioDePrueba()
    const { valor } = await crearSesion(env.DB, uid, SEC, 30)
    const [id] = valor.split('.')
    expect(await leerSesion(env.DB, `${id}.firma-falsa`, SEC)).toBeNull()
  })
  it('rechaza sesión expirada y cerrada', async () => {
    const uid = await usuarioDePrueba()
    const { valor, id } = await crearSesion(env.DB, uid, SEC, 30)
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-1 day') WHERE id=?`).bind(id).run()
    expect(await leerSesion(env.DB, valor, SEC)).toBeNull()
    const s2 = await crearSesion(env.DB, uid, SEC, 30)
    await cerrarSesion(env.DB, s2.id)
    expect(await leerSesion(env.DB, s2.valor, SEC)).toBeNull()
  })
  it('extraerCookie: múltiples cookies y nombres con sufijo no confunden', () => {
    expect(extraerCookie(`otra=1; ${COOKIE}=abc.def; mas=2`)).toBe('abc.def')
    expect(extraerCookie(`x${COOKIE}=malo`)).toBeNull()
    expect(extraerCookie(undefined)).toBeNull()
  })
})

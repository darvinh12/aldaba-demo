import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, firmar, verificarFirma, tokenAleatorio } from '../src/lib/crypto'

describe('crypto', () => {
  it('hash y verifica password', async () => {
    const h = await hashPassword('MiClave123!')
    expect(h.split('$')).toHaveLength(3)
    expect(await verifyPassword('MiClave123!', h)).toBe(true)
    expect(await verifyPassword('otra', h)).toBe(false)
  })
  it('dos hashes de la misma clave difieren (salt aleatoria)', async () => {
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'))
  })
  it('firma y verifica HMAC', async () => {
    const f = await firmar('sesion-123', 'secreto')
    expect(await verificarFirma('sesion-123', f, 'secreto')).toBe(true)
    expect(await verificarFirma('sesion-124', f, 'secreto')).toBe(false)
    expect(await verificarFirma('sesion-123', f, 'otro-secreto')).toBe(false)
  })
  it('verifyPassword nunca lanza con hashes malformados', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false)
    expect(await verifyPassword('x', 'abc$AAAA$AAAA')).toBe(false)
    expect(await verifyPassword('x', '0$AAAA$AAAA')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
  it('verificarFirma con firma no-base64url devuelve false', async () => {
    expect(await verificarFirma('dato', '!!!inválida!!!', 'secreto')).toBe(false)
  })
  it('tokenAleatorio: 43 chars url-safe, únicos', () => {
    const t = tokenAleatorio()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokenAleatorio()).not.toBe(t)
  })
})

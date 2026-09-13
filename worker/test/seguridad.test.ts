import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema } from './helpers'
import { app } from '../src/index'

beforeAll(aplicarSchema)

describe('seguridad (headers defensivos)', () => {
  it('toda respuesta de API lleva las cabeceras de seguridad', async () => {
    const res = await app.request('/api/salud', {}, env)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('respuestas de error también van endurecidas (401 sin sesión)', async () => {
    const res = await app.request('/api/me', {}, env)
    expect(res.status).toBe(401)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('strict-transport-security')).toBeTruthy()
  })
})

describe('CORS acotado a la app nativa', () => {
  it('preflight OPTIONS /api/login con Origin https://localhost responde 204 con permisos', async () => {
    const res = await app.request('/api/login', {
      method: 'OPTIONS',
      headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' },
    }, env)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    const allowHeaders = (res.headers.get('access-control-allow-headers') || '').toLowerCase()
    for (const h of ['content-type', 'authorization', 'x-condominio', 'x-rol', 'x-cliente']) {
      expect(allowHeaders).toContain(h)
    }
    expect(res.headers.get('vary')).toContain('Origin')
  })
  it('GET /api/salud con Origin permitido trae Allow-Origin (y conserva las cabeceras de seguridad)', async () => {
    const res = await app.request('/api/salud', { headers: { Origin: 'https://localhost' } }, env)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
  it('capacitor://localhost tambien esta en la lista blanca', async () => {
    const res = await app.request('/api/salud', { headers: { Origin: 'capacitor://localhost' } }, env)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
  it('un Origin ajeno NO recibe ninguna cabecera de permiso', async () => {
    const res = await app.request('/api/salud', { headers: { Origin: 'https://evil.com' } }, env)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    const pre = await app.request('/api/login', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
    }, env)
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()
  })
})

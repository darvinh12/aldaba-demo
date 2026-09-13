import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { app } from '../src/index'

describe('GET /api/version (modo demo)', () => {
  it('responde 200 sin sesion anunciando el modo demo', async () => {
    const res = await app.request('/api/version', {}, env)
    expect(res.status).toBe(200)
    const cuerpo = await res.json()
    expect(cuerpo).toEqual({
      api: 1,
      demo: true,
    })
  })
})

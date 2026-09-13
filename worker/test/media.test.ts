import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function admin(condoId: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'A', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
    .bind(uuid(), uid, condoId).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { cookie: `${COOKIE}=${valor}`, condoId }
}

describe('media', () => {
  it('sube un archivo y lo sirve; rechaza acceso desde otro condominio', async () => {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    const subir = await app.request('/api/media?nombre=recibo.jpg', {
      method: 'PUT',
      headers: { cookie: a.cookie, 'X-Condominio': condoId, 'content-type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    }, env)
    expect(subir.status).toBe(200)
    const { key } = await subir.json<any>()
    expect(key.startsWith(`${condoId}/`)).toBe(true)
    const leer = await app.request(`/api/media/${key}`, {
      headers: { cookie: a.cookie, 'X-Condominio': condoId },
    }, env)
    expect(leer.status).toBe(200)
    expect(leer.headers.get('content-type')).toBe('image/jpeg')
    const { condoId: otro } = await seedCondo()
    const b = await admin(otro)
    const cruzado = await app.request(`/api/media/${key}`, {
      headers: { cookie: b.cookie, 'X-Condominio': otro },
    }, env)
    expect(cruzado.status).toBe(403)
  })
  it('rechaza content-type no permitido y cuerpo grande', async () => {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    const exe = await app.request('/api/media?nombre=x.exe', {
      method: 'PUT', headers: { cookie: a.cookie, 'X-Condominio': condoId, 'content-type': 'application/x-msdownload' },
      body: new Uint8Array([1]),
    }, env)
    expect(exe.status).toBe(415)
    const grande = await app.request('/api/media?nombre=g.jpg', {
      method: 'PUT', headers: { cookie: a.cookie, 'X-Condominio': condoId, 'content-type': 'image/jpeg' },
      body: new Uint8Array(600 * 1024),
    }, env)
    expect(grande.status).toBe(413)
  })
  it('content-length excesivo se rechaza sin leer el body; residente SÍ sube (comprobantes F2)', async () => {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    const res = await app.request('/api/media?nombre=g.jpg', {
      method: 'PUT',
      headers: { cookie: a.cookie, 'X-Condominio': condoId, 'content-type': 'image/jpeg', 'content-length': String(600 * 1024) },
      body: new Uint8Array([1]),
    }, env)
    expect(res.status).toBe(413)
    // residente sube su comprobante de pago a su propio namespace de condominio
    const uid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, 'R', 'h').run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'residente')`).bind(uuid(), uid, condoId).run()
    const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
    const resR = await app.request('/api/media?nombre=comprobante.jpg', {
      method: 'PUT', headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId, 'content-type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    }, env)
    expect(resR.status).toBe(200)
    expect((await resR.json<any>()).key.startsWith(`${condoId}/`)).toBe(true)
    const mal = await app.request('/api/media/%zz', { headers: { cookie: a.cookie, 'X-Condominio': condoId } }, env)
    expect(mal.status).toBe(400)
  })
  it('fallback D1: si el archivo está en la tabla `archivos` (sin R2) igual se sirve, aislado por tenant', async () => {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    const key = `${condoId}/${uuid()}-doc.png`
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    // simula un archivo guardado en D1 (lo que ocurre en producción cuando R2 no está configurado)
    await env.DB.prepare(`INSERT INTO archivos(key,condominio_id,mime,datos) VALUES(?,?,?,?)`)
      .bind(key, condoId, 'image/png', bytes.buffer).run()
    const leer = await app.request(`/api/media/${key}`, { headers: { cookie: a.cookie, 'X-Condominio': condoId } }, env)
    expect(leer.status).toBe(200)
    expect(leer.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await leer.arrayBuffer())).toEqual(bytes)
    // otro condominio no puede leerlo
    const { condoId: otro } = await seedCondo()
    const b = await admin(otro)
    const cruzado = await app.request(`/api/media/${key}`, { headers: { cookie: b.cookie, 'X-Condominio': otro } }, env)
    expect(cruzado.status).toBe(403)
  })
  it('nombre de archivo se sanitiza', async () => {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    const res = await app.request('/api/media?nombre=../../etc/passwd', {
      method: 'PUT', headers: { cookie: a.cookie, 'X-Condominio': condoId, 'content-type': 'image/png' },
      body: new Uint8Array([0x89, 0x50]),
    }, env)
    expect(res.status).toBe(200)
    const { key } = await res.json<any>()
    expect(key).not.toContain('..')
    expect(key.startsWith(`${condoId}/`)).toBe(true)
  })
})

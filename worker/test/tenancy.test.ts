import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { requireAuth, conCondominio, requireRol, type Vars } from '../src/lib/tenancy'
import { crearSesion, COOKIE } from '../src/lib/session'

beforeAll(aplicarSchema)

async function armar(rol: 'admin' | 'residente' | 'porteria', suspendido = 0) {
  const { condoId } = await seedCondo()
  if (suspendido) await env.DB.prepare(`UPDATE condominios SET suspendido=1 WHERE id=?`).bind(condoId).run()
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'T', 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,?)`)
    .bind(uuid(), uid, condoId, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { condoId, uid, cookie: `${COOKIE}=${valor}` }
}

function appProtegida() {
  const app = new Hono<{ Bindings: typeof env; Variables: Vars }>()
  app.use('/api/*', requireAuth)
  app.use('/api/condo/*', conCondominio)
  app.get('/api/condo/dato', requireRol('admin', 'org_admin'), (c) => c.json({ condo: c.get('condo')!.id }))
  return app
}

const req = (cookie: string, condoId?: string) =>
  new Request('http://x/api/condo/dato', {
    headers: { cookie, ...(condoId ? { 'X-Condominio': condoId } : {}) },
  })

describe('tenancy', () => {
  it('401 sin sesión', async () => {
    const res = await appProtegida().request('http://x/api/condo/dato', {}, env)
    expect(res.status).toBe(401)
  })
  it('admin accede a su condominio y NO a otro', async () => {
    const a = await armar('admin')
    const b = await armar('admin')
    const ok = await appProtegida().request(req(a.cookie, a.condoId), {}, env)
    expect(ok.status).toBe(200)
    expect((await ok.json<{ condo: string }>()).condo).toBe(a.condoId)
    const cruzado = await appProtegida().request(req(a.cookie, b.condoId), {}, env)
    expect(cruzado.status).toBe(403)
  })
  it('residente recibe 403 en ruta de admin', async () => {
    const r = await armar('residente')
    const res = await appProtegida().request(req(r.cookie, r.condoId), {}, env)
    expect(res.status).toBe(403)
  })
  it('condominio suspendido → 403 para todos', async () => {
    const s = await armar('admin', 1)
    const res = await appProtegida().request(req(s.cookie, s.condoId), {}, env)
    expect(res.status).toBe(403)
  })
  it('sin header X-Condominio usa la única membresía', async () => {
    const a = await armar('admin')
    const res = await appProtegida().request(req(a.cookie), {}, env)
    expect(res.status).toBe(200)
  })
  it('usuario en 2 condominios sin header X-Condominio recibe 400', async () => {
    const a = await armar('admin')
    const { condoId: otro } = await seedCondo()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'residente')`)
      .bind(uuid(), a.uid, otro).run()
    const res = await appProtegida().request(req(a.cookie), {}, env)
    expect(res.status).toBe(400)
  })
  it('org_admin que además es residente del mismo condominio conserva su rol org_admin (no lo eclipsa la membresía menor)', async () => {
    // Un miembro de junta (org_admin de la organización) que también vive en un edificio de esa org.
    const { orgId, condoId } = await seedCondo()
    const otroCondo = uuid()
    await env.DB.prepare(`INSERT INTO condominios(id,organizacion_id,nombre) VALUES(?,?,?)`)
      .bind(otroCondo, orgId, 'Torre Sur').run()
    const uid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, 'Junta', 'h').run()
    // org_admin en un condo de la org + residente (rango menor) en OTRO condo de la misma org
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'org_admin')`).bind(uuid(), uid, condoId).run()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'residente')`).bind(uuid(), uid, otroCondo).run()
    const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 7)
    // Antes del fix: en 'otroCondo' se resolvía como residente → 403 en ruta de admin.
    const res = await appProtegida().request(req(`${COOKIE}=${valor}`, otroCondo), {}, env)
    expect(res.status).toBe(200)
    expect((await res.json<{ condo: string }>()).condo).toBe(otroCondo)
  })
  it('superadmin accede a un condominio ajeno (200) y queda auditado en eventos', async () => {
    const { condoId } = await seedCondo()
    const sid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,1)`)
      .bind(sid, `${sid}@t.com`, 'SA', 'h').run()
    const { valor } = await crearSesion(env.DB, sid, env.SESSION_SECRET, 7)
    const res = await appProtegida().request(req(`${COOKIE}=${valor}`, condoId), {}, env)
    expect(res.status).toBe(200) // sin membresía, pero es superadmin
    const ev = await env.DB.prepare(
      `SELECT COUNT(*) n FROM eventos WHERE tipo='sa.acceso_condominio' AND condominio_id=? AND actor_id=?`,
    ).bind(condoId, sid).first<{ n: number }>()
    expect(ev!.n).toBe(1) // el acceso cross-tenant SIEMPRE deja rastro
  })
  it('superadmin entra a un condominio suspendido (200) donde un admin normal no', async () => {
    const { condoId } = await seedCondo()
    await env.DB.prepare(`UPDATE condominios SET suspendido=1 WHERE id=?`).bind(condoId).run()
    const sid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,1)`)
      .bind(sid, `${sid}@t.com`, 'SA', 'h').run()
    const { valor } = await crearSesion(env.DB, sid, env.SESSION_SECRET, 7)
    const res = await appProtegida().request(req(`${COOKIE}=${valor}`, condoId), {}, env)
    expect(res.status).toBe(200)
  })
})

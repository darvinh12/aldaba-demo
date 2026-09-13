import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function usuario(es_superadmin = 0) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,?)`)
    .bind(uid, `${uid}@t.com`, 'U', 'h', es_superadmin).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, cookie: `${COOKIE}=${valor}` }
}
async function admin(condoId: string) {
  const u = await usuario()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
    .bind(uuid(), u.uid, condoId).run()
  return { ...u, headers: { cookie: u.cookie, 'X-Condominio': condoId } }
}
const j = (headers: any, body?: any) => ({
  method: 'POST', headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

describe('endurecimiento — invitaciones: revocación', () => {
  it('admin revoca una invitación de residente vigente (kill-switch)', async () => {
    const { condoId } = await seedCondo()
    const { headers } = await admin(condoId)
    // crea unidad e invitación
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,torre_id,nombre) VALUES(?,?,NULL,'PB')`)
      .bind(uuid(), condoId).run()
    const uni = await env.DB.prepare(`SELECT id FROM unidades WHERE condominio_id=?`).bind(condoId).first<{ id: string }>()
    const inv = await (await app.request('/api/invitaciones', j(headers, { unidad_id: uni!.id }), env)).json<any>()
    // revoca
    const del = await app.request(`/api/invitaciones/${inv.token}`, { method: 'DELETE', headers }, env)
    expect(del.status).toBe(200)
    // el token público ya no sirve
    const pub = await app.request(`/api/invitacion/${inv.token}`, {}, env)
    expect(pub.status).toBe(410)
    // idempotente-ish: revocar de nuevo → 404 (ya usada)
    const del2 = await app.request(`/api/invitaciones/${inv.token}`, { method: 'DELETE', headers }, env)
    expect(del2.status).toBe(404)
    // evento registrado
    const ev = await env.DB.prepare(`SELECT COUNT(*) n FROM eventos WHERE tipo='invitacion.revocada' AND condominio_id=?`)
      .bind(condoId).first<{ n: number }>()
    expect(ev!.n).toBe(1)
  })
  it('admin NO puede revocar invitación de otro condominio (404)', async () => {
    const a = await seedCondo(); const b = await seedCondo()
    const admA = await admin(a.condoId)
    const token = uuid()
    await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,'residente',datetime('now','+1 day'))`)
      .bind(token, b.condoId).run()
    const del = await app.request(`/api/invitaciones/${token}`, { method: 'DELETE', headers: admA.headers }, env)
    expect(del.status).toBe(404)
    const sigue = await env.DB.prepare(`SELECT usada FROM invitaciones WHERE token=?`).bind(token).first<{ usada: number }>()
    expect(sigue!.usada).toBe(0)
  })
  it('superadmin revoca invitación privilegiada (admin)', async () => {
    const { condoId } = await seedCondo()
    const sa = await usuario(1)
    const inv = await (await app.request('/api/sa/invitaciones', j({ cookie: sa.cookie }, { condominio_id: condoId, rol: 'admin' }), env)).json<any>()
    const del = await app.request(`/api/sa/invitaciones/${inv.token}`, { method: 'DELETE', headers: { cookie: sa.cookie } }, env)
    expect(del.status).toBe(200)
    const pub = await app.request(`/api/invitacion/${inv.token}`, {}, env)
    expect(pub.status).toBe(410)
  })
  it('la invitación registra creado_por (autoría)', async () => {
    const { condoId } = await seedCondo()
    const { uid, headers } = await admin(condoId)
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,torre_id,nombre) VALUES(?,?,NULL,'1A')`).bind(uuid(), condoId).run()
    const uni = await env.DB.prepare(`SELECT id FROM unidades WHERE condominio_id=?`).bind(condoId).first<{ id: string }>()
    const inv = await (await app.request('/api/invitaciones', j(headers, { unidad_id: uni!.id }), env)).json<any>()
    const fila = await env.DB.prepare(`SELECT creado_por FROM invitaciones WHERE token=?`).bind(inv.token).first<{ creado_por: string }>()
    expect(fila!.creado_por).toBe(uid)
  })
})

describe('endurecimiento — estructura: editar/borrar', () => {
  async function conUnidad() {
    const { condoId } = await seedCondo()
    const a = await admin(condoId)
    await app.request('/api/estructura/importar',
      { method: 'POST', headers: { ...a.headers, 'content-type': 'text/csv' }, body: 'A,1-A,0.5\n' }, env)
    const uni = await env.DB.prepare(`SELECT id,torre_id FROM unidades WHERE condominio_id=?`).bind(condoId).first<{ id: string; torre_id: string }>()
    return { condoId, ...a, uni: uni! }
  }
  it('PATCH corrige alícuota', async () => {
    const { headers, uni } = await conUnidad()
    const r2 = await app.request(`/api/estructura/unidades/${uni.id}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ alicuota: 0.75 }) }, env)
    expect(r2.status).toBe(200)
    const v = await env.DB.prepare(`SELECT alicuota FROM unidades WHERE id=?`).bind(uni.id).first<{ alicuota: number }>()
    expect(v!.alicuota).toBe(0.75)
  })
  it('PATCH rechaza alícuota negativa (400)', async () => {
    const { headers, uni } = await conUnidad()
    const r = await app.request(`/api/estructura/unidades/${uni.id}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ alicuota: -1 }) }, env)
    expect(r.status).toBe(400)
  })
  it('DELETE unidad sin residentes funciona; con residente da 409', async () => {
    const { condoId, headers, uni } = await conUnidad()
    // primero con residente colgando
    const res = await usuario()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,'residente')`)
      .bind(uuid(), res.uid, condoId, uni.id).run()
    const bloq = await app.request(`/api/estructura/unidades/${uni.id}`, { method: 'DELETE', headers }, env)
    expect(bloq.status).toBe(409)
    // quitar el residente y borrar
    await env.DB.prepare(`DELETE FROM membresias WHERE unidad_id=?`).bind(uni.id).run()
    const ok = await app.request(`/api/estructura/unidades/${uni.id}`, { method: 'DELETE', headers }, env)
    expect(ok.status).toBe(200)
    const cnt = await env.DB.prepare(`SELECT COUNT(*) n FROM unidades WHERE id=?`).bind(uni.id).first<{ n: number }>()
    expect(cnt!.n).toBe(0)
  })
  it('DELETE torre con unidades da 409', async () => {
    const { condoId, headers, uni } = await conUnidad()
    const del = await app.request(`/api/estructura/torres/${uni.torre_id}`, { method: 'DELETE', headers }, env)
    expect(del.status).toBe(409)
  })
})

describe('endurecimiento — superadmin: PATCH condominio y validación', () => {
  it('PATCH tasa_bs la persiste', async () => {
    const { condoId } = await seedCondo()
    const sa = await usuario(1)
    const r = await app.request(`/api/sa/condominios/${condoId}`, { method: 'PATCH', headers: { cookie: sa.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ tasa_bs: 40.5 }) }, env)
    expect(r.status).toBe(200)
    const v = await env.DB.prepare(`SELECT tasa_bs FROM condominios WHERE id=?`).bind(condoId).first<{ tasa_bs: number }>()
    expect(v!.tasa_bs).toBe(40.5)
  })
  it('PATCH tasa_bs negativa da 400', async () => {
    const { condoId } = await seedCondo()
    const sa = await usuario(1)
    const r = await app.request(`/api/sa/condominios/${condoId}`, { method: 'PATCH', headers: { cookie: sa.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ tasa_bs: -5 }) }, env)
    expect(r.status).toBe(400)
  })
  it('nombre de organización duplicado da 409', async () => {
    const sa = await usuario(1)
    const nombre = `Org ${uuid()}`
    const a = await app.request('/api/sa/organizaciones', j({ cookie: sa.cookie }, { nombre }), env)
    expect(a.status).toBe(200)
    const b = await app.request('/api/sa/organizaciones', j({ cookie: sa.cookie }, { nombre }), env)
    expect(b.status).toBe(409)
  })
})

describe('endurecimiento — validación de registro', () => {
  it('email inválido da 400', async () => {
    const { condoId } = await seedCondo()
    const token = uuid()
    await env.DB.prepare(`INSERT INTO invitaciones(token,condominio_id,rol,expira) VALUES(?,?,'admin',datetime('now','+1 day'))`)
      .bind(token, condoId).run()
    const r = await app.request('/api/registro', j({}, { token, nombre: 'X', email: 'no-es-email', password: 'clave12345' }), env)
    expect(r.status).toBe(400)
  })
})

describe('endurecimiento — BD garantiza invariantes con NULL', () => {
  it('índice parcial impide 2ª membresía admin idéntica (unidad NULL)', async () => {
    const { condoId } = await seedCondo()
    const u = await usuario()
    await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
      .bind(uuid(), u.uid, condoId).run()
    await expect(
      env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,'admin')`)
        .bind(uuid(), u.uid, condoId).run(),
    ).rejects.toThrow()
  })
  it('trigger rechaza alícuota negativa a nivel BD', async () => {
    const { condoId } = await seedCondo()
    await expect(
      env.DB.prepare(`INSERT INTO unidades(id,condominio_id,torre_id,nombre,alicuota) VALUES(?,?,NULL,'X',-1)`)
        .bind(uuid(), condoId).run(),
    ).rejects.toThrow(/negativa/)
  })
})

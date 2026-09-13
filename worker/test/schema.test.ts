import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'

beforeAll(aplicarSchema)

describe('schema', () => {
  it('crea las 12 tablas de F1', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf%' AND name NOT LIKE 'sqlite%'`,
    ).all<{ name: string }>()
    const nombres = results.map((r) => r.name)
    for (const t of ['organizaciones','condominios','torres','unidades','usuarios','membresias',
      'invitaciones','sesiones','login_intentos','comunicados','lecturas_comunicado','eventos'])
      expect(nombres).toContain(t)
  })
  it('rechaza rol inválido en membresías', async () => {
    const { condoId } = await seedCondo()
    const uid = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
      .bind(uid, `${uid}@x.com`, 'X', 'h').run()
    await expect(
      env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,rol) VALUES(?,?,?,?)`)
        .bind(uuid(), uid, condoId, 'hacker').run(),
    ).rejects.toThrow()
  })
})

describe('migración 0009 — saneamiento', () => {
  /** Semilla: condominio + 2 usuarios + 2 unidades + votación con una opción. */
  async function seedVotacion() {
    const { condoId } = await seedCondo()
    const u1 = uuid(), u2 = uuid(), unidadA = uuid(), unidadB = uuid(), votId = uuid(), opId = uuid()
    for (const id of [u1, u2])
      await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
        .bind(id, `${id}@x.com`, 'U', 'h').run()
    for (const id of [unidadA, unidadB])
      await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,?)`)
        .bind(id, condoId, `Apto ${id.slice(0, 8)}`).run()
    await env.DB.prepare(`INSERT INTO votaciones(id,condominio_id,titulo,creada_por) VALUES(?,?,?,?)`)
      .bind(votId, condoId, 'Votación', u1).run()
    await env.DB.prepare(`INSERT INTO opciones_voto(id,votacion_id,texto) VALUES(?,?,?)`)
      .bind(opId, votId, 'Sí').run()
    return { condoId, u1, u2, unidadA, unidadB, votId, opId }
  }
  const votar = (votId: string, opId: string, usuarioId: string, unidadId: string | null) =>
    env.DB.prepare(`INSERT INTO votos(id,votacion_id,opcion_id,usuario_id,unidad_id,peso) VALUES(?,?,?,?,?,1)`)
      .bind(uuid(), votId, opId, usuarioId, unidadId).run()

  it('un mismo usuario puede votar por dos unidades distintas (propietario múltiple)', async () => {
    const s = await seedVotacion()
    await votar(s.votId, s.opId, s.u1, s.unidadA)
    await votar(s.votId, s.opId, s.u1, s.unidadB) // el viejo UNIQUE(votacion_id,usuario_id) lo prohibía
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM votos WHERE votacion_id=?`)
      .bind(s.votId).first<{ n: number }>()
    expect(n!.n).toBe(2)
  })

  it('dos usuarios de la MISMA unidad no pueden votar dos veces en la misma votación', async () => {
    const s = await seedVotacion()
    await votar(s.votId, s.opId, s.u1, s.unidadA)
    await expect(votar(s.votId, s.opId, s.u2, s.unidadA)).rejects.toThrow(/UNIQUE/i)
  })

  it('pagos acepta tasa_bs (tasa histórica congelada al pagar)', async () => {
    const { condoId } = await seedCondo()
    const uid = uuid(), uniId = uuid(), pagoId = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
      .bind(uid, `${uid}@x.com`, 'U', 'h').run()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,?)`)
      .bind(uniId, condoId, 'Apto 1A').run()
    await env.DB.prepare(
      `INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,reportado_por,tasa_bs) VALUES(?,?,?,?,?,?,?)`)
      .bind(pagoId, condoId, uniId, 50, 'pago_movil', uid, 36.55).run()
    const p = await env.DB.prepare(`SELECT tasa_bs FROM pagos WHERE id=?`).bind(pagoId).first<{ tasa_bs: number }>()
    expect(p!.tasa_bs).toBe(36.55)
  })

  it('dos pagos con la misma referencia en la misma unidad chocan; con referencia vacía no', async () => {
    const { condoId } = await seedCondo()
    const uid = uuid(), uniId = uuid()
    await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`)
      .bind(uid, `${uid}@x.com`, 'U', 'h').run()
    await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,?)`)
      .bind(uniId, condoId, 'Apto 2B').run()
    const pagar = (referencia: string | null) =>
      env.DB.prepare(`INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,reportado_por) VALUES(?,?,?,?,?,?,?)`)
        .bind(uuid(), condoId, uniId, 50, 'pago_movil', referencia, uid).run()
    await pagar('REF-001')
    // El disparador trg_pagos_referencia_unica aborta el segundo insert (doble tap / reintento).
    // No es un índice UNIQUE a propósito: eso obligaría a reescribir la referencia bancaria
    // de los pagos duplicados que ya existan en producción, y ese dato es del cliente.
    await expect(pagar('REF-001')).rejects.toThrow(/pago duplicado/i)
    await pagar('')
    await pagar('') // vacía = sin referencia: no participa del anti-duplicado
    await pagar(null)
    await pagar(null)
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM pagos WHERE unidad_id=?`).bind(uniId).first<{ n: number }>()
    expect(n!.n).toBe(5)
  })

  it('condominios.es_demo existe con default 0', async () => {
    const { condoId } = await seedCondo() // el INSERT del seed no menciona es_demo
    const c = await env.DB.prepare(`SELECT es_demo FROM condominios WHERE id=?`).bind(condoId).first<{ es_demo: number }>()
    expect(c!.es_demo).toBe(0)
  })
})

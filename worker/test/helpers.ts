import { env, applyD1Migrations } from 'cloudflare:test'

// Aplica las migraciones reales de worker/migrations (via wrangler splitter, soporta triggers).
// Idempotente: applyD1Migrations solo corre las que faltan según la tabla d1_migrations.
export async function aplicarSchema() {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS)
}

export const uuid = () => crypto.randomUUID()

/** Semilla mínima: org + condominio. Devuelve ids. */
export async function seedCondo(nombre = 'Residencias Test') {
  const orgId = uuid(), condoId = uuid()
  // nombre de org único por semilla: la migración 0002 impone UNIQUE(organizaciones.nombre)
  await env.DB.prepare(`INSERT INTO organizaciones(id,nombre) VALUES(?,?)`).bind(orgId, `Org ${orgId}`).run()
  await env.DB.prepare(`INSERT INTO condominios(id,organizacion_id,nombre) VALUES(?,?,?)`)
    .bind(condoId, orgId, nombre).run()
  return { orgId, condoId }
}

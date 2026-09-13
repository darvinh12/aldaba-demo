export async function registrarEvento(
  db: D1Database, condominioId: string | null, actorId: string | null, tipo: string, datos?: unknown,
) {
  let datosStr: string | null = null
  if (datos !== undefined) {
    try { datosStr = JSON.stringify(datos).slice(0, 4000) } catch { datosStr = '"[datos no serializables]"' }
  }
  await db.prepare(`INSERT INTO eventos(condominio_id,actor_id,tipo,datos) VALUES(?,?,?,?)`)
    .bind(condominioId, actorId, tipo, datosStr).run()
}

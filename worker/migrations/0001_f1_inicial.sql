-- Migración 0001 — Fundación F1 (idéntica al esquema original aplicado por d1 execute).
-- En producción ya existen estas tablas: CREATE ... IF NOT EXISTS hace que aplicar esta
-- migración sea un no-op seguro; wrangler solo la marca como aplicada en d1_migrations.
CREATE TABLE IF NOT EXISTS organizaciones(
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS condominios(
  id TEXT PRIMARY KEY,
  organizacion_id TEXT NOT NULL REFERENCES organizaciones(id),
  nombre TEXT NOT NULL, direccion TEXT NOT NULL DEFAULT '',
  tasa_bs REAL NOT NULL DEFAULT 0,
  suspendido INTEGER NOT NULL DEFAULT 0,
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS torres(
  id TEXT PRIMARY KEY, condominio_id TEXT NOT NULL REFERENCES condominios(id),
  nombre TEXT NOT NULL, UNIQUE(condominio_id, nombre));
CREATE TABLE IF NOT EXISTS unidades(
  id TEXT PRIMARY KEY, condominio_id TEXT NOT NULL REFERENCES condominios(id),
  torre_id TEXT REFERENCES torres(id), nombre TEXT NOT NULL,
  alicuota REAL NOT NULL DEFAULT 0,
  UNIQUE(condominio_id, torre_id, nombre));
CREATE TABLE IF NOT EXISTS usuarios(
  id TEXT PRIMARY KEY, email TEXT COLLATE NOCASE NOT NULL UNIQUE, nombre TEXT NOT NULL,
  hash TEXT NOT NULL, es_superadmin INTEGER NOT NULL DEFAULT 0,
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS membresias(
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  rol TEXT NOT NULL CHECK(rol IN ('org_admin','admin','porteria','residente')),
  UNIQUE(usuario_id, condominio_id, unidad_id, rol));
CREATE TABLE IF NOT EXISTS invitaciones(
  token TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  rol TEXT NOT NULL CHECK(rol IN ('org_admin','admin','porteria','residente')),
  usada INTEGER NOT NULL DEFAULT 0,
  expira TEXT NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sesiones(
  id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  expira TEXT NOT NULL, creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS login_intentos(
  clave TEXT PRIMARY KEY, ventana INTEGER NOT NULL, intentos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comunicados(
  id TEXT PRIMARY KEY, condominio_id TEXT NOT NULL REFERENCES condominios(id),
  titulo TEXT NOT NULL, cuerpo TEXT NOT NULL, adjunto_key TEXT,
  creado_por TEXT NOT NULL REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS lecturas_comunicado(
  comunicado_id TEXT NOT NULL REFERENCES comunicados(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  leida TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(comunicado_id, usuario_id));
CREATE TABLE IF NOT EXISTS eventos(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condominio_id TEXT, actor_id TEXT, tipo TEXT NOT NULL, datos TEXT,
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_membresias_usuario ON membresias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_comunicados_condo ON comunicados(condominio_id, creada);
CREATE INDEX IF NOT EXISTS idx_eventos_condo ON eventos(condominio_id, creada);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_membresias_condo ON membresias(condominio_id, rol);
CREATE INDEX IF NOT EXISTS idx_invitaciones_condo ON invitaciones(condominio_id, creada);

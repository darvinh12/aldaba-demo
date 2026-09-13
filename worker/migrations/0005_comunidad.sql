-- Migración 0005 — Comunidad (F4): reservas de áreas comunes, votaciones ponderadas por
-- alícuota, tickets de mantenimiento y directorio del condominio.

CREATE TABLE IF NOT EXISTS areas_comunes(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  nombre TEXT NOT NULL,
  aforo INTEGER NOT NULL DEFAULT 0,
  costo_usd REAL NOT NULL DEFAULT 0 CHECK(costo_usd >= 0),
  horario TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(condominio_id, nombre));

CREATE TABLE IF NOT EXISTS reservas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  area_id TEXT NOT NULL REFERENCES areas_comunes(id),
  unidad_id TEXT REFERENCES unidades(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,                    -- 'YYYY-MM-DD'
  franja TEXT,                            -- 'mañana'|'tarde'|'noche'|libre
  invitados INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'solicitada' CHECK(estado IN ('solicitada','aprobada','rechazada')),
  motivo TEXT,
  resuelta_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS votaciones(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  cierre TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta','cerrada')),
  creada_por TEXT NOT NULL REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS opciones_voto(
  id TEXT PRIMARY KEY,
  votacion_id TEXT NOT NULL REFERENCES votaciones(id),
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS votos(
  id TEXT PRIMARY KEY,
  votacion_id TEXT NOT NULL REFERENCES votaciones(id),
  opcion_id TEXT NOT NULL REFERENCES opciones_voto(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  peso REAL NOT NULL DEFAULT 1,           -- ponderación por alícuota
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(votacion_id, usuario_id));       -- un voto por persona por votación

CREATE TABLE IF NOT EXISTS tickets(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT NOT NULL DEFAULT 'general',
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK(estado IN ('abierto','en_curso','resuelto')),
  asignado TEXT,
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada TEXT);

CREATE TABLE IF NOT EXISTS directorio(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  nombre TEXT NOT NULL,
  cargo TEXT,
  telefono TEXT,
  nota TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  creada TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_areas_condo ON areas_comunes(condominio_id);
CREATE INDEX IF NOT EXISTS idx_reservas_condo ON reservas(condominio_id, estado, fecha);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id, creada);
CREATE INDEX IF NOT EXISTS idx_votaciones_condo ON votaciones(condominio_id, estado);
CREATE INDEX IF NOT EXISTS idx_votos_votacion ON votos(votacion_id);
CREATE INDEX IF NOT EXISTS idx_tickets_condo ON tickets(condominio_id, estado, creada);
CREATE INDEX IF NOT EXISTS idx_directorio_condo ON directorio(condominio_id, orden);

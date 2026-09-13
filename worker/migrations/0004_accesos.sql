-- Migración 0004 — Accesos y seguridad (F3): pases de visita, bitácora de accesos,
-- paquetería, SOS y rondas de portería. Todo multi-tenant y con actor para auditoría.

-- Pases de visita creados por el residente (código = token compartible por WhatsApp / QR público).
CREATE TABLE IF NOT EXISTS pases_visita(
  token TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  creado_por TEXT NOT NULL REFERENCES usuarios(id),
  visitante TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'unico' CHECK(tipo IN ('unico','recurrente')),
  ventana TEXT,                                  -- descripción de la ventana horaria
  usos INTEGER NOT NULL DEFAULT 0,
  expira TEXT NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Bitácora de accesos (QR, sin cita/citófono, delivery). Estado incluye 'pendiente' para el citófono.
CREATE TABLE IF NOT EXISTS visitas_log(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  pase_token TEXT REFERENCES pases_visita(token),
  visitante TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('qr','sincita','delivery')),
  estado TEXT NOT NULL DEFAULT 'ingreso' CHECK(estado IN ('ingreso','denegado','pendiente')),
  documento TEXT,
  foto_key TEXT,
  motivo TEXT,
  guardia_id TEXT REFERENCES usuarios(id),
  resuelto_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Paquetería en custodia de portería.
CREATE TABLE IF NOT EXISTS paquetes(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT NOT NULL REFERENCES unidades(id),
  descripcion TEXT NOT NULL,
  remitente TEXT,
  foto_key TEXT,
  estado TEXT NOT NULL DEFAULT 'custodia' CHECK(estado IN ('custodia','entregado')),
  recibido_por TEXT NOT NULL REFERENCES usuarios(id),
  entregado_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  entregada TEXT);

-- Alertas SOS del residente (portería/administración responden).
CREATE TABLE IF NOT EXISTS sos_alertas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT REFERENCES unidades(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','atendida','resuelta')),
  atendida_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  resuelta TEXT);

-- Rondas del guardia: checkpoints con novedad opcional.
CREATE TABLE IF NOT EXISTS rondas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  guardia_id TEXT NOT NULL REFERENCES usuarios(id),
  checkpoint TEXT NOT NULL,
  novedad TEXT,
  foto_key TEXT,
  creada TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_pases_condo ON pases_visita(condominio_id, creada);
CREATE INDEX IF NOT EXISTS idx_pases_unidad ON pases_visita(unidad_id, creada);
CREATE INDEX IF NOT EXISTS idx_visitas_condo ON visitas_log(condominio_id, creada);
CREATE INDEX IF NOT EXISTS idx_visitas_estado ON visitas_log(condominio_id, estado);
CREATE INDEX IF NOT EXISTS idx_paquetes_condo ON paquetes(condominio_id, estado, creada);
CREATE INDEX IF NOT EXISTS idx_paquetes_unidad ON paquetes(unidad_id, creada);
CREATE INDEX IF NOT EXISTS idx_sos_condo ON sos_alertas(condominio_id, estado, creada);
CREATE INDEX IF NOT EXISTS idx_rondas_condo ON rondas(condominio_id, creada);

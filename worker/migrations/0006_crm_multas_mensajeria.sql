-- Migración 0006 — Multas/amonestaciones, CRM (contacto + notas) y mensajería con plantillas.

-- Teléfono del usuario (para WhatsApp / CRM).
ALTER TABLE usuarios ADD COLUMN telefono TEXT;

-- Multas (con monto, suman a la deuda de la unidad) y amonestaciones (aviso sin monto).
CREATE TABLE IF NOT EXISTS multas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT NOT NULL REFERENCES unidades(id),
  tipo TEXT NOT NULL DEFAULT 'multa' CHECK(tipo IN ('multa','amonestacion')),
  motivo TEXT NOT NULL,
  monto_usd REAL NOT NULL DEFAULT 0 CHECK(monto_usd >= 0),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','pagada','anulada')),
  creada_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Notas del CRM sobre una unidad/propietario.
CREATE TABLE IF NOT EXISTS notas_crm(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT NOT NULL REFERENCES unidades(id),
  texto TEXT NOT NULL,
  creada_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Plantillas de mensajería (además de las prehechas del sistema).
CREATE TABLE IF NOT EXISTS plantillas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  nombre TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Campañas de mensajería enviadas (auditoría de comunicación masiva).
CREATE TABLE IF NOT EXISTS mensajes(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  canal TEXT NOT NULL CHECK(canal IN ('whatsapp','email')),
  asunto TEXT,
  cuerpo TEXT NOT NULL,
  destinatarios INTEGER NOT NULL DEFAULT 0,
  enviado_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_multas_unidad ON multas(unidad_id, estado);
CREATE INDEX IF NOT EXISTS idx_multas_condo ON multas(condominio_id, creada);
CREATE INDEX IF NOT EXISTS idx_notas_unidad ON notas_crm(unidad_id, creada);
CREATE INDEX IF NOT EXISTS idx_plantillas_condo ON plantillas(condominio_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_condo ON mensajes(condominio_id, creada);

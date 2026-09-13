-- ============================================================================
-- ALDABA · Esquema SQL consolidado (D1 / SQLite)
-- Generado desde worker/migrations/*.sql (fuente de verdad versionada).
-- NO ejecutar directamente en prod: el esquema vive se aplica con
--   npx wrangler d1 migrations apply aldaba-db --remote
-- ============================================================================


-- ####################################################################
-- 0001_f1_inicial.sql
-- ####################################################################
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

-- ####################################################################
-- 0002_endurecimiento.sql
-- ####################################################################
-- Migración 0002 — Endurecimiento F1 (no destructiva; segura sobre datos vivos).
-- Cierra hallazgos de auditoría: índices únicos parciales que la BD no garantizaba con NULL,
-- unicidad de nombres, autoría de invitaciones, índice de limpieza de sesiones y CHECK de rango
-- por trigger (SQLite no permite añadir CHECK con ALTER sin recrear la tabla).

-- 1) Autoría de invitaciones (el vector de acceso más sensible del sistema).
ALTER TABLE invitaciones ADD COLUMN creado_por TEXT REFERENCES usuarios(id);

-- 2) Membresías sin unidad (admin/org_admin/porteria): la UNIQUE compuesta no aplica con
--    unidad_id NULL. Dedupe defensivo de filas idénticas redundantes, luego índice único parcial.
DELETE FROM membresias WHERE unidad_id IS NULL AND rowid NOT IN (
  SELECT MIN(rowid) FROM membresias WHERE unidad_id IS NULL
  GROUP BY usuario_id, condominio_id, rol);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membresias_sin_unidad
  ON membresias(usuario_id, condominio_id, rol) WHERE unidad_id IS NULL;

-- 3) Unidades sin torre: mismo problema con torre_id NULL. Renombra duplicados (sin perder datos)
--    antes de crear el índice único parcial.
UPDATE unidades SET nombre = nombre || ' (' || rowid || ')'
WHERE torre_id IS NULL AND rowid NOT IN (
  SELECT MIN(rowid) FROM unidades WHERE torre_id IS NULL GROUP BY condominio_id, nombre);
CREATE UNIQUE INDEX IF NOT EXISTS uq_unidades_sin_torre
  ON unidades(condominio_id, nombre) WHERE torre_id IS NULL;

-- 4) Unicidad de nombres: doble clic / retry creaba homónimos indistinguibles. Renombra
--    duplicados existentes antes de imponer la restricción.
UPDATE organizaciones SET nombre = nombre || ' (' || rowid || ')'
WHERE rowid NOT IN (SELECT MIN(rowid) FROM organizaciones GROUP BY nombre);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizaciones_nombre ON organizaciones(nombre);

UPDATE condominios SET nombre = nombre || ' (' || rowid || ')'
WHERE rowid NOT IN (SELECT MIN(rowid) FROM condominios GROUP BY organizacion_id, nombre);
CREATE UNIQUE INDEX IF NOT EXISTS uq_condominios_org_nombre
  ON condominios(organizacion_id, nombre);

-- 5) Limpieza de sesiones vencidas (corre en cada login) sin full scan.
CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira);

-- 6) CHECK de rango por trigger (defensa en BD, no solo en el parser CSV): alícuota y tasa_bs >= 0.
CREATE TRIGGER IF NOT EXISTS trg_unidades_alicuota_ins
  BEFORE INSERT ON unidades WHEN NEW.alicuota < 0
  BEGIN SELECT RAISE(ABORT, 'alicuota no puede ser negativa'); END;
CREATE TRIGGER IF NOT EXISTS trg_unidades_alicuota_upd
  BEFORE UPDATE OF alicuota ON unidades WHEN NEW.alicuota < 0
  BEGIN SELECT RAISE(ABORT, 'alicuota no puede ser negativa'); END;
CREATE TRIGGER IF NOT EXISTS trg_condominios_tasa_ins
  BEFORE INSERT ON condominios WHEN NEW.tasa_bs < 0
  BEGIN SELECT RAISE(ABORT, 'tasa_bs no puede ser negativa'); END;
CREATE TRIGGER IF NOT EXISTS trg_condominios_tasa_upd
  BEFORE UPDATE OF tasa_bs ON condominios WHEN NEW.tasa_bs < 0
  BEGIN SELECT RAISE(ABORT, 'tasa_bs no puede ser negativa'); END;

-- ####################################################################
-- 0003_finanzas.sql
-- ####################################################################
-- Migración 0003 — Finanzas y tesorería del condominio (F2).
-- Ingresos (cuotas emitidas + pagos reportados y conciliados) y egresos (gastos/compras
-- con factura). Todo con actor registrado para auditoría; el capital/fondo se computa de
-- estos movimientos. Multi-tenant: toda tabla lleva condominio_id.

-- Cuotas emitidas a una unidad por período (YYYY-MM). Un concepto por unidad/período.
CREATE TABLE IF NOT EXISTS cuotas(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT NOT NULL REFERENCES unidades(id),
  periodo TEXT NOT NULL,                         -- 'YYYY-MM'
  concepto TEXT NOT NULL DEFAULT 'Cuota de condominio',
  monto_usd REAL NOT NULL CHECK(monto_usd >= 0),
  emitida_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(unidad_id, periodo, concepto));

-- Pagos reportados por el residente y conciliados por el admin (borrador→aprobado/rechazado).
CREATE TABLE IF NOT EXISTS pagos(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  unidad_id TEXT NOT NULL REFERENCES unidades(id),
  monto_usd REAL NOT NULL CHECK(monto_usd >= 0),
  metodo TEXT NOT NULL,                          -- 'pago_movil'|'transferencia'|'zelle'|'efectivo'
  referencia TEXT,
  comprobante_key TEXT,                          -- objeto R2 (captura del comprobante)
  estado TEXT NOT NULL DEFAULT 'reportado' CHECK(estado IN ('reportado','aprobado','rechazado')),
  motivo TEXT,                                   -- motivo de rechazo
  reportado_por TEXT NOT NULL REFERENCES usuarios(id),
  conciliado_por TEXT REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  conciliada TEXT);

-- Egresos: gastos y compras del condominio, con factura adjunta (auditoría de en qué se gasta).
CREATE TABLE IF NOT EXISTS gastos(
  id TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('gasto','compra')),
  categoria TEXT NOT NULL,                       -- 'vigilancia'|'limpieza'|'mantenimiento'|'servicios'|'fondo'|'otro'
  descripcion TEXT NOT NULL,
  proveedor TEXT,
  monto_usd REAL NOT NULL CHECK(monto_usd >= 0),
  factura_key TEXT,                              -- objeto R2 (factura/recibo)
  factura_nro TEXT,
  fecha TEXT NOT NULL,                           -- 'YYYY-MM-DD'
  registrado_por TEXT NOT NULL REFERENCES usuarios(id),
  creada TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_cuotas_condo ON cuotas(condominio_id, periodo);
CREATE INDEX IF NOT EXISTS idx_cuotas_unidad ON cuotas(unidad_id, periodo);
CREATE INDEX IF NOT EXISTS idx_pagos_condo ON pagos(condominio_id, estado, creada);
CREATE INDEX IF NOT EXISTS idx_pagos_unidad ON pagos(unidad_id, creada);
CREATE INDEX IF NOT EXISTS idx_gastos_condo ON gastos(condominio_id, fecha);

-- ####################################################################
-- 0004_accesos.sql
-- ####################################################################
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

-- ####################################################################
-- 0005_comunidad.sql
-- ####################################################################
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

-- ####################################################################
-- 0006_crm_multas_mensajeria.sql
-- ####################################################################
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

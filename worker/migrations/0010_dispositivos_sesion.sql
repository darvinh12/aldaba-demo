-- Migración 0010 — Dispositivos y sesión persistente (origen: prueba del APK en el teléfono del dueño, 2026-08-18).
-- Objetivo: que la sesión de la app nativa no se caiga nunca sin motivo:
--   1) tabla `dispositivos` para registrar cada teléfono/tablet del usuario (y poder revocarlo);
--   2) `sesiones.dispositivo_id` para atar cada sesión a su dispositivo;
--   3) `sesiones.ultimo_uso` para la sesión deslizante (extender `expira` como máximo una vez por hora).
--
-- ESTILO OBLIGATORIO EN ESTE REPO (nos costó un despliegue): solo comentarios `--`,
-- jamás comentarios de bloque al estilo C, y cualquier cuerpo de trigger en UNA línea. El aplicador remoto
-- de D1 parte el archivo por sentencias y rechaza con
-- "SQL code did not contain a statement [7500]" cualquier otro formato.
--
-- Seguridad sobre PRODUCCIÓN: nada borra ni reescribe datos existentes; solo
-- CREATE TABLE/INDEX nuevos y ALTER TABLE ADD COLUMN (las filas viejas quedan NULL).

-- ============ 1. DISPOSITIVOS ============
-- Un registro por instalación de la app (o navegador que se registre). Esta tabla es la
-- MISMA que usará la mensajería push más adelante: `push_token` es el hueco reservado
-- (token FCM/APNs, NULL hasta que el dispositivo lo registre); no crear otra tabla para push.
-- `revocado=1` corta el dispositivo: sus sesiones se borran al revocar y la renovación se niega.
CREATE TABLE IF NOT EXISTS dispositivos(
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  plataforma TEXT NOT NULL CHECK(plataforma IN ('android','ios','web')),
  nombre TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT '',
  push_token TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_uso TEXT NOT NULL DEFAULT (datetime('now')),
  revocado INTEGER NOT NULL DEFAULT 0);

CREATE INDEX IF NOT EXISTS idx_dispositivos_usuario ON dispositivos(usuario_id, ultimo_uso);

-- ============ 2. SESIONES: dispositivo y último uso ============
-- `dispositivo_id` NULL = sesión web clásica o anterior a esta migración (sigue válida igual).
-- `ultimo_uso` NULL = sesión creada antes de la migración; el código lo trata como
-- "nunca actualizado" y lo llena en la próxima petición (session.ts).
-- ADD COLUMN no admite DEFAULT no constante: el valor lo pone el código al crear la sesión.
ALTER TABLE sesiones ADD COLUMN dispositivo_id TEXT REFERENCES dispositivos(id);
ALTER TABLE sesiones ADD COLUMN ultimo_uso TEXT;

-- Revocar un dispositivo borra sus sesiones con `DELETE ... WHERE dispositivo_id=?` (dispositivos.ts).
CREATE INDEX IF NOT EXISTS idx_sesiones_dispositivo ON sesiones(dispositivo_id);

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

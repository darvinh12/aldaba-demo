-- Migración 0009 — Saneamiento de integridad (auditoría de datos 2026-08-18).
-- (0008 queda reservado para la tabla `dispositivos` de notificaciones push.)
-- Diseñada para correr contra la D1 de PRODUCCIÓN con datos reales:
-- NADA borra filas, NADA reescribe datos del cliente, y ningún paso puede
-- fallar por duplicados preexistentes. El CI respalda la base antes de aplicar.
--
-- ESTILO OBLIGATORIO EN ESTE REPO: solo comentarios `--` y el cuerpo de los
-- disparadores en UNA línea (`BEGIN SELECT RAISE(...); END;`). El aplicador
-- remoto de D1 parte el archivo por sentencias y rechaza con
-- "SQL code did not contain a statement [7500]" cualquier otro formato.

-- ============ 1. VOTO POR UNIDAD (decisión del dueño) ============
-- Una unidad = un voto ponderado por su alícuota: un propietario con tres
-- apartamentos emite tres votos; dos residentes de la misma unidad votan una
-- sola vez. Hoy `votos` tiene UNIQUE(votacion_id, usuario_id) — regla por
-- PERSONA — y no persiste la unidad. SQLite no permite quitar una restricción
-- de tabla: se RECONSTRUYE la tabla con la forma correcta.
CREATE TABLE votos_nueva(
  id TEXT PRIMARY KEY,
  votacion_id TEXT NOT NULL REFERENCES votaciones(id),
  opcion_id TEXT NOT NULL REFERENCES opciones_voto(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  unidad_id TEXT REFERENCES unidades(id),   -- NULL = voto histórico sin unidad deducible
  peso REAL NOT NULL DEFAULT 1,             -- ponderación por alícuota
  creada TEXT NOT NULL DEFAULT (datetime('now')));

-- Copia con backfill best-effort: la unidad se deduce de la membresía
-- 'residente' vigente del votante en el condominio de la votación. Los votos
-- de usuarios ya desvinculados quedan NULL y SE CONSERVAN (nunca se pierden).
INSERT INTO votos_nueva(id, votacion_id, opcion_id, usuario_id, unidad_id, peso, creada)
SELECT v.id, v.votacion_id, v.opcion_id, v.usuario_id,
  (SELECT m.unidad_id FROM membresias m
   JOIN votaciones vo ON vo.id = v.votacion_id
   WHERE m.usuario_id = v.usuario_id
     AND m.condominio_id = vo.condominio_id
     AND m.rol = 'residente' AND m.unidad_id IS NOT NULL
   LIMIT 1),
  v.peso, v.creada
FROM votos v;

-- Si el backfill revela que una unidad ya votó doble (rotación histórica de
-- residentes), el índice único parcial de abajo fallaría. Para que la migración
-- sea segura en prod se conserva la unidad SOLO en el voto más antiguo de cada
-- (votación, unidad); los posteriores quedan con unidad NULL. El voto no se
-- borra: sigue contando por usuario como hasta hoy, y el código impide que ese
-- votante vuelva a votar (comunidad.ts). Revisables por consola: son los votos
-- con unidad_id NULL cuyo usuario sí tiene membresía vigente.
UPDATE votos_nueva SET unidad_id = NULL
WHERE unidad_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM votos_nueva v2
  WHERE v2.votacion_id = votos_nueva.votacion_id
    AND v2.unidad_id = votos_nueva.unidad_id
    AND v2.id != votos_nueva.id
    AND (v2.creada < votos_nueva.creada
         OR (v2.creada = votos_nueva.creada AND v2.id < votos_nueva.id)));

DROP TABLE votos;
ALTER TABLE votos_nueva RENAME TO votos;

-- Índices de la tabla reconstruida: el del listado (0005) + el del conteo por
-- opción (JOIN votos ON opcion_id en GET /votaciones, comunidad.ts).
CREATE INDEX IF NOT EXISTS idx_votos_votacion ON votos(votacion_id);
CREATE INDEX IF NOT EXISTS idx_votos_opcion ON votos(opcion_id);

-- La regla nueva: una unidad vota UNA vez por votación. Parcial: los votos
-- históricos sin unidad deducible (NULL) no chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS uq_votos_unidad
  ON votos(votacion_id, unidad_id) WHERE unidad_id IS NOT NULL;

-- ============ 2. TASA Bs HISTÓRICA EN PAGOS ============
-- El recibo hoy convierte con la tasa ACTUAL del condominio; un recibo
-- reimpreso meses después muestra Bs distintos a los que se pagaron. La columna
-- se llena al reportar el pago (finanzas.ts). Los pagos viejos quedan NULL y el
-- código hace respaldo con la tasa actual, marcándola como referencial.
ALTER TABLE pagos ADD COLUMN tasa_bs REAL;

-- ============ 3. ANTI-DUPLICADO DE PAGOS ============
-- Doble tap / reintento crea hoy dos pagos idénticos, ambos aprobables.
-- La referencia es el número de la operación bancaria con el que la junta
-- concilia contra el banco: es un dato contable del cliente y NO se toca.
-- Por eso NO se usa un índice UNIQUE (obligaría a reescribir la referencia de
-- los pagos duplicados que ya existan para que el CREATE no fallara). Se usa un
-- disparador BEFORE INSERT: bloquea los duplicados NUEVOS y deja intacta cada
-- fila histórica, aunque hoy haya duplicados sin resolver.
-- La referencia vacía o NULL no participa (efectivo sin referencia no choca).
-- El mensaje amable de 409 lo da el código (finanzas.ts:160-163); esto es la
-- red de seguridad de la base para cualquier otra vía de inserción.
CREATE TRIGGER IF NOT EXISTS trg_pagos_referencia_unica
  BEFORE INSERT ON pagos
  WHEN NEW.referencia IS NOT NULL AND NEW.referencia != '' AND EXISTS (SELECT 1 FROM pagos p WHERE p.condominio_id = NEW.condominio_id AND p.unidad_id = NEW.unidad_id AND p.referencia = NEW.referencia)
  BEGIN SELECT RAISE(ABORT, 'pago duplicado: ya existe uno con esa referencia en la unidad'); END;

-- ============ 4. CONDOMINIOS DEMO ============
-- Marca persistente para que auth y los seeds distingan la demo de los clientes
-- reales sin depender de nombres. UPDATE por id: si el condominio no existe,
-- simplemente no cambia filas (no falla). 'demo-condo-aldaba' es un id de
-- referencia para el condominio real de producción, que no existe en esta
-- base (ver scripts/seed_demo_enriquecer.sql).
ALTER TABLE condominios ADD COLUMN es_demo INTEGER NOT NULL DEFAULT 0;
UPDATE condominios SET es_demo = 1
WHERE id IN ('demo-condo-norte', 'demo-condo-sur', 'demo-condo-aldaba');

-- ============ 5. ÍNDICES PARA QUERIES REALES ============
-- membresias(unidad_id): lo usan el CRM de propietarios (LEFT JOIN membresias
-- ON m.unidad_id=u.id, finanzas.ts /crm), el detalle de unidad, el guard de
-- borrado de residente y el check de voto por unidad (comunidad.ts /votar).
-- opciones_voto(votacion_id): listado de opciones y validación de la opción al
-- votar (comunidad.ts). El de votos(opcion_id) ya se creó arriba.
CREATE INDEX IF NOT EXISTS idx_membresias_unidad ON membresias(unidad_id);
CREATE INDEX IF NOT EXISTS idx_opciones_votacion ON opciones_voto(votacion_id);

-- Índice muerto verificado: sesiones se consulta por PK (session.ts:22) y por
-- expira (idx_sesiones_expira); nadie la consulta por usuario_id. Quitarlo
-- abarata el INSERT de cada login.
DROP INDEX IF EXISTS idx_sesiones_usuario;

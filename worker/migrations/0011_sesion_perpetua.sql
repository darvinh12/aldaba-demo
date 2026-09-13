-- Migración 0011 — Sesión perpetua (origen: decisión del dueño, 2026-08-27).
-- La sesión pasa a durar 365 días de INACTIVIDAD y se desliza con cada uso: quien abre
-- Aldaba al menos una vez al año no vuelve a escribir su clave. `expira` conserva su
-- significado de "fecha a partir de la cual la sesión ya no vale", así que todos los
-- WHERE expira > datetime('now') siguen siendo correctos y la purga oportunista sigue
-- borrando exactamente lo abandonado. Lo que se agrega son dos columnas y un índice.
--
-- ESTILO OBLIGATORIO EN ESTE REPO (nos costó un despliegue): solo comentarios `--`,
-- jamás comentarios de bloque al estilo C, y cualquier cuerpo de trigger en UNA línea.
--
-- 1) Un índice: POST /api/sesion/cerrar-otras (auth.ts) borra las sesiones del usuario
-- salvo la actual, y sin este índice sería un full scan de la tabla. La 0009 lo había
-- eliminado como índice muerto porque en ese momento nadie consultaba `sesiones` por
-- usuario_id; el cierre remoto lo vuelve a necesitar.
-- Nada de datos se toca: CREATE INDEX IF NOT EXISTS es idempotente y no bloquea filas.
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);

-- 2) La CLASE de la sesión, guardada en la fila. Es el corazón de este cambio.
-- `dias`  = cuánto vale la sesión (su duración, no su vencimiento).
-- `desliza` = 1 si `expira` es un límite de INACTIVIDAD que se corre con el uso (la
--             sesión perpetua); 0 si es un plazo DURO desde el login que el uso no mueve
--             (hoy solo el superadmin sin dispositivo anclado).
-- POR QUÉ una columna y no calcularlo: el primer intento derivaba la duración de
-- (expira - creada). Como `creada` nunca cambia y cada extensión aleja `expira`, el
-- span crecía en cada uso (365 -> 548 -> 823...) y la sesión corta del superadmin se
-- volvía perpetua con solo abrir la app. La duración tiene que ser un dato estable.
-- Filas anteriores a esta migración: `dias` NULL y `desliza` 0 = no deslizan (no sabemos
-- con qué regla nacieron y no se les regala perpetuidad); viven hasta su `expira`
-- original y se canjean en POST /api/sesion/renovar como siempre.
-- ADD COLUMN con DEFAULT constante no reescribe la tabla ni bloquea filas.
ALTER TABLE sesiones ADD COLUMN dias INTEGER;
ALTER TABLE sesiones ADD COLUMN desliza INTEGER NOT NULL DEFAULT 0;

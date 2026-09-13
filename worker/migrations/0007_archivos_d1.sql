-- Almacén de archivos sobre D1 (fallback sin R2): comprobantes, facturas y fotos como BLOB.
-- Se usa SOLO cuando el binding R2 (MEDIA) no está configurado. Cada archivo va acotado a 500 KB
-- por la validación de media.ts, muy por debajo del límite de fila de D1. Aislado por condominio_id.
CREATE TABLE IF NOT EXISTS archivos(
  key TEXT PRIMARY KEY,
  condominio_id TEXT NOT NULL REFERENCES condominios(id),
  mime TEXT NOT NULL,
  datos BLOB NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_archivos_condo ON archivos(condominio_id);

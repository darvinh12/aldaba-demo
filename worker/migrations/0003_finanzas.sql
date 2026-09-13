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

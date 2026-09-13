-- Historia financiera de 5 meses (2026-02..2026-06) para los edificios demo, para que los
-- gráficos de tendencia del dashboard luzcan con datos reales. Idempotente (NOT EXISTS).
-- REGLA INNEGOCIABLE: ningún seed puede tocar filas de condominios con es_demo=0 (clientes
-- reales). Condominios seleccionados por ID demo (nunca por nombre: un cliente real podría
-- llamarse igual); usuarios (emisor/registrador) = admin del condominio.

-- 1) CUOTAS mensuales por unidad ($60)
INSERT INTO cuotas(id,condominio_id,unidad_id,periodo,concepto,monto_usd,emitida_por)
SELECT lower(hex(randomblob(16))), u.condominio_id, u.id, p.periodo, 'Cuota de condominio', 60,
  (SELECT m.usuario_id FROM membresias m WHERE m.condominio_id=u.condominio_id AND m.rol='admin' LIMIT 1)
FROM unidades u
CROSS JOIN (SELECT '2026-02' periodo UNION ALL SELECT '2026-03' UNION ALL SELECT '2026-04' UNION ALL SELECT '2026-05' UNION ALL SELECT '2026-06') p
WHERE u.condominio_id IN ('demo-condo-norte','demo-condo-sur')
  AND NOT EXISTS (SELECT 1 FROM cuotas c WHERE c.unidad_id=u.id AND c.periodo=p.periodo AND c.concepto='Cuota de condominio');

-- 2) PAGOS aprobados de esas cuotas, conciliados dentro del mes (deja una unidad '…2C' morosa)
INSERT INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,estado,reportado_por,conciliado_por,conciliada,creada)
SELECT lower(hex(randomblob(16))), u.condominio_id, u.id, 60, 'transferencia', 'aprobado',
  (SELECT m.usuario_id FROM membresias m WHERE m.condominio_id=u.condominio_id AND m.rol='admin' LIMIT 1),
  (SELECT m.usuario_id FROM membresias m WHERE m.condominio_id=u.condominio_id AND m.rol='admin' LIMIT 1),
  p.periodo || '-12 10:00:00', p.periodo || '-11 09:00:00'
FROM unidades u
CROSS JOIN (SELECT '2026-02' periodo UNION ALL SELECT '2026-03' UNION ALL SELECT '2026-04' UNION ALL SELECT '2026-05' UNION ALL SELECT '2026-06') p
WHERE u.condominio_id IN ('demo-condo-norte','demo-condo-sur')
  AND u.nombre NOT LIKE '%2C'
  AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.unidad_id=u.id AND substr(pg.conciliada,1,7)=p.periodo);

-- 3) GASTOS mensuales por edificio (vigilancia, limpieza, mantenimiento)
INSERT INTO gastos(id,condominio_id,tipo,categoria,descripcion,monto_usd,fecha,registrado_por)
SELECT lower(hex(randomblob(16))), c.id, g.tipo, g.categoria, g.descripcion, g.monto, p.periodo || '-' || g.dia,
  (SELECT m.usuario_id FROM membresias m WHERE m.condominio_id=c.id AND m.rol='admin' LIMIT 1)
FROM condominios c
CROSS JOIN (SELECT '2026-02' periodo UNION ALL SELECT '2026-03' UNION ALL SELECT '2026-04' UNION ALL SELECT '2026-05' UNION ALL SELECT '2026-06') p
CROSS JOIN (
  SELECT 'gasto' tipo, 'vigilancia' categoria, 'Vigilancia mensual' descripcion, 50 monto, '05' dia
  UNION ALL SELECT 'gasto', 'limpieza', 'Limpieza áreas comunes', 30, '08'
  UNION ALL SELECT 'compra', 'mantenimiento', 'Mantenimiento de ascensor', 40, '18'
) g
WHERE c.id IN ('demo-condo-norte','demo-condo-sur')
  AND NOT EXISTS (SELECT 1 FROM gastos gg WHERE gg.condominio_id=c.id AND gg.fecha=p.periodo || '-' || g.dia AND gg.descripcion=g.descripcion);

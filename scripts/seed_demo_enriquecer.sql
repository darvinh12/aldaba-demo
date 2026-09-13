-- REGLA INNEGOCIABLE: ningún seed puede tocar filas de condominios con es_demo=0 (clientes
-- reales). Todas las sentencias de este archivo van acotadas por ID a los condominios demo.
-- ENRIQUECER data demo (idempotente por id determinista / NOT EXISTS). Fechas relativas (no envejece).
-- Condos: norte=demo-condo-norte, sur=demo-condo-sur, aldaba=demo-condo-aldaba
-- El id "aldaba" es el condominio real de producción y no existe en la base
-- aldaba-demo-db (solo tiene norte y sur). Por eso las listas de condos se
-- resuelven contra la tabla condominios (WHERE id IN (...)) en vez de un UNION
-- ALL literal: así el condo inexistente simplemente no participa aquí y no
-- rompe el FOREIGN KEY, pero el mismo script sigue enriqueciendo los tres
-- condominios si se corre contra la base de producción.

-- ========== DIRECTORIO (los 3) ==========
INSERT OR IGNORE INTO directorio(id,condominio_id,nombre,cargo,telefono,nota,orden)
SELECT 'dir-'||c.id||'-'||g.k, c.id, g.nombre, g.cargo, g.tel, g.nota, g.orden
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
CROSS JOIN (
  SELECT 'conserje' k,'Conserjería' nombre,'Conserje' cargo,'0212-555-1010' tel,'Recepción, lun-sáb 6am-8pm' nota,0 orden
  UNION ALL SELECT 'junta','Presidencia de Junta','Administración','0414-555-2020','Reuniones el primer lunes de cada mes',1
  UNION ALL SELECT 'plomero','Servicios – Plomería','Contratista','0416-555-3030','Emergencias 24h',2
  UNION ALL SELECT 'electr','Servicios – Electricidad','Contratista','0424-555-4040','Fallas eléctricas y ascensor',3
  UNION ALL SELECT 'vigil','Central de Vigilancia','Seguridad','0212-555-5050','Portón y cámaras',4
) g;

-- ========== PLANTILLAS de mensajería (los 3) ==========
INSERT OR IGNORE INTO plantillas(id,condominio_id,nombre,cuerpo)
SELECT 'pl-'||c.id||'-'||g.k, c.id, g.nombre, g.cuerpo
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
CROSS JOIN (
  SELECT 'pago' k,'Recordatorio de pago' nombre,'Estimado {nombre}, le recordamos que la unidad {unidad} presenta un saldo pendiente. Agradecemos regularizarlo. Gracias.' cuerpo
  UNION ALL SELECT 'agua','Corte de agua programado','Estimados residentes, mañana habrá corte de agua de 9am a 1pm por mantenimiento del tanque. Recomendamos almacenar agua.'
  UNION ALL SELECT 'asamblea','Convocatoria a asamblea','Se convoca a asamblea de propietarios este sábado a las 4pm en el salón de fiestas. Su participación es importante.'
) g;

-- ========== ÁREAS COMUNES (Sur + Aldaba; Norte ya tiene) ==========
INSERT OR IGNORE INTO areas_comunes(id,condominio_id,nombre,aforo,costo_usd,horario,activa)
SELECT 'area-'||c.id||'-'||g.k, c.id, g.nombre, g.aforo, g.costo, g.horario, 1
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-sur','demo-condo-aldaba')) c
CROSS JOIN (
  SELECT 'salon' k,'Salón de fiestas' nombre,40 aforo,25 costo,'9am - 11pm' horario
  UNION ALL SELECT 'parrilla','Parrillera',15,10,'10am - 10pm'
  UNION ALL SELECT 'gym','Gimnasio',8,0,'5am - 10pm'
) g;

-- ========== VOTOS para la votación existente de Norte (lucía sin votos) ==========
INSERT OR IGNORE INTO votos(id,votacion_id,opcion_id,usuario_id,peso)
SELECT 'voto-n-'||m.usuario_id, v.id,
  (SELECT o.id FROM opciones_voto o WHERE o.votacion_id=v.id ORDER BY o.orden LIMIT 1),
  m.usuario_id, COALESCE(u.alicuota,1)
FROM votaciones v
JOIN membresias m ON m.condominio_id=v.condominio_id AND m.rol='residente'
LEFT JOIN unidades u ON u.id=m.unidad_id
WHERE v.condominio_id='demo-condo-norte'
  AND NOT EXISTS (SELECT 1 FROM votos vt WHERE vt.votacion_id=v.id AND vt.usuario_id=m.usuario_id);

-- ========== VOTACIÓN + opciones + votos para Sur ==========
INSERT OR IGNORE INTO votaciones(id,condominio_id,titulo,descripcion,cierre,estado,creada_por)
VALUES('vot-sur-1','demo-condo-sur','Color de fachada','Elegir el color para la próxima pintura del edificio.',
  strftime('%Y-%m-%d','now','+12 days'),'abierta',(SELECT usuario_id FROM membresias WHERE condominio_id='demo-condo-sur' AND rol='admin' LIMIT 1));
INSERT OR IGNORE INTO opciones_voto(id,votacion_id,texto,orden) VALUES
  ('opv-sur-1','vot-sur-1','Arena claro',0),('opv-sur-2','vot-sur-1','Gris moderno',1),('opv-sur-3','vot-sur-1','Blanco',2);
INSERT OR IGNORE INTO votos(id,votacion_id,opcion_id,usuario_id,peso)
SELECT 'voto-s-'||m.usuario_id,'vot-sur-1',
  CASE WHEN m.usuario_id LIKE '%pedro%' THEN 'opv-sur-1' ELSE 'opv-sur-2' END, m.usuario_id, COALESCE(u.alicuota,1)
FROM membresias m LEFT JOIN unidades u ON u.id=m.unidad_id
WHERE m.condominio_id='demo-condo-sur' AND m.rol='residente';

-- ========== TICKETS (Sur) ==========
INSERT OR IGNORE INTO tickets(id,condominio_id,unidad_id,usuario_id,titulo,descripcion,categoria,estado,creada)
SELECT 'tk-sur-1', 'demo-condo-sur', m.unidad_id, m.usuario_id, 'Luz del pasillo dañada','El bombillo del pasillo del piso 1 no enciende.','mantenimiento','abierto',datetime('now','-3 days')
FROM membresias m WHERE m.condominio_id='demo-condo-sur' AND m.rol='residente' LIMIT 1;
INSERT OR IGNORE INTO tickets(id,condominio_id,unidad_id,usuario_id,titulo,descripcion,categoria,estado,creada)
SELECT 'tk-sur-2', 'demo-condo-sur', m.unidad_id, m.usuario_id, 'Filtración en estacionamiento','Hay una filtración cerca del puesto 3.','mantenimiento','resuelto',datetime('now','-9 days')
FROM membresias m WHERE m.condominio_id='demo-condo-sur' AND m.rol='residente' LIMIT 1;

-- ========== ACCESOS: paquetería + rondas + bitácora (los 3, vía sus porteros) ==========
-- Paquetes (uno en custodia, uno entregado) — se cuelgan de la 1ª unidad de cada condo
INSERT OR IGNORE INTO paquetes(id,condominio_id,unidad_id,descripcion,remitente,estado,recibido_por,creada)
SELECT 'pq-'||c.id||'-1', c.id, (SELECT id FROM unidades WHERE condominio_id=c.id ORDER BY nombre LIMIT 1),
  'Caja mediana','Amazon','custodia',
  (SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1), datetime('now','-1 days')
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
WHERE EXISTS (SELECT 1 FROM membresias WHERE condominio_id=c.id AND rol='porteria');
INSERT OR IGNORE INTO paquetes(id,condominio_id,unidad_id,descripcion,remitente,estado,recibido_por,entregado_por,entregada,creada)
SELECT 'pq-'||c.id||'-2', c.id, (SELECT id FROM unidades WHERE condominio_id=c.id ORDER BY nombre LIMIT 1),
  'Sobre de documentos','MRW','entregado',
  (SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1),
  (SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1), datetime('now','-2 days'), datetime('now','-4 days')
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
WHERE EXISTS (SELECT 1 FROM membresias WHERE condominio_id=c.id AND rol='porteria');
-- Rondas
INSERT OR IGNORE INTO rondas(id,condominio_id,guardia_id,checkpoint,novedad,creada)
SELECT 'rn-'||c.id||'-'||g.k, c.id, (SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1), g.cp, g.nov, datetime('now', g.off)
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
CROSS JOIN (SELECT '1' k,'Lobby' cp, NULL nov,'-6 hours' off UNION ALL SELECT '2','Sótano','Portón revisado','-3 hours' UNION ALL SELECT '3','Azotea',NULL,'-1 hours') g
WHERE EXISTS (SELECT 1 FROM membresias WHERE condominio_id=c.id AND rol='porteria');
-- Bitácora (visitas_log): un ingreso por QR y una visita sin cita resuelta
INSERT OR IGNORE INTO visitas_log(id,condominio_id,unidad_id,visitante,tipo,estado,documento,guardia_id,creada)
SELECT 'vl-'||c.id||'-1', c.id, (SELECT id FROM unidades WHERE condominio_id=c.id ORDER BY nombre LIMIT 1),
  'Delivery – PedidosYa','delivery','ingreso',NULL,(SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1), datetime('now','-5 hours')
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
WHERE EXISTS (SELECT 1 FROM membresias WHERE condominio_id=c.id AND rol='porteria');
INSERT OR IGNORE INTO visitas_log(id,condominio_id,unidad_id,visitante,tipo,estado,documento,motivo,guardia_id,creada)
SELECT 'vl-'||c.id||'-2', c.id, (SELECT id FROM unidades WHERE condominio_id=c.id ORDER BY nombre LIMIT 1),
  'María Pérez','sincita','ingreso','V-15.234.567','Visita familiar',(SELECT usuario_id FROM membresias WHERE condominio_id=c.id AND rol='porteria' LIMIT 1), datetime('now','-1 days')
FROM (SELECT id FROM condominios WHERE id IN ('demo-condo-norte','demo-condo-sur','demo-condo-aldaba')) c
WHERE EXISTS (SELECT 1 FROM membresias WHERE condominio_id=c.id AND rol='porteria');

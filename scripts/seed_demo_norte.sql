-- REGLA INNEGOCIABLE: ningún seed puede tocar filas de condominios con es_demo=0 (clientes
-- reales). Todas las sentencias de este archivo van acotadas por ID a demo-condo-norte.
-- SIEMBRA de Ávila Norte para Comunidad (áreas, reservas, tickets, votación con votos).
-- Norte es el primer condominio de la cuenta "Demo" y el edificio donde aterriza cualquier
-- sesión nueva (localStorage limpio -> primer condominio de /api/me), así que no puede
-- quedar vacío en Comunidad. Idempotente: INSERT OR IGNORE + ids fijos. Fechas relativas
-- (no envejece).

-- ========== ÁREAS COMUNES ==========
INSERT OR IGNORE INTO areas_comunes(id,condominio_id,nombre,aforo,costo_usd,horario,activa) VALUES
  ('area-norte-gym','demo-condo-norte','Gimnasio',8,0,'5am - 10pm',1),
  ('area-norte-parrilla','demo-condo-norte','Parrillera',15,10,'10am - 10pm',1);

-- ========== RESERVAS (una pendiente, una aprobada futura, una aprobada ya pasada) ==========
INSERT OR IGNORE INTO reservas(id,condominio_id,area_id,unidad_id,usuario_id,fecha,franja,invitados,estado,motivo,resuelta_por,creada) VALUES
  ('res-norte-1','demo-condo-norte','area-norte-gym','demo-uni-n3a','demo-u-maria',
    date('now','+2 days'),'mañana',0,'aprobada','Rutina personal','demo-u-pnorte',datetime('now','-1 days')),
  ('res-norte-2','demo-condo-norte','area-norte-parrilla','demo-uni-n5b','demo-u-luis',
    date('now','+6 days'),'tarde',10,'solicitada','Cumpleaños familiar',NULL,datetime('now')),
  ('res-norte-3','demo-condo-norte','area-norte-gym','demo-uni-n2c','demo-u-ana',
    date('now','-3 days'),'noche',2,'aprobada','Entrenamiento con instructor','demo-u-pnorte',datetime('now','-5 days'));

-- ========== TICKETS (uno abierto, uno resuelto) ==========
INSERT OR IGNORE INTO tickets(id,condominio_id,unidad_id,usuario_id,titulo,descripcion,categoria,estado,creada) VALUES
  ('tk-norte-1','demo-condo-norte','demo-uni-n2c','demo-u-ana','Fuga de agua en el techo del estacionamiento',
    'Cae agua cerca del puesto 5 cuando llueve fuerte.','mantenimiento','abierto',datetime('now','-2 days')),
  ('tk-norte-2','demo-condo-norte','demo-uni-n5b','demo-u-luis','Portón peatonal no cierra bien',
    'Hay que empujarlo dos veces para que trabe.','seguridad','resuelto',datetime('now','-10 days'));
UPDATE tickets SET actualizada=datetime('now','-8 days') WHERE id='tk-norte-2';

-- ========== VOTACIÓN ABIERTA + opciones + votos (algunos residentes ya votaron) ==========
INSERT OR IGNORE INTO votaciones(id,condominio_id,titulo,descripcion,cierre,estado,creada_por) VALUES
  ('vot-norte-1','demo-condo-norte','Instalación de cámaras de seguridad adicionales',
    'Evaluar dos cámaras nuevas en la entrada de la Torre Norte y el estacionamiento.',
    strftime('%Y-%m-%d','now','+10 days'),'abierta','demo-u-pnorte');
INSERT OR IGNORE INTO opciones_voto(id,votacion_id,texto,orden) VALUES
  ('opv-norte-1','vot-norte-1','Sí, instalar de inmediato',0),
  ('opv-norte-2','vot-norte-1','Sí, pero cotizar antes',1),
  ('opv-norte-3','vot-norte-1','No es prioritario ahora',2);
INSERT OR IGNORE INTO votos(id,votacion_id,opcion_id,usuario_id,peso)
SELECT 'voto-vn-'||m.usuario_id,'vot-norte-1',
  CASE WHEN m.usuario_id = 'demo-u-maria' THEN 'opv-norte-1' ELSE 'opv-norte-2' END,
  m.usuario_id, COALESCE(u.alicuota,1)
FROM membresias m LEFT JOIN unidades u ON u.id=m.unidad_id
WHERE m.condominio_id='demo-condo-norte' AND m.rol='residente' AND m.usuario_id IN ('demo-u-maria','demo-u-luis');

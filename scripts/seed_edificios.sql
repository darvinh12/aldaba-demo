-- REGLA INNEGOCIABLE: ningún seed puede tocar filas de condominios con es_demo=0 (clientes
-- reales). Todas las sentencias de este archivo van acotadas por ID a los condominios demo.
-- Semilla demo: Junta de Condominio Residencias El Ávila con 2 edificios (condominios),
-- cada uno con su presidente (admin), portería y vecinos; y un presidente de la junta
-- general (org_admin) que ve ambos edificios. Idempotente: INSERT OR IGNORE + ids fijos.
-- Clave compartida de todos los usuarios demo: Demo1234
-- Hash PBKDF2 (100000$salt$hash): 100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM=

-- Organización = la junta de condominio de la residencia
INSERT OR IGNORE INTO organizaciones(id,nombre) VALUES
  ('demo-org-avila','Junta de Condominio Residencias El Ávila');

-- 2 edificios como condominios (tenant independiente cada uno)
-- es_demo=1 EXPLÍCITO: /api/demo/login solo acepta cuentas cuyo alcance completo
-- son condominios de demostración, y el DEFAULT de la columna es 0.
INSERT OR IGNORE INTO condominios(id,organizacion_id,nombre,direccion,tasa_bs,es_demo) VALUES
  ('demo-condo-norte','demo-org-avila','Edificio Ávila Norte','Av. Boyacá, Caracas',40.0,1),
  ('demo-condo-sur','demo-org-avila','Edificio Ávila Sur','Av. Boyacá, Caracas',40.0,1);

-- Una torre por edificio
INSERT OR IGNORE INTO torres(id,condominio_id,nombre) VALUES
  ('demo-torre-norte','demo-condo-norte','Torre Norte'),
  ('demo-torre-sur','demo-condo-sur','Torre Sur');

-- Unidades
INSERT OR IGNORE INTO unidades(id,condominio_id,torre_id,nombre,alicuota) VALUES
  ('demo-uni-n2c','demo-condo-norte','demo-torre-norte','N-2C',0.08),
  ('demo-uni-n3a','demo-condo-norte','demo-torre-norte','N-3A',0.10),
  ('demo-uni-n5b','demo-condo-norte','demo-torre-norte','N-5B',0.09),
  ('demo-uni-n6a','demo-condo-norte','demo-torre-norte','N-6A',0.10),
  ('demo-uni-s1a','demo-condo-sur','demo-torre-sur','S-1A',0.12),
  ('demo-uni-s4b','demo-condo-sur','demo-torre-sur','S-4B',0.11),
  ('demo-uni-s7c','demo-condo-sur','demo-torre-sur','S-7C',0.10);

-- Usuarios (misma clave demo: Demo1234)
INSERT OR IGNORE INTO usuarios(id,email,nombre,hash) VALUES
  ('demo-u-junta','presidente.junta@avila.demo','Rodolfo Betancourt','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-pnorte','presidente.norte@avila.demo','Carlos Malavé','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-psur','presidente.sur@avila.demo','María Fernanda Blanco','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-portn','porteria.norte@avila.demo','José Rondón','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-ports','porteria.sur@avila.demo','Luis Guerra','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-maria','maria.fernandez@avila.demo','María Fernández','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-luis','luis.perez@avila.demo','Luis Pérez','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-ana','ana.rojas@avila.demo','Ana Rojas','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-pedro','pedro.gomez@avila.demo','Pedro Gómez','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM='),
  ('demo-u-carla','carla.diaz@avila.demo','Carla Díaz','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM=');

-- Membresías / roles
--  presidente de la junta general = org_admin en AMBOS edificios (los ve con el selector)
INSERT OR IGNORE INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES
  ('demo-mem-junta-n','demo-u-junta','demo-condo-norte',NULL,'org_admin'),
  ('demo-mem-junta-s','demo-u-junta','demo-condo-sur',NULL,'org_admin'),
  ('demo-mem-pnorte','demo-u-pnorte','demo-condo-norte',NULL,'admin'),
  ('demo-mem-psur','demo-u-psur','demo-condo-sur',NULL,'admin'),
  ('demo-mem-portn','demo-u-portn','demo-condo-norte',NULL,'porteria'),
  ('demo-mem-ports','demo-u-ports','demo-condo-sur',NULL,'porteria'),
  ('demo-mem-maria','demo-u-maria','demo-condo-norte','demo-uni-n3a','residente'),
  ('demo-mem-luis','demo-u-luis','demo-condo-norte','demo-uni-n5b','residente'),
  ('demo-mem-ana','demo-u-ana','demo-condo-norte','demo-uni-n2c','residente'),
  ('demo-mem-pedro','demo-u-pedro','demo-condo-sur','demo-uni-s1a','residente'),
  ('demo-mem-carla','demo-u-carla','demo-condo-sur','demo-uni-s4b','residente');

-- Comunicados de cada edificio (autor = su presidente)
INSERT OR IGNORE INTO comunicados(id,condominio_id,titulo,cuerpo,creado_por) VALUES
  ('demo-com-n1','demo-condo-norte','Corte de agua programado','Mañana de 9:00 am a 1:00 pm por mantenimiento del tanque. Almacenen agua. — La Junta','demo-u-pnorte'),
  ('demo-com-n2','demo-condo-norte','Asamblea de propietarios','Este sábado 7:00 pm en el salón. Tema: presupuesto y fondo de reserva. Su asistencia cuenta.','demo-u-pnorte'),
  ('demo-com-s1','demo-condo-sur','Mantenimiento del ascensor','El ascensor estará fuera de servicio el martes de 8 am a 12 m. Usen las escaleras. Gracias.','demo-u-psur');

-- Algunas lecturas para que el % de lectura no sea 0
INSERT OR IGNORE INTO lecturas_comunicado(comunicado_id,usuario_id) VALUES
  ('demo-com-n1','demo-u-maria'),('demo-com-n1','demo-u-luis'),
  ('demo-com-n2','demo-u-ana');

-- ===== Finanzas demo (requiere migración 0003 aplicada) =====
-- Cuotas de julio 2026: $60 a cada unidad de ambos edificios
INSERT OR IGNORE INTO cuotas(id,condominio_id,unidad_id,periodo,concepto,monto_usd,emitida_por) VALUES
  ('demo-q-n2c','demo-condo-norte','demo-uni-n2c','2026-07','Cuota de condominio',60,'demo-u-pnorte'),
  ('demo-q-n3a','demo-condo-norte','demo-uni-n3a','2026-07','Cuota de condominio',60,'demo-u-pnorte'),
  ('demo-q-n5b','demo-condo-norte','demo-uni-n5b','2026-07','Cuota de condominio',60,'demo-u-pnorte'),
  ('demo-q-n6a','demo-condo-norte','demo-uni-n6a','2026-07','Cuota de condominio',60,'demo-u-pnorte'),
  ('demo-q-s1a','demo-condo-sur','demo-uni-s1a','2026-07','Cuota de condominio',60,'demo-u-psur'),
  ('demo-q-s4b','demo-condo-sur','demo-uni-s4b','2026-07','Cuota de condominio',60,'demo-u-psur'),
  ('demo-q-s7c','demo-condo-sur','demo-uni-s7c','2026-07','Cuota de condominio',60,'demo-u-psur');

-- Pagos: 2 aprobados (Norte), 1 pendiente por conciliar (Norte), 1 aprobado (Sur)
INSERT OR IGNORE INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,estado,reportado_por,conciliado_por,conciliada) VALUES
  ('demo-p-maria','demo-condo-norte','demo-uni-n3a',60,'pago_movil','00451','aprobado','demo-u-maria','demo-u-pnorte',datetime('now')),
  ('demo-p-luis','demo-condo-norte','demo-uni-n5b',60,'transferencia','78210','aprobado','demo-u-luis','demo-u-pnorte',datetime('now')),
  ('demo-p-pedro','demo-condo-sur','demo-uni-s1a',60,'zelle','avila-01','aprobado','demo-u-pedro','demo-u-psur',datetime('now'));
INSERT OR IGNORE INTO pagos(id,condominio_id,unidad_id,monto_usd,metodo,referencia,estado,reportado_por) VALUES
  ('demo-p-ana','demo-condo-norte','demo-uni-n2c',60,'pago_movil','00988','reportado','demo-u-ana');

-- Egresos con y sin factura
INSERT OR IGNORE INTO gastos(id,condominio_id,tipo,categoria,descripcion,proveedor,monto_usd,factura_nro,fecha,registrado_por) VALUES
  ('demo-g-n1','demo-condo-norte','gasto','vigilancia','Sueldo vigilante julio','Seguridad Total C.A.',50,NULL,'2026-07-05','demo-u-pnorte'),
  ('demo-g-n2','demo-condo-norte','compra','mantenimiento','Bomba de agua 1HP','HidroCaracas',40,'F-2026-118','2026-07-12','demo-u-pnorte'),
  ('demo-g-s1','demo-condo-sur','gasto','limpieza','Insumos de limpieza','Distribuidora El Sol',25,'A-3391','2026-07-08','demo-u-psur');

-- ===== CRM/Mensajería/Multas demo (requiere migración 0006) =====
UPDATE usuarios SET telefono='04141112233' WHERE id='demo-u-maria';
UPDATE usuarios SET telefono='04249998877' WHERE id='demo-u-luis';
UPDATE usuarios SET telefono='04165554433' WHERE id='demo-u-ana';
UPDATE usuarios SET telefono='04141230000' WHERE id='demo-u-pedro';
UPDATE usuarios SET telefono='04249876543' WHERE id='demo-u-carla';
INSERT OR IGNORE INTO multas(id,condominio_id,unidad_id,tipo,motivo,monto_usd,creada_por) VALUES
  ('demo-multa-1','demo-condo-norte','demo-uni-n2c','multa','Ruido fuera de horario permitido',15,'demo-u-pnorte'),
  ('demo-multa-2','demo-condo-norte','demo-uni-n6a','amonestacion','Mascota sin correa en áreas comunes',0,'demo-u-pnorte');

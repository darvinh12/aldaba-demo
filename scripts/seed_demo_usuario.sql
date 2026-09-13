-- Cuenta pública de la demostración: usuario "Demo" (también "demo" y "DEMO",
-- porque /api/login normaliza el identificador sin arroba contra aldaba.demo).
-- Lleva los CUATRO roles sobre el mismo edificio (Ávila Norte) para que el
-- selector del front recorra org_admin, admin, portería y residente sin
-- cambiar de cuenta, que es lo que hay que poder mostrar en la defensa.
-- Idempotente: INSERT OR IGNORE con ids fijos.

INSERT OR IGNORE INTO usuarios(id,email,nombre,hash,debe_cambiar_clave) VALUES
  ('demo-user-publico','demo@aldaba.demo','Usuario de Demostración','100000$s1F8xKhchlI3o4CliymAVg==$GEx0u33jgHWQb+RVSuWeJZiNKNHcTkz7R+ZG1F2g0xM=',0);

-- Los CUATRO roles sobre el mismo edificio. tenancy.ts respeta la cabecera X-Rol
-- cuando la membresía es directa, así que el selector del front cambia de panel
-- sin cambiar de cuenta. La de residente lleva unidad para que su estado de
-- cuenta y sus pases tengan sujeto.
INSERT OR IGNORE INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES
  ('demo-mem-publico-org','demo-user-publico','demo-condo-norte',NULL,'org_admin'),
  ('demo-mem-publico-adm','demo-user-publico','demo-condo-norte',NULL,'admin'),
  ('demo-mem-publico-por','demo-user-publico','demo-condo-norte',NULL,'porteria'),
  ('demo-mem-publico-res','demo-user-publico','demo-condo-norte','demo-uni-n3a','residente');

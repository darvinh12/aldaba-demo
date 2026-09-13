-- Cambio de clave obligatorio y correos de relleno.
--
-- CONTEXTO: un condominio puede arrancar con muchas cuentas creadas de golpe (unidades mas
-- administracion, junta y turnos de porteria) que comparten UNA clave temporal. Eso solo
-- es aceptable si la clave compartida MUERE en el primer ingreso, y para eso hace falta que
-- el servidor sepa quien todavia no la cambio. De ahi `debe_cambiar_clave`.
--
-- `correo_placeholder` marca las cuentas cuyo correo NO es un buzon real (los @sincorreo.test son
-- identificadores de acceso, no direcciones). La mensajeria masiva los SALTA en el canal
-- correo: sin esto, un administrador tocando "enviar" mandaria decenas de mensajes a un dominio
-- ajeno y quemaria la reputacion del dominio remitente en Resend. WhatsApp no se ve afectado.
--
-- Las dos columnas son NOT NULL DEFAULT 0: las cuentas que ya existian (el superadmin) no
-- cambian de comportamiento.

ALTER TABLE usuarios ADD COLUMN debe_cambiar_clave INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN correo_placeholder INTEGER NOT NULL DEFAULT 0;

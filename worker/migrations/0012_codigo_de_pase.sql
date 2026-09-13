-- Codigo corto y dictable para los pases de visita.
--
-- POR QUE: la pantalla de porteria ofrece "o ingresa el codigo manualmente", pero el unico
-- identificador que existia era el token: 32 bytes en base64url, o sea 43 caracteres con
-- mayusculas, minusculas, guion y guion bajo. Nadie dicta eso por telefono ni lo copia de
-- una pantalla. La opcion manual estaba en la interfaz y no habia forma de usarla.
--
-- El codigo NO reemplaza al token: el token sigue siendo el secreto del enlace publico
-- /pase/<token>. El codigo es un alias corto, valido solo dentro de su condominio y solo
-- para que un guardia autenticado lo teclee cuando la camara falla.
--
-- Unico por condominio (no global): dos edificios distintos pueden tener el mismo codigo
-- sin ambiguedad, porque quien lo canjea ya viene con su condominio resuelto por el tenancy.
-- El indice es parcial porque los pases anteriores a esta migracion quedan con codigo NULL
-- y en SQLite varios NULL no chocan entre si igual, pero el parcial lo deja explicito.

ALTER TABLE pases_visita ADD COLUMN codigo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pases_codigo ON pases_visita(condominio_id, codigo) WHERE codigo IS NOT NULL;

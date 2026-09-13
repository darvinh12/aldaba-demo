# Aldaba — Manual de uso

Guía práctica para usar Aldaba según tu rol. **App:** https://aldaba-demo.arondon33.workers.dev
(instalable: en el navegador, "Añadir a pantalla de inicio").

Al iniciar sesión, la app detecta tu rol y te lleva a tu panel. Si perteneces a varios condominios,
verás un **selector** arriba para cambiar entre ellos.

---

## 🔑 Ingresar
1. Abre https://aldaba-demo.arondon33.workers.dev
2. Escribe tu **correo** y tu **clave**.
3. (Residentes nuevos) Recibes un **enlace de invitación** por WhatsApp → creas tu cuenta con tu correo, teléfono y clave, y quedas asociado a tu unidad.

---

## 🏛️ Superadmin (plataforma)
La **consola de plataforma**.
- **Resumen:** totales de la plataforma (organizaciones, condominios, unidades, residentes).
- **Organizaciones:** crear una administradora/junta; renombrarla.
- **Condominios:** crear un condominio bajo una organización; **editar** dirección y tasa Bs; **suspender/reactivar**; **invitar** admin, org-admin o portería (copia el enlace); **borrar** (offboarding, pide escribir el nombre para confirmar).
- **Administrar cualquier condominio ("modo god"):** botón *Administrar* en un condominio → abres su **panel de admin completo** y editas todo (queda auditado). Vuelves con *← Consola*.

## 👔 Org-admin (junta / administradora de varios edificios)
- Ves **todos los condominios de tu organización** con el **selector** arriba.
- Dentro de cada uno tienes el **panel de admin completo** (igual que abajo).
- Un condominio nuevo que la administradora agregue a tu organización **aparece automáticamente**.

## 🏢 Admin (presidente / administrador de un condominio)
Tu panel tiene estas secciones (menú lateral en PC, pestañas en móvil):

### Dashboard
KPIs **clickeables** que te llevan a su sección: recaudación, morosidad, fondo, pagos por conciliar, unidades, comunicados. Abajo: cobranza pendiente y últimos comunicados.

### Estructura
- **Importar unidades** pegando un CSV `torre,unidad,alícuota` (re-importar actualiza alícuotas).
- **Editar** (nombre/alícuota) o **borrar** una unidad; **renombrar** o **borrar** una torre.
- **Invitar residente** por unidad (abre WhatsApp con el enlace) y **revocar** invitaciones.

### Finanzas
- **Cuotas:** emitir por período, monto igual o **por alícuota** (base × alícuota); **anular** una cuota.
- **Conciliar:** aprobar/rechazar los pagos reportados por los residentes (con motivo).
- **Egresos:** registrar **gasto o compra** con categoría, proveedor, monto y **factura**; editar/borrar.
- **Multas:** aplicar multa (suma a la morosidad) o amonestación; anular.
- El **fondo/capital** y la **morosidad** se calculan solos.

### Propietarios (CRM)
Busca una unidad → ves **saldo, contacto, historial** de pagos/multas, **residentes** (puedes **quitar** a uno), **notas internas**, editar el **teléfono**, escribir por **WhatsApp** e **imprimir el recibo** de un pago aprobado.

### Mensajería
Envío **masivo** por **WhatsApp** o **correo**, con **plantillas** (recordatorio de pago, corte de agua, asamblea, morosidad) y filtro **solo morosos**. Puedes guardar/borrar plantillas propias.

### Comunicados
Publicar avisos; ves el **% de lectura**. Puedes **editar** o **borrar** un comunicado.

### Comunidad
- **Reservas:** aprobar/rechazar solicitudes de áreas.
- **Votaciones:** crear (ponderadas por alícuota), cerrar, borrar; ves resultados en vivo.
- **Tickets:** mover estado (abierto → en curso → resuelto).
- **Áreas:** crear/editar/activar/borrar; **Directorio:** agregar/editar/borrar contactos.

### Seguridad
**Bitácora** de accesos (QR, sin cita, delivery), **exportable a CSV**.

## 👮 Portería (tablet en la caseta)
Interfaz oscura con KPIs (en cola, paquetes, alertas SOS) y pestañas:
- **Cola:** pases QR activos y visitas pendientes → *Dejar pasar*.
- **Escanear:** enciende la **cámara** y apunta al QR del visitante (o ingresa el código). Registra el ingreso.
- **Sin cita:** registra al visitante (nombre, documento, unidad, foto) → **llama al residente** por citófono.
- **Paquetes:** registra un paquete (unidad, descripción, foto) → avisa al residente → *Entregar*.
- **Rondas:** registra un checkpoint con novedad y foto.
- **SOS:** cuando un residente activa SOS, aparece un banner → *Voy en camino* / *Resuelta*.

## 🏠 Residente (vecino / propietario)
App con barra inferior:
- **Inicio:** accesos rápidos y estado general.
- **Accesos:** genera un **pase QR** (lo compartes por WhatsApp); ves tus pases (puedes **cancelar**); responde el **citófono**; ves tus **paquetes**; activa **SOS** (mantén presionado) y puedes **cancelar** una falsa alarma.
- **Pagos:** tu **estado de cuenta** (USD y Bs), **reporta un pago** (método, referencia, comprobante) y ves tu historial.
- **Reservas:** reserva un área común (fecha, franja); **cancela** tu reserva.
- **Comunidad:** cartelera (marca leído), **vota**, reporta y **cierra** tus tickets, y consulta el **directorio**.

---

## Preguntas frecuentes
- **¿Sin internet en la caseta?** Las acciones se guardan y la app reintenta; el escáner funciona local.
- **¿Puedo instalarla como app?** Sí, es una PWA: desde el navegador, "Añadir a pantalla de inicio" (iOS en Safari).
- **¿Los pagos se procesan en la app?** No: se **reportan y concilian** (Zelle/pago móvil/transferencia/efectivo). No es pasarela de pago.
- **¿Suben archivos (facturas/comprobantes)?** La función está lista; requiere habilitar el almacenamiento R2 (ver `docs/CONFIGURACION.md`).

Soporte: la administradora de tu condominio.

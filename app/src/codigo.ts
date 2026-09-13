/** Formato del código corto del pase de visita.
 *
 *  Vive suelto y no dentro de PaseQR.tsx porque lo usan tres pantallas muy distintas: el
 *  modal del residente, la cola de portería y la página pública /pase/<token>. Importarlo
 *  desde el modal arrastraría `qrcode` y el componente Sheet a la página pública, que es la
 *  que abre un visitante en su teléfono y conviene liviana. */

/** `A4K7TM` → `A4K 7TM`. Partido en dos, que es como se lee y se dicta un código.
 *  Si viniera con otro largo (un pase anterior a la migración 0012 trae null) se devuelve
 *  tal cual en vez de cortarlo mal. */
export const formatearCodigo = (c?: string | null): string =>
  c && c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : (c ?? '')

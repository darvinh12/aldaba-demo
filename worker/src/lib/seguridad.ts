import { createMiddleware } from 'hono/factory'

// Seguridad desde el diseño: cabeceras defensivas en TODA respuesta del Worker (API + páginas /pase).
// La API no renderiza HTML ni carga recursos → CSP mínima 'none'. Los assets de la SPA llevan su
// propia CSP en public/_headers. no-store evita que respuestas con datos sensibles queden cacheadas.

// CORS acotado: solo los orígenes del WebView de la app nativa (Capacitor/Ionic). La web de
// producción es same-origin y no necesita CORS; cualquier otro origen no recibe permiso alguno.
const ORIGENES_NATIVOS = new Set(['https://localhost', 'capacitor://localhost', 'ionic://localhost'])

export const seguridad = createMiddleware(async (c, next) => {
  const esApi = c.req.path.startsWith('/api/')
  const origen = c.req.header('Origin') ?? ''
  const origenPermitido = esApi && ORIGENES_NATIVOS.has(origen)

  if (origenPermitido && c.req.method === 'OPTIONS') {
    // Preflight: se responde aquí mismo, sin tocar rutas ni base de datos.
    c.res = new Response(null, { status: 204 })
  } else {
    await next()
  }

  const h = c.res.headers
  // La respuesta varía según el Origin (con o sin cabeceras CORS) → siempre Vary: Origin en /api.
  if (esApi && !(h.get('Vary') ?? '').toLowerCase().includes('origin')) h.append('Vary', 'Origin')
  if (origenPermitido) {
    h.set('Access-Control-Allow-Origin', origen)
    h.set('Access-Control-Allow-Credentials', 'true')
    if (c.req.method === 'OPTIONS') {
      h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      h.set('Access-Control-Allow-Headers', 'content-type, authorization, x-condominio, x-rol, x-cliente')
      h.set('Access-Control-Max-Age', '86400')
    }
  }

  h.set('X-Content-Type-Options', 'nosniff')
  h.set('X-Frame-Options', 'DENY')
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  // /pase/* devuelve una mini-página pública; el resto es JSON de API.
  if (esApi) {
    h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store')
  }
})

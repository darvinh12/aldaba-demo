import { Hono } from 'hono'
import { requireAuth, conCondominio, type Vars } from '../lib/tenancy'
import type { Env } from '../env.d'

const PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BYTES = 500 * 1024

export const media = new Hono<{ Bindings: Env; Variables: Vars }>()
media.use('*', requireAuth, conCondominio)

// Cualquier miembro del condominio puede subir a su propio namespace (admin: facturas; residente:
// comprobantes de pago). El objeto queda bajo `${condominio_id}/…`, aislado por tenant.
// Backend de almacenamiento: R2 si el binding MEDIA está configurado; si no, D1 (tabla `archivos`)
// como fallback gratuito sin R2. Ambos respetan el mismo límite de 500 KB y el mismo formato de key.
media.put('/', async (c) => {
  const bucket = c.env.MEDIA
  const tipo = c.req.header('content-type') ?? ''
  if (!PERMITIDOS.includes(tipo)) return c.json({ error: 'tipo de archivo no permitido' }, 415)
  const declarado = Number(c.req.header('content-length') ?? 0)
  if (declarado > MAX_BYTES) return c.json({ error: 'archivo demasiado grande (máx 500 KB)' }, 413)
  const cuerpo = await c.req.arrayBuffer()
  if (cuerpo.byteLength > MAX_BYTES) return c.json({ error: 'archivo demasiado grande (máx 500 KB)' }, 413)
  if (!cuerpo.byteLength) return c.json({ error: 'archivo vacío' }, 400)
  const nombre = (c.req.query('nombre') ?? 'archivo').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.\.+/g, '_').slice(0, 80)
  const key = `${c.get('condo')!.id}/${crypto.randomUUID()}-${nombre}`
  if (bucket) {
    await bucket.put(key, cuerpo, { httpMetadata: { contentType: tipo } })
  } else {
    await c.env.DB.prepare(`INSERT INTO archivos(key,condominio_id,mime,datos) VALUES(?,?,?,?)`)
      .bind(key, c.get('condo')!.id, tipo, cuerpo).run()
  }
  return c.json({ key })
})

media.get('/*', async (c) => {
  let key: string
  try {
    key = decodeURIComponent(c.req.path.replace(/^\/api\/media\//, ''))
  } catch {
    return c.json({ error: 'ruta inválida' }, 400)
  }
  const condoId = c.get('condo')!.id
  if (!key.startsWith(`${condoId}/`)) return c.json({ error: 'sin acceso' }, 403)
  const cabeceras = (contentType: string, etag?: string): Record<string, string> => ({
    'content-type': contentType || 'application/octet-stream',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
    ...(etag ? { etag } : {}),
  })
  // R2 primero (si está); si el objeto no existe ahí, se cae al fallback de D1 (archivos previos a R2).
  if (c.env.MEDIA) {
    const obj = await c.env.MEDIA.get(key)
    if (obj) {
      const cuerpo = await obj.arrayBuffer() // buffering acotado por MAX_BYTES; streaming rompe los tests
      return new Response(cuerpo, { headers: cabeceras(obj.httpMetadata?.contentType ?? '', obj.httpEtag) })
    }
  }
  const row = await c.env.DB.prepare(`SELECT mime, datos FROM archivos WHERE key=? AND condominio_id=?`)
    .bind(key, condoId).first<{ mime: string; datos: ArrayBuffer | number[] }>()
  if (!row) return c.json({ error: 'no existe' }, 404)
  const bytes = new Uint8Array(row.datos as ArrayBuffer) // D1 devuelve BLOB como ArrayBuffer (o number[] en algunos runtimes)
  return new Response(bytes, { headers: cabeceras(row.mime) })
})

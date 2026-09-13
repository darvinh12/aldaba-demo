import { Hono } from 'hono'
import { requireAuth, conCondominio, requireRol, type Vars } from '../lib/tenancy'
import { registrarEvento } from '../lib/eventos'
import type { Env } from '../env.d'

export const mensajeria = new Hono<{ Bindings: Env; Variables: Vars }>()
mensajeria.use('*', requireAuth, conCondominio, requireRol('admin', 'org_admin'))

// Normaliza un teléfono venezolano a formato internacional para wa.me (sin '+'): 0414… → 58414…
export function waNumero(tel: string): string {
  const n = String(tel).replace(/[^0-9]/g, '')
  if (n.startsWith('58')) return n
  if (n.startsWith('0')) return '58' + n.slice(1)
  if (n.length === 10) return '58' + n
  return n
}

// Destinatarios: residentes del condominio con contacto y saldo (para elegir a quién enviar).
async function destinatarios(db: D1Database, condoId: string, filtro?: string) {
  const { results } = await db.prepare(
    `SELECT us.id, us.nombre, us.email, us.telefono, us.correo_placeholder, u.nombre AS unidad,
       COALESCE((SELECT SUM(monto_usd) FROM cuotas q WHERE q.unidad_id=u.id),0)
       + COALESCE((SELECT SUM(monto_usd) FROM multas mu WHERE mu.unidad_id=u.id AND mu.estado='activa'),0)
       - COALESCE((SELECT SUM(monto_usd) FROM pagos p WHERE p.unidad_id=u.id AND p.estado='aprobado'),0) AS saldo
     FROM membresias m JOIN usuarios us ON us.id=m.usuario_id JOIN unidades u ON u.id=m.unidad_id
     WHERE m.condominio_id=? AND m.rol='residente'`).bind(condoId).all<any>()
  return filtro === 'morosos' ? results.filter((r: any) => r.saldo > 0.001) : results
}

mensajeria.get('/destinatarios', async (c) => {
  return c.json({ destinatarios: await destinatarios(c.env.DB, c.get('condo')!.id, c.req.query('filtro')) })
})

// Plantillas personalizadas del condominio (el front añade las prehechas del sistema).
mensajeria.get('/plantillas', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id,nombre,cuerpo FROM plantillas WHERE condominio_id=? ORDER BY creada DESC`).bind(c.get('condo')!.id).all()
  return c.json({ plantillas: results })
})
mensajeria.post('/plantillas', async (c) => {
  const b = await c.req.json<{ nombre?: string; cuerpo?: string }>().catch(() => ({} as any))
  if (!b.nombre?.trim() || !b.cuerpo?.trim()) return c.json({ error: 'nombre y cuerpo requeridos' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO plantillas(id,condominio_id,nombre,cuerpo) VALUES(?,?,?,?)`)
    .bind(id, c.get('condo')!.id, b.nombre.trim().slice(0, 80), b.cuerpo.trim().slice(0, 2000)).run()
  return c.json({ id })
})
mensajeria.patch('/plantillas/:id', async (c) => {
  const b = await c.req.json<{ nombre?: string; cuerpo?: string }>().catch(() => ({} as any))
  const sets: string[] = [], binds: unknown[] = []
  if (typeof b.nombre === 'string' && b.nombre.trim()) { sets.push('nombre=?'); binds.push(b.nombre.trim().slice(0, 80)) }
  if (typeof b.cuerpo === 'string' && b.cuerpo.trim()) { sets.push('cuerpo=?'); binds.push(b.cuerpo.trim().slice(0, 2000)) }
  if (!sets.length) return c.json({ error: 'nada que actualizar (nombre, cuerpo)' }, 400)
  binds.push(c.req.param('id'), c.get('condo')!.id)
  const r = await c.env.DB.prepare(`UPDATE plantillas SET ${sets.join(',')} WHERE id=? AND condominio_id=?`).bind(...binds).run()
  if (!r.meta.changes) return c.json({ error: 'plantilla no encontrada' }, 404)
  return c.json({ ok: true })
})
mensajeria.delete('/plantillas/:id', async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM plantillas WHERE id=? AND condominio_id=?`).bind(c.req.param('id'), c.get('condo')!.id).run()
  if (!r.meta.changes) return c.json({ error: 'plantilla no encontrada' }, 404)
  return c.json({ ok: true })
})

// Enviar campaña. WhatsApp: devuelve enlaces wa.me listos. Correo: envía por Resend si hay clave.
mensajeria.post('/enviar', async (c) => {
  const condoId = c.get('condo')!.id
  const b = await c.req.json<{ canal?: string; asunto?: string; cuerpo?: string; filtro?: string }>().catch(() => ({} as any))
  if (!b.cuerpo?.trim()) return c.json({ error: 'cuerpo del mensaje requerido' }, 400)
  const canal = b.canal === 'email' ? 'email' : 'whatsapp'
  const dest = await destinatarios(c.env.DB, condoId, b.filtro)
  const cuerpo = b.cuerpo.trim()

  let enviados = 0, links: any[] = [], pendientes = 0, sinCorreoReal = 0
  if (canal === 'whatsapp') {
    links = dest.filter((d: any) => d.telefono).map((d: any) => ({
      nombre: d.nombre, unidad: d.unidad,
      url: `https://wa.me/${waNumero(d.telefono)}?text=${encodeURIComponent(cuerpo.replaceAll('{nombre}', d.nombre).replaceAll('{unidad}', d.unidad))}`,
    }))
    pendientes = dest.length - links.length
    enviados = links.length
  } else {
    // Los correos DE RELLENO no se escriben (migración 0013). Las cuentas creadas en masa
    // llevan un identificador tipo `11a@sincorreo.test`, que NO es un buzón: es un dominio ajeno.
    // Mandarles 143 mensajes sería tirarlos a la casa de otro y quemar la reputación del
    // dominio remitente en Resend. Salen contados aparte para que el administrador vea por
    // qué se enviaron menos de los que esperaba, en vez de creer que falló el proveedor.
    const conMail = dest.filter((d: any) => d.email && !d.correo_placeholder)
    sinCorreoReal = dest.filter((d: any) => d.correo_placeholder).length
    if (c.env.RESEND_API_KEY) {
      for (const d of conMail) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: 'Aldaba Demo <no-reply@aldaba-demo.arondon33.workers.dev>', to: d.email, subject: b.asunto || 'Comunicado del condominio', text: cuerpo.replaceAll('{nombre}', d.nombre).replaceAll('{unidad}', d.unidad) }),
          })
          if (r.ok) enviados++
        } catch { /* continúa */ }
      }
      pendientes = dest.length - enviados
    } else {
      pendientes = conMail.length
    }
  }
  await c.env.DB.prepare(`INSERT INTO mensajes(id,condominio_id,canal,asunto,cuerpo,destinatarios,enviado_por) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), condoId, canal, b.asunto ?? null, cuerpo.slice(0, 2000), enviados, c.get('auth')!.usuarioId).run()
  await registrarEvento(c.env.DB, condoId, c.get('auth')!.usuarioId, 'mensajeria.enviada', { canal, enviados, filtro: b.filtro })
  return c.json({
    canal, enviados, pendientes, links,
    sinProveedor: canal === 'email' && !c.env.RESEND_API_KEY,
    sinCorreoReal, // cuántos se saltaron por tener correo de relleno (@sincorreo.test y similares)
  })
})

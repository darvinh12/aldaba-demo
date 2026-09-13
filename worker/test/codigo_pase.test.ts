/** Código corto del pase de visita (migración 0012).
 *
 *  POR QUE EXISTEN ESTAS PRUEBAS: la pantalla de portería siempre ofreció "o ingresa el
 *  código manualmente", pero el único identificador que existía era el token de 43
 *  caracteres en base64url — imposible de dictar por teléfono. La opción manual estaba en
 *  la interfaz y no se podía usar. Estas pruebas fijan que ahora sí exista un código
 *  dictable, que sirva para dejar entrar a alguien y que no abra puertas de más. */
import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, seedCondo, uuid } from './helpers'
import { crearSesion, COOKIE } from '../src/lib/session'
import { codigoLegible, normalizarCodigo } from '../src/lib/crypto'
import { app } from '../src/index'

beforeAll(aplicarSchema)

async function persona(condoId: string, rol: 'admin' | 'porteria' | 'residente', unidadId?: string) {
  const uid = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash) VALUES(?,?,?,?)`).bind(uid, `${uid}@t.com`, rol, 'h').run()
  await env.DB.prepare(`INSERT INTO membresias(id,usuario_id,condominio_id,unidad_id,rol) VALUES(?,?,?,?,?)`)
    .bind(uuid(), uid, condoId, unidadId ?? null, rol).run()
  const { valor } = await crearSesion(env.DB, uid, env.SESSION_SECRET, 30)
  return { uid, headers: { cookie: `${COOKIE}=${valor}`, 'X-Condominio': condoId } }
}
async function condo() {
  const { condoId } = await seedCondo()
  const u = uuid()
  await env.DB.prepare(`INSERT INTO unidades(id,condominio_id,nombre) VALUES(?,?,'PB')`).bind(u, condoId).run()
  return { condoId, unidad: u }
}
const post = (path: string, headers: any, body?: any) =>
  app.request(path, { method: 'POST', headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env)
const get = (path: string, headers: any) => app.request(path, { headers }, env)

describe('código del pase — generación', () => {
  it('es corto, en mayúsculas y sin los símbolos que se confunden al dictarlos', () => {
    for (let i = 0; i < 200; i++) {
      const c = codigoLegible()
      expect(c).toHaveLength(6)
      // Ni I/1/L (palito), ni O/0 (círculo), ni S/5, Z/2, B/8 (se oyen igual por teléfono).
      expect(c).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{6}$/)
    }
  })

  it('reparte parejo: sin sesgo de módulo ningún símbolo se lleva el doble que otro', () => {
    const cuenta = new Map<string, number>()
    for (let i = 0; i < 4000; i++) for (const ch of codigoLegible()) cuenta.set(ch, (cuenta.get(ch) ?? 0) + 1)
    const valores = [...cuenta.values()]
    expect(cuenta.size).toBe(25)
    // 24.000 símbolos entre 25 = 960 esperados. Con muestreo por módulo los primeros del
    // alfabeto saldrían ~1,2× más que los últimos; el rechazo mantiene todo cerca de 1.
    expect(Math.max(...valores) / Math.min(...valores)).toBeLessThan(1.35)
  })

  it('normaliza lo que teclea el guardia: minúsculas, guiones y espacios', () => {
    expect(normalizarCodigo('a4k-7tm')).toBe('A4K7TM')
    expect(normalizarCodigo('  A4K 7TM \n')).toBe('A4K7TM')
    expect(normalizarCodigo('')).toBe('')
    expect(normalizarCodigo('---')).toBe('')
  })
})

describe('código del pase — de punta a punta', () => {
  it('el residente recibe un código al crear el pase y lo ve en su lista', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const cr = await (await post('/api/accesos/pases', res.headers, { visitante: 'Ana Díaz', horas: 5 })).json<any>()
    expect(cr.codigo).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{6}$/)
    const lista = await (await get('/api/accesos/pases', res.headers)).json<any>()
    expect(lista.pases.find((p: any) => p.token === cr.token).codigo).toBe(cr.codigo)
  })

  it('el visitante ve el código en la página pública del pase', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const cr = await (await post('/api/accesos/pases', res.headers, { visitante: 'Luis Mora' })).json<any>()
    const pub = await (await app.request(`/api/accesos/pase-info/${cr.token}`, {}, env)).json<any>()
    expect(pub.codigo).toBe(cr.codigo)
  })

  it('portería deja entrar tecleando el código, y lo acepta en minúsculas y con guion', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const cr = await (await post('/api/accesos/pases', res.headers, { visitante: 'Rosa Peña', tipo: 'recurrente' })).json<any>()
    const cod: string = cr.codigo
    // Tal cual sale en pantalla.
    expect((await post(`/api/accesos/pases/${cod}/registrar`, port.headers)).status).toBe(200)
    // Como lo teclearía alguien apurado: minúsculas y con el guion del formato ABC-123.
    const tecleado = `${cod.slice(0, 3).toLowerCase()}-${cod.slice(3).toLowerCase()}`
    const r = await post(`/api/accesos/pases/${tecleado}/registrar`, port.headers)
    expect(r.status).toBe(200)
    expect((await r.json<any>()).visitante).toBe('Rosa Peña')
  })

  it('el token largo del QR sigue funcionando (no se rompió el escáner)', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const cr = await (await post('/api/accesos/pases', res.headers, { visitante: 'Carlos Ruiz' })).json<any>()
    expect((await post(`/api/accesos/pases/${cr.token}/registrar`, port.headers)).status).toBe(200)
  })

  it('el código de un edificio NO abre la puerta de otro', async () => {
    const a = await condo(); const b = await condo()
    const resA = await persona(a.condoId, 'residente', a.unidad)
    const portB = await persona(b.condoId, 'porteria')
    const cr = await (await post('/api/accesos/pases', resA.headers, { visitante: 'Intruso' })).json<any>()
    expect((await post(`/api/accesos/pases/${cr.codigo}/registrar`, portB.headers)).status).toBe(404)
  })

  it('un pase viejo sin código (anterior a la 0012) no se canjea con el código vacío', async () => {
    const { condoId, unidad } = await condo()
    const port = await persona(condoId, 'porteria')
    const res = await persona(condoId, 'residente', unidad)
    const viejo = 'tok-viejo-sin-codigo'
    await env.DB.prepare(
      `INSERT INTO pases_visita(token,condominio_id,unidad_id,creado_por,visitante,tipo,ventana,expira)
       VALUES(?,?,?,?,'Fantasma','recurrente','',datetime('now','+5 hours'))`,
    ).bind(viejo, condoId, unidad, res.uid).run()
    // '---' normaliza a cadena vacía: no puede hacer de comodín contra los codigo NULL.
    expect((await post(`/api/accesos/pases/---/registrar`, port.headers)).status).toBe(404)
    // pero su token sigue sirviendo
    expect((await post(`/api/accesos/pases/${viejo}/registrar`, port.headers)).status).toBe(200)
  })

  it('portería ve el código en la cola, para cotejarlo con el que le dictan', async () => {
    const { condoId, unidad } = await condo()
    const res = await persona(condoId, 'residente', unidad)
    const port = await persona(condoId, 'porteria')
    const cr = await (await post('/api/accesos/pases', res.headers, { visitante: 'Marta Sosa' })).json<any>()
    const cola = await (await get('/api/accesos/cola', port.headers)).json<any>()
    expect(cola.pases.find((p: any) => p.token === cr.token).codigo).toBe(cr.codigo)
  })
})

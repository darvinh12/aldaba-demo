import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { aplicarSchema, uuid } from './helpers'
import { hashPassword } from '../src/lib/crypto'
import { DIAS_SESION, DIAS_SESION_SUPERADMIN_SIN_ANCLA, DIAS_TOLERANCIA_RENOVACION } from '../src/lib/session'
import { app } from '../src/index'

// SESIÓN PERPETUA: `expira` es el límite de INACTIVIDAD, no la vida de la sesión.
// Quien usa Aldaba al menos una vez al año no vuelve a escribir su clave; quien la
// abandona más de 365+30 días pierde la sesión y su fila desaparece con la purga.
beforeAll(aplicarSchema)

const CLAVE = 'Clave12345!'
const SEGUNDOS_COOKIE = (DIAS_SESION + DIAS_TOLERANCIA_RENOVACION) * 86400

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }, env)

async function crearUsuario(email: string, esSuperadmin = 0) {
  const id = uuid()
  await env.DB.prepare(`INSERT INTO usuarios(id,email,nombre,hash,es_superadmin) VALUES(?,?,?,?,?)`)
    .bind(id, email, 'Test', await hashPassword(CLAVE), esSuperadmin).run()
  return id
}

const correo = (p: string) => `${p}-${uuid()}@t.com`

async function loginApp(email: string) {
  const res = await post('/api/login', { email, password: CLAVE }, { 'X-Cliente': 'app' })
  expect(res.status).toBe(200)
  return (await res.json<{ token: string }>()).token
}

async function loginWeb(email: string) {
  const res = await post('/api/login', { email, password: CLAVE })
  expect(res.status).toBe(200)
  return { cookie: res.headers.get('set-cookie')!.split(';')[0], setCookie: res.headers.get('set-cookie')! }
}

const conBearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra })
const idDeToken = (token: string) => token.split('.')[0]
const me = (headers: Record<string, string>) => app.request('/api/me', { headers }, env)
const renovar = (headers: Record<string, string>) => app.request('/api/sesion/renovar', { method: 'POST', headers }, env)

/** Días que le quedan a la sesión antes de morir por inactividad. */
const diasRestantes = (id: string) =>
  env.DB.prepare(`SELECT CAST(julianday(expira)-julianday('now') AS REAL) d FROM sesiones WHERE id=?`)
    .bind(id).first<{ d: number }>().then((f) => f?.d ?? null)

/** Envejece una sesión: la deja como si su último uso hubiera sido hace `dias`. */
const envejecer = (id: string, dias: number, vida = DIAS_SESION) =>
  env.DB.prepare(
    `UPDATE sesiones SET creada=datetime('now','-' || ? || ' days'),
       expira=datetime('now','-' || ? || ' days', '+' || ? || ' days'), ultimo_uso=datetime('now','-' || ? || ' days')
     WHERE id=?`,
  ).bind(String(dias), String(dias), String(vida), String(dias), id).run()

/** Deja la sesión con las fechas exactas que pide la prueba (en días desde ahora, con signo). */
const fechas = (id: string, creadaHace: number, expiraEn: number, usoHace: number) =>
  env.DB.prepare(
    `UPDATE sesiones SET creada=datetime('now','-' || ?1 || ' days'),
       expira=datetime('now','+' || ?2 || ' days'), ultimo_uso=datetime('now','-' || ?3 || ' days') WHERE id=?4`,
  ).bind(String(creadaHace), String(expiraEn), String(usoHace), id).run()

/** Registra un dispositivo y ancla a él la sesión que hace la petición. */
async function anclarDispositivo(headers: Record<string, string>, plataforma = 'android') {
  const res = await app.request('/api/dispositivos', {
    method: 'POST', body: JSON.stringify({ plataforma, modelo: 'Pixel 6' }),
    headers: { 'content-type': 'application/json', ...headers },
  }, env)
  expect(res.status).toBe(200)
  return (await res.json<{ id: string }>()).id
}

describe('sesión perpetua: vida y techo de inactividad', () => {
  it('una sesión nueva no vence: 365 días de inactividad y cookie de 395', async () => {
    const email = correo('perp1')
    await crearUsuario(email)
    const { setCookie } = await loginWeb(email)
    expect(setCookie).toContain(`Max-Age=${SEGUNDOS_COOKIE}`)
    expect(SEGUNDOS_COOKIE).toBeLessThan(400 * 86400) // tope de 400 días de Chrome/Edge
    const f = await env.DB.prepare(
      `SELECT CAST(julianday(expira)-julianday('now') AS REAL) d FROM sesiones
       WHERE usuario_id=(SELECT id FROM usuarios WHERE email=?)`,
    ).bind(email).first<{ d: number }>()
    expect(f!.d).toBeGreaterThan(DIAS_SESION - 0.5)
    expect(f!.d).toBeLessThan(DIAS_SESION + 0.5)
  })

  it('usada de tanto en tanto no muere nunca: a los 300 días la deslizante la lleva de vuelta a 365', async () => {
    const email = correo('perp2')
    await crearUsuario(email)
    const token = await loginApp(email)
    await envejecer(idDeToken(token), 300)
    expect((await me(conBearer(token))).status).toBe(200)
    expect(await diasRestantes(idDeToken(token))).toBeGreaterThan(DIAS_SESION - 1)
  })

  it('abandonada más allá del techo (365+30): 401 sesion_invalida, no canjea y la purga la borra', async () => {
    const email = correo('perp3')
    await crearUsuario(email)
    const token = await loginApp(email)
    await envejecer(idDeToken(token), 396)
    const res = await me(conBearer(token))
    expect(res.status).toBe(401)
    expect((await res.json<any>()).codigo).toBe('sesion_invalida')
    const ren = await renovar(conBearer(token, { 'X-Cliente': 'app' }))
    expect(ren.status).toBe(401)
    expect((await ren.json<any>()).codigo).toBe('sesion_invalida')
    // cualquier login dispara la purga oportunista y la fila muerta desaparece
    const otro = correo('perp3-otro')
    await crearUsuario(otro)
    await loginApp(otro)
    expect(await env.DB.prepare(`SELECT 1 FROM sesiones WHERE id=?`).bind(idDeToken(token)).first()).toBeNull()
  })

  it('la purga no toca sesiones vivas ni las que aún son canjeables', async () => {
    const email = correo('perp4')
    await crearUsuario(email)
    const viva = idDeToken(await loginApp(email))
    const recienVencida = idDeToken(await loginApp(email))
    const muerta = idDeToken(await loginApp(email))
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-29 days') WHERE id=?`).bind(recienVencida).run()
    await env.DB.prepare(`UPDATE sesiones SET expira=datetime('now','-31 days') WHERE id=?`).bind(muerta).run()
    const otro = correo('perp4-otro')
    await crearUsuario(otro)
    await loginApp(otro) // purga oportunista
    expect(await env.DB.prepare(`SELECT 1 FROM sesiones WHERE id=?`).bind(viva).first()).not.toBeNull()
    expect(await env.DB.prepare(`SELECT 1 FROM sesiones WHERE id=?`).bind(recienVencida).first()).not.toBeNull()
    expect(await env.DB.prepare(`SELECT 1 FROM sesiones WHERE id=?`).bind(muerta).first()).toBeNull()
  })
})

describe('sesión perpetua: la web sigue igual (cookie __Host-)', () => {
  it('la cookie autentica, renueva con vida fresca de 395 días y el logout la mata', async () => {
    const email = correo('web1')
    await crearUsuario(email)
    const { cookie } = await loginWeb(email)
    expect((await me({ cookie })).status).toBe(200)
    const ren = await renovar({ cookie })
    expect(ren.status).toBe(200)
    const cuerpo = await ren.json<any>()
    expect(cuerpo.token).toBeUndefined() // el token nunca viaja a la web
    const nueva = ren.headers.get('set-cookie')!
    expect(nueva).toContain(`Max-Age=${SEGUNDOS_COOKIE}`)
    expect(nueva).toContain('HttpOnly')
    const cookieNueva = nueva.split(';')[0]
    expect((await me({ cookie: cookieNueva })).status).toBe(200)
    expect((await me({ cookie })).status).toBe(401) // la vieja murió al canjearse
    const out = await app.request('/api/logout', { method: 'POST', headers: { cookie: cookieNueva } }, env)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await me({ cookie: cookieNueva })).status).toBe(401)
  })
})

describe('sesión perpetua: revocación y cierre remoto', () => {
  it('revocar el dispositivo mata la sesión en la SIGUIENTE petición, sin pasar por renovar', async () => {
    const email = correo('rev1')
    await crearUsuario(email)
    const token = await loginApp(email)
    const disp = await anclarDispositivo(conBearer(token))
    // revocación directa en BD: no borra las sesiones, así que el corte tiene que venir de leerSesion
    await env.DB.prepare(`UPDATE dispositivos SET revocado=1 WHERE id=?`).bind(disp).run()
    const res = await me(conBearer(token))
    expect(res.status).toBe(401)
    expect((await res.json<any>()).codigo).toBe('sesion_invalida')
  })

  it('la purga borra las sesiones de dispositivos revocados', async () => {
    const email = correo('rev2')
    await crearUsuario(email)
    const token = await loginApp(email)
    const disp = await anclarDispositivo(conBearer(token))
    await env.DB.prepare(`UPDATE dispositivos SET revocado=1 WHERE id=?`).bind(disp).run()
    const otro = correo('rev2-otro')
    await crearUsuario(otro)
    await loginApp(otro)
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM sesiones WHERE dispositivo_id=?`).bind(disp).first<{ n: number }>()
    expect(n!.n).toBe(0)
  })

  it('cerrar-otras deja viva solo la sesión actual, la audita y las cerradas no canjean', async () => {
    const email = correo('cerrar1')
    await crearUsuario(email)
    const viejo1 = await loginApp(email)
    const viejo2 = await loginApp(email)
    const actual = await loginApp(email)
    const res = await app.request('/api/sesion/cerrar-otras', { method: 'POST', headers: conBearer(actual) }, env)
    expect(res.status).toBe(200)
    expect((await res.json<any>()).cerradas).toBe(2)
    expect((await me(conBearer(actual))).status).toBe(200)
    for (const t of [viejo1, viejo2]) {
      const r = await me(conBearer(t))
      expect(r.status).toBe(401)
      expect((await r.json<any>()).codigo).toBe('sesion_invalida')
      expect((await renovar(conBearer(t, { 'X-Cliente': 'app' }))).status).toBe(401)
    }
    const ev = await env.DB.prepare(
      `SELECT COUNT(*) n FROM eventos WHERE tipo='auth.cierre_remoto' AND actor_id=(SELECT id FROM usuarios WHERE email=?)`,
    ).bind(email).first<{ n: number }>()
    expect(ev!.n).toBe(1)
  })

  it('cerrar-otras no toca las sesiones de otros usuarios y funciona por cookie', async () => {
    const yo = correo('cerrar2'), ajeno = correo('cerrar2-ajeno')
    await crearUsuario(yo)
    await crearUsuario(ajeno)
    const tokenAjeno = await loginApp(ajeno)
    await loginApp(yo)
    const { cookie } = await loginWeb(yo)
    const res = await app.request('/api/sesion/cerrar-otras', { method: 'POST', headers: { cookie } }, env)
    expect(res.status).toBe(200)
    expect((await res.json<any>()).cerradas).toBe(1)
    expect((await me({ cookie })).status).toBe(200)
    expect((await me(conBearer(tokenAjeno))).status).toBe(200)
  })

  it('cerrar-otras exige sesión', async () => {
    expect((await app.request('/api/sesion/cerrar-otras', { method: 'POST' }, env)).status).toBe(401)
  })
})

describe('sesión perpetua: excepción de superadmin', () => {
  it('sin dispositivo anclado su sesión es corta y NO se renueva (vuelve a pedir clave)', async () => {
    const email = correo('sa1')
    await crearUsuario(email, 1)
    const res = await post('/api/login', { email, password: CLAVE })
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${(DIAS_SESION_SUPERADMIN_SIN_ANCLA + DIAS_TOLERANCIA_RENOVACION) * 86400}`)
    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    const ren = await renovar({ cookie })
    expect(ren.status).toBe(401)
    expect((await ren.json<any>()).codigo).toBe('sesion_invalida')
    // la negativa queda auditada
    const ev = await env.DB.prepare(
      `SELECT COUNT(*) n FROM eventos WHERE tipo='auth.renovacion_negada' AND actor_id=(SELECT id FROM usuarios WHERE email=?)`,
    ).bind(email).first<{ n: number }>()
    expect(ev!.n).toBe(1)
  })

  it('con dispositivo anclado renueva, conserva el ancla y pasa a los 365 días', async () => {
    const email = correo('sa2')
    await crearUsuario(email, 1)
    const token = await loginApp(email)
    const disp = await anclarDispositivo(conBearer(token))
    const ren = await renovar(conBearer(token, { 'X-Cliente': 'app' }))
    expect(ren.status).toBe(200)
    const { token: nuevo } = await ren.json<{ token: string }>()
    const fila = await env.DB.prepare(
      `SELECT dispositivo_id, CAST(julianday(expira)-julianday('now') AS REAL) d FROM sesiones WHERE id=?`,
    ).bind(idDeToken(nuevo)).first<{ dispositivo_id: string; d: number }>()
    expect(fila!.dispositivo_id).toBe(disp) // el ancla sobrevive al canje: sigue siendo revocable
    expect(fila!.d).toBeGreaterThan(DIAS_SESION - 0.5)
  })

  it('una cuenta normal renueva sin ancla y también recibe 365 días', async () => {
    const email = correo('normal-renueva')
    await crearUsuario(email)
    const token = await loginApp(email)
    const ren = await renovar(conBearer(token, { 'X-Cliente': 'app' }))
    expect(ren.status).toBe(200)
    const { token: nuevo } = await ren.json<{ token: string }>()
    expect(await diasRestantes(idDeToken(nuevo))).toBeGreaterThan(DIAS_SESION - 0.5)
  })
})

// ── La CLASE de la sesión (cuánto vale) es un dato estable de la fila, no (expira - creada) ──
// Estas cuatro pruebas cubren los agujeros que abría derivar la duración de las fechas:
// el superadmin sin ancla se volvía perpetuo con solo usar su sesión, el techo crecía en
// cada extensión, un token robado se auto-ancla y compraba renovación, y la web nunca
// recibía cookie nueva.
describe('sesión perpetua: la clase de la sesión no cambia con el uso', () => {
  it('el superadmin SIN ancla no se vuelve perpetuo por usarla: la deslizante no pasa su vencimiento', async () => {
    const email = correo('clase-sa')
    await crearUsuario(email, 1)
    const token = await loginApp(email)
    // su sesión es de DIAS_SESION_SUPERADMIN_SIN_ANCLA días y le queda uno: usarla no puede resucitarla
    await fechas(idDeToken(token), DIAS_SESION_SUPERADMIN_SIN_ANCLA - 1, 1, 0.5)
    expect((await me(conBearer(token))).status).toBe(200)
    const d = (await diasRestantes(idDeToken(token)))!
    expect(d).toBeLessThan(1.2)
  })

  it('el techo de inactividad no crece: por muchas extensiones que haya, nunca pasa de DIAS_SESION', async () => {
    const email = correo('clase-techo')
    await crearUsuario(email)
    const token = await loginApp(email)
    // sesión vieja (nació hace 400 días) a la que le quedan 100: se extiende, pero a 365, no a 500
    await fechas(idDeToken(token), 400, 100, 0.5)
    expect((await me(conBearer(token))).status).toBe(200)
    const d = (await diasRestantes(idDeToken(token)))!
    expect(d).toBeGreaterThan(DIAS_SESION - 0.5)
    expect(d).toBeLessThan(DIAS_SESION + 0.5)
  })

  it('anclar un dispositivo a una sesión YA VIVA no la alarga ni la vuelve renovable', async () => {
    const email = correo('clase-robo')
    await crearUsuario(email, 1)
    const token = await loginApp(email) // el ladrón se queda con este token
    // el robo ocurre después del login: el ancla ya no llega en el mismo acto de escribir la clave
    await fechas(idDeToken(token), 2, DIAS_SESION_SUPERADMIN_SIN_ANCLA - 2, 0.5)
    const antes = (await diasRestantes(idDeToken(token)))!
    const disp = await anclarDispositivo(conBearer(token))
    // el dispositivo se registra y la sesión queda atada a él (visible y revocable por el dueño)
    const fila = await env.DB.prepare(`SELECT dispositivo_id FROM sesiones WHERE id=?`)
      .bind(idDeToken(token)).first<{ dispositivo_id: string }>()
    expect(fila!.dispositivo_id).toBe(disp)
    // pero no compró ni un día: ni de vencimiento ni de renovación
    expect((await diasRestantes(idDeToken(token)))!).toBeLessThan(antes + 0.01)
    const ren = await renovar(conBearer(token, { 'X-Cliente': 'app' }))
    expect(ren.status).toBe(401)
    expect((await ren.json<any>()).codigo).toBe('sesion_invalida')
  })

  it('el ancla del login SÍ eleva al superadmin a la clase perpetua (flujo real de la app)', async () => {
    const email = correo('clase-app')
    await crearUsuario(email, 1)
    const token = await loginApp(email)
    await anclarDispositivo(conBearer(token)) // la app registra el teléfono al instante
    const d = (await diasRestantes(idDeToken(token)))!
    expect(d).toBeGreaterThan(DIAS_SESION - 0.5)
  })
})

describe('sesión perpetua: la web renueva su cookie al extenderse la sesión', () => {
  it('una petición que extiende la sesión reemite la cookie con vida fresca', async () => {
    const email = correo('cookie-refresco')
    await crearUsuario(email)
    const { cookie } = await loginWeb(email)
    const id = cookie.split('=')[1].split('.')[0]
    await fechas(id, 300, 65, 300) // le queda menos de la mitad: la próxima petición la extiende
    const res = await me({ cookie })
    expect(res.status).toBe(200)
    const nueva = res.headers.get('set-cookie')
    expect(nueva).toContain(`Max-Age=${SEGUNDOS_COOKIE}`)
    expect(nueva).toContain('HttpOnly')
    expect(nueva!.split(';')[0]).toBe(cookie) // misma sesión, no un canje
    expect((await me({ cookie: nueva!.split(';')[0] })).status).toBe(200)
  })

  it('la app (Bearer) no recibe Set-Cookie: su token no viaja en cabeceras de cookie', async () => {
    const email = correo('cookie-app')
    await crearUsuario(email)
    const token = await loginApp(email)
    await fechas(idDeToken(token), 300, 65, 300)
    const res = await me(conBearer(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('sesión perpetua: el ancla de una sesión no se re-apunta', () => {
  it('una sesión ya anclada no cambia de dispositivo: revocar el del dueño la sigue matando', async () => {
    const email = correo('ancla-fija')
    await crearUsuario(email)
    const token = await loginApp(email)
    const propio = await anclarDispositivo(conBearer(token)) // el teléfono del dueño
    // el ladrón, con el token robado, registra SU aparato desde la misma sesión
    const ajeno = await anclarDispositivo(conBearer(token), 'ios')
    expect(ajeno).not.toBe(propio)
    const fila = await env.DB.prepare(`SELECT dispositivo_id FROM sesiones WHERE id=?`)
      .bind(idDeToken(token)).first<{ dispositivo_id: string }>()
    expect(fila!.dispositivo_id).toBe(propio) // el ancla no se movió
    // y por eso revocar el teléfono del dueño sigue cortando esa sesión
    await env.DB.prepare(`UPDATE dispositivos SET revocado=1 WHERE id=?`).bind(propio).run()
    expect((await me(conBearer(token))).status).toBe(401)
  })
})

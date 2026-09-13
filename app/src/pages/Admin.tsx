import { useEffect, useState } from 'react'
import { apiVivo, fechaUtc, usd, type Me } from '../api'
import { Shell, type NavItem } from '../shell'
import { Empty } from '../ui'
import { Icon } from '../components/icons'
import { Tilt, CornerMarks } from '../components/effects'
import { AreaLine, Donut, Gauge, BarsH, StatTile, COLORS } from '../components/charts'
import { Comunicados } from '../components/Comunicados'
import { Estructura } from '../components/Estructura'
import { Finanzas } from '../components/Finanzas'
import { Bitacora } from '../components/Bitacora'
import { ComunidadAdmin } from '../components/ComunidadAdmin'
import { Propietarios } from '../components/Propietarios'
import { Mensajeria } from '../components/Mensajeria'

const NAV: NavItem[] = [
  { key: 'inicio', label: 'Dashboard', ico: '📊' },
  { key: 'comunicados', label: 'Comunicados', ico: '📢' },
  { key: 'estructura', label: 'Estructura', ico: '🏢' },
  { key: 'finanzas', label: 'Finanzas', ico: '💰' },
  { key: 'propietarios', label: 'Propietarios', ico: '👥' },
  { key: 'mensajeria', label: 'Mensajería', ico: '📨' },
  { key: 'seguridad', label: 'Seguridad', ico: '🛡️' },
  { key: 'reservas', label: 'Comunidad', ico: '📅' },
]

export function Admin({ me, condo, selector, onSalir }: { me: Me; condo: any; selector: React.ReactNode; onSalir: () => void }) {
  const [activo, setActivo] = useState('inicio')
  return (
    <Shell brand="Aldaba Admin" subtitle={condo.nombre} selector={selector} onSalir={onSalir} esDemo={condo.es_demo === 1}
      meta={<span className="xs">{me.nombre}</span>} nav={NAV} activo={activo} setActivo={setActivo} side>
      {activo === 'inicio' && <Dashboard nombre={me.nombre} condo={condo.nombre} irA={setActivo} />}
      {activo === 'comunicados' && <Comunicados esAdmin />}
      {activo === 'estructura' && <Estructura />}
      {activo === 'finanzas' && <Finanzas />}
      {activo === 'propietarios' && <Propietarios />}
      {activo === 'mensajeria' && <Mensajeria />}
      {activo === 'seguridad' && <Bitacora />}
      {activo === 'reservas' && <ComunidadAdmin />}
    </Shell>
  )
}

// Delta mensual (último vs mes previo). El GLIFO indica dirección del cambio (▲ subió / ▼ bajó);
// el COLOR indica si es bueno o malo (moreIsBetter invierte). Así "egresos -25%" es ▼ verde.
function trend(arr: number[], moreIsBetter = true): { txt: string; tone: 'up' | 'down' | 'flat'; dir: 'up' | 'down' | 'flat' } | undefined {
  if (!arr || arr.length < 2) return undefined
  const last = arr[arr.length - 1], prev = arr[arr.length - 2]
  if (prev === 0 && last === 0) return undefined
  const raw = prev === 0 ? 100 : Math.round(((last - prev) / Math.abs(prev)) * 100)
  const rising = raw > 1, falling = raw < -1
  const dir = rising ? 'up' : falling ? 'down' : 'flat'
  const tone = (rising && moreIsBetter) || (falling && !moreIsBetter) ? 'up'
    : (rising && !moreIsBetter) || (falling && moreIsBetter) ? 'down' : 'flat'
  return { txt: `${raw > 0 ? '+' : ''}${raw}% vs. mes previo`, tone, dir }
}

function Dashboard({ nombre, condo, irA }: { nombre: string; condo: string; irA: (k: string) => void }) {
  const [est, setEst] = useState<any>(null)
  const [coms, setComs] = useState<any[]>([])
  const [invs, setInvs] = useState<any[]>([])
  const [fin, setFin] = useState<any>(null)
  const [serie, setSerie] = useState<any[]>([])
  useEffect(() => {
    apiVivo('/estructura', setEst).catch(() => {})
    apiVivo('/comunicados', (d: any) => setComs(d.comunicados)).catch(() => {})
    apiVivo('/invitaciones', (d: any) => setInvs(d.invitaciones)).catch(() => {})
    apiVivo('/finanzas/resumen', setFin).catch(() => {})
    apiVivo('/finanzas/series', (d: any) => setSerie(d.series ?? [])).catch(() => {})
  }, [])
  const unidades = est ? est.torres.reduce((a: number, t: any) => a + t.unidades.length, 0) + (est.sinTorre?.length ?? 0) : 0
  const activas = invs.filter((i) => !i.usada).length
  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'
  const sCob = serie.map((s) => s.cobrado), sFact = serie.map((s) => s.facturado), sEgr = serie.map((s) => s.egresos)

  return (
    <>
      {/* Cabecera del reporte — firma de lujo (Tilt + gauge de recaudación) */}
      <Tilt className="card hero corner-marks" max={3} style={{ marginBottom: 14 }}>
        <CornerMarks />
        <div className="row between" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ color: 'rgba(255,255,255,.72)' }}>{condo} · Tesorería</div>
            <h3 style={{ marginTop: 12, fontSize: '1.5rem' }}>{saludo}, {nombre.split(' ')[0]}.</h3>
            <div className="hero-metrics" style={{ maxWidth: 460 }}>
              <div className="m"><div className="k">Cobrado</div><div className="v">{fin ? usd(fin.cobrado) : '—'}</div></div>
              <div className="m"><div className="k">Fondo / capital</div><div className="v">{fin ? usd(fin.capital) : '—'}</div></div>
              <div className="m"><div className="k">Morosidad</div><div className="v">{fin ? usd(fin.morosidad) : '—'}</div></div>
            </div>
          </div>
          <div style={{ flexShrink: 0, margin: '0 auto' }}>
            {fin ? <Gauge value={fin.recaudacion} sub="Recaudación acumulada" id="hero" /> : <div className="spin" style={{ margin: 20 }} />}
          </div>
        </div>
      </Tilt>

      {/* Slicer / contexto del reporte */}
      <div className="slicer">
        <span className="badge-soft"><span className="dot-live" style={{ marginRight: 7 }} />En vivo</span>
        <span className="pill" onClick={() => irA('finanzas')}>Tasa Bs {fin?.tasa_bs || 0}</span>
        {fin?.multas > 0 && <span className="pill" onClick={() => irA('finanzas')}>Multas {usd(fin.multas)}</span>}
        <span className="mono-label" style={{ marginLeft: 'auto', fontSize: '.64rem' }}>{serie.length} {serie.length === 1 ? 'mes' : 'meses'} de historia</span>
      </div>

      {/* Canvas BI */}
      <div className="bi">
        <StatTile className="c3" label="Facturado" value={fin ? usd(fin.facturado) : '—'} ico={<Icon name="receipt" size={13} className="ico" />}
          spark={sFact} delta={trend(sFact, true)} onClick={() => irA('finanzas')} />
        <StatTile className="c3" label="Cobrado" value={fin ? usd(fin.cobrado) : '—'} ico={<Icon name="coins" size={13} className="ico" />}
          spark={sCob} delta={trend(sCob, true)} onClick={() => irA('finanzas')} />
        <StatTile className="c3" label="Egresos" value={fin ? usd(fin.egresos) : '—'} ico={<Icon name="expense" size={13} className="ico" />}
          spark={sEgr} delta={trend(sEgr, false)} onClick={() => irA('finanzas')} />
        <StatTile className="c3" label="Por conciliar" value={fin ? fin.porConciliar.n : '—'} ico={<Icon name="check" size={13} className="ico" />}
          delta={fin && fin.porConciliar.n ? { txt: `${usd(fin.porConciliar.monto)} en cola`, tone: 'flat' } : undefined} onClick={() => irA('finanzas')} />

        <div className="panel c8">
          <div className="panel-h"><Icon name="dashboard" size={15} style={{ opacity: .5 }} /><span className="t">Facturación vs. cobranza</span>
            <span className="s spacer">últimos {serie.length || 0} {serie.length === 1 ? 'mes' : 'meses'} · USD</span></div>
          <AreaLine series={serie} lines={[
            { key: 'facturado', color: COLORS[0], label: 'Facturado' },
            { key: 'cobrado', color: COLORS[5], label: 'Cobrado' },
            { key: 'egresos', color: COLORS[3], label: 'Egresos' },
          ]} />
          <div className="legend" style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            {[['Facturado', COLORS[0]], ['Cobrado', COLORS[5]], ['Egresos', COLORS[3]]].map(([n, c]) => (
              <span className="lg" key={n} style={{ flex: 'none' }}><span className="sw" style={{ background: c }} /><span className="nm" style={{ textTransform: 'none' }}>{n}</span></span>
            ))}
          </div>
        </div>

        <div className="panel c4">
          <div className="panel-h"><Icon name="expense" size={15} style={{ opacity: .5 }} /><span className="t">Egresos por categoría</span></div>
          <Donut data={(fin?.gastosPorCategoria ?? []).map((g: any) => ({ label: g.categoria, value: g.monto }))} />
        </div>

        <div className="panel c6">
          <div className="panel-h"><Icon name="alert" size={15} style={{ opacity: .5 }} /><span className="t">Cobranza pendiente</span>
            <button className="chip info spacer" onClick={() => irA('propietarios')}>Gestionar</button></div>
          <BarsH data={(fin?.topMorosos ?? []).map((m: any) => ({ label: m.nombre, value: m.saldo, id: m.id }))} onRow={() => irA('propietarios')} />
        </div>

        <div className="panel c6">
          <div className="panel-h"><Icon name="building" size={15} style={{ opacity: .5 }} /><span className="t">Operación</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { k: 'Unidades', v: unidades, s: est ? `${est.torres.length} torres` : '', go: 'estructura', ico: 'door' },
              { k: 'Comunicados', v: coms.length, s: 'publicados', go: 'comunicados', ico: 'megaphone' },
              { k: 'Invitaciones', v: activas, s: 'activas', go: 'estructura', ico: 'mail' },
              { k: 'Morosos', v: fin?.morosos ?? '—', s: 'unidades', go: 'propietarios', ico: 'alert' },
            ].map((o) => (
              <button key={o.k} className="list-item klink" style={{ borderBottom: 'none', textAlign: 'left', width: '100%' }} onClick={() => irA(o.go)}>
                <div className="li-ico"><Icon name={o.ico} /></div>
                <div className="li-body"><div className="li-title" style={{ fontFamily: 'var(--font-h)', fontSize: '1.15rem' }}>{o.v}</div>
                  <div className="li-sub">{o.k} · {o.s}</div></div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel c12">
          <div className="panel-h"><Icon name="megaphone" size={15} style={{ opacity: .5 }} /><span className="t">Últimos comunicados</span>
            <button className="chip info spacer" onClick={() => irA('comunicados')}>Ver todos</button></div>
          {!coms.length && <Empty ico="📭">Aún no has publicado comunicados.</Empty>}
          {coms.slice(0, 4).map((c) => (
            <div className="list-item klink" key={c.id} onClick={() => irA('comunicados')}>
              <div className="li-ico"><Icon name="pin" /></div>
              <div className="li-body">
                <div className="li-title">{c.titulo}</div>
                <div className="li-sub">{fechaUtc(c.creada).toLocaleDateString('es-VE')} · leído por {c.lectores}/{c.destinatarios}</div>
              </div>
              <div className="databar" style={{ width: 60, flexShrink: 0 }}>
                <i style={{ width: `${c.destinatarios ? (c.lectores / c.destinatarios) * 100 : 0}%`, background: 'var(--c2)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

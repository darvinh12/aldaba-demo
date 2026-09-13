import { useRef, useState, type ReactNode } from 'react'

// Paleta categórica (coincide con --c1..--c7 de tokens.css)
export const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)']
const RAW = ['#0a84c9', '#12988a', '#6d4bff', '#d98a2b', '#b74a86', '#2f9e63', '#64748b']

const fmtUsd = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const mesCorto = (p: string) => {
  const [y, m] = (p ?? '').split('-')
  const nn = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return m ? `${nn[+m] ?? m}${y ? " '" + y.slice(2) : ''}` : p
}

/* ---------- Tooltip flotante compartido ---------- */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; node: ReactNode } | null>(null)
  const show = (e: { clientX: number; clientY: number }, node: ReactNode) => setTip({ x: e.clientX, y: e.clientY, node })
  const hide = () => setTip(null)
  const el = tip ? (
    <div className="ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 170), top: tip.y - 12 }}>{tip.node}</div>
  ) : null
  return { show, hide, el }
}

/* ---------- Sparkline (mini línea para KPIs) ---------- */
export function Sparkline({ data, tone = 'up' }: { data: number[]; tone?: 'up' | 'down' | 'flat' }) {
  if (!data || data.length < 2) return <svg className="spark" viewBox="0 0 74 26" />
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1
  const x = (i: number) => (i / (data.length - 1)) * 72 + 1
  const y = (v: number) => 24 - ((v - min) / span) * 22
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  const col = tone === 'down' ? 'var(--neg)' : tone === 'flat' ? 'var(--faint)' : 'var(--pos)'
  const len = 120
  return (
    <svg className="spark" viewBox="0 0 74 26" preserveAspectRatio="none" aria-hidden>
      <polyline points={`1,25 ${pts.join(' ')} 73,25`} fill={col} opacity=".08" stroke="none" />
      <polyline className="serie" style={{ ['--len' as any]: len }} points={pts.join(' ')} stroke={col} strokeWidth="1.6" fill="none" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.1" fill={col} />
    </svg>
  )
}

/* ---------- KPI tile con sparkline ---------- */
export function StatTile({ label, value, delta, spark, ico, onClick, className = '' }:
  { label: string; value: ReactNode; delta?: { txt: string; tone: 'up' | 'down' | 'flat'; dir?: 'up' | 'down' | 'flat' }; spark?: number[]; ico?: ReactNode; onClick?: () => void; className?: string }) {
  const Cmp: any = onClick ? 'button' : 'div'
  const dir = delta?.dir ?? delta?.tone
  return (
    <Cmp className={`panel stat ${onClick ? 'klink' : ''} ${className}`} onClick={onClick} style={onClick ? undefined : { cursor: 'default' }}>
      <div className="lbl2">{ico}{label}</div>
      <div className="num">{value}</div>
      <div className="foot">
        {delta ? <span className={`dlt ${delta.tone}`}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {delta.txt}</span> : <span />}
        {spark && spark.length > 1 ? <Sparkline data={spark} tone={delta?.tone ?? 'up'} /> : null}
      </div>
    </Cmp>
  )
}

/* ---------- Gráfico de área + líneas (tendencia mensual) ---------- */
export function AreaLine({ series, lines, height = 210 }:
  { series: any[]; lines: { key: string; color: string; label: string }[]; height?: number }) {
  const tip = useTip()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hi, setHi] = useState<number | null>(null)
  const W = 640, H = height, padL = 46, padR = 12, padT = 12, padB = 26
  if (!series?.length) return <div className="empty" style={{ padding: 24 }}><p>Sin datos todavía.</p></div>
  const max = Math.max(1, ...series.flatMap((s) => lines.map((l) => Number(s[l.key]) || 0)))
  const nice = Math.ceil(max / 4) * 4 || 4
  const n = series.length
  const X = (i: number) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR))
  const Y = (v: number) => padT + (1 - v / nice) * (H - padT - padB)
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice)

  const move = (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    const rel = (e.clientX - r.left) / r.width * W
    let idx = 0, best = Infinity
    series.forEach((_, i) => { const d = Math.abs(X(i) - rel); if (d < best) { best = d; idx = i } })
    setHi(idx)
    tip.show(e, (
      <>
        <div className="k">{mesCorto(series[idx].periodo)}</div>
        {lines.map((l) => <div key={l.key}><span style={{ color: l.color }}>●</span> {l.label}: <b>{fmtUsd(Number(series[idx][l.key]) || 0)}</b></div>)}
      </>
    ))
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => { setHi(null); tip.hide() }} onMouseMove={move}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" style={{ height }}>
        <defs>
          {lines.map((l, li) => (
            <linearGradient key={li} id={`g${li}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RAW[li % RAW.length]} stopOpacity=".18" />
              <stop offset="100%" stopColor={RAW[li % RAW.length]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line className="grid" x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} />
            <text className="axis-t" x={padL - 6} y={Y(v) + 3} textAnchor="end">{v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}</text>
          </g>
        ))}
        {series.map((s, i) => <text key={i} className="axis-t" x={X(i)} y={H - 8} textAnchor="middle">{mesCorto(s.periodo)}</text>)}
        {lines.map((l, li) => {
          const pts = series.map((s, i) => [X(i), Y(Number(s[l.key]) || 0)])
          const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
          const area = `${line} L${X(n - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z`
          const len = pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0) + 40
          return (
            <g key={l.key}>
              <path className="area" d={area} fill={`url(#g${li})`} />
              <path className="serie" style={{ ['--len' as any]: Math.round(len), animationDelay: `${li * .12 + .1}s` }} d={line} stroke={l.color} />
              {pts.map((p, i) => <circle key={i} className="dot" cx={p[0]} cy={p[1]} r={hi === i ? 4 : 2.3} fill={l.color} />)}
            </g>
          )
        })}
        {hi != null && <line className="grid" x1={X(hi)} y1={padT} x2={X(hi)} y2={H - padB} style={{ stroke: 'var(--border)' }} />}
      </svg>
      {tip.el}
    </div>
  )
}

/* ---------- Donut + leyenda ---------- */
export function Donut({ data, centerLabel, centerValue }:
  { data: { label: string; value: number }[]; centerLabel?: string; centerValue?: ReactNode }) {
  const tip = useTip()
  const items = (data ?? []).filter((d) => d.value > 0)
  const total = items.reduce((a, d) => a + d.value, 0)
  if (!total) return <div className="empty" style={{ padding: 20 }}><p>Sin egresos registrados.</p></div>
  const R = 54, C = 2 * Math.PI * R, gap = 2
  let acc = 0
  return (
    <div className="donut-wrap">
      <svg width="132" height="132" viewBox="0 0 132 132" style={{ flexShrink: 0 }}>
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--muted)" strokeWidth="16" />
        {items.map((d, i) => {
          const frac = d.value / total
          const dash = Math.max(0, frac * C - gap)
          const seg = (
            <circle key={i} className="donut-seg" cx="66" cy="66" r={R} fill="none" stroke={RAW[i % RAW.length]} strokeWidth="16"
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} transform="rotate(-90 66 66)"
              style={{ cursor: 'default' }}
              onMouseMove={(e) => tip.show(e, <><div className="k">{d.label}</div><b>{fmtUsd(d.value)}</b> · {Math.round(frac * 100)}%</>)}
              onMouseLeave={tip.hide} />
          )
          acc += frac
          return seg
        })}
        <text x="66" y="62" textAnchor="middle" className="axis-t" style={{ fontSize: 9, fill: 'var(--faint)' }}>{centerLabel ?? 'TOTAL'}</text>
        <text x="66" y="80" textAnchor="middle" style={{ fontFamily: 'var(--font-h)', fontWeight: 600, fontSize: 15, fill: 'var(--ink)', letterSpacing: '-.03em' }}>
          {centerValue ?? fmtUsd(total)}
        </text>
      </svg>
      <div className="legend">
        {items.map((d, i) => (
          <div className="lg" key={i}>
            <span className="sw" style={{ background: RAW[i % RAW.length] }} />
            <span className="nm">{d.label}</span>
            <span className="vl">{fmtUsd(d.value)}</span>
          </div>
        ))}
      </div>
      {tip.el}
    </div>
  )
}

/* ---------- Gauge radial (semicírculo) para un porcentaje ----------
   Se adapta al fondo: usa currentColor para el % y la pista (funciona en hero oscuro y panel claro). */
export function Gauge({ value, sub, id = 'g' }: { value: number; sub?: string; id?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  // Tintes suaves y premium (no saturados) según salud de la recaudación
  const c0 = pct >= 80 ? '#57d39a' : pct >= 50 ? '#e6c169' : '#e79485'
  const c1 = pct >= 80 ? '#2fa16b' : pct >= 50 ? '#cf9a2f' : '#c85a48'
  const gid = `gauge-${id}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="176" height="104" viewBox="0 0 176 104" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c0} /><stop offset="100%" stopColor={c1} />
          </linearGradient>
        </defs>
        {/* pista sutil que se adapta al fondo */}
        <path d="M16 92 A72 72 0 0 1 160 92" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" strokeLinecap="round" pathLength={100} strokeDasharray="100" />
        {/* arco de valor con gradiente */}
        <path className="gauge-arc" d="M16 92 A72 72 0 0 1 160 92" fill="none" stroke={`url(#${gid})`} strokeWidth="8" strokeLinecap="round" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - pct} />
        <text x="88" y="84" textAnchor="middle" fill="currentColor" style={{ fontFamily: 'var(--font-h)', fontWeight: 600, fontSize: 32, letterSpacing: '-.045em' }}>{pct}<tspan style={{ fontSize: 18, fontWeight: 500 }} dx="1">%</tspan></text>
      </svg>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.14em', textTransform: 'uppercase', opacity: .62, marginTop: 4, textAlign: 'center' }}>{sub}</div>}
    </div>
  )
}

/* ---------- Ranking de barras horizontales (HTML + data-bars) ---------- */
export function BarsH({ data, color = 'var(--neg)', fmt = fmtUsd, onRow }:
  { data: { label: string; value: number; id?: string }[]; color?: string; fmt?: (n: number) => string; onRow?: (id?: string) => void }) {
  const items = (data ?? []).filter((d) => d.value > 0).slice(0, 6)
  if (!items.length) return <div className="empty" style={{ padding: 20 }}><p>Sin morosidad. ¡Todo al día!</p></div>
  const max = Math.max(...items.map((d) => d.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {items.map((d, i) => (
        <div key={i} onClick={() => onRow?.(d.id)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', alignItems: 'center', cursor: onRow ? 'pointer' : 'default' }}>
          <span className="sm" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <span className="mono-label" style={{ fontSize: '.74rem', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.value)}</span>
          <div className="databar" style={{ gridColumn: '1 / -1' }}>
            <i style={{ width: `${(d.value / max) * 100}%`, background: color, animationDelay: `${i * .06}s` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

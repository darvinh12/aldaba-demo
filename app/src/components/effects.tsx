import { useEffect, useRef, useState, type ReactNode } from 'react'

const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const fine = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches

/* Aurora — luz fluida en canvas, tuneada sutil para lujo.
   Blobs aditivos en navy/azul que orbitan y persiguen suavemente el cursor. */
const BLOBS = [
  { c: '10,132,201', r: 150, sx: 0.6, sy: 1.0, ph: 0 },
  { c: '25,179,255', r: 110, sx: 1.1, sy: 0.6, ph: 2 },
  { c: '0,54,95', r: 190, sx: 0.5, sy: 0.9, ph: 4 },
  { c: '109,75,255', r: 90, sx: 0.9, sy: 1.3, ph: 1 },
]
export function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (reduce()) return
    const cv = ref.current!; const cx = cv.getContext('2d')!
    let raf = 0, mouse: { x: number; y: number } | null = null
    const dpr = Math.min(window.devicePixelRatio || 1, 1.4)
    const resize = () => { cv.width = cv.offsetWidth * dpr; cv.height = cv.offsetHeight * dpr }
    resize()
    const onMove = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); mouse = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr } }
    window.addEventListener('pointermove', onMove, { passive: true }); window.addEventListener('resize', resize)
    const pos = BLOBS.map(() => ({ x: cv.width / 2, y: cv.height / 2 }))
    const tick = (t: number) => {
      const W = cv.width, H = cv.height
      cx.globalCompositeOperation = 'source-over'; cx.fillStyle = 'rgba(4,18,31,0.14)'; cx.fillRect(0, 0, W, H)
      cx.globalCompositeOperation = 'lighter'
      BLOBS.forEach((b, i) => {
        const tx = mouse ? mouse.x + Math.sin(t / 1000 + b.ph) * 70 * dpr : W / 2 + Math.sin((t / 1600) * b.sx + b.ph) * W * 0.32
        const ty = mouse ? mouse.y + Math.cos(t / 900 + b.ph) * 60 * dpr : H / 2 + Math.cos((t / 1800) * b.sy + b.ph) * H * 0.3
        pos[i].x += (tx - pos[i].x) * 0.035; pos[i].y += (ty - pos[i].y) * 0.035
        const r = b.r * dpr
        const g = cx.createRadialGradient(pos[i].x, pos[i].y, 0, pos[i].x, pos[i].y, r)
        g.addColorStop(0, `rgba(${b.c},0.4)`); g.addColorStop(1, `rgba(${b.c},0)`)
        cx.fillStyle = g; cx.beginPath(); cx.arc(pos[i].x, pos[i].y, r, 0, Math.PI * 2); cx.fill()
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="aurora-cv" aria-hidden="true" />
}

/* Corner-marks de precisión (firma "lab") */
export function CornerMarks() {
  return <><span className="cm tl" /><span className="cm tr" /><span className="cm bl" /><span className="cm br" /></>
}

/* Tilt 3D con brillo que siguen el puntero (Card3D del lab), sutil para lujo */
export function Tilt({ children, className = '', max = 6, style }: { children: ReactNode; className?: string; max?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, on: false })
  // En móvil/táctil el efecto 3D no aplica y el transform+preserve-3d puede interferir con el scroll:
  // se renderiza una tarjeta plana. El tilt queda solo en escritorio (puntero fino).
  const [tactil] = useState(() => !fine())
  if (tactil) return <div className={className} style={style}>{children}</div>
  const move = (e: React.PointerEvent) => {
    if (!fine() || reduce()) return
    const r = ref.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    setS({ rx: -(y - 0.5) * max, ry: (x - 0.5) * max, gx: x * 100, gy: y * 100, on: true })
  }
  const leave = () => setS({ rx: 0, ry: 0, gx: 50, gy: 50, on: false })
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={className}
      style={{ ...style, transform: `perspective(1000px) rotateX(${s.rx}deg) rotateY(${s.ry}deg)`, transition: s.on ? 'transform .08s var(--ease-out)' : 'transform .5s var(--ease-out)', transformStyle: 'preserve-3d' }}>
      {children}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', opacity: s.on ? 1 : 0, transition: 'opacity .3s var(--ease-out)', background: `radial-gradient(circle at ${s.gx}% ${s.gy}%, rgba(255,255,255,.14), transparent 55%)` }} />
    </div>
  )
}

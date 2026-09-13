import { useEffect, useState } from 'react'
import { Icon } from '../components/icons'
import { type Me } from '../api'
import { Shell, type NavItem } from '../shell'
import { PagosResidente } from '../components/PagosResidente'
import { AccesosResidente } from '../components/AccesosResidente'
import { ReservasResidente } from '../components/ReservasResidente'
import { ComunidadResidente } from '../components/ComunidadResidente'
import { Tilt, CornerMarks } from '../components/effects'
import { EN_APP } from '../plataforma'

const NAV: NavItem[] = [
  { key: 'inicio', label: 'Inicio', ico: '🏠' },
  { key: 'accesos', label: 'Accesos', ico: '🔑' },
  { key: 'reservas', label: 'Reservas', ico: '📅' },
  { key: 'pagos', label: 'Pagos', ico: '💳' },
  { key: 'comunidad', label: 'Comunidad', ico: '📢' },
]

const esIosUa = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

function GuiaInstalacion() {
  // Dentro de la app nativa no hay nada que instalar (y en iOS el UA dispararía la guía de Safari).
  const yaStandalone = EN_APP || matchMedia('(display-mode: standalone)').matches
  const [evento, setEvento] = useState<any>((window as any).__bip ?? null)
  const [visible, setVisible] = useState(() => !yaStandalone && (!!(window as any).__bip || esIosUa()))
  useEffect(() => {
    if (yaStandalone) return
    const h = (e: Event) => { e.preventDefault(); setEvento(e); setVisible(true) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (!visible) return null
  return (
    <div className="card" style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
      <h3><Icon name="phone" className="h-ico" />Instala Aldaba en tu teléfono</h3>
      {esIosUa()
        ? <p className="sm">En Safari: toca <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.</p>
        : <button className="btn btn-primary block" onClick={() => { evento?.prompt(); setVisible(false) }}>Instalar app</button>}
    </div>
  )
}

export function Residente({ me, condo, selector, onSalir }: { me: Me; condo: any; selector: React.ReactNode; onSalir: () => void }) {
  const [activo, setActivo] = useState('inicio')
  return (
    <Shell brand="Aldaba" subtitle={condo.nombre} selector={selector} onSalir={onSalir} esDemo={condo.es_demo === 1}
      meta={<span className="xs">{me.nombre}</span>} nav={NAV} activo={activo} setActivo={setActivo} side={false}>
      {activo === 'inicio' && (
        <>
          <Tilt className="card hero corner-marks" max={5}>
            <CornerMarks />
            <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>{condo.nombre}</div>
            <h3 style={{ marginTop: 14, fontSize: '1.5rem' }}>Buen día, {me.nombre.split(' ')[0]}.</h3>
            <p className="sm" style={{ opacity: .82, marginTop: 4, maxWidth: 340 }}>Tu residencia, en orden. Comunicados, pagos, accesos y reservas — en un solo lugar.</p>
          </Tilt>
          <GuiaInstalacion />
          <div className="kpis">
            <button className="kpi tint-blue" onClick={() => setActivo('pagos')}>
              <span className="k-arrow"><Icon name="queue" size={15} /></span>
              <div className="label"><Icon name="card" size={13} className="ico" />Mis pagos</div><div className="val" style={{ fontSize: '1.05rem', marginTop: 8 }}>Ver cuotas</div></button>
            <button className="kpi tint-green" onClick={() => setActivo('accesos')}>
              <span className="k-arrow"><Icon name="queue" size={15} /></span>
              <div className="label"><Icon name="key" size={13} className="ico" />Accesos</div><div className="val" style={{ fontSize: '1.05rem', marginTop: 8 }}>Invitar visita</div></button>
            <button className="kpi tint-amber" onClick={() => setActivo('reservas')}>
              <span className="k-arrow"><Icon name="queue" size={15} /></span>
              <div className="label"><Icon name="calendar" size={13} className="ico" />Áreas comunes</div><div className="val" style={{ fontSize: '1.05rem', marginTop: 8 }}>Reservar</div></button>
            <button className="kpi" onClick={() => setActivo('comunidad')}>
              <span className="k-arrow"><Icon name="queue" size={15} /></span>
              <div className="label"><Icon name="megaphone" size={13} className="ico" />Comunidad</div><div className="val" style={{ fontSize: '1.05rem', marginTop: 8 }}>Cartelera</div></button>
          </div>
        </>
      )}
      {activo === 'comunidad' && <ComunidadResidente />}
      {activo === 'accesos' && <AccesosResidente />}
      {activo === 'reservas' && <ReservasResidente />}
      {activo === 'pagos' && <PagosResidente />}
    </Shell>
  )
}

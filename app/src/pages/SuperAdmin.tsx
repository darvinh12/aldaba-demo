import { useEffect, useState } from 'react'
import { api, conError, setCondoActivo, type Me } from '../api'
import { PUBLIC_ORIGIN, copiar } from '../plataforma'
import { Shell, type NavItem } from '../shell'
import { BarsH } from '../components/charts'
import { Kpi, Empty, Sheet, SubmitBtn, useToast, useAsync } from '../ui'
import { Icon } from '../components/icons'
import { Tilt, CornerMarks } from '../components/effects'
import { Admin } from './Admin'

const NAV: NavItem[] = [
  { key: 'resumen', label: 'Resumen', ico: 'dashboard' },
  { key: 'orgs', label: 'Organizaciones', ico: 'bank' },
  { key: 'condos', label: 'Condominios', ico: 'building' },
]

type Gestion = { id: string; nombre: string }

export function SuperAdmin({ me, onSalir }: { me: Me; onSalir: () => void }) {
  const [activo, setActivo] = useState('resumen')
  const [data, setData] = useState<any>(null)
  const [editar, setEditar] = useState<any>(null)
  const [gestion, setGestion] = useState<Gestion | null>(null)
  const toast = useToast()
  const recargar = () => api('/sa/overview').then(setData).catch((e) => toast(e.message, 'err'))
  useEffect(() => { recargar() }, [])

  const invitarAdmin = async (condominio_id: string, rol = 'admin') => {
    const r = await conError(() => api('/sa/invitaciones', { method: 'POST', body: JSON.stringify({ condominio_id, rol }) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    const enlace = `${PUBLIC_ORIGIN}${r.url}`
    if (await copiar(enlace)) {
      toast(`Invitación de ${rol} copiada al portapapeles`, 'ok')
    } else {
      // El portapapeles falla sin HTTPS o sin permiso: mostramos el enlace para copiarlo a mano.
      toast(`No se pudo copiar. Enlace: ${enlace}`, 'err')
    }
  }
  const suspender = async (id: string, suspendido: number) => {
    const r = await conError(() => api(`/sa/condominios/${id}/suspension`, { method: 'POST', body: JSON.stringify({ suspendido }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast(suspendido ? 'Condominio suspendido' : 'Condominio reactivado', 'ok'); recargar() }
  }
  const borrarCondo = async (c: any) => {
    const t = prompt('Escribe el NOMBRE del condominio para borrarlo permanentemente:')
    if (t === c.nombre) {
      const r = await conError(() => api(`/sa/condominios/${c.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
      if (r !== undefined) { toast('Condominio borrado', 'ok'); recargar() }
    } else if (t) toast('El nombre no coincide', 'err')
  }
  const administrar = (c: any) => { setCondoActivo(c.id); setGestion({ id: c.id, nombre: c.nombre }) }
  const volverAConsola = () => { setGestion(null); recargar() }

  /* ---------- Modo gestión: panel de admin completo sobre el condominio elegido ---------- */
  if (gestion) {
    return (
      <Admin
        key={gestion.id}
        me={me}
        condo={{ id: gestion.id, nombre: gestion.nombre, rol: 'admin' }}
        selector={
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <button className="btn btn-sm btn-ghost" onClick={volverAConsola}>&larr; Consola</button>
            <span className="chip info" style={{ maxWidth: '38vw', overflow: 'hidden' }} title={`Superadmin gestionando ${gestion.nombre}`}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Superadmin · gestionando {gestion.nombre}</span>
            </span>
          </div>
        }
        onSalir={onSalir}
      />
    )
  }

  /* ---------- Modo consola: overview de la plataforma ---------- */
  const orgs = data?.organizaciones ?? []
  const condos = data?.condominios ?? []
  const totUnidades = condos.reduce((a: number, c: any) => a + (c.unidades || 0), 0)
  const totResidentes = condos.reduce((a: number, c: any) => a + (c.residentes || 0), 0)
  const suspendidos = condos.filter((c: any) => c.suspendido).length
  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'

  const FilaCondo = ({ c, conOrg }: { c: any; conOrg?: boolean }) => (
    <div className="list-item condo-row" key={c.id}>
      <div className="li-ico"><Icon name="building" /></div>
      <div className="li-body">
        <div className="li-title">{c.nombre} {c.suspendido ? <span className="chip off">Suspendido</span> : <span className="chip ok">Activo</span>}</div>
        <div className="li-sub">
          {conOrg ? `${c.organizacion} · ` : ''}{c.unidades} unidades · {c.residentes} residentes · tasa Bs {c.tasa_bs || 0}{c.direccion ? ` · ${c.direccion}` : ''}
        </div>
      </div>
      <div className="li-actions">
        {conOrg && <button className="chip info" onClick={() => invitarAdmin(c.id)}>Invitar admin</button>}
        <button className="chip neutral" onClick={() => setEditar(c)}>Editar</button>
        {conOrg && (
          <button className="chip pend" onClick={() => suspender(c.id, c.suspendido ? 0 : 1)}>
            {c.suspendido ? 'Reactivar' : 'Suspender'}
          </button>
        )}
        {conOrg && <button className="chip off" onClick={() => borrarCondo(c)}>Borrar</button>}
        <button className="btn btn-sm btn-primary" onClick={() => administrar(c)}>Administrar</button>
      </div>
    </div>
  )

  return (
    <Shell brand="Aldaba" subtitle="Consola superadmin" onSalir={onSalir} nav={NAV} activo={activo} setActivo={setActivo} side
      meta={<span className="xs">{me.nombre}</span>}>
      {!data ? <div className="centrado"><div className="spin dark" /></div> : (
        <>
          {activo === 'resumen' && (
            <>
              <Tilt className="card hero corner-marks" max={4} style={{ marginBottom: 18 }}>
                <CornerMarks />
                <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Aldaba · Plataforma</div>
                <h3 style={{ marginTop: 12, fontSize: '1.5rem' }}>{saludo}, {me.nombre.split(' ')[0]}.</h3>
                <p className="sm" style={{ opacity: .85, marginTop: 6 }}>
                  Supervisas {orgs.length} {orgs.length === 1 ? 'organización' : 'organizaciones'} y {condos.length} {condos.length === 1 ? 'condominio' : 'condominios'}. Entra a cualquiera para administrarlo por completo.
                </p>
                <div className="row" style={{ gap: 22, marginTop: 14, fontSize: '.8rem', opacity: .92, flexWrap: 'wrap' }}>
                  <span>{totUnidades} unidades</span>
                  <span>{totResidentes} residentes</span>
                  {suspendidos > 0 && <span>{suspendidos} {suspendidos === 1 ? 'suspendido' : 'suspendidos'}</span>}
                </div>
              </Tilt>

              <div className="kpis">
                <Kpi label="Organizaciones" val={orgs.length} ico="bank" tint="blue" />
                <Kpi label="Condominios" val={condos.length} ico="building" tint="green" />
                <Kpi label="Unidades" val={totUnidades} ico="door" tint="amber" />
                <Kpi label="Residentes" val={totResidentes} ico="users" tint="blue" />
              </div>

              {condos.length > 0 && (
                <div className="bi" style={{ marginBottom: 18 }}>
                  <div className="panel c6">
                    <div className="panel-h"><Icon name="users" size={15} style={{ opacity: .5 }} /><span className="t">Condominios por residentes</span></div>
                    <BarsH data={condos.map((c: any) => ({ label: c.nombre, value: c.residentes || 0, id: c.id })).sort((a: any, b: any) => b.value - a.value)}
                      color="var(--c1)" fmt={(n) => `${n}`} onRow={(id) => { const c = condos.find((x: any) => x.id === id); if (c) administrar(c) }} />
                  </div>
                  <div className="panel c6">
                    <div className="panel-h"><Icon name="door" size={15} style={{ opacity: .5 }} /><span className="t">Condominios por unidades</span></div>
                    <BarsH data={condos.map((c: any) => ({ label: c.nombre, value: c.unidades || 0, id: c.id })).sort((a: any, b: any) => b.value - a.value)}
                      color="var(--c2)" fmt={(n) => `${n}`} onRow={(id) => { const c = condos.find((x: any) => x.id === id); if (c) administrar(c) }} />
                  </div>
                </div>
              )}

              {!orgs.length && (
                <div className="card">
                  <Empty ico="bank">Aún no hay organizaciones. Crea la primera para empezar a montar condominios.</Empty>
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setActivo('orgs')}>Crear organización</button>
                  </div>
                </div>
              )}

              {orgs.map((o: any) => {
                const cs = condos.filter((c: any) => c.organizacion_id === o.id)
                return (
                  <div className="card" key={o.id}>
                    <div className="card-head">
                      <h3><Icon name="bank" className="h-ico" />{o.nombre} <span className="sub">{cs.length} {cs.length === 1 ? 'condominio' : 'condominios'}</span></h3>
                      <button className="chip info spacer" onClick={() => setActivo('condos')}>Nuevo condominio</button>
                    </div>
                    {!cs.length && <Empty ico="building">Sin condominios en esta organización todavía.</Empty>}
                    {cs.map((c: any) => <FilaCondo c={c} conOrg key={c.id} />)}
                  </div>
                )
              })}
            </>
          )}

          {activo === 'orgs' && <Organizaciones data={data} onDone={recargar} />}

          {activo === 'condos' && (
            <>
              <NuevoCondo orgs={orgs} onDone={recargar} />
              <div className="card">
                <h3><Icon name="building" className="h-ico" />Condominios <span className="sub">{condos.length}</span></h3>
                {!condos.length && <Empty ico="building">Sin condominios todavía.</Empty>}
                {condos.map((c: any) => <FilaCondo c={c} conOrg key={c.id} />)}
              </div>
            </>
          )}
        </>
      )}
      {editar && (
        <EditarCondo c={editar} onClose={() => setEditar(null)} onDone={() => { setEditar(null); recargar() }}
          onInvitar={invitarAdmin} onAdministrar={(c) => { setEditar(null); administrar(c) }} />
      )}
    </Shell>
  )
}

function Organizaciones({ data, onDone }: { data: any; onDone: () => void }) {
  const [nombre, setNombre] = useState(''); const toast = useToast(); const { loading, run } = useAsync()
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/sa/organizaciones', { method: 'POST', body: JSON.stringify({ nombre }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { setNombre(''); toast('Organización creada', 'ok'); onDone() }
  }, e)
  const renombrar = async (o: any) => {
    const nuevo = prompt('Nuevo nombre de la organización:', o.nombre)
    if (!nuevo || nuevo === o.nombre) return
    const r = await conError(() => api(`/sa/organizaciones/${o.id}`, { method: 'PATCH', body: JSON.stringify({ nombre: nuevo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Organización renombrada', 'ok'); onDone() }
  }
  const borrar = async (o: any, n: number) => {
    if (n > 0) { toast('Elimina primero sus condominios (offboarding)', 'err'); return }
    if (!confirm(`¿Eliminar la organización "${o.nombre}"?`)) return
    const r = await conError(() => api(`/sa/organizaciones/${o.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Organización eliminada', 'ok'); onDone() }
  }
  return (
    <>
      <div className="card">
        <h3><Icon name="bank" className="h-ico" />Nueva organización <span className="sub">administradora o junta</span></h3>
        <form onSubmit={crear} className="row">
          <input className="inp" placeholder="Administradora XYZ" value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={120} />
          <SubmitBtn loading={loading} className="btn btn-primary">Crear</SubmitBtn>
        </form>
      </div>
      <div className="card">
        <h3><Icon name="bank" className="h-ico" />Organizaciones <span className="sub">{data.organizaciones.length}</span></h3>
        {!data.organizaciones.length && <Empty ico="bank">Sin organizaciones todavía.</Empty>}
        {data.organizaciones.map((o: any) => {
          const n = data.condominios.filter((c: any) => c.organizacion_id === o.id).length
          return (
            <div className="list-item" key={o.id}>
              <div className="li-ico"><Icon name="bank" /></div>
              <div className="li-body"><div className="li-title">{o.nombre}</div>
                <div className="li-sub">{n} {n === 1 ? 'condominio' : 'condominios'}</div></div>
              <div className="li-actions">
                <button className="chip neutral" onClick={() => renombrar(o)}>Renombrar</button>
                {n === 0 && <button className="chip off" onClick={() => borrar(o, n)}>Eliminar</button>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function NuevoCondo({ orgs, onDone }: { orgs: any[]; onDone: () => void }) {
  const [f, setF] = useState({ organizacion_id: '', nombre: '', direccion: '' })
  const toast = useToast(); const { loading, run } = useAsync()
  const crear = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/sa/condominios', { method: 'POST', body: JSON.stringify(f) }), (m) => toast(m, 'err'))
    if (r !== undefined) { setF({ organizacion_id: '', nombre: '', direccion: '' }); toast('Condominio creado', 'ok'); onDone() }
  }, e)
  return (
    <div className="card">
      <h3><Icon name="building" className="h-ico" />Nuevo condominio</h3>
      {!orgs.length && <p className="hint" style={{ marginBottom: 8 }}>Primero crea una organización.</p>}
      <form onSubmit={crear} className="stack">
        <select className="inp" value={f.organizacion_id} onChange={(e) => setF({ ...f, organizacion_id: e.target.value })} required>
          <option value="">— organización —</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <div className="grid2">
          <input className="inp" placeholder="Nombre del condominio" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={120} />
          <input className="inp" placeholder="Dirección (opcional)" value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} />
        </div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Crear condominio</SubmitBtn>
      </form>
    </div>
  )
}

function EditarCondo({ c, onClose, onDone, onInvitar, onAdministrar }:
  { c: any; onClose: () => void; onDone: () => void; onInvitar: (id: string, rol?: string) => void; onAdministrar: (c: any) => void }) {
  const [nombre, setNombre] = useState(c.nombre ?? '')
  const [direccion, setDireccion] = useState(c.direccion ?? ''), [tasa, setTasa] = useState(String(c.tasa_bs || 0))
  const [invs, setInvs] = useState<any[]>([])
  const toast = useToast(); const { loading, run } = useAsync()
  const cargarInvs = () => api(`/sa/invitaciones?condominio=${c.id}`).then((d) => setInvs(d.invitaciones)).catch(() => {})
  useEffect(() => { cargarInvs() }, [])
  const guardar = (e: React.FormEvent) => run(async () => {
    if (!nombre.trim()) { toast('El nombre no puede quedar vacío', 'err'); return }
    const r = await conError(() => api(`/sa/condominios/${c.id}`, { method: 'PATCH', body: JSON.stringify({ nombre: nombre.trim(), direccion, tasa_bs: Number(tasa) }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Condominio actualizado', 'ok'); onDone() }
  }, e)
  const invitar = async (rol: string) => { await onInvitar(c.id, rol); setTimeout(cargarInvs, 600) }
  const revocar = async (token: string) => {
    const r = await conError(() => api(`/sa/invitaciones/${token}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Invitación revocada', 'ok'); cargarInvs() }
  }
  const rolLabel: Record<string, string> = { admin: 'Admin', org_admin: 'Org-admin', porteria: 'Portería' }
  return (
    <Sheet title={c.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="stack">
        <div className="field"><label>Nombre del condominio</label><input className="inp" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} required /></div>
        <div className="field"><label>Dirección</label><input className="inp" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
        <div className="field"><label>Tasa Bs / USD</label><input className="inp" type="number" step="0.01" min="0" value={tasa} onChange={(e) => setTasa(e.target.value)} />
          <div className="hint">La usará el módulo de Finanzas para convertir cuotas.</div></div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Guardar</SubmitBtn>
      </form>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => invitar('admin')}>Invitar admin</button>
        <button className="btn btn-sm btn-ghost" onClick={() => invitar('org_admin')}>Invitar org-admin</button>
        <button className="btn btn-sm btn-ghost" onClick={() => invitar('porteria')}>Invitar portería</button>
      </div>
      {!!invs.length && (
        <div style={{ marginTop: 12 }}>
          <div className="xs muted-txt" style={{ marginBottom: 6 }}>Invitaciones pendientes</div>
          {invs.map((i) => (
            <div className="list-item" key={i.token}>
              <div className="li-body"><div className="li-title" style={{ fontSize: '.85rem' }}>{rolLabel[i.rol] ?? i.rol} {i.vencida ? <span className="chip off">vencida</span> : <span className="chip pend">sin usar</span>}</div>
                <div className="li-sub">…{String(i.token).slice(-8)}</div></div>
              <button className="chip off" onClick={() => revocar(i.token)}>Revocar</button>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-primary block" style={{ marginTop: 14 }} onClick={() => onAdministrar(c)}>
        Administrar este condominio
      </button>
    </Sheet>
  )
}

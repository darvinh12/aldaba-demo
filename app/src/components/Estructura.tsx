import { useEffect, useState } from 'react'
import { api, apiVivo, conError, fechaUtc } from '../api'
import { PUBLIC_ORIGIN, abrirExterno, copiar as copiarTexto } from '../plataforma'
import { useToast, Empty, Sheet, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'

export function Estructura() {
  const [est, setEst] = useState<any>(null)
  const [invs, setInvs] = useState<any[]>([])
  const [csv, setCsv] = useState('')
  const [editar, setEditar] = useState<any>(null)
  const toast = useToast()
  const imp = useAsync()
  const recargar = () => apiVivo('/estructura', setEst).catch((e) => toast(e.message, 'err'))
  const cargarInvs = () => apiVivo('/invitaciones', (d: any) => setInvs(d.invitaciones)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { recargar(); cargarInvs() }, [])

  const importar = (e: React.FormEvent) => imp.run(async () => {
    const r = await conError(() => api('/estructura/importar', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv }), (m) => toast(m, 'err'))
    if (r === undefined) return
    toast(`${r.torres} torres, ${r.unidades} unidades nuevas, ${r.actualizadas} actualizadas`, 'ok')
    setCsv(''); recargar()
  }, e)

  const invitar = async (unidadId: string, nombre: string) => {
    const inv = await conError(() => api('/invitaciones', { method: 'POST', body: JSON.stringify({ unidad_id: unidadId }) }), (m) => toast(m, 'err'))
    if (inv === undefined) return
    const abs = `${PUBLIC_ORIGIN}${inv.url}`
    const copiado = await copiarTexto(abs)
    if (!copiado) toast('No se pudo copiar el enlace al portapapeles', 'err')
    const wa = `https://wa.me/?text=${encodeURIComponent(`Hola! Regístrate en Aldaba para la unidad ${nombre}: ${abs}`)}`
    abrirExterno(wa)
    toast(copiado ? 'Invitación creada y copiada' : 'Invitación creada', 'ok'); cargarInvs()
  }
  const revocar = async (token: string) => {
    if (!confirm('¿Revocar esta invitación? El link dejará de funcionar.')) return
    const r = await conError(() => api(`/invitaciones/${token}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Invitación revocada', 'ok'); cargarInvs() }
  }
  const copiar = async (token: string) => {
    const ok = await copiarTexto(`${PUBLIC_ORIGIN}/registro?token=${token}`)
    if (ok) toast('Link copiado', 'ok')
    else toast('No se pudo copiar el enlace al portapapeles', 'err')
  }
  const borrarUnidad = async (id: string) => {
    if (!confirm('¿Borrar esta unidad?')) return
    const r = await conError(() => api(`/estructura/unidades/${id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Unidad borrada', 'ok'); recargar() }
  }
  const renombrarTorre = async (t: any) => {
    const nombre = prompt('Nuevo nombre de la torre:', t.nombre)
    if (!nombre) return
    const r = await conError(() => api(`/estructura/torres/${t.id}`, { method: 'PATCH', body: JSON.stringify({ nombre }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Torre renombrada', 'ok'); recargar() }
  }
  const borrarTorre = async (id: string) => {
    if (!confirm('¿Borrar esta torre? Debe estar vacía.')) return
    const r = await conError(() => api(`/estructura/torres/${id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Torre borrada', 'ok'); recargar() }
  }

  const bloques = est ? [...est.torres, ...(est.sinTorre?.length ? [{ id: null, nombre: 'Sin torre', unidades: est.sinTorre }] : [])] : []
  const totalUnidades = est ? est.torres.reduce((a: number, t: any) => a + t.unidades.length, 0) + (est.sinTorre?.length ?? 0) : 0

  return (
    <>
      <div className="card">
        <h3><Icon name="inbox" className="h-ico" />Importar unidades <span className="sub">CSV: torre, unidad, alícuota</span></h3>
        <form onSubmit={importar} className="stack">
          <textarea className="inp" rows={4} placeholder={'torre,unidad,alicuota\nA,1-A,0.25\nA,1-B,0.25\nB,PH,0.5'} value={csv} onChange={(e) => setCsv(e.target.value)} required />
          <span className="hint">La alícuota es la participación de cada unidad en los gastos comunes: entre todas deben sumar 1 (100%).</span>
          <div className="row between">
            <span className="hint">Re-importar actualiza las alícuotas existentes.</span>
            <SubmitBtn loading={imp.loading} className="btn btn-primary">Importar</SubmitBtn>
          </div>
        </form>
      </div>

      {est && totalUnidades > 0 && (() => {
        const suma = Number(est.suma_alicuotas ?? 0)
        const pct = suma * 100
        const cuadra = Math.abs(suma - 1) <= 0.005
        const pctTxt = pct.toLocaleString('es-VE', { maximumFractionDigits: 2 })
        return (
          <div className="card">
            <div className="row between">
              <span><b>Suma de alícuotas:</b> {pctTxt}%</span>
              {cuadra ? <span className="chip ok">cuadra 100%</span> : <span className="chip pend">no cuadra</span>}
            </div>
            {!cuadra && (
              <p className="hint" style={{ color: 'var(--warn)', marginTop: 8 }}>
                Las alícuotas de este condominio suman {pctTxt}% y deberían sumar 100%. Al emitir cuotas por alícuota,
                el sistema reparte proporcionalmente (cada unidad paga base × su alícuota), así que con esta suma el
                total emitido será el {pctTxt}% de la base. Corrige las alícuotas para que sumen 1.
              </p>
            )}
          </div>
        )
      })()}

      {est && !totalUnidades && <Empty ico="🏢">Aún no hay unidades. Importa el CSV para empezar.</Empty>}

      {bloques.map((t: any) => (
        <div className="card" key={t.id ?? 'sin'}>
          <div className="card-head">
            <h3><Icon name="building" className="h-ico" />{t.nombre} <span className="sub">{t.unidades.length} unidades</span></h3>
            {t.id && (
              <div className="li-actions spacer">
                <button className="chip neutral" onClick={() => renombrarTorre(t)}>Renombrar</button>
                {!t.unidades.length && <button className="chip off" onClick={() => borrarTorre(t.id)}>Borrar torre</button>}
              </div>
            )}
          </div>
          {t.unidades.map((u: any) => (
            <div className="list-item" key={u.id}>
              <div className="li-ico"><Icon name="door" /></div>
              <div className="li-body">
                <div className="li-title">{u.nombre}</div>
                <div className="li-sub">alícuota {u.alicuota}</div>
              </div>
              <div className="li-actions">
                <button className="chip info" onClick={() => invitar(u.id, u.nombre)}>Invitar</button>
                <button className="chip neutral" onClick={() => setEditar(u)}>✎</button>
                <button className="chip off" onClick={() => borrarUnidad(u.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="card">
        <h3><Icon name="mail" className="h-ico" />Invitaciones de residentes <span className="sub">{invs.length}</span></h3>
        {!invs.length && <Empty ico="✉️">Sin invitaciones todavía.</Empty>}
        {invs.map((inv: any) => (
          <div className="list-item" key={inv.token}>
            <div className="li-body">
              <div className="li-title">{inv.unidad ?? '—'} {inv.usada ? <span className="chip neutral">usada</span> : <span className="chip ok">activa</span>}</div>
              <div className="li-sub">creada {fechaUtc(inv.creada).toLocaleDateString('es-VE')}{inv.creador ? ` · por ${inv.creador}` : ''}</div>
            </div>
            {!inv.usada && (
              <div className="li-actions">
                <button className="chip info" onClick={() => copiar(inv.token)}>Copiar</button>
                <button className="chip off" onClick={() => revocar(inv.token)}>Revocar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editar && <EditarUnidad u={editar} onClose={() => setEditar(null)} onDone={() => { setEditar(null); recargar() }} />}
    </>
  )
}

function EditarUnidad({ u, onClose, onDone }: { u: any; onClose: () => void; onDone: () => void }) {
  const [nombre, setNombre] = useState(u.nombre), [alicuota, setAlicuota] = useState(String(u.alicuota))
  const toast = useToast(); const { loading, run } = useAsync()
  const guardar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api(`/estructura/unidades/${u.id}`, { method: 'PATCH', body: JSON.stringify({ nombre, alicuota: Number(alicuota) }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Unidad actualizada', 'ok'); onDone() }
  }, e)
  return (
    <Sheet title={`Editar unidad ${u.nombre}`} onClose={onClose}>
      <form onSubmit={guardar} className="stack">
        <div className="field"><label>Nombre</label><input className="inp" value={nombre} onChange={(e) => setNombre(e.target.value)} required /></div>
        <div className="field"><label>Alícuota</label><input className="inp" type="number" step="0.0001" min="0" value={alicuota} onChange={(e) => setAlicuota(e.target.value)} required /></div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Guardar</SubmitBtn>
      </form>
    </Sheet>
  )
}

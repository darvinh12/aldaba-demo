import { useEffect, useState } from 'react'
import { api, apiVivo, conError, fechaUtc } from '../api'
import { useToast, Empty, Bar, Sheet, SubmitBtn, useAsync } from '../ui'
import { Icon } from './icons'

export function Comunicados({ esAdmin }: { esAdmin: boolean }) {
  const [lista, setLista] = useState<any[]>([])
  const [nuevo, setNuevo] = useState({ titulo: '', cuerpo: '' })
  const [editando, setEditando] = useState<any>(null)
  const toast = useToast()
  const { loading, run } = useAsync()
  const recargar = () => apiVivo('/comunicados', (d: any) => setLista(d.comunicados)).catch((e) => toast(e.message, 'err'))
  useEffect(() => { recargar() }, [])
  const publicar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api('/comunicados', { method: 'POST', body: JSON.stringify(nuevo) }), (m) => toast(m, 'err'))
    if (r === undefined) return
    setNuevo({ titulo: '', cuerpo: '' }); toast('Comunicado publicado', 'ok'); recargar()
  }, e)
  const leer = async (id: string) => {
    const r = await conError(() => api(`/comunicados/${id}/leer`, { method: 'POST' }), (m) => toast(m, 'err'))
    if (r !== undefined) recargar()
  }
  const borrar = async (c: any) => {
    if (!confirm(`¿Borrar el comunicado "${c.titulo}"?`)) return
    const r = await conError(() => api(`/comunicados/${c.id}`, { method: 'DELETE' }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Comunicado borrado', 'ok'); recargar() }
  }
  return (
    <>
      {esAdmin && (
        <div className="card">
          <h3><Icon name="megaphone" className="h-ico" />Publicar comunicado</h3>
          <form onSubmit={publicar} className="stack">
            <input className="inp" placeholder="Título" maxLength={200} value={nuevo.titulo} onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })} required />
            <textarea className="inp" placeholder="Cuerpo del aviso…" rows={3} maxLength={10000} value={nuevo.cuerpo} onChange={(e) => setNuevo({ ...nuevo, cuerpo: e.target.value })} required />
            <SubmitBtn loading={loading} className="btn btn-primary block">Publicar</SubmitBtn>
          </form>
        </div>
      )}
      <div className="card">
        <h3>Cartelera</h3>
        {!lista.length && <Empty ico="📭">Sin comunicados todavía.</Empty>}
        <div className="stack" style={{ gap: 0 }}>
          {lista.map((c) => {
            const pct = c.destinatarios ? Math.round((c.lectores / c.destinatarios) * 100) : 0
            return (
              <div className="list-item" key={c.id} style={{ alignItems: 'flex-start' }}>
                <div className="li-ico"><Icon name="pin" /></div>
                <div className="li-body">
                  <div className="row between">
                    <div className="li-title">{c.titulo}</div>
                    {!esAdmin && (c.leido
                      ? <span className="chip ok">✓ Leído</span>
                      : <button className="chip info" onClick={() => leer(c.id)}>Marcar leído</button>)}
                  </div>
                  <div className="li-sub" style={{ whiteSpace: 'pre-wrap' }}>{c.cuerpo}</div>
                  <div className="li-sub" style={{ marginTop: 6 }}>{fechaUtc(c.creada).toLocaleString('es-VE')} · por {c.autor}</div>
                  {esAdmin && (
                    <div style={{ marginTop: 8 }}>
                      <div className="row between xs" style={{ marginBottom: 4 }}>
                        <span className="muted-txt">Lectura</span><span style={{ fontWeight: 700 }}>{c.lectores}/{c.destinatarios} ({pct}%)</span>
                      </div>
                      <Bar pct={pct} green />
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        <button className="chip neutral" onClick={() => setEditando(c)}><Icon name="wrench" /> Editar</button>
                        <button className="chip off" onClick={() => borrar(c)}><Icon name="expense" /> Borrar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {editando && <EditarComunicado c={editando} onClose={() => setEditando(null)} onDone={() => { setEditando(null); recargar() }} />}
    </>
  )
}

function EditarComunicado({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const [titulo, setTitulo] = useState(c.titulo), [cuerpo, setCuerpo] = useState(c.cuerpo)
  const toast = useToast(); const { loading, run } = useAsync()
  const guardar = (e: React.FormEvent) => run(async () => {
    const r = await conError(() => api(`/comunicados/${c.id}`, { method: 'PATCH', body: JSON.stringify({ titulo, cuerpo }) }), (m) => toast(m, 'err'))
    if (r !== undefined) { toast('Comunicado actualizado', 'ok'); onDone() }
  }, e)
  return (
    <Sheet title="Editar comunicado" onClose={onClose}>
      <form onSubmit={guardar} className="stack">
        <div className="field"><label>Título</label><input className="inp" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} required /></div>
        <div className="field"><label>Cuerpo</label><textarea className="inp" rows={5} maxLength={10000} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} required /></div>
        <SubmitBtn loading={loading} className="btn btn-primary block">Guardar</SubmitBtn>
      </form>
    </Sheet>
  )
}

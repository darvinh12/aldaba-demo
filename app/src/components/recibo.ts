import { api, usd, fechaUtc } from '../api'
import { EN_APP } from '../plataforma'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

/** HTML autocontenido del recibo membretado (mismo diseño de siempre). */
function htmlRecibo(r: any): string {
  // tasa_bs viene del PAGO (congelada al reportarlo); si el pago es anterior a ese cambio
  // (tasa_referencial=1) el worker cae a la tasa actual y aquí se marca como referencial.
  const bs = r.tasa_bs ? ` · Bs ${(r.monto_usd * r.tasa_bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : ''
  const filaTasa = r.tasa_bs
    ? `<div class="row"><span>Tasa Bs/USD</span><b>${esc(Number(r.tasa_bs).toLocaleString('es-VE', { maximumFractionDigits: 4 }))}${r.tasa_referencial ? ' <span style="font-weight:400;color:#94A3B8">(referencial: tasa actual, no la del día del pago)</span>' : ''}</b></div>`
    : ''
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${esc(r.id).slice(0, 8)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
    body{padding:34px;color:#0F172A;background:#fff}
    .head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #2563EB;padding-bottom:16px;margin-bottom:22px}
    .mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#2563EB,#1E40AF);color:#fff;display:grid;place-items:center;font-weight:800;font-size:1.6rem}
    .org{font-size:.78rem;color:#5B6B80}
    h1{font-size:1.25rem}
    .badge{display:inline-block;background:#DCFCE7;color:#166534;font-weight:700;font-size:.72rem;padding:4px 12px;border-radius:99px;margin:6px 0 18px}
    .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #E2E8F0;font-size:.9rem}
    .row span{color:#5B6B80}.row b{font-weight:700}
    .total{margin-top:18px;background:#F1F5F9;border-radius:14px;padding:16px;display:flex;justify-content:space-between;align-items:center}
    .total .big{font-size:1.7rem;font-weight:800;font-family:sans-serif}
    .foot{margin-top:26px;font-size:.72rem;color:#94A3B8;text-align:center}
    @media print{body{padding:16px}}
  </style></head><body>
    <div class="head"><div class="mark">A</div><div>
      <h1>${esc(r.condominio)}</h1><div class="org">${esc(r.organizacion)}${r.direccion ? ' · ' + esc(r.direccion) : ''}</div></div></div>
    <div style="text-align:center"><div class="badge">✓ PAGO ${r.estado === 'aprobado' ? 'APROBADO' : esc(r.estado).toUpperCase()}</div></div>
    <h2 style="font-size:1rem;margin-bottom:10px">Recibo de pago</h2>
    <div class="row"><span>Recibo N°</span><b>${esc(r.id).slice(0, 8).toUpperCase()}</b></div>
    <div class="row"><span>Unidad</span><b>${esc(r.unidad)}</b></div>
    <div class="row"><span>Propietario</span><b>${esc(r.residente)}</b></div>
    <div class="row"><span>Método</span><b>${esc(String(r.metodo).replace('_', ' '))}</b></div>
    ${r.referencia ? `<div class="row"><span>Referencia</span><b>${esc(r.referencia)}</b></div>` : ''}
    <div class="row"><span>Fecha</span><b>${esc(fechaUtc(r.conciliada || r.creada).toLocaleString('es-VE'))}</b></div>
    ${filaTasa}
    <div class="total"><span style="color:#5B6B80;font-weight:600">Monto pagado</span><span class="big">${esc(usd(r.monto_usd))}${esc(bs)}</span></div>
    <div class="foot">Documento generado por Aldaba. Comprobante válido de pago registrado.</div>
  </body></html>`
}

// Un solo iframe de impresión reutilizado: quitarlo justo después de print() cancela
// el diálogo en algunos navegadores, así que el anterior se retira al imprimir de nuevo.
let marcoImpresion: HTMLIFrameElement | null = null

/** Imprime el recibo desde un iframe oculto del propio documento (sin window.open). */
function imprimirEnIframe(html: string): boolean {
  marcoImpresion?.remove(); marcoImpresion = null
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(f)
  const doc = f.contentDocument, win = f.contentWindow
  if (!doc || !win || typeof win.print !== 'function') { f.remove(); return false }
  doc.open(); doc.write(html); doc.close()
  marcoImpresion = f
  setTimeout(() => { try { win.focus(); win.print() } catch { /* WebView sin soporte real: el modal ya no aplica aquí */ } }, 350)
  return true
}

/** Fallback nativo (WebView sin print()): recibo a pantalla completa dentro de la app.
 *  El botón Compartir queda deshabilitado — E5 lo conecta a @capacitor/share. */
function mostrarModalRecibo(html: string): void {
  document.getElementById('recibo-modal')?.remove()
  const cont = document.createElement('div')
  cont.id = 'recibo-modal'
  cont.style.cssText = 'position:fixed;inset:0;z-index:1200;background:#fff;display:flex;flex-direction:column'

  const barra = document.createElement('div')
  barra.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC'

  const titulo = document.createElement('div')
  titulo.style.cssText = 'flex:1;min-width:0'
  const t1 = document.createElement('strong')
  t1.textContent = 'Recibo de pago'
  t1.style.cssText = 'display:block;font-size:.95rem;color:#0F172A'
  const t2 = document.createElement('span')
  t2.textContent = 'compartir disponible próximamente'
  t2.style.cssText = 'font-size:.72rem;color:#94A3B8'
  titulo.append(t1, t2)

  const compartir = document.createElement('button')
  compartir.type = 'button'
  compartir.textContent = 'Compartir'
  compartir.disabled = true
  compartir.title = 'Disponible próximamente'
  compartir.style.cssText = 'padding:8px 14px;border:1px solid #E2E8F0;border-radius:10px;background:#F1F5F9;color:#94A3B8;font-weight:600;font-size:.85rem'

  const cerrar = document.createElement('button')
  cerrar.type = 'button'
  cerrar.textContent = 'Cerrar'
  cerrar.style.cssText = 'padding:8px 14px;border:0;border-radius:10px;background:#2563EB;color:#fff;font-weight:600;font-size:.85rem'
  cerrar.onclick = () => cont.remove()

  const vista = document.createElement('iframe')
  vista.style.cssText = 'flex:1;width:100%;border:0;background:#fff'
  vista.srcdoc = html

  barra.append(titulo, compartir, cerrar)
  cont.append(barra, vista)
  document.body.appendChild(cont)
}

/** Muestra el recibo membretado del pago: en web lo imprime desde un iframe oculto;
 *  en la app nativa (WebView sin print) lo presenta en un modal a pantalla completa. */
export async function imprimirRecibo(pagoId: string, onErr: (m: string) => void) {
  let r: any
  try { r = await api(`/finanzas/pagos/${pagoId}/recibo`) } catch (e) { onErr((e as Error).message); return }
  const html = htmlRecibo(r)
  if (EN_APP || !imprimirEnIframe(html)) mostrarModalRecibo(html)
}

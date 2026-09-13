/** El QR de un pase, DENTRO de la app.
 *
 *  POR QUE EXISTE: "Ver QR" abría la página pública /pase/<token> con abrirExterno(), o sea
 *  window.open(). En el WebView de Capacitor eso es un no-op — devuelve null y el usuario
 *  veía "el navegador bloqueó la ventana emergente". Nunca pudo ver su propio QR desde la
 *  app. Además, aunque hubiera funcionado, mandar al residente fuera de la aplicación para
 *  enseñarle un código suyo es un rodeo: la página pública es para el VISITANTE.
 *
 *  El código corto va tan grande como el QR a propósito: es el camino de respaldo cuando la
 *  cámara de la tablet de portería no enfoca, y en ese momento el residente lo va a estar
 *  leyendo en voz alta por teléfono. */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { PUBLIC_ORIGIN, abrirExterno, copiar } from '../plataforma'
import { Sheet, useToast } from '../ui'
import { fechaUtc } from '../api'
import { Icon } from './icons'
import { formatearCodigo } from '../codigo'

export function PaseQR({ pase, onClose }: { pase: any; onClose: () => void }) {
  const [qr, setQr] = useState('')
  const [fallo, setFallo] = useState(false)
  const toast = useToast()
  const enlace = `${PUBLIC_ORIGIN}/pase/${pase.token}`

  useEffect(() => {
    let vivo = true
    QRCode.toDataURL(enlace, { width: 260, margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } })
      .then((d) => { if (vivo) setQr(d) })
      .catch(() => { if (vivo) setFallo(true) })
    return () => { vivo = false }
  }, [enlace])

  const compartir = () => {
    const texto = `Hola ${pase.visitante}, este es tu pase de entrada: ${enlace}`
      + (pase.codigo ? `\nSi el QR no lee, el código es ${formatearCodigo(pase.codigo)}` : '')
    abrirExterno(`https://wa.me/?text=${encodeURIComponent(texto)}`)
  }
  const copiarAlgo = (valor: string, que: string) =>
    copiar(valor).then((ok) => toast(ok ? `${que} copiado` : `No se pudo copiar ${que.toLowerCase()}`, ok ? 'ok' : 'err'))

  const vencido = new Date(pase.expira.replace(' ', 'T') + 'Z') < new Date()

  return (
    <Sheet title={`Pase de ${pase.visitante}`} onClose={onClose}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 14, display: 'inline-block', lineHeight: 0 }}>
          {qr
            ? <img src={qr} alt={`Código QR del pase de ${pase.visitante}`} width={260} height={260} style={{ display: 'block' }} />
            : <div style={{ width: 260, height: 260, display: 'grid', placeItems: 'center', color: '#0F172A' }}>
                {fallo ? <span className="sm">No se pudo dibujar el QR.<br />Usa el código de abajo.</span> : <div className="spin" />}
              </div>}
        </div>

        {pase.codigo && (
          <div style={{ marginTop: 18 }}>
            <div className="xs muted-txt" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>Código del pase</div>
            <button type="button" onClick={() => copiarAlgo(pase.codigo, 'Código')}
              title="Tocar para copiar"
              style={{
                marginTop: 6, border: 0, background: 'none', cursor: 'pointer', color: 'inherit',
                fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 34, fontWeight: 600, letterSpacing: '.14em',
              }}>
              {formatearCodigo(pase.codigo)}
            </button>
            <div className="xs muted-txt" style={{ marginTop: 2 }}>Dícteselo a portería si el QR no lee</div>
          </div>
        )}

        <div className="sm muted-txt" style={{ marginTop: 14 }}>
          {pase.tipo === 'recurrente' ? 'Pase recurrente' : 'Válido para un solo ingreso'}
          {' · '}{vencido ? 'vencido' : `vence ${fechaUtc(pase.expira).toLocaleString('es-VE')}`}
          {pase.ventana ? ` · ${pase.ventana}` : ''}
        </div>

        <div className="btn-row" style={{ marginTop: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={compartir}><Icon name="phone" />Compartir por WhatsApp</button>
          <button className="btn btn-ghost" onClick={() => copiarAlgo(enlace, 'Enlace')}>Copiar enlace</button>
        </div>
      </div>
    </Sheet>
  )
}

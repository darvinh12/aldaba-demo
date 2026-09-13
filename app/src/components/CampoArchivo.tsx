/** Campo para adjuntar un comprobante o una factura.
 *
 *  WEB: exactamente el mismo <input type="file"> de siempre — el navegador ya lo resuelve
 *  bien y no se le cambia ni una clase.
 *
 *  APP (EN_APP): botones propios en español ("Tomar foto", "Galería", "Archivo") que abren
 *  el plugin nativo. El selector del WebView salía en inglés y sin estilo ("Choose File /
 *  No file chosen"); el botón "Archivo" lo conserva escondido para los PDF, que la cámara
 *  no puede dar. */
import { useRef, useState } from 'react'
import { Icon } from './icons'
import { EN_APP } from '../plataforma'
import { capturarImagen, type OrigenImagen } from '../camara'
import { abrirAjustesDeLaApp } from '../permisos'

type Props = {
  /** Texto de la etiqueta, tal cual se ve hoy (p. ej. "Comprobante (captura)"). */
  etiqueta: string
  /** Prefijo del nombre del archivo generado por la cámara ('comprobante', 'factura'). */
  nombreBase: string
  /** El padre decide qué hacer con el archivo (subirArchivo y guardar la key). */
  onArchivo: (f?: File) => void
  /** Aviso para el toast del padre cuando la captura falla. */
  onError: (m: string) => void
  subiendo?: boolean
  adjunto?: boolean
  /** Confirmación en verde una vez subido (p. ej. "Comprobante adjuntado"). */
  textoAdjunto: string
}

export function CampoArchivo({ etiqueta, nombreBase, onArchivo, onError, subiendo, adjunto, textoAdjunto }: Props) {
  const refInput = useRef<HTMLInputElement>(null)
  const [abriendo, setAbriendo] = useState(false)
  const [permisoDenegado, setPermisoDenegado] = useState(false)

  const confirmacion = (
    <>
      {subiendo && <div className="hint">Subiendo…</div>}
      {adjunto && <div className="hint" style={{ color: 'var(--success)' }}>✓ {textoAdjunto}</div>}
    </>
  )

  if (!EN_APP) {
    return (
      <div className="field">
        <label>{etiqueta}</label>
        <input className="inp" type="file" accept="image/*,application/pdf" onChange={(e) => onArchivo(e.target.files?.[0])} />
        {confirmacion}
      </div>
    )
  }

  const capturar = async (origen: OrigenImagen) => {
    setAbriendo(true)
    try {
      const archivo = await capturarImagen(origen, nombreBase)
      if (archivo) { setPermisoDenegado(false); onArchivo(archivo) } // null = canceló, sin ruido
    } catch (e) {
      const error = e as Error
      setPermisoDenegado(error.name === 'PermisoDenegado')
      onError(error.message)
    } finally { setAbriendo(false) }
  }

  const ocupado = abriendo || !!subiendo
  return (
    <div className="field">
      <label>{etiqueta}</label>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => void capturar('camara')}>
          <Icon name="camera" size={16} />Tomar foto
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => void capturar('galeria')}>
          <Icon name="imagen" size={16} />Galería
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => refInput.current?.click()}>
          <Icon name="file" size={16} />Archivo
        </button>
      </div>
      {/* Sigue existiendo para los PDF: es el mismo input de la web, solo que sin mostrar su
          texto en inglés — lo dispara el botón "Archivo". */}
      <input ref={refInput} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { onArchivo(e.target.files?.[0]); e.target.value = '' }} />
      {abriendo && <div className="hint">Abriendo…</div>}
      {permisoDenegado && (
        <div className="hint">
          <button type="button" className="chip neutral" onClick={() => void abrirAjustesDeLaApp()}>Abrir ajustes del teléfono</button>
        </div>
      )}
      {confirmacion}
    </div>
  )
}

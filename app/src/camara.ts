/** Captura de imágenes con la cámara / galería del teléfono (solo app nativa Capacitor).
 *
 *  POR QUÉ EXISTE: en el WebView, un <input type="file"> se pinta con el selector del
 *  sistema ("Choose File / No file chosen"), en inglés y sin estilo. Con el plugin nativo
 *  el residente toca "Tomar foto" y le abre la cámara directamente.
 *
 *  El resultado se entrega como File para que subirArchivo() lo mande igual que hoy,
 *  sin tocar la API ni el worker.
 *
 *  El plugin se importa DINÁMICAMENTE y solo con EN_APP: la web nunca descarga este
 *  código de Capacitor. Ojo con la regla del arranque: aquí no se devuelve ni se espera
 *  ningún proxy de plugin, solo el RESULTADO de sus métodos. */
import { EN_APP } from './plataforma'
import { pedirPermisoCamara } from './permisos'

/** Mismo tope que valida el worker en PUT /api/media (500 KB). Se comprime para no chocarlo:
 *  rebotar la subida después de que el usuario ya tomó la foto es la peor experiencia posible. */
export const LIMITE_BYTES = 500 * 1024

/** Tipos que el worker acepta. Un HEIC de iPhone o un GIF no están: por eso se reconvierte. */
const MIMES_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp']

export type OrigenImagen = 'camara' | 'galeria'

/** Error con name='PermisoDenegado' para que la interfaz ofrezca abrir los Ajustes de la app:
 *  con el permiso ya negado el sistema no vuelve a mostrar su diálogo. */
function errorPermiso(mensaje: string): Error {
  const e = new Error(mensaje)
  e.name = 'PermisoDenegado'
  return e
}

/** base64 → Blob sin pasar por fetch(): la CSP empaquetada tiene connect-src acotado y
 *  un fetch a la URI capacitor:// de la foto quedaría bloqueado. */
function deBase64(b64: string, mime: string): Blob {
  const binario = atob(b64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Redibuja el mapa de bits a JPEG con un ancho máximo y una calidad dadas. */
function aJpeg(bitmap: ImageBitmap, anchoMax: number, calidad: number): Promise<Blob | null> {
  const escala = Math.min(1, anchoMax / bitmap.width)
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.max(1, Math.round(bitmap.width * escala))
  lienzo.height = Math.max(1, Math.round(bitmap.height * escala))
  const ctx = lienzo.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height)
  return new Promise((resolver) => lienzo.toBlob(resolver, 'image/jpeg', calidad))
}

/** Baja resolución y calidad en escalones hasta caber en `max`. Devuelve null si ni el
 *  escalón más agresivo alcanza (imagen rarísima): el que llama avisa en español. */
async function ajustarPeso(origen: Blob, max: number): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(origen) } catch { return null }
  try {
    // Primero se conserva el detalle (1600 px); solo si no cabe se va recortando.
    for (const ancho of [1600, 1280, 1024, 800, 640]) {
      for (const calidad of [0.72, 0.55, 0.4]) {
        const salida = await aJpeg(bitmap, ancho, calidad)
        if (salida && salida.size <= max) return salida
      }
    }
    return null
  } finally { bitmap.close() }
}

const marcaDeTiempo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** Abre la cámara o la galería del sistema y devuelve la imagen lista para subirArchivo().
 *
 *  Devuelve null si el usuario cerró sin elegir nada (cancelar no es un error que mostrar).
 *  Lanza Error con name='PermisoDenegado' si el permiso está negado, o Error normal si la
 *  imagen no logró caber en el límite. */
export async function capturarImagen(origen: OrigenImagen, nombreBase: string): Promise<File | null> {
  if (!EN_APP) throw new Error('La cámara nativa solo está disponible en la app')

  if (origen === 'camara') {
    // Se pide en el punto de uso, no al arrancar: el residente ya entiende para qué es.
    const permiso = await pedirPermisoCamara()
    if (permiso === 'denegado') throw errorPermiso('Aldaba no tiene permiso de cámara. Actívalo en los Ajustes del teléfono.')
  }

  let base64: string
  let formato: string
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const foto = await Camera.getPhoto({
      // width + quality hacen que el propio plugin entregue una imagen ya reducida:
      // evita cargar en memoria los 12 MP originales dentro del WebView.
      quality: 72,
      width: 1600,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.Base64,
      source: origen === 'camara' ? CameraSource.Camera : CameraSource.Photos,
      saveToGallery: false,
      promptLabelCancel: 'Cancelar',
      promptLabelHeader: 'Adjuntar imagen',
      promptLabelPhoto: 'Elegir de la galería',
      promptLabelPicture: 'Tomar foto',
    })
    base64 = foto.base64String ?? ''
    formato = foto.format || 'jpeg'
  } catch (e) {
    const texto = (e as Error)?.message ?? ''
    if (/cancel|no image|no media/i.test(texto)) return null
    if (/denied|permission|access/i.test(texto)) {
      throw errorPermiso(origen === 'camara'
        ? 'Aldaba no tiene permiso de cámara. Actívalo en los Ajustes del teléfono.'
        : 'Aldaba no tiene permiso para ver tus fotos. Actívalo en los Ajustes del teléfono.')
    }
    throw new Error('No se pudo abrir la cámara. Intenta de nuevo.')
  }
  if (!base64) return null

  const mime = `image/${formato === 'jpg' ? 'jpeg' : formato}`
  let datos: Blob = deBase64(base64, mime)

  // Si ya es un tipo que el worker acepta y cabe en el límite, se sube tal cual (mejor nitidez).
  if (!(MIMES_ACEPTADOS.includes(mime) && datos.size <= LIMITE_BYTES)) {
    const ajustada = await ajustarPeso(datos, LIMITE_BYTES)
    if (!ajustada) {
      throw new Error(`La imagen pesa ${Math.round(datos.size / 1024)} KB y no se pudo reducir por debajo de 500 KB. Toma la foto más de cerca o con menos resolución.`)
    }
    datos = ajustada
  }

  const extension = datos.type === 'image/png' ? 'png' : datos.type === 'image/webp' ? 'webp' : 'jpg'
  return new File([datos], `${nombreBase}-${marcaDeTiempo()}.${extension}`, { type: datos.type })
}

export type FilaUnidad = { torre: string; unidad: string; alicuota: number }

export function parseUnidadesCsv(texto: string): FilaUnidad[] {
  const limpio = texto.replace(/^﻿/, '')
  const lineas = limpio.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Delimitador ambiguo: la coma es a la vez separador de campo y separador decimal en VE.
  // Si el archivo usa ';' como separador (convención LatAm/Excel es-VE), la coma queda libre
  // para los decimales (1,5 = 1.5). Se decide una vez para todo el archivo, no por línea.
  const delim = limpio.includes(';') ? ';' : ','
  const filas: FilaUnidad[] = []
  lineas.forEach((linea, i) => {
    const campos = linea.split(delim).map((c) => c.trim())
    // Encabezado solo la 1ª línea y solo si la 2ª columna es "unidad": así una torre
    // llamada literalmente "Torre" sigue siendo importable.
    if (i === 0 && campos[0].toLowerCase() === 'torre' && campos[1]?.toLowerCase() === 'unidad') return
    if (campos.length < 2 || !campos[0] || !campos[1])
      throw new Error(`CSV inválido en línea ${i + 1}: se esperaba torre,unidad[,alicuota]`)
    const alicuota = campos[2] ? Number(campos[2].replace(',', '.')) : 0
    if (Number.isNaN(alicuota)) throw new Error(`CSV inválido en línea ${i + 1}: alícuota no numérica`)
    if (alicuota < 0) throw new Error(`CSV inválido en línea ${i + 1}: alícuota negativa`)
    filas.push({ torre: campos[0], unidad: campos[1], alicuota })
  })
  return filas
}

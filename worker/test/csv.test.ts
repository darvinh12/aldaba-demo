import { describe, it, expect } from 'vitest'
import { parseUnidadesCsv } from '../src/lib/csv'

describe('parseUnidadesCsv', () => {
  it('parsea torre,unidad,alicuota con encabezado opcional y BOM', () => {
    const csv = '﻿torre,unidad,alicuota\nA,1-A,0.5\nA,1-B,0.5\nB,PH,1.0\n'
    expect(parseUnidadesCsv(csv)).toEqual([
      { torre: 'A', unidad: '1-A', alicuota: 0.5 },
      { torre: 'A', unidad: '1-B', alicuota: 0.5 },
      { torre: 'B', unidad: 'PH', alicuota: 1.0 },
    ])
  })
  it('acepta ; como separador y alicuota ausente = 0', () => {
    expect(parseUnidadesCsv('A;2-A\nA;2-B;')).toEqual([
      { torre: 'A', unidad: '2-A', alicuota: 0 },
      { torre: 'A', unidad: '2-B', alicuota: 0 },
    ])
  })
  it('con ; como separador, la coma es decimal (1,5 = 1.5) y no parte la columna', () => {
    expect(parseUnidadesCsv('torre;unidad;alicuota\nA;PB;1,5\nA;PH;2,75')).toEqual([
      { torre: 'A', unidad: 'PB', alicuota: 1.5 },
      { torre: 'A', unidad: 'PH', alicuota: 2.75 },
    ])
  })
  it('reporta filas inválidas con número de línea', () => {
    expect(() => parseUnidadesCsv('A,1-A\nsolo-un-campo\n')).toThrow(/línea 2/)
  })
  it('rechaza alícuota negativa', () => {
    expect(() => parseUnidadesCsv('A,1-A,-0.5')).toThrow(/negativa/)
  })
  it('una torre llamada literalmente "Torre" es importable (encabezado solo si 2ª col = "unidad")', () => {
    // encabezado real: se descarta
    expect(parseUnidadesCsv('torre,unidad\nTorre,PB,1.0')).toEqual([{ torre: 'Torre', unidad: 'PB', alicuota: 1.0 }])
    // "torre,algo" a mitad de archivo es dato, no encabezado
    expect(parseUnidadesCsv('A,1-A\nTorre,2-B')).toEqual([
      { torre: 'A', unidad: '1-A', alicuota: 0 },
      { torre: 'Torre', unidad: '2-B', alicuota: 0 },
    ])
  })
})

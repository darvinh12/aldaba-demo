/** Plano gráfico de una torre: un cuadrito por apartamento, agrupados por piso.
 *
 *  Verde = habitado (la unidad tiene al menos un residente asociado), gris = vacío.
 *  El dato viene de `residentes` en GET /api/estructura.
 *
 *  DE DÓNDE SALE EL PISO. El esquema no guarda el piso, solo el nombre de la unidad
 *  ('N-3A', '1-A', '11A'), así que se deduce del primer grupo de dígitos del nombre.
 *  Acierta en los formatos que usa el sistema, pero es una lectura del nombre y no un
 *  dato duro: si ninguna unidad de la torre tiene números, el plano cae a una sola
 *  cuadrícula sin pisos en lugar de inventarse una distribución. Los pisos que no
 *  existen en los datos no se dibujan, así que una torre con unidades en los pisos 2 y
 *  6 muestra dos filas, no seis. */

type Unidad = { id: string; nombre: string; alicuota?: number; residentes?: number }

/** Primer grupo de dígitos del nombre. null si el nombre no trae ninguno. */
function pisoDe(nombre: string): number | null {
  const m = nombre.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Lo que se pinta dentro del cuadrito: la parte del nombre que distingue al
 *  apartamento dentro de su piso. De 'N-3A' deja 'A', de '1-A' deja 'A'. Si no queda
 *  nada legible, se usa el nombre completo. */
function etiquetaCorta(nombre: string): string {
  const cola = nombre.replace(/^[^\d]*\d+/, '').replace(/^[-\s.]+/, '')
  return cola || nombre
}

export function PlanoTorre({ nombre, unidades }: { nombre: string; unidades: Unidad[] }) {
  if (!unidades.length) return null

  const habitadas = unidades.filter((u) => (u.residentes ?? 0) > 0).length

  // Agrupación por piso. Si ni una sola unidad tiene número, no hay pisos que mostrar.
  const conPiso = unidades.filter((u) => pisoDe(u.nombre) !== null)
  const hayPisos = conPiso.length > 0

  const pisos = new Map<number, Unidad[]>()
  const sueltas: Unidad[] = []
  for (const u of unidades) {
    const p = pisoDe(u.nombre)
    if (p === null) sueltas.push(u)
    else pisos.set(p, [...(pisos.get(p) ?? []), u])
  }
  // De mayor a menor: el piso más alto arriba, como se ve una torre de verdad.
  const ordenados = [...pisos.entries()].sort((a, b) => b[0] - a[0])

  const Cuadro = ({ u }: { u: Unidad }) => {
    const viva = (u.residentes ?? 0) > 0
    return (
      <div
        className={`plano-apto ${viva ? 'viva' : 'vacia'}`}
        title={`${u.nombre} · ${viva ? `${u.residentes} residente${u.residentes! > 1 ? 's' : ''}` : 'sin residentes'}`}
        aria-label={`${u.nombre}, ${viva ? 'habitada' : 'vacía'}`}
      >
        {etiquetaCorta(u.nombre)}
      </div>
    )
  }

  return (
    <div className="plano-wrap">
      <div className="plano-cab">
        <span className="mono-label">Plano de {nombre}</span>
        <span className="plano-leyenda">
          <i className="plano-punto viva" aria-hidden="true" /> {habitadas} habitadas
          <i className="plano-punto vacia" style={{ marginLeft: 12 }} aria-hidden="true" /> {unidades.length - habitadas} vacías
        </span>
      </div>

      <div className="plano-torre">
        <div className="plano-techo" aria-hidden="true" />

        {hayPisos
          ? ordenados.map(([piso, us]) => (
              <div className="plano-piso" key={piso}>
                <span className="plano-num">{piso}</span>
                <div className="plano-aptos">
                  {us.map((u) => <Cuadro key={u.id} u={u} />)}
                </div>
              </div>
            ))
          : (
            <div className="plano-piso">
              <span className="plano-num" aria-hidden="true">·</span>
              <div className="plano-aptos">
                {unidades.map((u) => <Cuadro key={u.id} u={u} />)}
              </div>
            </div>
          )}

        {hayPisos && sueltas.length > 0 && (
          <div className="plano-piso">
            <span className="plano-num" title="Unidades cuyo nombre no indica piso">?</span>
            <div className="plano-aptos">
              {sueltas.map((u) => <Cuadro key={u.id} u={u} />)}
            </div>
          </div>
        )}

        <div className="plano-base" aria-hidden="true" />
      </div>
    </div>
  )
}

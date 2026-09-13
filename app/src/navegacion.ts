/** Historial de navegación propio para el botón atrás de la app nativa.
 *
 *  La SPA no usa router: cambia de vista con estado local (sección activa del
 *  Shell, modales, hojas). El WebView nunca acumula historial, así que el
 *  `canGoBack` de Capacitor era SIEMPRE false y el botón atrás minimizaba la
 *  app al primer toque. Aquí se lleva una pila propia: cada vista que se abre
 *  (cambio de sección, modal, hoja) se apila junto con la acción que la
 *  deshace, y el botón atrás (nativo.ts) las deshace en orden. Solo con la
 *  pila vacía —la raíz de la app— se ofrece salir, y nunca antes.
 *
 *  En la WEB no hace nada: apilarVista() es un no-op y el navegador conserva
 *  su comportamiento de siempre (el botón atrás del navegador no cambia). */
import { useEffect, useRef } from 'react'
import { EN_APP } from './plataforma'

type Entrada = { cerrar: () => void; tag?: string }
const pila: Entrada[] = []

/** Apila una vista abierta con la acción que la deshace (cerrar el modal,
 *  volver a la sección anterior). Devuelve la función para retirarla de la
 *  pila si la vista se cierra por su cuenta (botón ✕, clic fuera, Escape).
 *  `tag` (opcional) identifica entradas equivalentes: si ya hay una con el
 *  mismo tag se retira antes de apilar. Así alternar secciones (Inicio↔Pagos
 *  N veces) no llena la pila de repeticiones: queda a lo sumo UNA entrada por
 *  sección y el botón atrás llega a la raíz en pocos toques, no en N. */
export function apilarVista(cerrar: () => void, tag?: string): () => void {
  if (!EN_APP) return () => {}
  if (tag) {
    const previa = pila.findIndex((x) => x.tag === tag)
    if (previa >= 0) pila.splice(previa, 1)
  }
  const e: Entrada = { cerrar, tag }
  pila.push(e)
  return () => {
    const i = pila.indexOf(e)
    if (i >= 0) pila.splice(i, 1)
  }
}

/** Botón atrás: deshace la vista más reciente. false = pila vacía (raíz de la
 *  app); el que llama decide qué sigue (nativo.ts ofrece salir con diálogo). */
export function volverAtras(): boolean {
  const e = pila.pop()
  if (!e) return false
  try { e.cerrar() } catch { /* una vista rota no debe bloquear el botón atrás */ }
  return true
}

/** Hook para overlays controlados por estado: mientras `abierta` sea true la
 *  vista queda apilada y el botón atrás la cierra llamando `cerrar`. */
export function useVistaAtras(abierta: boolean, cerrar: () => void): void {
  const ref = useRef(cerrar)
  ref.current = cerrar
  useEffect(() => {
    if (!abierta) return
    return apilarVista(() => ref.current())
  }, [abierta])
}

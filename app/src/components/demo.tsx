/** Autolimpieza de la bandera pegajosa: si la sesión activa alcanza algún
 *  condominio real, este dispositivo no es de demostración. Se llama con los
 *  condominios de /me tras cada carga de sesión. */
export function apagarDemoSiSesionReal(condos: { es_demo?: number }[]) {
  if (condos.length > 0 && !condos.every((c) => c.es_demo === 1)) {
    try { localStorage.removeItem('aldaba_demo') } catch { /* noop */ }
  }
}

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** CSP para el HTML empaquetado (APK/IPA): dentro de Capacitor no hay cabeceras de Cloudflare
 *  (app/public/_headers no aplica), así que el index.html de build lleva su propia meta-CSP con
 *  connect-src al worker real. Se inyecta SOLO en build: en `vite dev` una meta estática rompería
 *  el HMR (websocket ws://localhost) y el preámbulo inline de react-refresh. En la web servida por
 *  Cloudflare conviven meta y cabecera: el navegador aplica AMBAS (gana la intersección), y esta
 *  meta es un superconjunto de lo que la web usa, por lo que su comportamiento no cambia. */
const API_REAL = 'https://aldaba-demo.arondon33.workers.dev'
const CSP_EMPAQUETADA = [
  `default-src 'self'`,
  `script-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `font-src 'self'`,
  `img-src 'self' data: blob: ${API_REAL}`,
  `connect-src 'self' ${API_REAL}`,
  `media-src 'self' blob: ${API_REAL}`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join('; ')

function cspEmpaquetada(): Plugin {
  return {
    name: 'aldaba-csp-empaquetada',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_EMPAQUETADA },
          injectTo: 'head-prepend',
        }],
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cspEmpaquetada()],
  build: {
    outDir: '../worker/public', emptyOutDir: true,
    // TARGET EXPLÍCITO, Y NO ES UN DETALLE. Vite 6 compila por defecto a
    // 'baseline-widely-available', que es Safari 16 — mientras el proyecto de iOS declara
    // MinimumOSVersion 14.0. Con esa combinación un iPhone con iOS 14 o 15 INSTALA la app y
    // después no arranca: el navegador no entiende el JavaScript. Se fija a safari14 para
    // que lo que se promete y lo que funciona sean lo mismo.
    // En Venezuela hay muchos teléfonos viejos; bajar el objetivo cuesta unos kilobytes y
    // gana desde el iPhone 6s (2015) en adelante, que con Safari 16 quedaban fuera.
    target: ['safari14', 'chrome87', 'firefox78', 'edge88'],
  },
  server: { proxy: { '/api': 'http://localhost:8787' } },
})

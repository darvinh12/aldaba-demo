export type Env = {
  DB: D1Database
  /** opcional hasta que el token CF tenga permiso R2 y exista el bucket (ver DESPLIEGUE.local.md) */
  MEDIA?: R2Bucket
  ASSETS: Fetcher
  SESSION_SECRET: string
  /** opcional: si está, la mensajería por correo envía vía Resend; si no, queda como pendiente */
  RESEND_API_KEY?: string
  /** opcional: PAT de SOLO LECTURA (Contents) del repo privado, para que /api/apk sirva el
   *  APK del último GitHub Release; sin él la descarga responde 503 con motivo claro */
  GITHUB_TOKEN_RELEASES?: string
}
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers/config').D1Migration[]
  }
}

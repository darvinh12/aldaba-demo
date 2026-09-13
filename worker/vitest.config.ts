import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'

// Los tests aplican las MISMAS migraciones que producción (via applyD1Migrations en helpers),
// garantizando que la suite corre el esquema real y no una copia que puede divergir.
export default defineWorkersConfig(async () => {
  const migraciones = await readD1Migrations(path.join(__dirname, 'migrations'))
  return {
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            d1Databases: ['DB'],
            r2Buckets: ['MEDIA'],
            // RESEND_API_KEY vacío a propósito: los tests NUNCA deben enviar correo real
            // (aunque .dev.vars tenga la clave para desarrollo local).
            bindings: { SESSION_SECRET: 'test', RESEND_API_KEY: '', TEST_MIGRATIONS: migraciones },
          },
        },
      },
    },
  }
})

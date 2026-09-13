# Aldaba

Sistema de gestión de condominios. Una administradora opera uno o varios edificios desde la misma cuenta, y cada quien entra a lo suyo: la junta lleva las finanzas, la portería controla la entrada, y el propietario ve su estado de cuenta y autoriza a sus visitantes.

Este repositorio es una demostración pública con datos ficticios, preparada para mostrar el sistema funcionando. No tiene relación con ningún condominio real ni contiene información de personas reales.

## Entrar

**https://aldaba-demo.arondon33.workers.dev**

| Usuario | Clave |
|---|---|
| `Demo` | `Demo1234` |

La cuenta funciona escribiendo `Demo`, `demo` o `DEMO`, sin importar las mayúsculas. Una vez adentro hay un selector en la barra superior que cambia entre los cuatro roles sin salir de la sesión, así se recorre el sistema completo sin manejar varias cuentas.

## Qué hace cada rol

| Rol | Qué ve |
|---|---|
| Junta de condominio | Los dos edificios de la junta, con sus finanzas y su gente |
| Administración | Un edificio: cuotas, pagos por conciliar, gastos, morosidad, propietarios, comunicados |
| Portería | La cola de accesos, el escáner de pases, paquetería, citófono y alertas |
| Residente | Su estado de cuenta, sus pases de visita, reservas de áreas comunes y votaciones |

Los datos sembrados son la Junta de Condominio Residencias El Ávila, con dos edificios, unidades, propietarios, seis meses de cuotas emitidas con sus pagos, comunicados, reservas y una votación ponderada por alícuota.

## Cómo está hecho

Un solo Worker de Cloudflare sirve la API y la aplicación web compilada. No hay servidor que administrar ni contenedores que levantar.

| Pieza | Tecnología |
|---|---|
| API y archivos estáticos | Cloudflare Workers con Hono y TypeScript |
| Base de datos | D1, que es SQLite, con aislamiento por condominio y esquema versionado en migraciones |
| Interfaz | React 18 con Vite |
| Sesiones | Guardadas en la base, con cookie firmada por HMAC |
| Autenticación | PBKDF2 con límite de intentos y permisos por rol |

La seguridad está en el diseño y no encima. Cada consulta va acotada al condominio de quien pregunta, todo pasa por sentencias preparadas, y las acciones quedan registradas para auditoría. El detalle del modelo de datos está en [docs/ESQUEMA.md](docs/ESQUEMA.md), con las 31 tablas y su diagrama.

## Correr en local

Hace falta Node 20 o superior.

```bash
# API y aplicación juntas en el puerto 8787, con base local
cd worker && npm install && npx wrangler dev

# Opcional: interfaz con recarga en caliente en el 5173
cd app && npm install && npm run dev

# Pruebas del backend, sobre una base D1 real con las migraciones aplicadas
cd worker && npx vitest run --no-file-parallelism
```

Las pruebas son 214 sobre 23 archivos y cubren el aislamiento entre condominios, los permisos por rol, el ciclo de sesión y las restricciones del esquema. Conviene correrlas con `--no-file-parallelism`, porque en Windows la ejecución en paralelo levanta demasiados procesos a la vez y produce fallos por agotamiento de recursos que no tienen que ver con el código.

## Documentación

El [manual de uso](docs/MANUAL.md) explica el sistema rol por rol y módulo por módulo. El [esquema](docs/ESQUEMA.md) documenta el modelo de datos, y [docs/esquema-consolidado.sql](docs/esquema-consolidado.sql) reúne todo el SQL comentado en un archivo.

## Licencia

MIT. Ver [LICENSE](LICENSE).

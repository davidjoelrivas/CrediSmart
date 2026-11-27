# Despliegue de CrediSmart (un solo servicio)

CrediSmart corre como **un único servicio Node**: la API (`/api/v1/*`) y la aplicación web compilada salen del mismo proceso y la misma dirección. La base de datos es PostgreSQL en Supabase (ver `supabase.md`).

## Qué necesita el servicio

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` + `DATABASE_PASSWORD` | Sí | Conexión a Supabase (Session pooler) |
| `FIELD_ENCRYPTION_KEY`, `FIELD_HASH_KEY` | Sí | Cifrado del DNI. **Deben ser las mismas que se usaron al crear los datos**: con otras llaves, los DNI existentes no se pueden leer |
| `NODE_ENV=production` | Sí | Cookies seguras, HSTS y registros en JSON |
| `PUBLIC_BASE_URL` | Sí | Dirección `https://…` pública. Es la que lleva el QR de los recibos |
| `PORT` | No | Lo define la plataforma |

En producción el servidor se niega a arrancar si `PUBLIC_BASE_URL` no empieza con `https://`.

## Opción A (recomendada): Render o Railway con el Dockerfile

1. Crea una cuenta y conecta el repositorio de GitHub.
2. Crea un **Web Service** con el `Dockerfile` de la raíz del repositorio.
3. Pega las variables de la tabla de arriba en el panel de la plataforma (nunca en el repositorio).
4. Comprobación de salud: ruta `/api/v1/health`.
5. Cuando la plataforma te dé la URL (`https://algo.onrender.com`), ponla en `PUBLIC_BASE_URL` y vuelve a desplegar.
6. Abre la URL e inicia sesión con un usuario de la demo.

> El plan gratuito de Render duerme el servicio tras 15 minutos sin tráfico y tarda ~1 minuto en despertar. Para la feria, abre la página 5 minutos antes (o paga el plan más barato).

## Opción B (plan de emergencia): túnel desde tu computadora

Si la nube falla el día de la feria, tu computadora puede servir el sistema (sigue usando la base de datos de Supabase) y `cloudflared` le da una dirección `https` temporal:

```powershell
cd C:\Users\DAVID\Desktop\dev\CrediSmart
pnpm build
$env:NODE_ENV="production"; $env:PUBLIC_BASE_URL="https://TU-DIRECCION.trycloudflare.com"
pnpm start
# en otra terminal:
cloudflared tunnel --url http://localhost:3000
```

`PUBLIC_BASE_URL` debe ser la dirección que imprime `cloudflared`. Los QR de recibos creados con otra dirección dejarán de abrir: usa la misma durante toda la demostración.

## Antes de usar con datos reales

- [ ] Rotar las llaves y la contraseña de la base de datos (estuvieron en una conversación).
- [ ] Pasar Supabase a un plan con respaldos automáticos (el gratuito no los tiene y pausa el proyecto tras ~1 semana sin uso) o programar `pnpm --filter @app/api db:backup`.
- [ ] Crear al dueño real con `pnpm --filter @app/api users:create` (no usar los usuarios `@demo.credismart.app`).
- [ ] Que un abogado apruebe el texto del contrato y pagaré (hoy es un borrador y cada página lo dice).
- [ ] Confirmar con el abogado el tope legal de tasa y configurarlo en la organización.

## Operación diaria

- **Mora:** el servidor la recalcula solo cada hora (y también con el botón "Recalcular mora" del tablero).
- **Salud de la base de datos:** `pnpm --filter @app/api db:check`.
- **Nuevo usuario / contraseña olvidada:** `users:create` y `users:reset-password` (cierra las sesiones abiertas de esa persona).
- **Respaldo:** `pnpm --filter @app/api db:backup` (queda en `backups/`, fuera de Git).

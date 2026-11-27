# Entorno de producción: PostgreSQL en Supabase

El sistema usa **PostgreSQL** con SQL escrito a mano (sin ORM). Supabase solo aporta el servidor administrado: el código se conecta con una cadena de conexión normal y **no usa** la API REST, el SDK ni la autenticación de Supabase.

## Un solo entorno
Hay una única base real (producción). Las pruebas automáticas **nunca** se conectan a ella: usan un PostgreSQL local y se niegan a correr contra un servidor remoto.

## Puesta en marcha (una vez)
1. En supabase.com, dentro de **tu propia organización**, crear un proyecto nuevo. Elegir la región más cercana y una contraseña fuerte para la base.
2. Botón **Connect** → **Session pooler** → copiar la cadena de conexión.
3. Crear el archivo `.env` en la raíz del repositorio a partir de `.env.example` y pegar `DATABASE_URL`.
4. Generar las llaves de cifrado y pegarlas en `.env`:
   ```bash
   pnpm --filter @app/api keys:generate
   ```
5. Aplicar el esquema y verificarlo:
   ```bash
   pnpm --filter @app/api db:migrate
   pnpm --filter @app/api db:check
   ```
   `db:check` debe terminar con **"Todo en orden"**: conexión cifrada, 5 de 5 migraciones y seguridad por fila activa en todas las tablas.
6. (Opcional, para demostraciones) crear la organización demo con datos **ficticios**:
   ```bash
   pnpm --filter @app/api db:seed:demo
   ```

## Seguridad
- **Las tablas no son públicas.** Supabase expone por internet las tablas del esquema `public` a los roles `anon` y `authenticated`. La migración `0005_security.sql` activa la seguridad por fila (RLS) sin políticas y les quita todos los permisos: para esos roles el resultado es "negar todo". El servidor se conecta como dueño de las tablas y no se ve afectado. Una prueba automática falla si una migración futura crea una tabla sin RLS.
- **Conexión cifrada (SSL)** obligatoria con cualquier servidor que no sea local.
- **Datos sensibles cifrados** a nivel de campo (AES-256-GCM): el DNI de los clientes se guarda cifrado y se busca por una huella (HMAC) con una llave distinta.
- **Nunca** poner en el código ni en el repositorio: la contraseña de la base, la llave `service_role` de Supabase ni las llaves de cifrado. Solo van en `.env` (ignorado por Git) y en las variables de entorno del hosting.
- Pagos, repartos, recibos, asientos y bitácora son **inmutables** (triggers de la base) y la contabilidad cuadra por diseño (trigger diferido).
- Si se pierden `FIELD_ENCRYPTION_KEY` y `FIELD_HASH_KEY`, los datos cifrados **no se pueden recuperar**: guardar una copia en un lugar seguro.

## Respaldos
El plan gratuito de Supabase no incluye respaldos automáticos (verificar en la página de precios vigente). Mientras tanto:
```bash
pnpm --filter @app/api db:backup      # crea backups/credit-smart-AAAA-MM-DD-HHMM.dump
```
Requiere `pg_dump` (variable `PG_DUMP_PATH` si no está en el PATH). Los respaldos contienen datos de clientes: guardarlos en un lugar seguro, nunca en Git. Para restaurar en una base vacía:
```bash
pg_restore --no-owner --dbname "postgres://..." backups/credit-smart-....dump
```

## Antes de una demostración pública
- Usar la organización **demo** (datos ficticios). No mostrar datos reales de los clientes.
- Ejecutar `db:check` y `db:backup` el día anterior.
- Los proyectos del plan gratuito se pausan tras una semana sin uso: abrir el sistema en los días previos.

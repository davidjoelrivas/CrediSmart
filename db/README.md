# Base de datos

PostgreSQL con SQL escrito a mano (sin ORM, usando el driver `pg`). El esquema vive en `migrations/` como archivos versionados.

## Migraciones
- Archivos `NNNN_nombre.sql`, aplicados en orden por el ejecutor (`apps/api/src/shared/infrastructure/postgres/migrator.ts`).
- Cada migración corre dentro de una transacción: si falla a mitad, no queda nada a medias.
- Cada migración aplicada guarda su checksum: **no se editan**, se agrega una nueva. Si un archivo aplicado cambia, el ejecutor se detiene.
- Un candado de PostgreSQL (`pg_advisory_lock`) evita que dos procesos migren a la vez.

## Comandos (desde `apps/api`)
```bash
pnpm db:migrate     # lee DATABASE_URL del archivo .env de la raíz
pnpm db:check       # verifica migraciones, cifrado de la conexión y seguridad por fila
pnpm db:backup      # respaldo con pg_dump hacia backups/
pnpm db:seed:demo   # organización demo con datos ficticios
pnpm keys:generate  # llaves para el cifrado de datos sensibles
pnpm test               # pruebas unitarias (no necesitan base de datos)
pnpm test:integration   # pruebas contra PostgreSQL real; crean y migran la base credit_smart_test
```
Ver `.env.example` para las variables de entorno y `docs/operaciones/supabase.md` para el entorno de producción. La misma cadena de conexión sirve para un PostgreSQL local, para Supabase o para cualquier hosting de Postgres.

## Convenciones
- Ids: `uuid` (versión 7). Dinero: `bigint` en centavos. Tasas: puntos base.
- Fechas de negocio: `date`. Instantes: `timestamptz`.
- `organization_id` en cada tabla de negocio, primero en los índices.
- Pagos, repartos, recibos, asientos y bitácora son **inmutables** (triggers `BEFORE UPDATE OR DELETE`).
- La contabilidad cuadra por diseño: un trigger diferido rechaza al confirmar cualquier asiento cuyos débitos no igualen a sus créditos.
- Toda tabla nueva en `public` debe activar la seguridad por fila (RLS); una prueba automática lo exige (ver `0005_security.sql`).

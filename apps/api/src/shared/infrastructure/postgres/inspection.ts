import type { Executor } from "./sql";
import { asString, selectRows } from "./sql";

export interface DatabaseInspection {
  version: string;
  currentUser: string;
  /** Si la conexión actual viaja cifrada. */
  encrypted: boolean;
  tables: string[];
  /** Tablas del esquema público sin seguridad por fila: deberían ser ninguna. */
  tablesWithoutRowSecurity: string[];
  appliedMigrations: string[];
  /** Permisos que los roles públicos de Supabase (anon, authenticated) tienen sobre las tablas: deberían ser ninguno. */
  exposedRoleAccess: string[];
  /** Verdadero si no hay nada que corregir. */
  healthy: boolean;
  problems: string[];
}

/**
 * Revisa que la base esté lista para producción: migraciones aplicadas, seguridad por fila en
 * todas las tablas y conexión cifrada cuando no es local. Se usa en `pnpm db:check`.
 */
export async function inspectDatabase(db: Executor, expectedMigrations: number): Promise<DatabaseInspection> {
  const [info] = await selectRows(
    db,
    `SELECT version() AS version, current_user AS current_user,
            COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS encrypted`,
  );
  const tables = (
    await selectRows(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
  ).map((row) => asString(row.tablename));
  const withoutRls = (
    await selectRows(
      db,
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY c.relname`,
    )
  ).map((row) => asString(row.relname));

  const exposedRoleAccess = (
    await selectRows(
      db,
      `SELECT r.rolname || ' puede ' || p.privilege || ' en ' || t.tablename AS access
       FROM pg_roles r
       CROSS JOIN pg_tables t
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
       WHERE r.rolname IN ('anon', 'authenticated') AND t.schemaname = 'public'
         AND has_table_privilege(r.rolname, format('public.%I', t.tablename), p.privilege)
       ORDER BY r.rolname, t.tablename, p.privilege`,
    )
  ).map((row) => asString(row.access));

  let appliedMigrations: string[] = [];
  const problems: string[] = [];
  if (tables.includes("schema_migrations")) {
    appliedMigrations = (await selectRows(db, "SELECT name FROM schema_migrations ORDER BY version")).map((row) =>
      asString(row.name),
    );
  }
  if (appliedMigrations.length < expectedMigrations) {
    problems.push(`Faltan migraciones: hay ${appliedMigrations.length} aplicadas y se esperaban ${expectedMigrations}.`);
  }
  if (withoutRls.length > 0) {
    problems.push(`Tablas sin seguridad por fila: ${withoutRls.join(", ")}.`);
  }
  if (exposedRoleAccess.length > 0) {
    problems.push(`Los roles públicos tienen acceso a las tablas (${exposedRoleAccess.length} permisos): ${exposedRoleAccess[0]}...`);
  }

  return {
    version: asString(info!.version),
    currentUser: asString(info!.current_user),
    encrypted: info!.encrypted === true,
    tables,
    tablesWithoutRowSecurity: withoutRls,
    appliedMigrations,
    exposedRoleAccess,
    healthy: problems.length === 0,
    problems,
  };
}

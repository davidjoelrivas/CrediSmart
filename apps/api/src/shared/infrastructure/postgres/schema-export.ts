import { asString, selectRows, type Executor } from "./sql";

export interface ColumnModel {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface TableModel {
  name: string;
  /** Seguridad por fila activada. */
  rowSecurity: boolean;
  columns: ColumnModel[];
  /** Llaves primarias, únicas, foráneas y reglas CHECK, con su definición exacta. */
  constraints: Array<{ name: string; kind: string; definition: string }>;
  indexes: Array<{ name: string; definition: string }>;
  triggers: Array<{ name: string; definition: string }>;
}

export interface DataModel {
  engine: string;
  migrations: string[];
  tables: TableModel[];
}

const CONSTRAINT_KINDS: Record<string, string> = {
  p: "PRIMARY KEY",
  u: "UNIQUE",
  f: "FOREIGN KEY",
  c: "CHECK",
  x: "EXCLUDE",
};

/**
 * Lee el esquema REAL de la base de datos (no una descripción escrita a mano) y lo devuelve como un objeto
 * listo para guardar en JSON: tablas, columnas, restricciones, índices, triggers y seguridad por fila.
 * El orden es siempre el mismo, así que dos exportaciones del mismo esquema son idénticas.
 */
export async function exportDataModel(db: Executor): Promise<DataModel> {
  const [version] = await selectRows(db, "SHOW server_version");
  const migrations = await selectRows(db, "SELECT name FROM schema_migrations ORDER BY name");

  const tables = await selectRows(
    db,
    `SELECT c.relname AS name, c.relrowsecurity AS row_security
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
  );
  const columns = await selectRows(
    db,
    `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const constraints = await selectRows(
    db,
    `SELECT c.relname AS table_name, k.conname AS name, k.contype AS kind, pg_get_constraintdef(k.oid) AS definition
     FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' ORDER BY c.relname, k.contype, k.conname`,
  );
  const indexes = await selectRows(
    db,
    "SELECT tablename AS table_name, indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
  );
  const triggers = await selectRows(
    db,
    `SELECT c.relname AS table_name, t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
  );

  const typeOf = (row: Record<string, unknown>) => {
    const base = asString(row.data_type) === "USER-DEFINED" ? asString(row.udt_name) : asString(row.data_type);
    return row.character_maximum_length ? `${base}(${asString(row.character_maximum_length)})` : base;
  };

  return {
    engine: `PostgreSQL ${asString(version!.server_version).split(" ")[0]}`,
    migrations: migrations.map((row) => asString(row.name)),
    tables: tables.map((table) => {
      const name = asString(table.name);
      const of = (rows: Array<Record<string, unknown>>) => rows.filter((row) => asString(row.table_name) === name);
      return {
        name,
        rowSecurity: Boolean(table.row_security),
        columns: of(columns).map((row) => ({
          name: asString(row.column_name),
          type: typeOf(row),
          nullable: asString(row.is_nullable) === "YES",
          default: row.column_default === null ? null : asString(row.column_default),
        })),
        constraints: of(constraints).map((row) => ({
          name: asString(row.name),
          kind: CONSTRAINT_KINDS[asString(row.kind)] ?? asString(row.kind),
          definition: asString(row.definition),
        })),
        indexes: of(indexes).map((row) => ({ name: asString(row.name), definition: asString(row.definition) })),
        triggers: of(triggers).map((row) => ({ name: asString(row.name), definition: asString(row.definition) })),
      };
    }),
  };
}

/** Columnas que nunca salen en una exportación de datos: contraseñas, tokens y datos cifrados o sus huellas. */
const SECRET_COLUMN = /(_enc|_hash|password|token)/i;

/**
 * Exporta las filas de UNA organización (normalmente la demo) como JSON, quitando todo lo secreto.
 * Solo incluye tablas que tienen `organization_id`; las tablas hijas sin esa columna (cuotas de un pago, líneas
 * de un asiento) se pueden reconstruir desde sus padres.
 */
export async function exportOrganizationData(
  db: Executor,
  organizationId: string,
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const tables = await selectRows(
    db,
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name`,
  );
  const result: Record<string, Array<Record<string, unknown>>> = {};
  for (const { table_name } of tables) {
    const name = asString(table_name);
    // El nombre de la tabla viene del catálogo de la base de datos (no de una persona) y se cita como identificador.
    const rows = await selectRows(db, `SELECT * FROM "${name.replace(/"/g, '""')}" WHERE organization_id = $1`, [organizationId]);
    result[name] = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([column, value]) => [
          column,
          SECRET_COLUMN.test(column) ? "[oculto]" : Buffer.isBuffer(value) ? "[binario]" : value instanceof Date ? value.toISOString() : value,
        ]),
      ),
    );
  }
  return result;
}

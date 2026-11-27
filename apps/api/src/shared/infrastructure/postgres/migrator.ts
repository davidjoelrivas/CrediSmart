import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { clientOptions, type DatabaseConfig } from "./connection";

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
/** Número fijo para el candado de PostgreSQL (pg_advisory_lock). */
const LOCK_KEY = 874_221_001;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationResult {
  /** Migraciones que se aplicaron en esta ejecución. */
  applied: string[];
  /** Migraciones que ya estaban aplicadas y no cambiaron. */
  alreadyApplied: string[];
}

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
}

/**
 * Aplica en orden los archivos `NNNN_nombre.sql` que todavía no se aplicaron. Cada migración
 * corre dentro de una transacción: si falla a mitad, no queda nada a medias. Guarda el
 * checksum de cada una: si un archivo ya aplicado cambia, se detiene (las migraciones no se
 * editan; se agrega una nueva). Un candado evita que dos procesos migren a la vez.
 */
export async function runMigrations(
  config: DatabaseConfig,
  migrationsDirectory: string,
): Promise<MigrationResult> {
  const files = (await readdir(migrationsDirectory)).filter((name) => MIGRATION_FILE.test(name)).sort();

  const client = new pg.Client(clientOptions(config));
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    varchar(10)  PRIMARY KEY,
         name       varchar(160) NOT NULL,
         checksum   char(64)     NOT NULL,
         applied_at timestamptz  NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query("SELECT version, checksum FROM schema_migrations");
    const known = new Map<string, string>(rows.map((row) => [String(row.version), String(row.checksum)]));

    const result: MigrationResult = { applied: [], alreadyApplied: [] };
    for (const file of files) {
      const version = MIGRATION_FILE.exec(file)![1]!;
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const checksum = checksumOf(sql);

      const previous = known.get(version);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new MigrationError(
            `La migración ${file} ya se aplicó y su contenido cambió. No se editan: agregá una migración nueva.`,
          );
        }
        result.alreadyApplied.push(file);
        continue;
      }

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
          version,
          file,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

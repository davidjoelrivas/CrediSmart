import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { parseDatabaseUrl, type DatabaseConfig } from "../../shared/infrastructure/postgres/connection";
import { runStatement } from "../../shared/infrastructure/postgres/sql";
import { newUuidV7 } from "../../shared/infrastructure/postgres/uuid";

export const TEST_DATABASE_NAME = "credit_smart_test";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Servidor PostgreSQL para pruebas: por defecto el local con el usuario postgres sin clave.
 * Las pruebas de integración crean y borran bases de datos, así que SOLO pueden correr contra un
 * servidor local: esta protección evita apuntarlas por error a la base de producción.
 */
export function adminConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const config = parseDatabaseUrl(env.POSTGRES_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5432/postgres");
  if (!LOCAL_HOSTS.includes(config.host)) {
    throw new Error(
      `Las pruebas de integración solo pueden usar un PostgreSQL local, pero POSTGRES_ADMIN_URL apunta a "${config.host}". ` +
        "Nunca las corras contra la base de producción.",
    );
  }
  return config;
}

export function testDatabaseConfig(): DatabaseConfig {
  return { ...adminConfig(), database: TEST_DATABASE_NAME };
}

export const migrationsDirectory = fileURLToPath(new URL("../../../../../db/migrations", import.meta.url));

export interface SeededOrganization {
  organizationId: string;
  borrowerId: string;
}

/**
 * Cada prueba trabaja con su propia organización nueva: así las pruebas no se estorban
 * entre sí y de paso se verifica el aislamiento entre organizaciones.
 */
export async function seedOrganization(
  pool: Pool,
  options: { aprCapBp?: number | null } = {},
): Promise<SeededOrganization> {
  const organizationId = newUuidV7();
  const borrowerId = newUuidV7();

  await runStatement(pool, "INSERT INTO organizations (id, name, legal_apr_cap_bp) VALUES ($1, $2, $3)", [
    organizationId,
    `Organización de prueba ${organizationId.slice(-6)}`,
    options.aprCapBp ?? null,
  ]);
  await runStatement(
    pool,
    `INSERT INTO borrowers (id, organization_id, full_name, national_id_enc, national_id_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      borrowerId,
      organizationId,
      "Cliente de prueba",
      randomBytes(32),
      createHash("sha256").update(borrowerId).digest("hex"),
    ],
  );
  return { organizationId, borrowerId };
}

import pg from "pg";
import { clientOptions } from "../../shared/infrastructure/postgres/connection";
import { runMigrations } from "../../shared/infrastructure/postgres/migrator";
import {
  adminConfig,
  migrationsDirectory,
  TEST_DATABASE_NAME,
  testDatabaseConfig,
} from "./test-database";

/** Antes de las pruebas de integración: recrea la base de pruebas desde cero y le aplica las migraciones. */
export default async function setup(): Promise<void> {
  const client = new pg.Client(clientOptions(adminConfig()));
  await client.connect();
  try {
    // Imita los roles que Supabase ya trae, para poder probar que la migración de seguridad los deja sin acceso.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$;`);
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE_NAME} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEST_DATABASE_NAME} ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await client.end();
  }
  await runMigrations(testDatabaseConfig(), migrationsDirectory);
}

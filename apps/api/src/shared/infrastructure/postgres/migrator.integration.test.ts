import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminConfig, migrationsDirectory } from "../../../testing/postgres/test-database";
import { clientOptions } from "./connection";
import { MigrationError, runMigrations } from "./migrator";

const SCRATCH_DATABASE = "credit_smart_migrator_test";
const scratchConfig = () => ({ ...adminConfig(), database: SCRATCH_DATABASE });

async function recreateScratchDatabase(): Promise<void> {
  const client = new pg.Client(clientOptions(adminConfig()));
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${SCRATCH_DATABASE} ENCODING 'UTF8' TEMPLATE template0`);
  await client.end();
}

async function tablesOf(database: string): Promise<string[]> {
  const client = new pg.Client(clientOptions({ ...adminConfig(), database }));
  await client.connect();
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  await client.end();
  return rows.map((row) => String(row.table_name));
}

describe("runMigrations", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "migraciones-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("aplica las migraciones reales del proyecto y la segunda vez no hace nada", async () => {
    await recreateScratchDatabase();

    const first = await runMigrations(scratchConfig(), migrationsDirectory);
    const second = await runMigrations(scratchConfig(), migrationsDirectory);

    expect(first.applied).toEqual([
      "0001_foundation.sql",
      "0002_lending.sql",
      "0003_collections.sql",
      "0004_accounting_and_audit.sql",
      "0005_security.sql",
    ]);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toHaveLength(5);
  });

  it("crea todas las tablas del esquema", async () => {
    expect(await tablesOf(SCRATCH_DATABASE)).toEqual(
      [
        "audit_chain_heads",
        "audit_log",
        "borrowers",
        "installments",
        "journal_entries",
        "journal_lines",
        "loan_counters",
        "loans",
        "organizations",
        "payment_allocations",
        "payments",
        "receipt_counters",
        "receipts",
        "schema_migrations",
      ].sort(),
    );
  });

  it("aplica solo las migraciones nuevas, en orden", async () => {
    await recreateScratchDatabase();
    await writeFile(join(directory, "0001_primera.sql"), "CREATE TABLE a (id int PRIMARY KEY);");
    await runMigrations(scratchConfig(), directory);

    await writeFile(join(directory, "0002_segunda.sql"), "CREATE TABLE b (id int PRIMARY KEY);");
    const result = await runMigrations(scratchConfig(), directory);

    expect(result.applied).toEqual(["0002_segunda.sql"]);
    expect(result.alreadyApplied).toEqual(["0001_primera.sql"]);
  });

  it("se detiene si una migración ya aplicada fue editada", async () => {
    await writeFile(join(directory, "0001_primera.sql"), "CREATE TABLE a (id int PRIMARY KEY, extra int);");

    await expect(runMigrations(scratchConfig(), directory)).rejects.toThrow(MigrationError);
  });

  it("una migración que falla a mitad no deja nada a medias", async () => {
    await recreateScratchDatabase();
    await rm(join(directory, "0002_segunda.sql"), { force: true });
    await writeFile(join(directory, "0001_primera.sql"), "CREATE TABLE a (id int PRIMARY KEY);");
    await writeFile(
      join(directory, "0002_rota.sql"),
      "CREATE TABLE tabla_buena (id int PRIMARY KEY); CREATE TABLE tabla_mala (id tipo_que_no_existe);",
    );

    await expect(runMigrations(scratchConfig(), directory)).rejects.toThrow();

    expect(await tablesOf(SCRATCH_DATABASE)).toEqual(["a", "schema_migrations"]);
  });

  it("ignora los archivos que no siguen el formato NNNN_nombre.sql", async () => {
    await recreateScratchDatabase();
    await rm(join(directory, "0002_rota.sql"), { force: true });
    await writeFile(join(directory, "notas.txt"), "no es una migración");
    await writeFile(join(directory, "borrador.sql"), "DROP DATABASE todo;");

    const result = await runMigrations(scratchConfig(), directory);

    expect(result.applied).toEqual(["0001_primera.sql"]);
  });
});

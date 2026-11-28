import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseConfig } from "../../../testing/postgres/test-database";
import { clientOptions } from "./connection";
import { inspectDatabase } from "./inspection";

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client(clientOptions(testDatabaseConfig()));
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("inspectDatabase", () => {
  it("reporta una base sana: migraciones aplicadas y todas las tablas protegidas", async () => {
    const inspection = await inspectDatabase(client, 9);

    expect(inspection.healthy).toBe(true);
    expect(inspection.problems).toEqual([]);
    expect(inspection.version).toMatch(/PostgreSQL/);
    expect(inspection.appliedMigrations).toHaveLength(9);
    expect(inspection.tables).toContain("loans");
    expect(inspection.tablesWithoutRowSecurity).toEqual([]);
  });

  it("confirma que los roles públicos no tienen acceso a ninguna tabla", async () => {
    const inspection = await inspectDatabase(client, 9);

    expect(inspection.exposedRoleAccess).toEqual([]);
  });

  it("detecta un permiso abierto a los roles públicos", async () => {
    await client.query("BEGIN");
    try {
      await client.query("GRANT SELECT ON loans TO anon");
      const inspection = await inspectDatabase(client, 9);

      expect(inspection.healthy).toBe(false);
      expect(inspection.exposedRoleAccess).toEqual(["anon puede SELECT en loans"]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("avisa cuando faltan migraciones", async () => {
    const inspection = await inspectDatabase(client, 13);

    expect(inspection.healthy).toBe(false);
    expect(inspection.problems[0]).toMatch(/Faltan migraciones/);
  });

  it("detecta una tabla que quedó sin seguridad por fila", async () => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TABLE tabla_olvidada (id int)");
      const inspection = await inspectDatabase(client, 9);

      expect(inspection.healthy).toBe(false);
      expect(inspection.tablesWithoutRowSecurity).toEqual(["tabla_olvidada"]);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

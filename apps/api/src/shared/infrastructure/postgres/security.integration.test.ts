import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientOptions } from "./connection";
import { testDatabaseConfig } from "../../../testing/postgres/test-database";

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client(clientOptions(testDatabaseConfig()));
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

const publicTables = async (): Promise<string[]> => {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return rows.map((row) => String(row.tablename));
};

describe("seguridad de la base de datos", () => {
  it("toda tabla del esquema público tiene la seguridad por fila activada", async () => {
    // Esta prueba falla si una migración futura crea una tabla y olvida activar RLS.
    const { rows } = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it("no define políticas: para los roles expuestos el resultado es negar todo", async () => {
    const { rows } = await client.query("SELECT tablename FROM pg_policies WHERE schemaname = 'public'");
    expect(rows).toEqual([]);
  });

  it("los roles anon y authenticated no tienen ningún permiso sobre las tablas", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of await publicTables()) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const { rows } = await client.query("SELECT has_table_privilege($1, $2, $3) AS allowed", [
            role,
            `public.${table}`,
            privilege,
          ]);
          expect(rows[0].allowed, `${role} ${privilege} ${table}`).toBe(false);
        }
      }
    }
  });

  it("un rol expuesto no puede leer los préstamos aunque lo intente", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE anon");
      await expect(client.query("SELECT * FROM loans")).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("una tabla creada después tampoco queda abierta a los roles expuestos", async () => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TABLE tabla_nueva_de_prueba (id int)");
      const { rows } = await client.query(
        "SELECT has_table_privilege('anon', 'public.tabla_nueva_de_prueba', 'SELECT') AS allowed",
      );
      expect(rows[0].allowed).toBe(false);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

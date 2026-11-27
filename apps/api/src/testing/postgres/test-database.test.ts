import { describe, expect, it } from "vitest";
import { adminConfig } from "./test-database";

describe("adminConfig (protección de las pruebas de integración)", () => {
  it("usa el Postgres local por defecto", () => {
    expect(adminConfig({}).host).toBe("127.0.0.1");
  });

  it("acepta cualquier servidor local", () => {
    expect(adminConfig({ POSTGRES_ADMIN_URL: "postgres://postgres@localhost:5433/postgres" }).port).toBe(5433);
  });

  it("se niega a correr contra un servidor remoto, como la base de producción", () => {
    expect(() =>
      adminConfig({ POSTGRES_ADMIN_URL: "postgres://postgres:clave@db.abcdefgh.supabase.co:5432/postgres" }),
    ).toThrow(/solo pueden usar un PostgreSQL local/);
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedOrganization, testDatabaseConfig } from "../../../testing/postgres/test-database";
import { createPool } from "./connection";
import { exportDataModel, exportOrganizationData } from "./schema-export";

let pool: Pool;

beforeAll(() => {
  pool = createPool(testDatabaseConfig());
});

afterAll(async () => {
  await pool.end();
});

describe("exportDataModel", () => {
  it("describe el esquema real: tablas, columnas, llaves, triggers y seguridad por fila", async () => {
    const model = await exportDataModel(pool);
    const loans = model.tables.find((table) => table.name === "loans")!;

    expect(model.engine).toMatch(/^PostgreSQL \d+/);
    expect(model.migrations).toContain("0009_tenant_integrity.sql");
    expect(model.tables.map((table) => table.name)).toEqual(expect.arrayContaining(["loans", "payments", "users", "prescreening_submissions"]));
    expect(model.tables.every((table) => table.rowSecurity)).toBe(true);
    expect(loans.columns.find((column) => column.name === "principal")).toMatchObject({ type: "bigint", nullable: false });
    expect(loans.constraints.some((constraint) => constraint.kind === "FOREIGN KEY" && constraint.name === "fk_loans_borrower_same_org")).toBe(true);
    expect(model.tables.find((table) => table.name === "payments")!.triggers.map((trigger) => trigger.name)).toContain("trg_payments_immutable");
  });

  it("es determinista: dos exportaciones seguidas son idénticas", async () => {
    expect(JSON.stringify(await exportDataModel(pool))).toBe(JSON.stringify(await exportDataModel(pool)));
  });
});

describe("exportOrganizationData", () => {
  it("exporta solo la organización pedida y oculta todo lo secreto", async () => {
    const mine = await seedOrganization(pool);
    await seedOrganization(pool);

    const data = await exportOrganizationData(pool, mine.organizationId);

    expect(data.borrowers).toHaveLength(1);
    expect(data.borrowers![0]).toMatchObject({ full_name: "Cliente de prueba", national_id_enc: "[oculto]", national_id_hash: "[oculto]" });
    expect(JSON.stringify(data)).not.toContain("password_hash\":\"scrypt");
    expect(data.users ?? []).toEqual([]);
  });
});

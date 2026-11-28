import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../../shared/infrastructure/postgres/connection";
import { runStatement } from "../../../shared/infrastructure/postgres/sql";
import { newUuidV7 } from "../../../shared/infrastructure/postgres/uuid";
import { seedOrganization, testDatabaseConfig } from "../../../testing/postgres/test-database";

let pool: Pool;

beforeAll(() => {
  pool = createPool(testDatabaseConfig());
});

afterAll(async () => {
  await pool.end();
});

const insertLoan = (organizationId: string, borrowerId: string) =>
  runStatement(
    pool,
    `INSERT INTO loans (id, organization_id, borrower_id, code, principal, rate_bp, rate_period, payment_frequency,
       installments_count, interest_method, start_date, apr_bp, status, approved_on)
     VALUES ($1, $2, $3, $4, 100000, 500, 'MONTHLY', 'BIWEEKLY', 4, 'FLAT', '2026-12-01', 1000, 'PENDING_SIGNATURE', '2026-12-01')`,
    [newUuidV7(), organizationId, borrowerId, `X-${newUuidV7().slice(-6)}`],
  );

describe("integridad entre organizaciones en la base de datos", () => {
  it("un préstamo de una organización no puede apuntar a un cliente de otra", async () => {
    const victim = await seedOrganization(pool);
    const intruder = await seedOrganization(pool);

    await expect(insertLoan(intruder.organizationId, victim.borrowerId)).rejects.toMatchObject({ code: "23503" });
    await expect(insertLoan(victim.organizationId, victim.borrowerId)).resolves.toBe(1);
  });

  it("una cuenta de cliente del portal solo puede vincularse a un cliente de su organización", async () => {
    const victim = await seedOrganization(pool);
    const intruder = await seedOrganization(pool);
    const insertClientUser = (organizationId: string, borrowerId: string) =>
      runStatement(
        pool,
        `INSERT INTO users (id, organization_id, role, full_name, phone, password_hash, borrower_id)
         VALUES ($1, $2, 'CLIENT', 'Cliente', $3, 'x', $4)`,
        [newUuidV7(), organizationId, String(Math.floor(Math.random() * 1e8)).padStart(8, "0"), borrowerId],
      );

    await expect(insertClientUser(intruder.organizationId, victim.borrowerId)).rejects.toMatchObject({ code: "23503" });
    await expect(insertClientUser(victim.organizationId, victim.borrowerId)).resolves.toBe(1);
  });
});

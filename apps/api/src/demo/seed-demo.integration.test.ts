import { isBalanced, summarize } from "@app/domain";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCipher } from "../shared/infrastructure/crypto/field-cipher";
import { FixedClock } from "../shared/infrastructure/memory/in-memory-database";
import { createPool } from "../shared/infrastructure/postgres/connection";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { selectRows } from "../shared/infrastructure/postgres/sql";
import { testDatabaseConfig } from "../testing/postgres/test-database";
import { DEMO_ORGANIZATION_ID, seedDemo } from "./seed-demo";

let pool: Pool;
const cipher = new FieldCipher(randomBytes(32), randomBytes(32));
const clock = new FixedClock("2026-12-01");

beforeAll(() => {
  pool = createPool(testDatabaseConfig());
});

afterAll(async () => {
  await pool.end();
});

describe("seedDemo", () => {
  it("crea la organización demo con clientes, préstamos, pagos y recibos", async () => {
    const result = await seedDemo(pool, cipher, clock);

    expect(result).toEqual({ created: true, organizationId: DEMO_ORGANIZATION_ID, loans: 6, payments: 9 });
    const database = new PostgresDatabase(pool);
    const loans = await database.repositories().loans.listByOrganization(DEMO_ORGANIZATION_ID);
    expect(loans.map((loan) => loan.status).sort()).toEqual([
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "PAID_OFF",
      "PENDING_SIGNATURE",
    ]);
    const [receipts] = await selectRows(pool, "SELECT count(*)::int AS total FROM receipts WHERE organization_id = $1", [
      DEMO_ORGANIZATION_ID,
    ]);
    expect(receipts!.total).toBe(9);
  });

  it("deja la contabilidad cuadrada y con cifras coherentes para el tablero", async () => {
    const entries = await new PostgresDatabase(pool).repositories().ledger.entriesOf(DEMO_ORGANIZATION_ID);
    const summary = summarize(entries);

    expect(isBalanced(entries)).toBe(true);
    expect(summary.interestIncome.toCents()).toBeGreaterThan(0);
    expect(summary.portfolio.toCents()).toBeGreaterThan(0);
    expect(summary.totalCapital.toCents()).toBe(
      15_000_000 + summary.interestIncome.toCents() + summary.lateFeeIncome.toCents(),
    );
  });

  it("guarda el DNI cifrado y permite buscarlo por su huella", async () => {
    const [row] = await selectRows(
      pool,
      "SELECT national_id_enc, national_id_hash FROM borrowers WHERE organization_id = $1 AND full_name LIKE 'María%'",
      [DEMO_ORGANIZATION_ID],
    );

    expect(Buffer.from(row!.national_id_enc as Buffer).toString("utf8")).not.toContain("0000-0000-00001");
    expect(cipher.decrypt(row!.national_id_enc as Buffer)).toBe("0000-0000-00001");
    expect(row!.national_id_hash).toBe(cipher.searchHash("00000000 00001"));
  });

  it("es idempotente: ejecutarlo otra vez no duplica nada", async () => {
    const again = await seedDemo(pool, cipher, clock);

    expect(again.created).toBe(false);
    const loans = await new PostgresDatabase(pool).repositories().loans.listByOrganization(DEMO_ORGANIZATION_ID);
    expect(loans).toHaveLength(6);
  });
});

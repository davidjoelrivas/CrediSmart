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
import { CreateUser } from "../modules/identity/application/create-user";
import { PostgresUserRepository } from "../modules/identity/infrastructure/postgres/postgres-identity-repositories";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { runStatement } from "../shared/infrastructure/postgres/sql";
import { DEMO_ORGANIZATION_ID, ensureDemoUsers, seedDemo, upgradeDemoLateFees } from "./seed-demo";

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
    const database = new PostgresDatabase(pool, cipher);
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
    const entries = await new PostgresDatabase(pool, cipher).repositories().ledger.entriesOf(DEMO_ORGANIZATION_ID);
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
    const loans = await new PostgresDatabase(pool, cipher).repositories().loans.listByOrganization(DEMO_ORGANIZATION_ID);
    expect(loans).toHaveLength(6);
  });

  it("deja calculada la mora de los préstamos vencidos", async () => {
    const [row] = await selectRows(
      pool,
      "SELECT COALESCE(SUM(late_fee_due), 0)::bigint AS total FROM installments WHERE organization_id = $1",
      [DEMO_ORGANIZATION_ID],
    );

    expect(row!.total).toBeGreaterThan(0);
  });

  it("crea los tres usuarios de la demo una sola vez", async () => {
    const createUser = new CreateUser({
      users: new PostgresUserRepository(pool),
      hasher: new ScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1 }),
      ids: new UuidV7Generator(),
    });

    const first = await ensureDemoUsers(pool, createUser, "clave-de-demo-123");
    const second = await ensureDemoUsers(pool, createUser, "otra-clave-distinta");

    expect(first.created).toHaveLength(3);
    expect(second.created).toEqual([]);
    expect(second.existing).toHaveLength(3);
  });

  it("actualiza una demo antigua (sin política de mora) sin tocar nada más", async () => {
    // Se deja la demo como estaba antes de la migración 0007.
    await runStatement(pool, "UPDATE loans SET late_fee_policy = '{\"type\":\"NONE\"}'::jsonb, grace_days = 0 WHERE organization_id = $1", [DEMO_ORGANIZATION_ID]);
    await runStatement(pool, "UPDATE installments SET late_fee_due = 0 WHERE organization_id = $1", [DEMO_ORGANIZATION_ID]);

    const upgraded = await upgradeDemoLateFees(pool, cipher, clock);
    const again = await upgradeDemoLateFees(pool, cipher, clock);

    expect(upgraded).toBe(5);
    expect(again).toBe(0);
    const [row] = await selectRows(
      pool,
      "SELECT COALESCE(SUM(late_fee_due), 0)::bigint AS total FROM installments WHERE organization_id = $1",
      [DEMO_ORGANIZATION_ID],
    );
    expect(row!.total).toBeGreaterThan(0);
  });
});

import { AprCapExceededError, isBalanced, Money, outstandingOf, statusOf, summarize } from "@app/domain";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditLog } from "../modules/audit/infrastructure/postgres/postgres-audit-log";
import type { VerificationCodeGenerator } from "../modules/collections/application/ports";
import { RegisterPayment } from "../modules/collections/application/register-payment";
import { ReversePayment } from "../modules/collections/application/reverse-payment";
import { ApproveLoan } from "../modules/lending/application/approve-loan";
import { DisburseLoan } from "../modules/lending/application/disburse-loan";
import { SimulateLoan } from "../modules/lending/application/simulate-loan";
import { PostgresLegalCapProvider } from "../modules/lending/infrastructure/postgres/postgres-loan-support";
import { ConflictError, NotFoundError } from "../shared/application/errors";
import type { RequestContext } from "../shared/application/ports";
import { RandomVerificationCodes } from "../shared/infrastructure/crypto/random-verification-codes";
import { FixedClock } from "../shared/infrastructure/memory/in-memory-database";
import { createPool } from "../shared/infrastructure/postgres/connection";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { runStatement } from "../shared/infrastructure/postgres/sql";
import { newUuidV7, UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { standardTerms } from "../testing/harness";
import { seedOrganization, testCipher, testDatabaseConfig } from "../testing/postgres/test-database";

let pool: Pool;
let database: PostgresDatabase;

beforeAll(() => {
  pool = createPool(testDatabaseConfig());
  database = new PostgresDatabase(pool, testCipher);
});

afterAll(async () => {
  await database.close();
});

function createSystem(options: { verificationCodes?: VerificationCodeGenerator } = {}) {
  const unitOfWork = database.unitOfWork();
  const clock = new FixedClock("2026-12-01");
  const ids = new UuidV7Generator();
  const legalCap = new PostgresLegalCapProvider(pool);
  const verificationCodes = options.verificationCodes ?? new RandomVerificationCodes();
  return {
    clock,
    repositories: database.repositories(),
    audit: new PostgresAuditLog(pool),
    simulateLoan: new SimulateLoan({ legalCap }),
    approveLoan: new ApproveLoan({ unitOfWork, clock, ids, legalCap }),
    disburseLoan: new DisburseLoan({ unitOfWork, clock }),
    registerPayment: new RegisterPayment({ unitOfWork, clock, ids, verificationCodes }),
    reversePayment: new ReversePayment({ unitOfWork, clock, ids }),
  };
}

const contextOf = (organizationId: string): RequestContext => ({ organizationId, actorId: newUuidV7() });
const lempiras = (text: string) => Money.fromLempiras(text);

type System = ReturnType<typeof createSystem>;

/** Organización nueva con un préstamo de L 10,000 ya desembolsado: 4 cuotas de L 2,750. */
async function activeLoan(system: System, options: { aprCapBp?: number | null } = {}) {
  const { organizationId, borrowerId } = await seedOrganization(pool, options);
  const context = contextOf(organizationId);
  const loan = await system.approveLoan.execute(context, { borrowerId, terms: standardTerms() });
  await system.disburseLoan.execute(context, { loanId: loan.id, method: "CASH" });
  return { organizationId, borrowerId, context, loan };
}

const pay = (system: System, context: RequestContext, loanId: string, amount: string, key: string) =>
  system.registerPayment.execute(context, {
    loanId,
    amount: lempiras(amount),
    method: "CASH",
    idempotencyKey: key,
  });

describe("PostgreSQL: ciclo de vida completo de un préstamo", () => {
  it("aprueba, desembolsa, cobra y revierte guardando todo correctamente", async () => {
    const system = createSystem();
    const { organizationId, borrowerId } = await seedOrganization(pool);
    const context = contextOf(organizationId);

    const approved = await system.approveLoan.execute(context, { borrowerId, terms: standardTerms() });
    expect(approved.code).toBe("PR-0001");
    expect(approved.status).toBe("PENDING_SIGNATURE");

    await system.disburseLoan.execute(context, { loanId: approved.id, method: "CASH" });
    const { payment, receipt } = await pay(system, context, approved.id, "2750", "key-1");

    const stored = (await system.repositories.loans.findById(organizationId, approved.id))!;
    expect(stored.status).toBe("ACTIVE");
    expect(stored.terms.principal.toCents()).toBe(1_000_000);
    expect(stored.terms.startDate).toBe("2026-12-01");
    expect(stored.balances).toHaveLength(4);
    expect(statusOf(stored.balances[0]!)).toBe("PAID");
    expect(receipt.folio).toBe(1);
    expect(await system.repositories.receipts.findByVerificationCode(receipt.verificationCode)).toEqual(receipt);

    await system.reversePayment.execute(context, { paymentId: payment.id, reason: "Error de digitación" });

    const afterReversal = (await system.repositories.loans.findById(organizationId, approved.id))!;
    expect(afterReversal.balances.every((balance) => statusOf(balance) === "PENDING")).toBe(true);

    const entries = await system.repositories.ledger.entriesOf(organizationId);
    expect(entries).toHaveLength(3); // desembolso, pago y reverso
    expect(isBalanced(entries)).toBe(true);
    const summary = summarize(entries);
    expect(summary.cash.toCents()).toBe(-1_000_000);
    expect(summary.portfolio.toCents()).toBe(1_000_000);

    const payments = await system.repositories.payments.listByLoan(organizationId, approved.id);
    expect(payments.map((item) => item.amount.toCents())).toEqual([275_000, -275_000]);
    expect(payments[1]!.reversesPaymentId).toBe(payment.id);
    expect(payments[0]!.allocations).toHaveLength(1);
  });

  it("deja una bitácora encadenada e íntegra", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);
    await pay(system, context, loan.id, "1000", "key-1");

    const records = await system.audit.recordsOf(organizationId);
    expect(records.map((record) => record.action)).toEqual([
      "LOAN_APPROVED",
      "LOAN_DISBURSED",
      "PAYMENT_REGISTERED",
    ]);
    expect(records[0]!.details.principalCents).toBe(1_000_000);
    expect(await system.audit.verifyChain(organizationId)).toEqual({ valid: true });
  });

  it("numera los préstamos de la organización sin repetir códigos aunque se aprueben a la vez", async () => {
    const system = createSystem();
    const { organizationId, borrowerId } = await seedOrganization(pool);
    const context = contextOf(organizationId);

    const loans = await Promise.all(
      Array.from({ length: 6 }, () =>
        system.approveLoan.execute(context, { borrowerId, terms: standardTerms() }),
      ),
    );

    expect(loans.map((loan) => loan.code).sort()).toEqual([
      "PR-0001",
      "PR-0002",
      "PR-0003",
      "PR-0004",
      "PR-0005",
      "PR-0006",
    ]);
    expect(await system.repositories.loans.listByOrganization(organizationId)).toHaveLength(6);
  });
});

describe("PostgreSQL: pagos simultáneos", () => {
  it("dos solicitudes idénticas a la vez registran un solo pago", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);

    const results = await Promise.all([
      pay(system, context, loan.id, "2750", "misma-clave"),
      pay(system, context, loan.id, "2750", "misma-clave"),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.payment.id).toBe(results[1]!.payment.id);
    expect(await system.repositories.payments.listByLoan(organizationId, loan.id)).toHaveLength(1);
    expect(await system.repositories.ledger.entriesOf(organizationId)).toHaveLength(2);
  });

  it("dos pagos distintos a la vez se aplican ambos, sin perder ninguno", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);

    await Promise.all([
      pay(system, context, loan.id, "2750", "clave-a"),
      pay(system, context, loan.id, "2750", "clave-b"),
    ]);

    const stored = (await system.repositories.loans.findById(organizationId, loan.id))!;
    expect(statusOf(stored.balances[0]!)).toBe("PAID");
    expect(statusOf(stored.balances[1]!)).toBe("PAID");
    expect(statusOf(stored.balances[2]!)).toBe("PENDING");
    const owed = stored.balances.reduce((sum, balance) => sum.add(outstandingOf(balance).total), Money.zero());
    expect(owed.toCents()).toBe(550_000);
  });

  it("los recibos salen con números correlativos sin repetirse", async () => {
    const system = createSystem();
    const { context, loan } = await activeLoan(system);

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) => pay(system, context, loan.id, "500", `clave-${index}`)),
    );

    expect(results.map((result) => result.receipt.folio).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("PostgreSQL: aislamiento entre organizaciones", () => {
  it("una organización no ve ni opera los préstamos de otra", async () => {
    const system = createSystem();
    const first = await activeLoan(system);
    const second = await seedOrganization(pool);

    expect(await system.repositories.loans.findById(second.organizationId, first.loan.id)).toBeNull();
    expect(await system.repositories.loans.listByOrganization(second.organizationId)).toEqual([]);
    await expect(
      pay(system, contextOf(second.organizationId), first.loan.id, "100", "k"),
    ).rejects.toThrow(NotFoundError);
    await expect(
      system.disburseLoan.execute(contextOf(second.organizationId), { loanId: first.loan.id, method: "CASH" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("la misma clave de idempotencia puede usarse en organizaciones distintas", async () => {
    const system = createSystem();
    const first = await activeLoan(system);
    const second = await activeLoan(system);

    await pay(system, first.context, first.loan.id, "100", "clave-compartida");
    const result = await pay(system, second.context, second.loan.id, "100", "clave-compartida");

    expect(result.replayed).toBe(false);
  });
});

describe("PostgreSQL: reglas de negocio con base real", () => {
  it("rechaza pagos repetidos con otro monto y pagos de más", async () => {
    const system = createSystem();
    const { context, loan } = await activeLoan(system);
    await pay(system, context, loan.id, "100", "clave-1");

    await expect(pay(system, context, loan.id, "200", "clave-1")).rejects.toThrow(ConflictError);
    await expect(pay(system, context, loan.id, "99999", "clave-2")).rejects.toThrow(ConflictError);
  });

  it("el tope legal se lee de la organización: sin confirmación rechaza, con motivo aprueba", async () => {
    const system = createSystem();
    const { organizationId, borrowerId } = await seedOrganization(pool, { aprCapBp: 2400 });
    const context = contextOf(organizationId);

    await expect(
      system.approveLoan.execute(context, { borrowerId, terms: standardTerms() }),
    ).rejects.toThrow(AprCapExceededError);
    expect(await system.repositories.loans.listByOrganization(organizationId)).toEqual([]);

    const loan = await system.approveLoan.execute(context, {
      borrowerId,
      terms: standardTerms(),
      aprCapOverride: { confirmed: true, reason: "Autorizado por el abogado" },
    });
    expect(loan.aprCapOverrideReason).toBe("Autorizado por el abogado");
    const simulation = await system.simulateLoan.execute(context, standardTerms());
    expect(simulation.exceedsAprCap).toBe(true);
  });

  it("si algo falla a mitad de un pago, la base queda exactamente como estaba", async () => {
    const failing = createSystem({
      verificationCodes: {
        newCode() {
          throw new Error("no se pudo generar el código");
        },
      },
    });
    const { organizationId, context, loan } = await activeLoan(failing);

    await expect(pay(failing, context, loan.id, "2750", "clave-1")).rejects.toThrow("no se pudo generar");

    expect(await failing.repositories.payments.listByLoan(organizationId, loan.id)).toEqual([]);
    expect(await failing.repositories.ledger.entriesOf(organizationId)).toHaveLength(1);
    const stored = (await failing.repositories.loans.findById(organizationId, loan.id))!;
    expect(statusOf(stored.balances[0]!)).toBe("PENDING");
    expect(await failing.audit.recordsOf(organizationId)).toHaveLength(2);
  });
});

describe("PostgreSQL: lo que la propia base impide", () => {
  const execute = (sql: string, params: unknown[] = []) => runStatement(pool, sql, params);

  it("no permite editar ni borrar pagos, repartos, recibos, asientos ni la bitácora", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);
    const { payment } = await pay(system, context, loan.id, "2750", "clave-1");

    await expect(execute("UPDATE payments SET amount = 1 WHERE id = $1", [payment.id])).rejects.toThrow(/inmutable/);
    await expect(execute("DELETE FROM payments WHERE id = $1", [payment.id])).rejects.toThrow(/inmutable/);
    await expect(
      execute("UPDATE payment_allocations SET principal = 0 WHERE payment_id = $1", [payment.id]),
    ).rejects.toThrow(/inmutable/);
    await expect(execute("UPDATE receipts SET folio = 99 WHERE payment_id = $1", [payment.id])).rejects.toThrow(
      /inmutable/,
    );
    await expect(
      execute("DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE organization_id = $1)", [
        organizationId,
      ]),
    ).rejects.toThrow(/inmutable/);
    await expect(
      execute("UPDATE journal_entries SET description = 'x' WHERE organization_id = $1", [organizationId]),
    ).rejects.toThrow(/inmutable/);
    await expect(execute("UPDATE audit_log SET action = 'x' WHERE organization_id = $1", [organizationId])).rejects.toThrow(
      /inmutable/,
    );
    await expect(execute("DELETE FROM audit_log WHERE organization_id = $1", [organizationId])).rejects.toThrow(
      /inmutable/,
    );
  });

  it("no permite pagos negativos que no sean reversos, ni cuotas pagadas de más", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);

    await expect(
      execute(
        `INSERT INTO payments (id, organization_id, loan_id, amount, method, received_on, received_by, idempotency_key)
         VALUES ($1, $2, $3, -100, 'CASH', '2026-12-01', $4, 'x')`,
        [newUuidV7(), organizationId, loan.id, context.actorId],
      ),
    ).rejects.toThrow(/ck_payments_amount/);
    await expect(
      execute("UPDATE installments SET principal_paid = principal_due + 1 WHERE loan_id = $1", [loan.id]),
    ).rejects.toThrow(/ck_installments_amounts/);
  });

  it("no permite repetir la clave de idempotencia ni revertir dos veces el mismo pago", async () => {
    const system = createSystem();
    const { organizationId, context, loan } = await activeLoan(system);
    const { payment } = await pay(system, context, loan.id, "2750", "clave-1");
    await system.reversePayment.execute(context, { paymentId: payment.id, reason: "Error" });

    const insertPayment = (key: string, reverses: string | null, amount: number) =>
      execute(
        `INSERT INTO payments (id, organization_id, loan_id, amount, method, received_on, received_by,
                               idempotency_key, reverses_payment_id, reversal_reason)
         VALUES ($1, $2, $3, $4, 'CASH', '2026-12-01', $5, $6, $7, $8)`,
        [newUuidV7(), organizationId, loan.id, amount, context.actorId, key, reverses, reverses ? "otra vez" : null],
      );

    await expect(insertPayment("clave-1", null, 100)).rejects.toThrow(/uq_payments_idempotency/);
    await expect(insertPayment("otra-clave", payment.id, -275_000)).rejects.toThrow(/uq_payments_reverses/);
  });

  it("rechaza al confirmar un asiento cuyos débitos y créditos no son iguales", async () => {
    const { organizationId } = await seedOrganization(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "INSERT INTO journal_entries (organization_id, entry_date, description) VALUES ($1, '2026-12-01', 'Descuadrado') RETURNING id",
        [organizationId],
      );
      await client.query(
        "INSERT INTO journal_lines (entry_id, line_number, account_code, debit, credit) VALUES ($1, 1, '1101', 100, 0)",
        [rows[0].id],
      );
      await client.query(
        "INSERT INTO journal_lines (entry_id, line_number, account_code, debit, credit) VALUES ($1, 2, '3101', 0, 99)",
        [rows[0].id],
      );
      await expect(client.query("COMMIT")).rejects.toThrow(/no cuadra/);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }

    const { rows: stored } = await pool.query("SELECT count(*)::int AS total FROM journal_entries WHERE organization_id = $1", [
      organizationId,
    ]);
    expect(stored[0].total).toBe(0);
  });

  it("acepta un asiento cuadrado escrito directamente", async () => {
    const { organizationId } = await seedOrganization(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "INSERT INTO journal_entries (organization_id, entry_date, description) VALUES ($1, '2026-12-01', 'Cuadrado') RETURNING id",
        [organizationId],
      );
      await client.query(
        "INSERT INTO journal_lines (entry_id, line_number, account_code, debit, credit) VALUES ($1, 1, '1101', 100, 0), ($1, 2, '3101', 0, 100)",
        [rows[0].id],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const { rows: stored } = await pool.query("SELECT count(*)::int AS total FROM journal_entries WHERE organization_id = $1", [
      organizationId,
    ]);
    expect(stored[0].total).toBe(1);
  });
});

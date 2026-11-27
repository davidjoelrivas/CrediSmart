import { Money } from "@app/domain";
import { describe, expect, it } from "vitest";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

async function activeLoan(harness: ReturnType<typeof createHarness>, graceDays = 2) {
  const loan = await harness.approveLoan.execute(contextOf(), {
    borrowerId: "borrower-1",
    terms: standardTerms(),
    lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 },
    graceDays,
  });
  await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });
  return loan;
}

describe("AccrueLateFees", () => {
  it("no cobra mora mientras la cuota esté dentro de la gracia", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const loan = await activeLoan(harness);
    harness.clock.date = "2026-12-17";

    const result = await harness.accrueLateFees.execute(contextOf());

    expect(result).toMatchObject({ loansChecked: 1, loansUpdated: 0, installmentsUpdated: 0 });
    const saved = await harness.repositories.loans.findById("org-1", loan.id);
    expect(saved!.balances[0]!.lateFeeDue.isZero()).toBe(true);
  });

  it("cobra mora cuando se acaba la gracia y la deja guardada en la cuota", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const loan = await activeLoan(harness);
    harness.clock.date = "2026-12-18";

    const result = await harness.accrueLateFees.execute(contextOf());

    expect(result).toMatchObject({ loansUpdated: 1, installmentsUpdated: 1 });
    const saved = await harness.repositories.loans.findById("org-1", loan.id);
    expect(saved!.balances[0]!.lateFeeDue.toCents()).toBeGreaterThan(0);
    expect(saved!.balances[1]!.lateFeeDue.isZero()).toBe(true);
  });

  it("correrlo dos veces el mismo día no cambia nada ni llena la bitácora", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    await activeLoan(harness);
    harness.clock.date = "2026-12-18";

    await harness.accrueLateFees.execute(contextOf());
    const second = await harness.accrueLateFees.execute(contextOf());

    expect(second.loansUpdated).toBe(0);
    const accruals = (await harness.repositories.audit.recordsOf("org-1")).filter(
      (record) => record.action === "LATE_FEES_ACCRUED",
    );
    expect(accruals).toHaveLength(1);
  });

  it("el pago siguiente cubre primero la mora", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const loan = await activeLoan(harness);
    harness.clock.date = "2026-12-18";
    await harness.accrueLateFees.execute(contextOf());
    const accrued = (await harness.repositories.loans.findById("org-1", loan.id))!.balances[0]!
      .lateFeeDue;

    const { payment } = await harness.registerPayment.execute(contextOf(), {
      loanId: loan.id,
      amount: Money.fromLempiras("100"),
      method: "CASH",
      idempotencyKey: "k-1",
    });

    expect(payment.allocations[0]!.lateFee.toCents()).toBe(Math.min(10_000, accrued.toCents()));
  });

  it("ignora préstamos sin política de mora y préstamos de otra organización", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const plain = await harness.approveLoan.execute(contextOf(), {
      borrowerId: "borrower-1",
      terms: standardTerms(),
    });
    await harness.disburseLoan.execute(contextOf(), { loanId: plain.id, method: "CASH" });
    harness.clock.date = "2027-03-01";

    const own = await harness.accrueLateFees.execute(contextOf());
    const other = await harness.accrueLateFees.execute(contextOf("org-2"));

    expect(own.installmentsUpdated).toBe(0);
    expect(other.loansChecked).toBe(0);
  });
});

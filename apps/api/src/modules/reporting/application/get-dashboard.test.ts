import { Money } from "@app/domain";
import { describe, expect, it } from "vitest";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

async function newBorrower(harness: ReturnType<typeof createHarness>, name: string, nationalId: string) {
  return harness.createBorrower.execute(contextOf(), {
    fullName: name,
    nationalId,
    privacyConsent: true,
  });
}

/** Aporta capital, aprueba y desembolsa un préstamo estándar (L 10,000, 4 cuotas quincenales de L 2,750). */
async function activeLoanFor(harness: ReturnType<typeof createHarness>, borrowerId: string) {
  const loan = await harness.approveLoan.execute(contextOf(), { borrowerId, terms: standardTerms() });
  await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });
  return loan;
}

describe("GetDashboard", () => {
  it("una organización nueva muestra todo en cero", async () => {
    const harness = createHarness();

    const dashboard = await harness.getDashboard.execute(contextOf());

    expect(dashboard.loans.total).toBe(0);
    expect(dashboard.risk.par30Bp).toBe(0);
    expect(dashboard.topOverdue).toEqual([]);
  });

  it("cuenta préstamos por estado y el capital pendiente", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    const luis = await newBorrower(harness, "Luis Gómez", "0801199000002");
    await activeLoanFor(harness, ana.id);
    await harness.approveLoan.execute(contextOf(), { borrowerId: luis.id, terms: standardTerms() });

    const dashboard = await harness.getDashboard.execute(contextOf());

    expect(dashboard.loans).toMatchObject({ active: 1, pendingSignature: 1, paidOff: 0, total: 2 });
    expect(dashboard.risk.outstandingPrincipalCents).toBe(1_000_000);
    expect(dashboard.capital.portfolioCents).toBe(1_000_000);
    expect(dashboard.capital.cashCents).toBe(-1_000_000);
  });

  it("lista las cuotas que vencen en los próximos 7 días", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    await activeLoanFor(harness, ana.id);
    harness.clock.date = "2026-12-10";

    const dashboard = await harness.getDashboard.execute(contextOf());

    expect(dashboard.upcoming).toHaveLength(1);
    expect(dashboard.upcoming[0]).toMatchObject({ borrowerName: "Ana Pérez", installmentNumber: 1, dueDate: "2026-12-15" });
  });

  it("calcula atraso, monto vencido y cartera en riesgo", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    const luis = await newBorrower(harness, "Luis Gómez", "0801199000002");
    const late = await activeLoanFor(harness, ana.id);
    const onTime = await activeLoanFor(harness, luis.id);
    // Luis paga la primera cuota a tiempo; Ana no paga nada.
    harness.clock.date = "2026-12-15";
    await harness.registerPayment.execute(contextOf(), {
      loanId: onTime.id,
      amount: Money.fromLempiras("2750"),
      method: "CASH",
      idempotencyKey: "k-1",
    });
    harness.clock.date = "2026-12-25";

    const dashboard = await harness.getDashboard.execute(contextOf());

    // Solo vence la primera cuota (15 de dic.): Luis ya la pagó y la segunda vence el 29.
    expect(dashboard.risk.overdueLoans).toBe(1);
    expect(dashboard.topOverdue[0]).toMatchObject({ loanId: late.id, daysOverdue: 10, overdueCents: 275_000 });
    expect(dashboard.risk.overdueAmountCents).toBe(275_000);
    // El préstamo de Ana tiene L 10,000 de capital de L 17,500 pendientes en total → más de la mitad en riesgo.
    expect(dashboard.risk.par7Bp).toBeGreaterThan(5000);
    expect(dashboard.risk.par30Bp).toBe(0);
  });

  it("suma lo cobrado en el mes y muestra los últimos pagos", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    const loan = await activeLoanFor(harness, ana.id);
    harness.clock.date = "2026-12-15";
    await harness.registerPayment.execute(contextOf(), {
      loanId: loan.id,
      amount: Money.fromLempiras("1000"),
      method: "TRANSFER",
      idempotencyKey: "k-1",
    });

    const dashboard = await harness.getDashboard.execute(contextOf());

    expect(dashboard.income.collectedThisMonthCents).toBe(100_000);
    expect(dashboard.recentPayments[0]).toMatchObject({ borrowerName: "Ana Pérez", amountCents: 100_000, isReversal: false });
  });

  it("no mezcla datos de otras organizaciones", async () => {
    const harness = createHarness();
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    await activeLoanFor(harness, ana.id);

    const other = await harness.getDashboard.execute(contextOf("org-2"));

    expect(other.loans.total).toBe(0);
    expect(other.capital.portfolioCents).toBe(0);
  });
});

describe("LoanQueries", () => {
  it("lista préstamos con nombre del cliente y filtra por estado", async () => {
    const harness = createHarness();
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    await activeLoanFor(harness, ana.id);
    await harness.approveLoan.execute(contextOf(), { borrowerId: ana.id, terms: standardTerms() });

    const all = await harness.loanQueries.list(contextOf());
    const pending = await harness.loanQueries.list(contextOf(), { status: "PENDING_SIGNATURE" });

    expect(all).toHaveLength(2);
    expect(all[0]!.borrowerName).toBe("Ana Pérez");
    expect(pending).toHaveLength(1);
  });

  it("el detalle incluye cuotas, política de mora y pagos con su recibo", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const ana = await newBorrower(harness, "Ana Pérez", "0801199000001");
    const loan = await harness.approveLoan.execute(contextOf(), {
      borrowerId: ana.id,
      terms: standardTerms(),
      lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 },
      graceDays: 3,
    });
    await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });
    await harness.registerPayment.execute(contextOf(), {
      loanId: loan.id,
      amount: Money.fromLempiras("1000"),
      method: "CASH",
      idempotencyKey: "k-1",
    });

    const detail = await harness.loanQueries.get(contextOf(), loan.id);

    expect(detail.installmentsDetail).toHaveLength(4);
    expect(detail.lateFee.description).toBe("5 % del monto vencido después de 3 días de gracia");
    expect(detail.payments[0]).toMatchObject({ amountCents: 100_000, receiptFolio: "REC-000001", reversed: false });
    expect(detail.installmentsDetail[0]!.status).toBe("PARTIAL");
  });
});

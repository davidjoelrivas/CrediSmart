import { describe, expect, it } from "vitest";
import { InvalidPaymentError, Money, outstandingOf, statusOf, summarize } from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";
import { formatReceiptFolio } from "../domain/receipt";

type Harness = ReturnType<typeof createHarness>;
const lempiras = (text: string) => Money.fromLempiras(text);

/** Préstamo de L 10,000 ya desembolsado en efectivo: 4 cuotas de L 2,750. */
async function activeLoan(harness: Harness, organizationId = "org-1") {
  const loan = await harness.approveLoan.execute(contextOf(organizationId), {
    borrowerId: "borrower-1",
    terms: standardTerms(),
  });
  await harness.disburseLoan.execute(contextOf(organizationId), { loanId: loan.id, method: "CASH" });
  return loan;
}

const pay = (harness: Harness, loanId: string, amount: string, key: string, extra = {}) =>
  harness.registerPayment.execute(contextOf(), {
    loanId,
    amount: lempiras(amount),
    method: "CASH",
    idempotencyKey: key,
    ...extra,
  });

describe("RegisterPayment: pago normal", () => {
  it("salda la primera cuota con un pago exacto y emite el recibo", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    const result = await pay(harness, loan.id, "2750", "key-1");

    expect(result.replayed).toBe(false);
    expect(statusOf(result.loan.balances[0]!)).toBe("PAID");
    expect(statusOf(result.loan.balances[1]!)).toBe("PENDING");
    expect(result.loan.status).toBe("ACTIVE");
    expect(result.payment.allocations).toHaveLength(1);
    expect(result.receipt.folio).toBe(1);
    expect(formatReceiptFolio(result.receipt.folio)).toBe("REC-000001");
    expect(result.receipt.verificationCode).toBe("VERIF-000001");
  });

  it("guarda el pago, el préstamo actualizado y el recibo", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    const { payment, receipt } = await pay(harness, loan.id, "1000", "key-1", { reference: " BAC-123 " });

    expect(await harness.repositories.payments.findById("org-1", payment.id)).toEqual(payment);
    expect(payment.reference).toBe("BAC-123");
    expect(await harness.repositories.receipts.findByVerificationCode(receipt.verificationCode)).toEqual(
      receipt,
    );
    const saved = await harness.repositories.loans.findById("org-1", loan.id);
    expect(outstandingOf(saved!.balances[0]!).total.toCents()).toBe(175_000);
  });

  it("registra el asiento contable: entra a caja y se reparte entre capital e interés", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    await pay(harness, loan.id, "2750", "key-1");

    const summary = summarize(await harness.repositories.ledger.entriesOf("org-1"));
    expect(summary.cash.toCents()).toBe(-1_000_000 + 275_000);
    expect(summary.portfolio.toCents()).toBe(750_000);
    expect(summary.interestIncome.toCents()).toBe(25_000);
  });

  it("deja constancia en la bitácora", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    const { payment } = await pay(harness, loan.id, "2750", "key-1");

    const records = await harness.repositories.audit.recordsOf("org-1");
    const last = records.at(-1)!;
    expect(last).toMatchObject({ action: "PAYMENT_REGISTERED", entityId: payment.id });
    expect(last.details).toMatchObject({ amountCents: 275_000, receiptFolio: 1, loanPaidOff: false });
  });

  it("numera los recibos de forma correlativa por organización", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);
    const otherLoan = await activeLoan(harness, "org-2");

    const first = await pay(harness, loan.id, "100", "key-1");
    const second = await pay(harness, loan.id, "100", "key-2");
    const otherOrganization = await harness.registerPayment.execute(contextOf("org-2"), {
      loanId: otherLoan.id,
      amount: lempiras("100"),
      method: "CASH",
      idempotencyKey: "key-1",
    });

    expect([first.receipt.folio, second.receipt.folio, otherOrganization.receipt.folio]).toEqual([1, 2, 1]);
  });

  it("al pagar todo, el préstamo queda pagado con su fecha de cierre", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const loan = await activeLoan(harness);
    harness.clock.date = "2027-01-26";

    const { loan: paidLoan } = await pay(harness, loan.id, "11000", "key-1");

    expect(paidLoan.status).toBe("PAID_OFF");
    expect(paidLoan.closedOn).toBe("2027-01-26");
    await expect(pay(harness, loan.id, "100", "key-2")).rejects.toThrow(ConflictError);
  });

  it("usa la fecha en que se recibió el dinero para el asiento cuando es anterior a hoy", async () => {
    const harness = createHarness({ today: "2026-12-10" });
    const loan = await activeLoan(harness);

    const { payment } = await pay(harness, loan.id, "500", "key-1", { receivedOn: "2026-12-08" });

    expect(payment.receivedOn).toBe("2026-12-08");
    const entries = await harness.repositories.ledger.entriesOf("org-1");
    expect(entries.at(-1)!.date).toBe("2026-12-08");
  });
});

describe("RegisterPayment: idempotencia", () => {
  it("la misma clave devuelve el pago original sin aplicarlo otra vez", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    const first = await pay(harness, loan.id, "2750", "key-1");
    const second = await pay(harness, loan.id, "2750", "key-1");

    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(await harness.repositories.payments.listByLoan("org-1", loan.id)).toHaveLength(1);
    expect(await harness.repositories.ledger.entriesOf("org-1")).toHaveLength(2); // desembolso + 1 pago
    const saved = await harness.repositories.loans.findById("org-1", loan.id);
    expect(outstandingOf(saved!.balances[0]!).total.isZero()).toBe(true);
    expect(outstandingOf(saved!.balances[1]!).total.toCents()).toBe(275_000);
  });

  it("la misma clave con otro monto es un conflicto", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);
    await pay(harness, loan.id, "2750", "key-1");

    await expect(pay(harness, loan.id, "2000", "key-1")).rejects.toThrow(ConflictError);
  });

  it("exige una clave de idempotencia", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    await expect(pay(harness, loan.id, "100", "  ")).rejects.toThrow(InvalidPaymentError);
  });
});

describe("RegisterPayment: rechazos", () => {
  it("rechaza pagos en cero o negativos", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    await expect(pay(harness, loan.id, "0", "key-1")).rejects.toThrow(InvalidPaymentError);
    await expect(pay(harness, loan.id, "-5", "key-2")).rejects.toThrow(InvalidPaymentError);
  });

  it("rechaza un pago mayor a lo que se debe y no cambia nada", async () => {
    const harness = createHarness();
    const loan = await activeLoan(harness);

    await expect(pay(harness, loan.id, "11000.01", "key-1")).rejects.toThrow(ConflictError);

    expect(await harness.repositories.payments.listByLoan("org-1", loan.id)).toEqual([]);
    expect(await harness.repositories.ledger.entriesOf("org-1")).toHaveLength(1);
  });

  it("rechaza fechas inválidas o futuras", async () => {
    const harness = createHarness({ today: "2026-12-10" });
    const loan = await activeLoan(harness);

    await expect(pay(harness, loan.id, "100", "k1", { receivedOn: "2026-12-11" })).rejects.toThrow(
      InvalidPaymentError,
    );
    await expect(pay(harness, loan.id, "100", "k2", { receivedOn: "10/12/2026" })).rejects.toThrow(
      InvalidPaymentError,
    );
  });

  it("no admite pagos en un préstamo que todavía no fue desembolsado", async () => {
    const harness = createHarness();
    const pending = await harness.approveLoan.execute(contextOf(), {
      borrowerId: "b-1",
      terms: standardTerms(),
    });

    await expect(pay(harness, pending.id, "100", "key-1")).rejects.toThrow(ConflictError);
  });

  it("no encuentra préstamos inexistentes ni de otra organización", async () => {
    const harness = createHarness();
    const otherOrganizationLoan = await activeLoan(harness, "org-2");

    await expect(pay(harness, "no-existe", "100", "k1")).rejects.toThrow(NotFoundError);
    await expect(pay(harness, otherOrganizationLoan.id, "100", "k2")).rejects.toThrow(NotFoundError);
  });
});

describe("RegisterPayment: atomicidad", () => {
  it("si falla al emitir el recibo, no queda ningún pago ni cambio a medias", async () => {
    const harness = createHarness({
      verificationCodes: {
        newCode() {
          throw new Error("no se pudo generar el código");
        },
      },
    });
    const loan = await activeLoan(harness);

    await expect(pay(harness, loan.id, "2750", "key-1")).rejects.toThrow("no se pudo generar");

    expect(await harness.repositories.payments.listByLoan("org-1", loan.id)).toEqual([]);
    expect(await harness.repositories.ledger.entriesOf("org-1")).toHaveLength(1);
    const saved = await harness.repositories.loans.findById("org-1", loan.id);
    expect(statusOf(saved!.balances[0]!)).toBe("PENDING");
  });
});

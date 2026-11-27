import { describe, expect, it } from "vitest";
import { InvalidPaymentError, isBalanced, Money, outstandingOf, statusOf, summarize } from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

type Harness = ReturnType<typeof createHarness>;
const lempiras = (text: string) => Money.fromLempiras(text);

async function loanWithPayment(harness: Harness, amount = "2750") {
  const loan = await harness.approveLoan.execute(contextOf(), {
    borrowerId: "borrower-1",
    terms: standardTerms(),
  });
  await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });
  const { payment, receipt } = await harness.registerPayment.execute(contextOf(), {
    loanId: loan.id,
    amount: lempiras(amount),
    method: "CASH",
    idempotencyKey: "key-1",
  });
  return { loan, payment, receipt };
}

describe("ReversePayment", () => {
  it("devuelve los saldos de las cuotas a como estaban antes del pago", async () => {
    const harness = createHarness();
    const { loan, payment } = await loanWithPayment(harness, "4000");

    const { loan: restored } = await harness.reversePayment.execute(contextOf(), {
      paymentId: payment.id,
      reason: "Se registró al cliente equivocado",
    });

    expect(restored.status).toBe("ACTIVE");
    expect(restored.balances.every((balance) => statusOf(balance) === "PENDING")).toBe(true);
    expect(outstandingOf(restored.balances[0]!).total.toCents()).toBe(275_000);
    expect((await harness.repositories.loans.findById("org-1", loan.id))?.balances).toEqual(restored.balances);
  });

  it("crea un reverso con monto negativo que apunta al pago original, sin borrar nada", async () => {
    const harness = createHarness();
    const { loan, payment } = await loanWithPayment(harness);

    const { reversal } = await harness.reversePayment.execute(contextOf("org-1", "owner-3"), {
      paymentId: payment.id,
      reason: "  Monto digitado de más  ",
    });

    expect(reversal.amount.toCents()).toBe(-275_000);
    expect(reversal.reversesPaymentId).toBe(payment.id);
    expect(reversal.reversalReason).toBe("Monto digitado de más");
    expect(reversal.receivedBy).toBe("owner-3");
    const payments = await harness.repositories.payments.listByLoan("org-1", loan.id);
    expect(payments).toHaveLength(2);
    expect(payments[0]).toEqual(payment);
  });

  it("revierte el asiento contable: el libro cuadra y las cifras vuelven a las del desembolso", async () => {
    const harness = createHarness();
    const { payment } = await loanWithPayment(harness);

    await harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Error" });

    const entries = await harness.repositories.ledger.entriesOf("org-1");
    const summary = summarize(entries);
    expect(isBalanced(entries)).toBe(true);
    expect(summary.cash.toCents()).toBe(-1_000_000);
    expect(summary.portfolio.toCents()).toBe(1_000_000);
    expect(summary.interestIncome.isZero()).toBe(true);
  });

  it("si el pago había saldado el préstamo, lo vuelve a dejar activo", async () => {
    const harness = createHarness();
    const { loan, payment } = await loanWithPayment(harness, "11000");
    expect((await harness.repositories.loans.findById("org-1", loan.id))?.status).toBe("PAID_OFF");

    const { loan: restored } = await harness.reversePayment.execute(contextOf(), {
      paymentId: payment.id,
      reason: "Cheque devuelto",
    });

    expect(restored.status).toBe("ACTIVE");
    expect(restored.closedOn).toBeNull();
  });

  it("deja constancia del motivo en la bitácora y conserva el recibo original", async () => {
    const harness = createHarness();
    const { payment, receipt } = await loanWithPayment(harness);

    await harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Error de digitación" });

    const last = (await harness.repositories.audit.recordsOf("org-1")).at(-1)!;
    expect(last).toMatchObject({ action: "PAYMENT_REVERSED", entityId: payment.id });
    expect(last.details.reason).toBe("Error de digitación");
    expect(await harness.repositories.receipts.findByPaymentId("org-1", payment.id)).toEqual(receipt);
  });

  it("después de revertir, se puede registrar el pago correcto", async () => {
    const harness = createHarness();
    const { loan, payment } = await loanWithPayment(harness);
    await harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Monto errado" });

    const corrected = await harness.registerPayment.execute(contextOf(), {
      loanId: loan.id,
      amount: lempiras("2000"),
      method: "CASH",
      idempotencyKey: "key-2",
    });

    expect(corrected.replayed).toBe(false);
    expect(outstandingOf(corrected.loan.balances[0]!).total.toCents()).toBe(75_000);
  });

  describe("rechazos", () => {
    it("exige el motivo", async () => {
      const harness = createHarness();
      const { payment } = await loanWithPayment(harness);

      await expect(
        harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "  " }),
      ).rejects.toThrow(InvalidPaymentError);
    });

    it("no permite revertir dos veces el mismo pago", async () => {
      const harness = createHarness();
      const { payment } = await loanWithPayment(harness);
      await harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Error" });

      await expect(
        harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Otra vez" }),
      ).rejects.toThrow(ConflictError);
      expect(await harness.repositories.ledger.entriesOf("org-1")).toHaveLength(3);
    });

    it("no permite revertir un reverso", async () => {
      const harness = createHarness();
      const { payment } = await loanWithPayment(harness);
      const { reversal } = await harness.reversePayment.execute(contextOf(), {
        paymentId: payment.id,
        reason: "Error",
      });

      await expect(
        harness.reversePayment.execute(contextOf(), { paymentId: reversal.id, reason: "Deshacer" }),
      ).rejects.toThrow(ConflictError);
    });

    it("no encuentra pagos inexistentes ni de otra organización", async () => {
      const harness = createHarness();
      const { payment } = await loanWithPayment(harness);

      await expect(
        harness.reversePayment.execute(contextOf(), { paymentId: "no-existe", reason: "Error" }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        harness.reversePayment.execute(contextOf("org-2"), { paymentId: payment.id, reason: "Error" }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

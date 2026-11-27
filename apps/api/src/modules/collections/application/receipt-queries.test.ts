import { Money } from "@app/domain";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../../shared/application/errors";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";
import { ReceiptQueries, borrowerHintOf } from "./receipt-queries";
import { longDate, renderReceiptPdf, verificationUrl } from "../infrastructure/receipt-pdf";

async function paidLoan() {
  const harness = createHarness({ today: "2026-12-01" });
  const borrower = await harness.createBorrower.execute(contextOf(), {
    fullName: "María Fernanda López",
    nationalId: "0801199012345",
    privacyConsent: true,
  });
  const loan = await harness.approveLoan.execute(contextOf(), { borrowerId: borrower.id, terms: standardTerms() });
  await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });
  const { payment, receipt } = await harness.registerPayment.execute(contextOf(), {
    loanId: loan.id,
    amount: Money.fromLempiras("1000"),
    method: "CASH",
    idempotencyKey: "k-1",
  });
  const queries = new ReceiptQueries({ repositories: harness.database.repositories() });
  return { harness, queries, payment, receipt, loan };
}

describe("ReceiptQueries", () => {
  it("arma los datos del recibo con el reparto del pago", async () => {
    const { queries, payment } = await paidLoan();

    const view = await queries.forPayment(contextOf(), payment.id);

    expect(view).toMatchObject({
      folio: "REC-000001",
      borrowerName: "María Fernanda López",
      loanCode: "PR-0001",
      amountCents: 100_000,
      voided: false,
    });
    const allocated = view.allocation.lateFeeCents + view.allocation.interestCents + view.allocation.principalCents;
    expect(allocated).toBe(100_000);
    expect(view.loanBalanceCents).toBe(1_100_000 - 100_000);
  });

  it("no entrega recibos de otra organización", async () => {
    const { queries, payment } = await paidLoan();

    await expect(queries.forPayment(contextOf("org-2"), payment.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la verificación pública confirma el recibo sin exponer datos personales", async () => {
    const { queries, receipt } = await paidLoan();

    const verification = await queries.verify(receipt.verificationCode);

    expect(verification).toMatchObject({ valid: true, folio: "REC-000001", amountCents: 100_000, borrowerHint: "María L." });
    expect(JSON.stringify(verification)).not.toContain("Fernanda");
    expect(JSON.stringify(verification)).not.toContain("0801");
  });

  it("un código inventado no verifica nada", async () => {
    const { queries } = await paidLoan();

    expect(await queries.verify("CODIGO-FALSO")).toBeNull();
  });

  it("si el pago se revierte, el recibo queda anulado", async () => {
    const { harness, queries, payment, receipt } = await paidLoan();

    await harness.reversePayment.execute(contextOf(), { paymentId: payment.id, reason: "Se registró dos veces" });

    expect(await queries.verify(receipt.verificationCode)).toMatchObject({ valid: false, voided: true });
    expect((await queries.forPayment(contextOf(), payment.id)).voided).toBe(true);
  });
});

describe("renderReceiptPdf", () => {
  it("genera un PDF válido, también anulado", async () => {
    const { queries, payment } = await paidLoan();
    const view = await queries.forPayment(contextOf(), payment.id);

    const pdf = await renderReceiptPdf(view, "https://credismart.example");
    const voided = await renderReceiptPdf({ ...view, voided: true }, "https://credismart.example/");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    expect(voided.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("la dirección del QR lleva el código y no duplica barras", () => {
    expect(verificationUrl("https://x.example/", "AB-12")).toBe("https://x.example/verificar/AB-12");
  });

  it("escribe fechas en español", () => {
    expect(longDate("2026-12-01")).toBe("1 de diciembre de 2026");
  });
});

describe("borrowerHintOf", () => {
  it("deja solo el nombre y la inicial del último apellido", () => {
    expect(borrowerHintOf("María Fernanda López")).toBe("María L.");
    expect(borrowerHintOf("Pedro")).toBe("Pedro");
  });
});

describe("borrowerHintOf con anotaciones", () => {
  it("ignora lo que va entre paréntesis", () => {
    expect(borrowerHintOf("Pedro Antonio Zelaya (demo)")).toBe("Pedro Z.");
  });
});

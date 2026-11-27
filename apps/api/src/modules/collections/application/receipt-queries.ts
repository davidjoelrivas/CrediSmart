import { Money, outstandingOf, type PaymentAllocation } from "@app/domain";
import { NotFoundError } from "../../../shared/application/errors";
import type { RequestContext } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import type { ReceiptVerification, ReceiptView } from "@app/contracts";
import { formatReceiptFolio } from "../domain/receipt";

export type { ReceiptVerification, ReceiptView };

/** "María Fernanda López" → "María L." */
export function borrowerHintOf(fullName: string): string {
  const parts = fullName.replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]! : "";
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export class ReceiptQueries {
  constructor(private readonly deps: { repositories: Repositories }) {}

  async forPayment(context: RequestContext, paymentId: string): Promise<ReceiptView> {
    const { repositories } = this.deps;
    const payment = await repositories.payments.findById(context.organizationId, paymentId);
    const receipt = payment
      ? await repositories.receipts.findByPaymentId(context.organizationId, payment.id)
      : null;
    if (!payment || !receipt) {
      throw new NotFoundError("Recibo del pago", paymentId);
    }
    const [loan, organization, reversal] = await Promise.all([
      repositories.loans.findById(context.organizationId, payment.loanId),
      repositories.organizations.findById(context.organizationId),
      repositories.payments.findReversalOf(context.organizationId, payment.id),
    ]);
    if (!loan) {
      throw new NotFoundError("Préstamo", payment.loanId);
    }
    const names = await repositories.borrowers.namesByIds(context.organizationId, [loan.borrowerId]);

    const total = (pick: (allocation: PaymentAllocation) => Money) =>
      payment.allocations.reduce((sum, allocation) => sum.add(pick(allocation)), Money.zero()).toCents();

    return {
      folio: formatReceiptFolio(receipt.folio),
      issuedOn: receipt.issuedOn,
      verificationCode: receipt.verificationCode,
      organizationName: organization?.name ?? "CrediSmart",
      borrowerName: names.get(loan.borrowerId) ?? "Cliente",
      loanCode: loan.code,
      amountCents: payment.amount.toCents(),
      method: payment.method,
      reference: payment.reference,
      receivedOn: payment.receivedOn,
      allocation: {
        lateFeeCents: total((allocation) => allocation.lateFee),
        interestCents: total((allocation) => allocation.interest),
        principalCents: total((allocation) => allocation.principal),
      },
      loanBalanceCents: loan.balances
        .reduce((sum, balance) => sum.add(outstandingOf(balance).total), Money.zero())
        .toCents(),
      voided: reversal !== null,
    };
  }

  /** Verificación pública del QR. Devuelve null si el código no existe. */
  async verify(code: string): Promise<ReceiptVerification | null> {
    const { repositories } = this.deps;
    const receipt = await repositories.receipts.findByVerificationCode(code);
    if (!receipt) {
      return null;
    }
    const payment = await repositories.payments.findById(receipt.organizationId, receipt.paymentId);
    if (!payment) {
      return null;
    }
    const [loan, organization, reversal] = await Promise.all([
      repositories.loans.findById(receipt.organizationId, payment.loanId),
      repositories.organizations.findById(receipt.organizationId),
      repositories.payments.findReversalOf(receipt.organizationId, payment.id),
    ]);
    const names = loan
      ? await repositories.borrowers.namesByIds(receipt.organizationId, [loan.borrowerId])
      : new Map<string, string>();
    return {
      valid: reversal === null,
      voided: reversal !== null,
      folio: formatReceiptFolio(receipt.folio),
      issuedOn: receipt.issuedOn,
      receivedOn: payment.receivedOn,
      amountCents: payment.amount.toCents(),
      organizationName: organization?.name ?? "CrediSmart",
      borrowerHint: borrowerHintOf((loan && names.get(loan.borrowerId)) || "Cliente"),
    };
  }
}

import {
  daysOverdue,
  describeLateFee,
  Money,
  outstandingOf,
  statusOf,
  type InstallmentStatus,
  type LateFeeConfig,
} from "@app/domain";
import { NotFoundError } from "../../../shared/application/errors";
import type { Clock, RequestContext } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import type {
  InstallmentView,
  LoanDetailView,
  LoanSummaryView,
  PaymentView,
} from "@app/contracts";
import { formatReceiptFolio } from "../../collections/domain/receipt";
import type { Loan, LoanStatus } from "../domain/loan";

export type { InstallmentView, LoanDetailView, LoanSummaryView, PaymentView };

function summaryOf(loan: Loan, borrowerName: string, asOf: string): LoanSummaryView {
  const outstanding = loan.balances.reduce((sum, balance) => sum.add(outstandingOf(balance).total), Money.zero());
  const next = loan.status === "ACTIVE" ? loan.balances.find((balance) => statusOf(balance) !== "PAID") : undefined;
  return {
    id: loan.id,
    code: loan.code,
    borrowerId: loan.borrowerId,
    borrowerName,
    status: loan.status,
    principalCents: loan.terms.principal.toCents(),
    aprBp: loan.aprBp,
    installments: loan.terms.installments,
    outstandingCents: loan.status === "PAID_OFF" || loan.status === "CANCELLED" ? 0 : outstanding.toCents(),
    nextDueDate: next?.dueDate ?? null,
    nextDueCents: next ? outstandingOf(next).total.toCents() : 0,
    daysOverdue: loan.status === "ACTIVE" ? daysOverdue(loan.balances, asOf) : 0,
    approvedOn: loan.approvedOn,
    disbursedOn: loan.disbursedOn,
  };
}

/** Lecturas de préstamos para las pantallas: listado con filtros y detalle con cuotas y pagos. */
export class LoanQueries {
  constructor(private readonly deps: { repositories: Repositories; clock: Clock }) {}

  async list(
    context: RequestContext,
    filter: { status?: LoanStatus; borrowerId?: string; overdueOnly?: boolean } = {},
  ): Promise<LoanSummaryView[]> {
    const { repositories } = this.deps;
    const asOf = this.deps.clock.today();
    const loans = (await repositories.loans.listByOrganization(context.organizationId)).filter(
      (loan) =>
        (!filter.status || loan.status === filter.status) &&
        (!filter.borrowerId || loan.borrowerId === filter.borrowerId),
    );
    const names = await repositories.borrowers.namesByIds(context.organizationId, [
      ...new Set(loans.map((loan) => loan.borrowerId)),
    ]);

    const views = loans.map((loan) => summaryOf(loan, names.get(loan.borrowerId) ?? "Cliente", asOf));
    const result = filter.overdueOnly ? views.filter((view) => view.daysOverdue > 0) : views;
    return result.sort((first, second) => second.code.localeCompare(first.code));
  }

  async get(context: RequestContext, loanId: string): Promise<LoanDetailView> {
    const { repositories } = this.deps;
    const asOf = this.deps.clock.today();
    const loan = await repositories.loans.findById(context.organizationId, loanId);
    if (!loan) {
      throw new NotFoundError("Préstamo", loanId);
    }
    const names = await repositories.borrowers.namesByIds(context.organizationId, [loan.borrowerId]);
    const payments = await repositories.payments.listByLoan(context.organizationId, loan.id);
    const reversedIds = new Set(payments.map((payment) => payment.reversesPaymentId).filter(Boolean));

    const paymentViews: PaymentView[] = [];
    for (const payment of payments) {
      const receipt = await repositories.receipts.findByPaymentId(context.organizationId, payment.id);
      paymentViews.push({
        id: payment.id,
        amountCents: payment.amount.toCents(),
        method: payment.method,
        reference: payment.reference,
        receivedOn: payment.receivedOn,
        isReversal: payment.reversesPaymentId !== null,
        reversesPaymentId: payment.reversesPaymentId,
        reversalReason: payment.reversalReason,
        reversed: reversedIds.has(payment.id),
        receiptFolio: receipt ? formatReceiptFolio(receipt.folio) : null,
        verificationCode: receipt?.verificationCode ?? null,
      });
    }

    return {
      ...summaryOf(loan, names.get(loan.borrowerId) ?? "Cliente", asOf),
      terms: {
        rateBp: loan.terms.rateBp,
        ratePeriod: loan.terms.ratePeriod,
        paymentFrequency: loan.terms.paymentFrequency,
        interestMethod: loan.terms.interestMethod ?? "FLAT",
        startDate: loan.terms.startDate,
      },
      lateFee: {
        config: loan.lateFee,
        graceDays: loan.graceDays,
        description: describeLateFee(loan.lateFee, loan.graceDays),
      },
      aprCapOverrideReason: loan.aprCapOverrideReason,
      installmentsDetail: loan.balances.map((balance) => {
        const outstanding = outstandingOf(balance);
        const status = statusOf(balance);
        return {
          number: balance.number,
          dueDate: balance.dueDate,
          status,
          principalDueCents: balance.principalDue.toCents(),
          interestDueCents: balance.interestDue.toCents(),
          lateFeeDueCents: balance.lateFeeDue.toCents(),
          paidCents: balance.principalPaid.add(balance.interestPaid).add(balance.lateFeePaid).toCents(),
          outstandingCents: outstanding.total.toCents(),
          isOverdue: loan.status === "ACTIVE" && status !== "PAID" && balance.dueDate < asOf,
        };
      }),
      payments: paymentViews,
    };
  }
}

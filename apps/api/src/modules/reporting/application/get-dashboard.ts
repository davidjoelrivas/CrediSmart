import {
  addDays,
  daysOverdue,
  Money,
  outstandingOf,
  summarize,
  type InstallmentBalance,
} from "@app/domain";
import type { Clock, RequestContext } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import type {
  DashboardView,
  OverdueLoanView,
  RecentPaymentView,
  UpcomingInstallmentView,
} from "@app/contracts";
import type { Loan } from "../../lending/domain/loan";

export type { DashboardView, OverdueLoanView, RecentPaymentView, UpcomingInstallmentView };

const UPCOMING_DAYS = 7;
const TOP_OVERDUE = 5;
const UPCOMING_LIMIT = 10;
const RECENT_PAYMENTS = 8;

function overdueAmountOf(balances: readonly InstallmentBalance[], asOf: string): Money {
  return balances
    .filter((balance) => balance.dueDate < asOf)
    .reduce((sum, balance) => sum.add(outstandingOf(balance).total), Money.zero());
}

function principalOutstandingOf(loan: Loan): Money {
  return loan.balances.reduce((sum, balance) => sum.add(outstandingOf(balance).principal), Money.zero());
}

function shareBp(part: Money, whole: Money): number {
  return whole.isZero() ? 0 : Math.round((part.toCents() * 10_000) / whole.toCents());
}

/** Arma el tablero del prestamista a partir de los préstamos, los pagos y la contabilidad. */
export class GetDashboard {
  constructor(private readonly deps: { repositories: Repositories; clock: Clock }) {}

  async execute(context: RequestContext): Promise<DashboardView> {
    const { repositories } = this.deps;
    const asOf = this.deps.clock.today();
    const monthStart = `${asOf.slice(0, 7)}-01`;

    const [loans, entries, collected, recent] = await Promise.all([
      repositories.loans.listByOrganization(context.organizationId),
      repositories.ledger.entriesOf(context.organizationId),
      repositories.payments.netReceivedBetween(context.organizationId, monthStart, asOf),
      repositories.payments.listRecent(context.organizationId, RECENT_PAYMENTS),
    ]);
    const borrowerIds = [...new Set(loans.map((loan) => loan.borrowerId))];
    const borrowerName = await repositories.borrowers.namesByIds(context.organizationId, borrowerIds);
    const nameOf = (loan: Loan) => borrowerName.get(loan.borrowerId) ?? "Cliente";
    const loanById = new Map(loans.map((loan) => [loan.id, loan]));

    const summary = summarize(entries);
    const activeLoans = loans.filter((loan) => loan.status === "ACTIVE");

    let outstandingPrincipal = Money.zero();
    let atRisk7 = Money.zero();
    let atRisk30 = Money.zero();
    let overdueAmount = Money.zero();
    const overdue: OverdueLoanView[] = [];
    for (const loan of activeLoans) {
      const principal = principalOutstandingOf(loan);
      outstandingPrincipal = outstandingPrincipal.add(principal);
      const days = daysOverdue(loan.balances, asOf);
      if (days === 0) {
        continue;
      }
      const amount = overdueAmountOf(loan.balances, asOf);
      overdueAmount = overdueAmount.add(amount);
      if (days > 7) {
        atRisk7 = atRisk7.add(principal);
      }
      if (days > 30) {
        atRisk30 = atRisk30.add(principal);
      }
      overdue.push({
        loanId: loan.id,
        loanCode: loan.code,
        borrowerId: loan.borrowerId,
        borrowerName: nameOf(loan),
        daysOverdue: days,
        overdueCents: amount.toCents(),
      });
    }
    overdue.sort((first, second) => second.daysOverdue - first.daysOverdue || second.overdueCents - first.overdueCents);

    const horizon = addDays(asOf, UPCOMING_DAYS);
    const upcoming: UpcomingInstallmentView[] = [];
    for (const loan of activeLoans) {
      for (const balance of loan.balances) {
        const outstanding = outstandingOf(balance);
        if (balance.dueDate >= asOf && balance.dueDate <= horizon && !outstanding.total.isZero()) {
          upcoming.push({
            loanId: loan.id,
            loanCode: loan.code,
            borrowerName: nameOf(loan),
            installmentNumber: balance.number,
            dueDate: balance.dueDate,
            amountCents: outstanding.total.toCents(),
          });
        }
      }
    }
    upcoming.sort((first, second) => first.dueDate.localeCompare(second.dueDate));

    return {
      asOf,
      capital: {
        cashCents: summary.cash.toCents(),
        portfolioCents: summary.portfolio.toCents(),
        totalCents: summary.totalCapital.toCents(),
      },
      income: {
        interestCents: summary.interestIncome.toCents(),
        lateFeeCents: summary.lateFeeIncome.toCents(),
        netIncomeCents: summary.netIncome.toCents(),
        collectedThisMonthCents: collected.toCents(),
      },
      loans: {
        active: activeLoans.length,
        pendingSignature: loans.filter((loan) => loan.status === "PENDING_SIGNATURE").length,
        paidOff: loans.filter((loan) => loan.status === "PAID_OFF").length,
        total: loans.length,
      },
      risk: {
        outstandingPrincipalCents: outstandingPrincipal.toCents(),
        overdueLoans: overdue.length,
        overdueAmountCents: overdueAmount.toCents(),
        par7Bp: shareBp(atRisk7, outstandingPrincipal),
        par30Bp: shareBp(atRisk30, outstandingPrincipal),
      },
      topOverdue: overdue.slice(0, TOP_OVERDUE),
      upcoming: upcoming.slice(0, UPCOMING_LIMIT),
      recentPayments: recent.map((payment) => {
        const loan = loanById.get(payment.loanId);
        return {
          paymentId: payment.id,
          loanCode: loan?.code ?? "—",
          borrowerName: loan ? nameOf(loan) : "Cliente",
          amountCents: payment.amount.toCents(),
          method: payment.method,
          receivedOn: payment.receivedOn,
          isReversal: payment.reversesPaymentId !== null,
        };
      }),
    };
  }
}

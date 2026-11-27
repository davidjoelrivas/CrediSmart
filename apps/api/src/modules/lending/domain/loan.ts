import {
  createBalance,
  statusOf,
  type InstallmentBalance,
  type LoanTerms,
  buildSchedule,
} from "@app/domain";

export type LoanStatus = "PENDING_SIGNATURE" | "ACTIVE" | "PAID_OFF" | "WRITTEN_OFF" | "CANCELLED";

export class InvalidLoanTransitionError extends Error {
  constructor(from: LoanStatus, action: string) {
    super(`No se puede ${action} un préstamo en estado ${from}`);
    this.name = "InvalidLoanTransitionError";
  }
}

/** Préstamo: condiciones pactadas, saldos de cada cuota y estado dentro de su ciclo de vida. */
export interface Loan {
  id: string;
  organizationId: string;
  borrowerId: string;
  /** Código legible dentro de la organización, por ejemplo PR-0001. */
  code: string;
  terms: LoanTerms;
  /** Tasa efectiva anual en puntos base, calculada al aprobar. */
  aprBp: number;
  /** Motivo con el que se aprobó a pesar de superar el tope legal configurado; null si no hizo falta. */
  aprCapOverrideReason: string | null;
  status: LoanStatus;
  balances: readonly InstallmentBalance[];
  approvedOn: string;
  disbursedOn: string | null;
  /** Fecha en que se terminó de pagar; null mientras tenga saldo. */
  closedOn: string | null;
}

export interface NewLoan {
  id: string;
  organizationId: string;
  borrowerId: string;
  code: string;
  terms: LoanTerms;
  aprBp: number;
  aprCapOverrideReason: string | null;
  approvedOn: string;
}

/** Un préstamo recién aprobado: ya tiene su plan de cuotas y espera la firma y el desembolso. */
export function approveLoan(input: NewLoan): Loan {
  return {
    ...input,
    status: "PENDING_SIGNATURE",
    balances: buildSchedule(input.terms).map(createBalance),
    disbursedOn: null,
    closedOn: null,
  };
}

/** Marca el préstamo como desembolsado: solo es posible desde "pendiente de firma". */
export function activateLoan(loan: Loan, disbursedOn: string): Loan {
  if (loan.status !== "PENDING_SIGNATURE") {
    throw new InvalidLoanTransitionError(loan.status, "desembolsar");
  }
  return { ...loan, status: "ACTIVE", disbursedOn };
}

/**
 * Registra un pago sobre un préstamo activo: guarda los nuevos saldos de las cuotas y,
 * si ya no se debe nada, lo marca como pagado.
 */
export function recordPaymentOnLoan(
  loan: Loan,
  balances: readonly InstallmentBalance[],
  paidOn: string,
): Loan {
  if (loan.status !== "ACTIVE") {
    throw new InvalidLoanTransitionError(loan.status, "registrar pagos sobre");
  }
  const fullyPaid = balances.every((balance) => statusOf(balance) === "PAID");
  return {
    ...loan,
    balances,
    status: fullyPaid ? "PAID_OFF" : "ACTIVE",
    closedOn: fullyPaid ? paidOn : null,
  };
}

/** Devuelve el préstamo a activo con los saldos restaurados después de revertir un pago. */
export function restoreLoanAfterReversal(loan: Loan, balances: readonly InstallmentBalance[]): Loan {
  if (loan.status !== "ACTIVE" && loan.status !== "PAID_OFF") {
    throw new InvalidLoanTransitionError(loan.status, "revertir pagos de");
  }
  return { ...loan, balances, status: "ACTIVE", closedOn: null };
}

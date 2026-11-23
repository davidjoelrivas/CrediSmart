import { Money } from "./money";
import type { Installment } from "./schedule";

export type InstallmentStatus = "PENDING" | "PARTIAL" | "PAID";

/** Estado de una cuota: lo que debe y lo que ya se pagó, separado por componente. */
export interface InstallmentBalance {
  number: number;
  dueDate: string;
  principalDue: Money;
  interestDue: Money;
  lateFeeDue: Money;
  principalPaid: Money;
  interestPaid: Money;
  lateFeePaid: Money;
}

export interface Outstanding {
  principal: Money;
  interest: Money;
  lateFee: Money;
  total: Money;
}

export class InvalidBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBalanceError";
  }
}

/** Crea el saldo inicial de una cuota recién generada: nada pagado y sin mora. */
export function createBalance(installment: Installment): InstallmentBalance {
  return {
    number: installment.number,
    dueDate: installment.dueDate,
    principalDue: installment.principal,
    interestDue: installment.interest,
    lateFeeDue: Money.zero(),
    principalPaid: Money.zero(),
    interestPaid: Money.zero(),
    lateFeePaid: Money.zero(),
  };
}

/** Lo que todavía falta pagar de cada componente. */
export function outstandingOf(balance: InstallmentBalance): Outstanding {
  const principal = balance.principalDue.subtract(balance.principalPaid);
  const interest = balance.interestDue.subtract(balance.interestPaid);
  const lateFee = balance.lateFeeDue.subtract(balance.lateFeePaid);
  return { principal, interest, lateFee, total: principal.add(interest).add(lateFee) };
}

export function statusOf(balance: InstallmentBalance): InstallmentStatus {
  if (outstandingOf(balance).total.isZero()) {
    return "PAID";
  }
  const paid = balance.principalPaid.add(balance.interestPaid).add(balance.lateFeePaid);
  return paid.isZero() ? "PENDING" : "PARTIAL";
}

function requireConsistentComponent(due: Money, paid: Money, label: string): void {
  if (due.isNegative() || paid.isNegative()) {
    throw new InvalidBalanceError(`El monto de ${label} no puede ser negativo`);
  }
  if (paid.compareTo(due) === 1) {
    throw new InvalidBalanceError(`Lo pagado de ${label} no puede superar lo debido`);
  }
}

/** Verifica que los montos de una cuota sean coherentes (nada negativo, nada pagado de más). */
export function validateBalance(balance: InstallmentBalance): void {
  requireConsistentComponent(balance.principalDue, balance.principalPaid, "capital");
  requireConsistentComponent(balance.interestDue, balance.interestPaid, "interés");
  requireConsistentComponent(balance.lateFeeDue, balance.lateFeePaid, "mora");
}

import {
  outstandingOf,
  validateBalance,
  type InstallmentBalance,
} from "./installment-balance";
import { Money } from "./money";

/** Cómo se repartió un pago dentro de una cuota. */
export interface PaymentAllocation {
  installmentNumber: number;
  lateFee: Money;
  interest: Money;
  principal: Money;
}

export interface AllocationResult {
  /** Solo las cuotas que recibieron dinero, de la más antigua a la más reciente. */
  allocations: PaymentAllocation[];
  /** Saldos actualizados de todas las cuotas, en el mismo orden en que se recibieron. */
  balances: InstallmentBalance[];
  /** Dinero que sobró porque ya no quedaba nada por pagar. */
  unallocated: Money;
}

export class InvalidPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentError";
  }
}

function smallerOf(first: Money, second: Money): Money {
  return first.compareTo(second) === 1 ? second : first;
}

function byDueDateThenNumber(first: InstallmentBalance, second: InstallmentBalance): number {
  if (first.dueDate !== second.dueDate) {
    return first.dueDate < second.dueDate ? -1 : 1;
  }
  return first.number - second.number;
}

/**
 * Reparte un pago entre las cuotas: primero la cuota más antigua y, dentro de
 * cada cuota, mora → interés → capital. Si el pago alcanza, el excedente pasa a
 * las cuotas siguientes (adelanto). Lo que sobre al saldar todo se devuelve en
 * `unallocated`. No modifica los saldos recibidos.
 */
export function allocatePayment(
  balances: readonly InstallmentBalance[],
  payment: Money,
): AllocationResult {
  if (payment.toCents() <= 0) {
    throw new InvalidPaymentError("El pago debe ser mayor que cero");
  }
  balances.forEach(validateBalance);

  const updatedByNumber = new Map<number, InstallmentBalance>();
  const allocations: PaymentAllocation[] = [];
  let remaining = payment;

  for (const balance of [...balances].sort(byDueDateThenNumber)) {
    if (remaining.isZero()) {
      break;
    }
    const outstanding = outstandingOf(balance);
    if (outstanding.total.isZero()) {
      continue;
    }

    const lateFee = smallerOf(remaining, outstanding.lateFee);
    remaining = remaining.subtract(lateFee);
    const interest = smallerOf(remaining, outstanding.interest);
    remaining = remaining.subtract(interest);
    const principal = smallerOf(remaining, outstanding.principal);
    remaining = remaining.subtract(principal);

    allocations.push({ installmentNumber: balance.number, lateFee, interest, principal });
    updatedByNumber.set(balance.number, {
      ...balance,
      lateFeePaid: balance.lateFeePaid.add(lateFee),
      interestPaid: balance.interestPaid.add(interest),
      principalPaid: balance.principalPaid.add(principal),
    });
  }

  return {
    allocations,
    balances: balances.map((balance) => updatedByNumber.get(balance.number) ?? balance),
    unallocated: remaining,
  };
}

/**
 * Deshace la aplicación de un pago: devuelve los saldos como estaban antes de
 * recibirlo. Falla si el pago deshecho no coincide con lo que realmente se aplicó
 * (por ejemplo, revertir dos veces el mismo pago). No modifica los saldos recibidos.
 */
export function reverseAllocations(
  balances: readonly InstallmentBalance[],
  allocations: readonly PaymentAllocation[],
): InstallmentBalance[] {
  const known = new Set(balances.map((balance) => balance.number));
  for (const allocation of allocations) {
    if (!known.has(allocation.installmentNumber)) {
      throw new InvalidPaymentError(
        `El pago hace referencia a la cuota ${allocation.installmentNumber}, que no existe`,
      );
    }
  }

  const byNumber = new Map(allocations.map((allocation) => [allocation.installmentNumber, allocation]));
  return balances.map((balance) => {
    const allocation = byNumber.get(balance.number);
    if (!allocation) {
      return balance;
    }
    const restored = {
      ...balance,
      lateFeePaid: balance.lateFeePaid.subtract(allocation.lateFee),
      interestPaid: balance.interestPaid.subtract(allocation.interest),
      principalPaid: balance.principalPaid.subtract(allocation.principal),
    };
    validateBalance(restored);
    return restored;
  });
}

import { daysBetween } from "./dates";
import { outstandingOf, type InstallmentBalance } from "./installment-balance";
import { calculateLateFee } from "./late-fee";
import { lateFeePolicyFromConfig, type LateFeeConfig } from "./late-fee-config";

export interface LateFeeAccrual {
  balances: InstallmentBalance[];
  /** Cuántas cuotas cambiaron su mora en esta corrida. */
  changedInstallments: number;
}

/**
 * Pone al día la mora de las cuotas vencidas de un préstamo al día `asOf`.
 *
 * Es idempotente y nunca baja: la mora de una cuota solo crece (o se queda igual), así que correrla
 * dos veces el mismo día, o todos los días, da el mismo resultado. La mora se calcula sobre lo que
 * sigue vencido de capital e interés; cuando el cliente paga, la mora ya generada no desaparece.
 */
export function accrueLateFees(
  balances: readonly InstallmentBalance[],
  config: LateFeeConfig,
  graceDays: number,
  asOf: string,
): LateFeeAccrual {
  const policy = lateFeePolicyFromConfig(config);
  let changedInstallments = 0;

  const updated = balances.map((balance) => {
    if (balance.dueDate >= asOf) {
      return balance;
    }
    const outstanding = outstandingOf(balance);
    const overdueAmount = outstanding.principal.add(outstanding.interest);
    const computed = calculateLateFee({
      policy,
      dueDate: balance.dueDate,
      overdueAmount,
      asOf,
      graceDays,
    });
    // Nunca baja, y nunca queda por debajo de lo que ya se pagó de mora.
    if (computed.compareTo(balance.lateFeeDue) !== 1) {
      return balance;
    }
    changedInstallments += 1;
    return { ...balance, lateFeeDue: computed };
  });

  return { balances: updated, changedInstallments };
}

/** Días de atraso de la cuota vencida más antigua que todavía debe capital o interés; 0 si está al día. */
export function daysOverdue(balances: readonly InstallmentBalance[], asOf: string): number {
  let oldest = 0;
  for (const balance of balances) {
    const outstanding = outstandingOf(balance);
    if (balance.dueDate < asOf && !outstanding.principal.add(outstanding.interest).isZero()) {
      oldest = Math.max(oldest, daysBetween(balance.dueDate, asOf));
    }
  }
  return oldest;
}

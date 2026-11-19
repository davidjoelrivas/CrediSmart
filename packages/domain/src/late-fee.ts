import { daysBetween, isValidIsoDate } from "./dates";
import { Money } from "./money";

/**
 * Política de mora de un préstamo. Cada tipo se calcula con su propia regla:
 * - NONE: no se cobra mora.
 * - PERCENT_OF_OVERDUE: un porcentaje único sobre el monto vencido.
 * - FIXED_PER_DAY: un monto fijo por cada día de atraso.
 * - PERCENT_PER_DAY: un porcentaje diario sobre el monto vencido.
 */
export type LateFeePolicy =
  | { type: "NONE" }
  | { type: "PERCENT_OF_OVERDUE"; rateBp: number }
  | { type: "FIXED_PER_DAY"; amountPerDay: Money }
  | { type: "PERCENT_PER_DAY"; rateBp: number };

export interface LateFeeInput {
  policy: LateFeePolicy;
  /** Fecha de vencimiento de la cuota (AAAA-MM-DD). */
  dueDate: string;
  /** Monto vencido que sigue sin pagarse. */
  overdueAmount: Money;
  /** Fecha en que se calcula la mora, es decir "hoy" (AAAA-MM-DD). */
  asOf: string;
  /** Días de gracia después del vencimiento en los que no se cobra mora. */
  graceDays: number;
}

export class InvalidLateFeeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLateFeeInputError";
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validateLateFeeInput(input: LateFeeInput): void {
  if (!isValidIsoDate(input.dueDate) || !isValidIsoDate(input.asOf)) {
    throw new InvalidLateFeeInputError("Las fechas deben tener el formato AAAA-MM-DD");
  }
  if (!isNonNegativeInteger(input.graceDays)) {
    throw new InvalidLateFeeInputError("Los días de gracia deben ser un entero mayor o igual a 0");
  }
  if (input.overdueAmount.isNegative()) {
    throw new InvalidLateFeeInputError("El monto vencido no puede ser negativo");
  }
  const { policy } = input;
  if (
    (policy.type === "PERCENT_OF_OVERDUE" || policy.type === "PERCENT_PER_DAY") &&
    !isNonNegativeInteger(policy.rateBp)
  ) {
    throw new InvalidLateFeeInputError("La tasa de mora debe ser un entero en puntos base");
  }
  if (policy.type === "FIXED_PER_DAY" && policy.amountPerDay.isNegative()) {
    throw new InvalidLateFeeInputError("El monto diario de mora no puede ser negativo");
  }
}

/**
 * Calcula la mora de una cuota vencida. Una cuota está en mora cuando
 * `asOf` es posterior a `dueDate + graceDays`; pasado ese punto, los días de
 * atraso se cuentan desde el vencimiento.
 */
export function calculateLateFee(input: LateFeeInput): Money {
  validateLateFeeInput(input);

  const daysLate = daysBetween(input.dueDate, input.asOf);
  if (daysLate <= input.graceDays || input.overdueAmount.isZero()) {
    return Money.zero();
  }

  const { policy, overdueAmount } = input;
  switch (policy.type) {
    case "NONE":
      return Money.zero();
    case "PERCENT_OF_OVERDUE":
      return overdueAmount.multiplyByBasisPoints(policy.rateBp);
    case "FIXED_PER_DAY":
      return policy.amountPerDay.multiplyByRatio(daysLate, 1);
    case "PERCENT_PER_DAY":
      return overdueAmount.multiplyByBasisPoints(policy.rateBp * daysLate);
  }
}

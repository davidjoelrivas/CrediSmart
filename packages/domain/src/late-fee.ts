import { daysBetween, isValidIsoDate } from "./dates";
import { Money } from "./money";

export class InvalidLateFeeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLateFeeInputError";
  }
}

/**
 * Regla para calcular la mora de una cuota vencida (principio abierto/cerrado):
 * cada política es una clase que implementa esta interfaz. Para agregar una
 * política nueva se crea otra clase; `calculateLateFee` no cambia.
 */
export interface LateFeePolicy {
  /** Mora de un monto vencido con los días de atraso indicados (ya superada la gracia). */
  calculate(overdueAmount: Money, daysLate: number): Money;
}

function requireBasisPoints(rateBp: number): void {
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    throw new InvalidLateFeeInputError("La tasa de mora debe ser un entero en puntos base");
  }
}

/** No se cobra mora. */
export class NoLateFee implements LateFeePolicy {
  calculate(): Money {
    return Money.zero();
  }
}

/** Un porcentaje único sobre el monto vencido, sin importar los días de atraso. */
export class PercentOfOverdueLateFee implements LateFeePolicy {
  constructor(private readonly rateBp: number) {
    requireBasisPoints(rateBp);
  }

  calculate(overdueAmount: Money): Money {
    return overdueAmount.multiplyByBasisPoints(this.rateBp);
  }
}

/** Un monto fijo por cada día de atraso. */
export class FixedPerDayLateFee implements LateFeePolicy {
  constructor(private readonly amountPerDay: Money) {
    if (amountPerDay.isNegative()) {
      throw new InvalidLateFeeInputError("El monto diario de mora no puede ser negativo");
    }
  }

  calculate(_overdueAmount: Money, daysLate: number): Money {
    return this.amountPerDay.multiplyByRatio(daysLate, 1);
  }
}

/** Un porcentaje diario sobre el monto vencido. */
export class PercentPerDayLateFee implements LateFeePolicy {
  constructor(private readonly rateBp: number) {
    requireBasisPoints(rateBp);
  }

  calculate(overdueAmount: Money, daysLate: number): Money {
    return overdueAmount.multiplyByBasisPoints(this.rateBp * daysLate);
  }
}

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

function validateLateFeeInput(input: LateFeeInput): void {
  if (!isValidIsoDate(input.dueDate) || !isValidIsoDate(input.asOf)) {
    throw new InvalidLateFeeInputError("Las fechas deben tener el formato AAAA-MM-DD");
  }
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0) {
    throw new InvalidLateFeeInputError("Los días de gracia deben ser un entero mayor o igual a 0");
  }
  if (input.overdueAmount.isNegative()) {
    throw new InvalidLateFeeInputError("El monto vencido no puede ser negativo");
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
  return input.policy.calculate(input.overdueAmount, daysLate);
}

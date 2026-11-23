import { daysBetween, isValidIsoDate } from "./dates";
import { Money } from "./money";
import type { Installment } from "./schedule";

const DAYS_PER_YEAR = 365;
const BASIS_POINTS_PER_UNIT = 10_000;
const BISECTION_ITERATIONS = 200;
/** Tope de búsqueda: 100,000,000 % anual. Un préstamo a un solo día puede dar tasas enormes. */
const MAX_ANNUAL_RATE = 1_000_000;

export class InvalidAprInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAprInputError";
  }
}

export interface AprPayment {
  /** Fecha del pago (AAAA-MM-DD), posterior a la fecha de inicio. */
  dueDate: string;
  amount: Money;
}

export interface AprInput {
  principal: Money;
  startDate: string;
  payments: readonly AprPayment[];
}

interface DatedCents {
  years: number;
  cents: number;
}

function toDatedPayments(input: AprInput): DatedCents[] {
  if (input.principal.toCents() <= 0) {
    throw new InvalidAprInputError("El capital debe ser mayor que cero");
  }
  if (!isValidIsoDate(input.startDate)) {
    throw new InvalidAprInputError("La fecha de inicio debe tener el formato AAAA-MM-DD");
  }
  if (input.payments.length === 0) {
    throw new InvalidAprInputError("Se necesita al menos un pago para calcular la tasa");
  }
  return input.payments.map((payment) => {
    if (!isValidIsoDate(payment.dueDate) || daysBetween(input.startDate, payment.dueDate) < 1) {
      throw new InvalidAprInputError("Cada pago debe tener una fecha válida posterior al inicio");
    }
    if (payment.amount.toCents() <= 0) {
      throw new InvalidAprInputError("Cada pago debe ser mayor que cero");
    }
    return {
      years: daysBetween(input.startDate, payment.dueDate) / DAYS_PER_YEAR,
      cents: payment.amount.toCents(),
    };
  });
}

/** Valor presente de los pagos a una tasa anual efectiva `rate` (0.10 = 10 %). */
function presentValue(payments: readonly DatedCents[], rate: number): number {
  return payments.reduce((sum, payment) => sum + payment.cents / (1 + rate) ** payment.years, 0);
}

/**
 * Tasa efectiva anual (TEA) del préstamo, en puntos base (1000 = 10 %). Es la
 * tasa anual que iguala el valor presente de los pagos con el capital
 * entregado (con fechas reales, base 365 días). Es un cálculo numérico de una
 * tasa, no de dinero: el resultado se redondea al punto base más cercano.
 */
export function calculateApr(input: AprInput): number {
  const payments = toDatedPayments(input);
  const principalCents = input.principal.toCents();

  const totalCents = payments.reduce((sum, payment) => sum + payment.cents, 0);
  if (totalCents < principalCents) {
    throw new InvalidAprInputError("Los pagos suman menos que el capital entregado");
  }
  if (totalCents === principalCents) {
    return 0;
  }
  if (presentValue(payments, MAX_ANNUAL_RATE) > principalCents) {
    throw new InvalidAprInputError("La tasa efectiva anual excede el rango calculable");
  }

  let low = 0;
  let high = 1;
  while (presentValue(payments, high) > principalCents) {
    low = high;
    high *= 2;
  }
  for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration++) {
    const middle = (low + high) / 2;
    if (presentValue(payments, middle) > principalCents) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.round(((low + high) / 2) * BASIS_POINTS_PER_UNIT);
}

/** TEA de un plan de cuotas generado por `buildSchedule`. */
export function calculateScheduleApr(
  principal: Money,
  startDate: string,
  schedule: readonly Installment[],
): number {
  return calculateApr({
    principal,
    startDate,
    payments: schedule.map((installment) => ({
      dueDate: installment.dueDate,
      amount: installment.total,
    })),
  });
}

export interface AprCapCheck {
  aprBp: number;
  /** Tope legal configurado por la organización, o null si no tiene. */
  capBp: number | null;
  exceeds: boolean;
}

export class AprCapExceededError extends Error {
  constructor(aprBp: number, capBp: number) {
    super(
      `La tasa efectiva anual (${aprBp / 100} %) supera el tope configurado (${capBp / 100} %). ` +
        "Para continuar hay que confirmar explícitamente e indicar el motivo.",
    );
    this.name = "AprCapExceededError";
  }
}

/** Compara la TEA con el tope legal configurado; sin tope, nunca se excede. */
export function checkAprCap(aprBp: number, capBp: number | null): AprCapCheck {
  return { aprBp, capBp, exceeds: capBp !== null && aprBp > capBp };
}

export interface AprCapOverride {
  confirmed: boolean;
  reason: string;
}

export interface AprCapDecision {
  overrideApplied: boolean;
  reason: string | null;
}

/**
 * Si la TEA supera el tope, exige que el prestamista confirme de forma
 * explícita y deje el motivo (queda en la auditoría). No decide por él:
 * la responsabilidad legal de las condiciones es del prestamista.
 */
export function requireAprCapCompliance(
  check: AprCapCheck,
  override?: AprCapOverride,
): AprCapDecision {
  if (!check.exceeds) {
    return { overrideApplied: false, reason: null };
  }
  const reason = override?.reason.trim() ?? "";
  if (!override?.confirmed || reason === "") {
    throw new AprCapExceededError(check.aprBp, check.capBp as number);
  }
  return { overrideApplied: true, reason };
}

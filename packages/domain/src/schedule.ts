import { Money } from "./money";

export type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface LoanTerms {
  principal: Money;
  /** Tasa en puntos base por periodo de tasa (500 = 5 %). */
  rateBp: number;
  ratePeriod: Frequency;
  paymentFrequency: Frequency;
  installments: number;
  /** Fecha de inicio en formato AAAA-MM-DD. */
  startDate: string;
}

export interface Installment {
  number: number;
  dueDate: string;
  principal: Money;
  interest: Money;
  total: Money;
}

const BASIS_POINTS_PER_UNIT = 10_000;
const DAYS_PER_WEEK = 7;

/** Convención comercial: 1 mes = 4 semanas, 1 quincena = 2 semanas. */
const WEEKS_PER_PERIOD: Record<Frequency, number> = {
  WEEKLY: 1,
  BIWEEKLY: 2,
  MONTHLY: 4,
};

export class InvalidLoanTermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLoanTermsError";
  }
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const lastDayOfTargetMonth = new Date(Date.UTC(year!, month! - 1 + months + 1, 0)).getUTCDate();
  const date = new Date(
    Date.UTC(year!, month! - 1 + months, Math.min(day!, lastDayOfTargetMonth)),
  );
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(isoDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && addDays(isoDate, 0) === isoDate;
}

function validateLoanTerms(terms: LoanTerms): void {
  if (!Number.isInteger(terms.installments) || terms.installments < 1) {
    throw new InvalidLoanTermsError("El número de cuotas debe ser un entero mayor o igual a 1");
  }
  if (terms.principal.toCents() <= 0) {
    throw new InvalidLoanTermsError("El capital debe ser mayor que cero");
  }
  if (!Number.isInteger(terms.rateBp) || terms.rateBp < 0) {
    throw new InvalidLoanTermsError("La tasa debe ser un entero en puntos base, sin negativos");
  }
  if (!isValidIsoDate(terms.startDate)) {
    throw new InvalidLoanTermsError("La fecha de inicio debe tener el formato AAAA-MM-DD");
  }
}

/** Interés total con método fijo (FLAT): capital × tasa × periodos de tasa que dura el préstamo. */
function calculateFlatInterest(terms: LoanTerms): Money {
  const weeksPerPayment = WEEKS_PER_PERIOD[terms.paymentFrequency];
  const weeksPerRatePeriod = WEEKS_PER_PERIOD[terms.ratePeriod];
  return terms.principal.multiplyByRatio(
    terms.rateBp * terms.installments * weeksPerPayment,
    BASIS_POINTS_PER_UNIT * weeksPerRatePeriod,
  );
}

/** Fecha de vencimiento de la cuota indicada, contada siempre desde la fecha de inicio. */
function calculateDueDate(terms: LoanTerms, installmentNumber: number): string {
  if (terms.paymentFrequency === "MONTHLY") {
    return addMonths(terms.startDate, installmentNumber);
  }
  const daysPerPayment = DAYS_PER_WEEK * WEEKS_PER_PERIOD[terms.paymentFrequency];
  return addDays(terms.startDate, daysPerPayment * installmentNumber);
}

/** Construye el plan de cuotas con interés fijo (FLAT). */
export function buildSchedule(terms: LoanTerms): Installment[] {
  validateLoanTerms(terms);

  const principalParts = terms.principal.splitEvenly(terms.installments);
  const interestParts = calculateFlatInterest(terms).splitEvenly(terms.installments);

  return principalParts.map((principal, index) => {
    const interest = interestParts[index]!;
    const number = index + 1;
    return {
      number,
      dueDate: calculateDueDate(terms, number),
      principal,
      interest,
      total: principal.add(interest),
    };
  });
}

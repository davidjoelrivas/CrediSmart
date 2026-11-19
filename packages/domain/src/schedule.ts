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

/** Primera versión: calcula el plan de cuotas con interés fijo (FLAT). */
export function buildSchedule(terms: LoanTerms): Installment[] {
  if (!Number.isInteger(terms.installments) || terms.installments < 1) {
    throw new InvalidLoanTermsError("El número de cuotas debe ser un entero mayor o igual a 1");
  }
  if (terms.principal.toCents() <= 0) {
    throw new InvalidLoanTermsError("El capital debe ser mayor que cero");
  }
  if (!Number.isInteger(terms.rateBp) || terms.rateBp < 0) {
    throw new InvalidLoanTermsError("La tasa debe ser un entero en puntos base, sin negativos");
  }
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(terms.startDate);
  if (!dateMatch || addDays(terms.startDate, 0) !== terms.startDate) {
    throw new InvalidLoanTermsError("La fecha de inicio debe tener el formato AAAA-MM-DD");
  }

  let weeksPerPayment: number;
  if (terms.paymentFrequency === "WEEKLY") {
    weeksPerPayment = 1;
  } else if (terms.paymentFrequency === "BIWEEKLY") {
    weeksPerPayment = 2;
  } else {
    weeksPerPayment = 4;
  }

  let weeksPerRatePeriod: number;
  if (terms.ratePeriod === "WEEKLY") {
    weeksPerRatePeriod = 1;
  } else if (terms.ratePeriod === "BIWEEKLY") {
    weeksPerRatePeriod = 2;
  } else {
    weeksPerRatePeriod = 4;
  }

  const totalInterest = terms.principal.multiplyByRatio(
    terms.rateBp * terms.installments * weeksPerPayment,
    10000 * weeksPerRatePeriod,
  );
  const principalParts = terms.principal.splitEvenly(terms.installments);
  const interestParts = totalInterest.splitEvenly(terms.installments);

  const schedule: Installment[] = [];
  for (let number = 1; number <= terms.installments; number++) {
    let dueDate: string;
    if (terms.paymentFrequency === "WEEKLY") {
      dueDate = addDays(terms.startDate, 7 * number);
    } else if (terms.paymentFrequency === "BIWEEKLY") {
      dueDate = addDays(terms.startDate, 14 * number);
    } else {
      dueDate = addMonths(terms.startDate, number);
    }
    const principal = principalParts[number - 1]!;
    const interest = interestParts[number - 1]!;
    schedule.push({ number, dueDate, principal, interest, total: principal.add(interest) });
  }
  return schedule;
}

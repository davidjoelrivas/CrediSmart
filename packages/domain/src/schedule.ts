import { addDays, addMonths, isValidIsoDate } from "./dates";
import {
  buildDecliningParts,
  buildInterestOnlyParts,
  type AmountParts,
  type RatePerPayment,
} from "./interest-methods";
import { Money } from "./money";

export type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/**
 * - FLAT: interés fijo sobre el capital original, cuotas parejas.
 * - DECLINING: interés sobre el saldo, cuota nivelada.
 * - INTEREST_ONLY: solo interés en cada cuota; el capital va en la última.
 */
export type InterestMethod = "FLAT" | "DECLINING" | "INTEREST_ONLY";

export interface LoanTerms {
  /** Si no se indica, se usa interés fijo (FLAT). */
  interestMethod?: InterestMethod;
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
  if (terms.interestMethod !== undefined && !(terms.interestMethod in INTEREST_METHODS)) {
    throw new InvalidLoanTermsError(`Método de interés desconocido: "${terms.interestMethod}"`);
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
/** Interés fijo: el interés total se reparte en partes iguales, igual que el capital. */
function buildFlatParts(terms: LoanTerms): AmountParts {
  return {
    principal: terms.principal.splitEvenly(terms.installments),
    interest: calculateFlatInterest(terms).splitEvenly(terms.installments),
  };
}

function ratePerPayment(terms: LoanTerms): RatePerPayment {
  return {
    numerator: terms.rateBp * WEEKS_PER_PERIOD[terms.paymentFrequency],
    denominator: BASIS_POINTS_PER_UNIT * WEEKS_PER_PERIOD[terms.ratePeriod],
  };
}

/** Cada método de interés es una función aparte: agregar uno nuevo es agregar una entrada. */
const INTEREST_METHODS: Record<InterestMethod, (terms: LoanTerms) => AmountParts> = {
  FLAT: buildFlatParts,
  DECLINING: (terms) =>
    buildDecliningParts(terms.principal, terms.installments, ratePerPayment(terms)),
  INTEREST_ONLY: (terms) =>
    buildInterestOnlyParts(terms.principal, terms.installments, ratePerPayment(terms)),
};

export function buildSchedule(terms: LoanTerms): Installment[] {
  validateLoanTerms(terms);

  const method = INTEREST_METHODS[terms.interestMethod ?? "FLAT"];
  const { principal: principalParts, interest: interestParts } = method(terms);

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

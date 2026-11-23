import { Money } from "./money";

/** Reparto del capital y del interés en cada cuota, de la primera a la última. */
export interface AmountParts {
  principal: Money[];
  interest: Money[];
}

/**
 * Fracción del saldo que se cobra como interés en cada periodo de pago
 * (por ejemplo 250 / 10000 = 2.5 %). Se usa como proporción de enteros para
 * redondear con exactitud al centavo.
 */
export interface RatePerPayment {
  numerator: number;
  denominator: number;
}

function zeros(count: number): Money[] {
  return Array.from({ length: count }, () => Money.zero());
}

/**
 * Solo interés: cada cuota paga el interés sobre el capital completo y todo
 * el capital se devuelve en la última cuota.
 */
export function buildInterestOnlyParts(
  principal: Money,
  installments: number,
  rate: RatePerPayment,
): AmountParts {
  const interestPerPayment = principal.multiplyByRatio(rate.numerator, rate.denominator);
  const principalParts = zeros(installments);
  principalParts[installments - 1] = principal;
  return {
    principal: principalParts,
    interest: Array.from({ length: installments }, () => interestPerPayment),
  };
}

/**
 * Interés sobre saldo con cuota nivelada (sistema francés): el interés de cada
 * cuota se calcula sobre el capital que todavía se debe. La cuota nivelada se
 * calcula con la fórmula de la anualidad y se redondea al centavo; la última
 * cuota salda el capital pendiente y absorbe la diferencia de redondeo.
 */
export function buildDecliningParts(
  principal: Money,
  installments: number,
  rate: RatePerPayment,
): AmountParts {
  const ratePerPayment = rate.numerator / rate.denominator;
  if (ratePerPayment === 0) {
    return { principal: principal.splitEvenly(installments), interest: zeros(installments) };
  }

  const levelPayment = Money.fromCents(
    Math.round(
      (principal.toCents() * ratePerPayment) / (1 - (1 + ratePerPayment) ** -installments),
    ),
  );

  const principalParts: Money[] = [];
  const interestParts: Money[] = [];
  let balance = principal;

  for (let payment = 1; payment <= installments; payment++) {
    const interest = balance.multiplyByRatio(rate.numerator, rate.denominator);
    const isLast = payment === installments;
    const scheduledPrincipal = levelPayment.subtract(interest);
    const principalPart = isLast
      ? balance
      : clamp(scheduledPrincipal, Money.zero(), balance);

    principalParts.push(principalPart);
    interestParts.push(interest);
    balance = balance.subtract(principalPart);
  }
  return { principal: principalParts, interest: interestParts };
}

function clamp(value: Money, minimum: Money, maximum: Money): Money {
  if (value.compareTo(minimum) === -1) return minimum;
  if (value.compareTo(maximum) === 1) return maximum;
  return value;
}

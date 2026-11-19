import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { buildSchedule, InvalidLoanTermsError, type Frequency, type LoanTerms } from "./schedule";

function termsOf(overrides: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principal: Money.fromLempiras("10000"),
    rateBp: 500,
    ratePeriod: "MONTHLY",
    paymentFrequency: "BIWEEKLY",
    installments: 4,
    startDate: "2026-12-01",
    ...overrides,
  };
}

const cents = (money: Money) => money.toCents();

describe("buildSchedule: interés fijo", () => {
  it("L 10,000 al 5 % mensual, 4 cuotas quincenales: 4 cuotas de L 2,750", () => {
    const schedule = buildSchedule(termsOf());

    expect(schedule).toHaveLength(4);
    for (const installment of schedule) {
      expect(cents(installment.principal)).toBe(250000);
      expect(cents(installment.interest)).toBe(25000);
      expect(cents(installment.total)).toBe(275000);
    }
    expect(schedule.map((installment) => installment.dueDate)).toEqual([
      "2026-12-15",
      "2026-12-29",
      "2027-01-12",
      "2027-01-26",
    ]);
  });

  it("pagos semanales con tasa mensual: 4 semanas equivalen a 1 mes de interés", () => {
    const schedule = buildSchedule(
      termsOf({
        principal: Money.fromLempiras("1000"),
        rateBp: 2000,
        paymentFrequency: "WEEKLY",
        installments: 4,
      }),
    );

    expect(schedule.map((installment) => cents(installment.total))).toEqual([
      30000, 30000, 30000, 30000,
    ]);
    expect(schedule.map((installment) => installment.dueDate)).toEqual([
      "2026-12-08",
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
    ]);
  });

  it("pagos mensuales ajustan al último día del mes sin acumular desfases", () => {
    const schedule = buildSchedule(
      termsOf({
        principal: Money.fromLempiras("6000"),
        rateBp: 1000,
        paymentFrequency: "MONTHLY",
        installments: 3,
        startDate: "2026-11-30",
      }),
    );

    expect(schedule.map((installment) => installment.dueDate)).toEqual([
      "2026-12-30",
      "2027-01-30",
      "2027-02-28",
    ]);
    expect(schedule.map((installment) => cents(installment.total))).toEqual([
      260000, 260000, 260000,
    ]);
  });

  it("la última cuota absorbe la diferencia de redondeo", () => {
    const schedule = buildSchedule(
      termsOf({
        principal: Money.fromLempiras("100"),
        rateBp: 1000,
        paymentFrequency: "MONTHLY",
        installments: 3,
      }),
    );

    expect(schedule.map((installment) => cents(installment.principal))).toEqual([
      3333, 3333, 3334,
    ]);
    expect(schedule.map((installment) => cents(installment.interest))).toEqual([
      1000, 1000, 1000,
    ]);
  });

  it("sin interés, las cuotas solo reparten el capital", () => {
    const schedule = buildSchedule(termsOf({ rateBp: 0 }));
    expect(schedule.every((installment) => installment.interest.isZero())).toBe(true);
    const totalPrincipal = schedule.reduce((sum, item) => sum.add(item.principal), Money.zero());
    expect(cents(totalPrincipal)).toBe(1000000);
  });

  it("propiedad: capital, interés y fechas siempre cuadran", () => {
    const frequencies: Frequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.constantFrom(...frequencies),
        fc.constantFrom(...frequencies),
        fc.integer({ min: 1, max: 60 }),
        (principalCents, rateBp, ratePeriod, paymentFrequency, installments) => {
          const principal = Money.fromCents(principalCents);
          const schedule = buildSchedule(
            termsOf({ principal, rateBp, ratePeriod, paymentFrequency, installments }),
          );

          const sumPrincipal = schedule.reduce((sum, item) => sum.add(item.principal), Money.zero());
          const sumTotal = schedule.reduce((sum, item) => sum.add(item.total), Money.zero());
          const sumInterest = schedule.reduce((sum, item) => sum.add(item.interest), Money.zero());

          expect(schedule).toHaveLength(installments);
          expect(cents(sumPrincipal)).toBe(principalCents);
          expect(cents(sumTotal)).toBe(cents(sumPrincipal.add(sumInterest)));
          for (let index = 1; index < schedule.length; index++) {
            expect(schedule[index]!.dueDate > schedule[index - 1]!.dueDate).toBe(true);
          }
        },
      ),
    );
  });
});

describe("buildSchedule: validaciones", () => {
  it("rechaza un número de cuotas inválido", () => {
    expect(() => buildSchedule(termsOf({ installments: 0 }))).toThrow(InvalidLoanTermsError);
    expect(() => buildSchedule(termsOf({ installments: 2.5 }))).toThrow(InvalidLoanTermsError);
  });

  it("rechaza capital cero o negativo", () => {
    expect(() => buildSchedule(termsOf({ principal: Money.zero() }))).toThrow(InvalidLoanTermsError);
    expect(() => buildSchedule(termsOf({ principal: Money.fromCents(-100) }))).toThrow(
      InvalidLoanTermsError,
    );
  });

  it("rechaza tasas negativas o no enteras", () => {
    expect(() => buildSchedule(termsOf({ rateBp: -1 }))).toThrow(InvalidLoanTermsError);
    expect(() => buildSchedule(termsOf({ rateBp: 12.5 }))).toThrow(InvalidLoanTermsError);
  });

  it("rechaza fechas de inicio inválidas", () => {
    for (const startDate of ["01/12/2026", "2026-13-01", "2026-02-30", ""]) {
      expect(() => buildSchedule(termsOf({ startDate }))).toThrow(InvalidLoanTermsError);
    }
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calculateScheduleApr } from "./apr";
import { Money } from "./money";
import {
  buildSchedule,
  InvalidLoanTermsError,
  type Frequency,
  type InterestMethod,
  type LoanTerms,
} from "./schedule";

function termsOf(overrides: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principal: Money.fromLempiras("10000"),
    rateBp: 500,
    ratePeriod: "MONTHLY",
    paymentFrequency: "MONTHLY",
    installments: 4,
    startDate: "2026-12-01",
    ...overrides,
  };
}

const cents = (money: Money) => money.toCents();
const column = (terms: LoanTerms, pick: "principal" | "interest" | "total") =>
  buildSchedule(terms).map((installment) => cents(installment[pick]));

describe("interés sobre saldo (DECLINING)", () => {
  const terms = termsOf({ interestMethod: "DECLINING" });

  it("L 10,000 al 5 % mensual en 4 cuotas mensuales: cuota nivelada de L 2,820.12", () => {
    expect(column(terms, "total")).toEqual([282012, 282012, 282012, 282011]);
  });

  it("el interés de cada cuota se calcula sobre el saldo y va bajando", () => {
    expect(column(terms, "interest")).toEqual([50000, 38399, 26219, 13429]);
    expect(column(terms, "principal")).toEqual([232012, 243613, 255793, 268582]);
  });

  it("el capital suma exactamente lo prestado", () => {
    const sum = column(terms, "principal").reduce((total, value) => total + value, 0);
    expect(sum).toBe(1_000_000);
  });

  it("sin tasa solo reparte el capital", () => {
    const zeroRate = termsOf({ interestMethod: "DECLINING", rateBp: 0 });
    expect(column(zeroRate, "interest")).toEqual([0, 0, 0, 0]);
    expect(column(zeroRate, "principal")).toEqual([250000, 250000, 250000, 250000]);
  });

  it("con una sola cuota paga el capital más un periodo de interés", () => {
    const single = termsOf({ interestMethod: "DECLINING", installments: 1 });
    expect(column(single, "total")).toEqual([1_050_000]);
  });

  it("usa la tasa por periodo de pago: 5 % mensual con pagos quincenales es 2.5 % por pago", () => {
    const biweekly = termsOf({ interestMethod: "DECLINING", paymentFrequency: "BIWEEKLY" });
    expect(column(biweekly, "interest")[0]).toBe(25000);
  });
});

describe("solo interés (INTEREST_ONLY)", () => {
  const terms = termsOf({ interestMethod: "INTEREST_ONLY", paymentFrequency: "BIWEEKLY" });

  it("cada cuota paga el interés y el capital completo va en la última", () => {
    expect(column(terms, "principal")).toEqual([0, 0, 0, 1_000_000]);
    expect(column(terms, "interest")).toEqual([25000, 25000, 25000, 25000]);
    expect(column(terms, "total")).toEqual([25000, 25000, 25000, 1_025_000]);
  });

  it("con una sola cuota paga capital e interés juntos", () => {
    const single = termsOf({ interestMethod: "INTEREST_ONLY", installments: 1 });
    expect(column(single, "total")).toEqual([1_050_000]);
  });
});

describe("selección del método", () => {
  it("sin método indicado se comporta como interés fijo", () => {
    const withoutMethod = column(termsOf(), "total");
    const explicit = column(termsOf({ interestMethod: "FLAT" }), "total");
    expect(withoutMethod).toEqual(explicit);
  });

  it("rechaza un método desconocido", () => {
    expect(() =>
      buildSchedule(termsOf({ interestMethod: "COMPOUND" as unknown as InterestMethod })),
    ).toThrow(InvalidLoanTermsError);
  });

  it("para el mismo préstamo, el interés sobre saldo cuesta menos que el fijo", () => {
    const flat = column(termsOf({ interestMethod: "FLAT" }), "interest").reduce((a, b) => a + b, 0);
    const declining = column(termsOf({ interestMethod: "DECLINING" }), "interest").reduce(
      (a, b) => a + b,
      0,
    );
    expect(declining).toBeLessThan(flat);
  });

  it("la TEA se puede calcular para cualquier método", () => {
    const methods: InterestMethod[] = ["FLAT", "DECLINING", "INTEREST_ONLY"];
    for (const interestMethod of methods) {
      const terms = termsOf({ interestMethod });
      const apr = calculateScheduleApr(terms.principal, terms.startDate, buildSchedule(terms));
      expect(apr).toBeGreaterThan(0);
    }
  });
});

describe("propiedades de todos los métodos", () => {
  const frequencies: Frequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];
  const methods: InterestMethod[] = ["FLAT", "DECLINING", "INTEREST_ONLY"];

  it("el capital siempre suma lo prestado, nada queda negativo y las fechas avanzan", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...methods),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.constantFrom(...frequencies),
        fc.constantFrom(...frequencies),
        fc.integer({ min: 1, max: 60 }),
        (interestMethod, principalCents, rateBp, ratePeriod, paymentFrequency, installments) => {
          const schedule = buildSchedule(
            termsOf({
              interestMethod,
              principal: Money.fromCents(principalCents),
              rateBp,
              ratePeriod,
              paymentFrequency,
              installments,
            }),
          );

          const principalSum = schedule.reduce((sum, item) => sum + cents(item.principal), 0);
          expect(schedule).toHaveLength(installments);
          expect(principalSum).toBe(principalCents);
          for (const item of schedule) {
            expect(cents(item.principal)).toBeGreaterThanOrEqual(0);
            expect(cents(item.interest)).toBeGreaterThanOrEqual(0);
            expect(cents(item.total)).toBe(cents(item.principal) + cents(item.interest));
          }
          for (let index = 1; index < schedule.length; index++) {
            expect(schedule[index]!.dueDate > schedule[index - 1]!.dueDate).toBe(true);
          }
        },
      ),
    );
  });

  it("en interés sobre saldo, el interés nunca sube de una cuota a la siguiente", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 100_000_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 2, max: 48 }),
        (principalCents, rateBp, installments) => {
          const interest = column(
            termsOf({
              interestMethod: "DECLINING",
              principal: Money.fromCents(principalCents),
              rateBp,
              installments,
            }),
            "interest",
          );
          for (let index = 1; index < interest.length; index++) {
            expect(interest[index]!).toBeLessThanOrEqual(interest[index - 1]!);
          }
        },
      ),
    );
  });
});

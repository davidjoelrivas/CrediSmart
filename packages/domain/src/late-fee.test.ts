import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateLateFee,
  FixedPerDayLateFee,
  InvalidLateFeeInputError,
  NoLateFee,
  PercentOfOverdueLateFee,
  PercentPerDayLateFee,
  type LateFeeInput,
  type LateFeePolicy,
} from "./late-fee";
import { Money } from "./money";

function inputOf(overrides: Partial<LateFeeInput> = {}): LateFeeInput {
  return {
    policy: new PercentOfOverdueLateFee(500),
    dueDate: "2026-12-15",
    overdueAmount: Money.fromLempiras("2750"),
    asOf: "2026-12-25",
    graceDays: 0,
    ...overrides,
  };
}

const feeCents = (input: LateFeeInput) => calculateLateFee(input).toCents();

describe("calculateLateFee: cuándo hay mora", () => {
  it("no hay mora el mismo día del vencimiento ni antes", () => {
    expect(feeCents(inputOf({ asOf: "2026-12-15" }))).toBe(0);
    expect(feeCents(inputOf({ asOf: "2026-12-01" }))).toBe(0);
  });

  it("no hay mora dentro de los días de gracia", () => {
    expect(feeCents(inputOf({ graceDays: 3, asOf: "2026-12-18" }))).toBe(0);
  });

  it("hay mora desde el primer día después de la gracia", () => {
    expect(feeCents(inputOf({ graceDays: 3, asOf: "2026-12-19" }))).toBeGreaterThan(0);
  });

  it("no hay mora si no queda monto vencido", () => {
    expect(feeCents(inputOf({ overdueAmount: Money.zero() }))).toBe(0);
  });
});

describe("calculateLateFee: políticas", () => {
  it("NoLateFee nunca cobra mora", () => {
    expect(feeCents(inputOf({ policy: new NoLateFee() }))).toBe(0);
  });

  it("PercentOfOverdueLateFee cobra 5 % de L 2,750 una sola vez, sin importar los días", () => {
    expect(feeCents(inputOf({ asOf: "2026-12-16" }))).toBe(13750);
    expect(feeCents(inputOf({ asOf: "2027-03-15" }))).toBe(13750);
  });

  it("FixedPerDayLateFee cobra L 25 por cada día de atraso", () => {
    const policy = new FixedPerDayLateFee(Money.fromLempiras("25"));
    expect(feeCents(inputOf({ policy, asOf: "2026-12-25" }))).toBe(25000);
  });

  it("PercentPerDayLateFee cobra 1 % diario: 5 días sobre L 1,000 son L 50", () => {
    const policy = new PercentPerDayLateFee(100);
    expect(
      feeCents(
        inputOf({
          policy,
          overdueAmount: Money.fromLempiras("1000"),
          asOf: "2026-12-20",
        }),
      ),
    ).toBe(5000);
  });

  it("redondea half-up al centavo", () => {
    // 5 % de 0.10 = 0.005 -> 0.01
    expect(feeCents(inputOf({ overdueAmount: Money.fromCents(10) }))).toBe(1);
  });

  it("propiedad: la mora nunca es negativa y por día no baja al pasar los días", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 365 }),
        fc.integer({ min: 0, max: 30 }),
        (overdueCents, rateBp, daysLate, graceDays) => {
          const base = inputOf({
            policy: new PercentPerDayLateFee(rateBp),
            overdueAmount: Money.fromCents(overdueCents),
            graceDays,
            asOf: new Date(Date.UTC(2026, 11, 15 + daysLate)).toISOString().slice(0, 10),
          });
          const later = {
            ...base,
            asOf: new Date(Date.UTC(2026, 11, 16 + daysLate)).toISOString().slice(0, 10),
          };

          expect(feeCents(base)).toBeGreaterThanOrEqual(0);
          expect(feeCents(later)).toBeGreaterThanOrEqual(feeCents(base));
        },
      ),
    );
  });
});

describe("LateFeePolicy: contrato común (sustitución de Liskov)", () => {
  const policies: [string, LateFeePolicy][] = [
    ["NoLateFee", new NoLateFee()],
    ["PercentOfOverdueLateFee", new PercentOfOverdueLateFee(500)],
    ["FixedPerDayLateFee", new FixedPerDayLateFee(Money.fromLempiras("25"))],
    ["PercentPerDayLateFee", new PercentPerDayLateFee(100)],
  ];

  it.each(policies)("%s devuelve una mora que nunca es negativa", (_name, policy) => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 365 }),
        (overdueCents, daysLate) => {
          const fee = policy.calculate(Money.fromCents(overdueCents), daysLate);
          expect(fee.isNegative()).toBe(false);
        },
      ),
    );
  });
});

describe("calculateLateFee: extensión sin modificar el cálculo", () => {
  it("acepta una política nueva definida fuera del módulo", () => {
    class CappedLateFee implements LateFeePolicy {
      constructor(
        private readonly inner: LateFeePolicy,
        private readonly cap: Money,
      ) {}

      calculate(overdueAmount: Money, daysLate: number): Money {
        const fee = this.inner.calculate(overdueAmount, daysLate);
        return fee.compareTo(this.cap) === 1 ? this.cap : fee;
      }
    }

    const policy = new CappedLateFee(
      new PercentPerDayLateFee(100),
      Money.fromLempiras("30"),
    );
    const input = inputOf({
      policy,
      overdueAmount: Money.fromLempiras("1000"),
      asOf: "2026-12-25",
    });

    // Sin tope serían L 100 (1 % diario durante 10 días); con tope, L 30.
    expect(feeCents(input)).toBe(3000);
  });
});

describe("calculateLateFee: validaciones", () => {
  it("rechaza fechas inválidas", () => {
    expect(() => calculateLateFee(inputOf({ dueDate: "15/12/2026" }))).toThrow(
      InvalidLateFeeInputError,
    );
    expect(() => calculateLateFee(inputOf({ asOf: "2026-02-30" }))).toThrow(
      InvalidLateFeeInputError,
    );
  });

  it("rechaza días de gracia negativos o no enteros", () => {
    expect(() => calculateLateFee(inputOf({ graceDays: -1 }))).toThrow(InvalidLateFeeInputError);
    expect(() => calculateLateFee(inputOf({ graceDays: 1.5 }))).toThrow(InvalidLateFeeInputError);
  });

  it("rechaza un monto vencido negativo", () => {
    expect(() => calculateLateFee(inputOf({ overdueAmount: Money.fromCents(-1) }))).toThrow(
      InvalidLateFeeInputError,
    );
  });

  it("rechaza políticas con tasas o montos inválidos al crearlas", () => {
    expect(() => new PercentOfOverdueLateFee(-5)).toThrow(InvalidLateFeeInputError);
    expect(() => new PercentPerDayLateFee(1.5)).toThrow(InvalidLateFeeInputError);
    expect(() => new FixedPerDayLateFee(Money.fromCents(-100))).toThrow(InvalidLateFeeInputError);
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AprCapExceededError,
  calculateApr,
  calculateScheduleApr,
  checkAprCap,
  InvalidAprInputError,
  requireAprCapCompliance,
} from "./apr";
import { Money } from "./money";
import { buildSchedule, type Frequency } from "./schedule";

const lempiras = (text: string) => Money.fromLempiras(text);

describe("calculateApr: casos conocidos", () => {
  it("un pago a 365 días con 10 % de interés da una TEA de 10 %", () => {
    const apr = calculateApr({
      principal: lempiras("1000"),
      startDate: "2026-12-01",
      payments: [{ dueDate: "2027-12-01", amount: lempiras("1100") }],
    });
    expect(apr).toBe(1000);
  });

  it("un pago a 730 días con 21 % total equivale a 10 % anual compuesto", () => {
    const apr = calculateApr({
      principal: lempiras("1000"),
      startDate: "2026-12-01",
      payments: [{ dueDate: "2028-12-01", amount: lempiras("1210") }],
    });
    // 2028 es bisiesto: son 731 días, así que la tasa queda apenas por debajo del 10 %.
    expect(apr).toBeGreaterThanOrEqual(995);
    expect(apr).toBeLessThanOrEqual(1000);
  });

  it("sin interés la TEA es cero", () => {
    const apr = calculateApr({
      principal: lempiras("1000"),
      startDate: "2026-12-01",
      payments: [
        { dueDate: "2026-12-15", amount: lempiras("500") },
        { dueDate: "2026-12-29", amount: lempiras("500") },
      ],
    });
    expect(apr).toBe(0);
  });

  it("5 % mensual en 4 cuotas quincenales cuesta mucho más que 5 % anual", () => {
    const startDate = "2026-12-01";
    const principal = lempiras("10000");
    const schedule = buildSchedule({
      principal,
      rateBp: 500,
      ratePeriod: "MONTHLY",
      paymentFrequency: "BIWEEKLY",
      installments: 4,
      startDate,
    });

    const apr = calculateScheduleApr(principal, startDate, schedule);

    // Cuota de L 2,750 cada 14 días sobre L 10,000: tasa quincenal cercana a 3.9 %.
    expect(apr).toBeGreaterThan(16_000);
    expect(apr).toBeLessThan(18_500);
  });
});

describe("calculateApr: validaciones", () => {
  const valid = {
    principal: lempiras("1000"),
    startDate: "2026-12-01",
    payments: [{ dueDate: "2027-01-01", amount: lempiras("1100") }],
  };

  it("rechaza capital cero, fechas inválidas y pagos vacíos", () => {
    expect(() => calculateApr({ ...valid, principal: Money.zero() })).toThrow(InvalidAprInputError);
    expect(() => calculateApr({ ...valid, startDate: "01/12/2026" })).toThrow(InvalidAprInputError);
    expect(() => calculateApr({ ...valid, payments: [] })).toThrow(InvalidAprInputError);
  });

  it("rechaza pagos que no son posteriores al inicio o no son positivos", () => {
    expect(() =>
      calculateApr({ ...valid, payments: [{ dueDate: "2026-12-01", amount: lempiras("1100") }] }),
    ).toThrow(InvalidAprInputError);
    expect(() =>
      calculateApr({ ...valid, payments: [{ dueDate: "2027-01-01", amount: Money.zero() }] }),
    ).toThrow(InvalidAprInputError);
  });

  it("rechaza pagos que suman menos que el capital", () => {
    expect(() =>
      calculateApr({ ...valid, payments: [{ dueDate: "2027-01-01", amount: lempiras("999.99") }] }),
    ).toThrow(InvalidAprInputError);
  });
});

describe("calculateApr: propiedades", () => {
  const frequencies: Frequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

  it("a más interés, nunca baja la TEA, y nunca es negativa", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 100_000_000 }),
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        fc.constantFrom(...frequencies),
        fc.integer({ min: 2, max: 24 }),
        (principalCents, rateBp, extraRateBp, paymentFrequency, installments) => {
          const principal = Money.fromCents(principalCents);
          const aprFor = (bp: number) =>
            calculateScheduleApr(
              principal,
              "2026-12-01",
              buildSchedule({
                principal,
                rateBp: bp,
                ratePeriod: "MONTHLY",
                paymentFrequency,
                installments,
                startDate: "2026-12-01",
              }),
            );

          const lower = aprFor(rateBp);
          const higher = aprFor(rateBp + extraRateBp);

          expect(lower).toBeGreaterThanOrEqual(0);
          expect(higher).toBeGreaterThanOrEqual(lower);
        },
      ),
    );
  });
});

describe("tope legal configurable", () => {
  it("sin tope configurado nunca se excede", () => {
    expect(checkAprCap(999_999, null).exceeds).toBe(false);
  });

  it("una TEA igual al tope no lo excede", () => {
    expect(checkAprCap(2400, 2400).exceeds).toBe(false);
    expect(checkAprCap(2401, 2400).exceeds).toBe(true);
  });

  it("dentro del tope no pide confirmación", () => {
    expect(requireAprCapCompliance(checkAprCap(2000, 2400))).toEqual({
      overrideApplied: false,
      reason: null,
    });
  });

  it("al superar el tope exige confirmación explícita con motivo", () => {
    const check = checkAprCap(17_000, 2400);

    expect(() => requireAprCapCompliance(check)).toThrow(AprCapExceededError);
    expect(() => requireAprCapCompliance(check, { confirmed: false, reason: "Cliente de confianza" })).toThrow(
      AprCapExceededError,
    );
    expect(() => requireAprCapCompliance(check, { confirmed: true, reason: "   " })).toThrow(
      AprCapExceededError,
    );
  });

  it("deja constancia del motivo cuando se confirma", () => {
    const decision = requireAprCapCompliance(checkAprCap(17_000, 2400), {
      confirmed: true,
      reason: "  Autorizado tras consultar con el abogado  ",
    });
    expect(decision).toEqual({
      overrideApplied: true,
      reason: "Autorizado tras consultar con el abogado",
    });
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createBalance, type InstallmentBalance } from "./installment-balance";
import { accrueLateFees, daysOverdue } from "./late-fee-accrual";
import {
  describeLateFee,
  parseLateFeeConfig,
  type LateFeeConfig,
} from "./late-fee-config";
import { InvalidLateFeeInputError } from "./late-fee";
import { Money } from "./money";

function balanceOf(dueDate: string, overrides: Partial<InstallmentBalance> = {}): InstallmentBalance {
  return {
    ...createBalance({
      number: 1,
      dueDate,
      principal: Money.fromLempiras("2500"),
      interest: Money.fromLempiras("250"),
      total: Money.fromLempiras("2750"),
    }),
    ...overrides,
  };
}

const percent5: LateFeeConfig = { type: "PERCENT_OF_OVERDUE", rateBp: 500 };

describe("accrueLateFees", () => {
  it("no genera mora antes del vencimiento ni durante la gracia", () => {
    const before = accrueLateFees([balanceOf("2026-12-15")], percent5, 3, "2026-12-15");
    const grace = accrueLateFees([balanceOf("2026-12-15")], percent5, 3, "2026-12-18");

    expect(before.changedInstallments).toBe(0);
    expect(grace.changedInstallments).toBe(0);
  });

  it("genera la mora de una cuota vencida sobre capital e interés pendientes", () => {
    const result = accrueLateFees([balanceOf("2026-12-15")], percent5, 0, "2026-12-20");

    expect(result.balances[0]!.lateFeeDue.toCents()).toBe(13750);
    expect(result.changedInstallments).toBe(1);
  });

  it("es idempotente: correrla otra vez el mismo día no cambia nada", () => {
    const first = accrueLateFees([balanceOf("2026-12-15")], percent5, 0, "2026-12-20");
    const second = accrueLateFees(first.balances, percent5, 0, "2026-12-20");

    expect(second.changedInstallments).toBe(0);
    expect(second.balances).toEqual(first.balances);
  });

  it("la mora diaria crece cada día y nunca baja", () => {
    const policy: LateFeeConfig = { type: "FIXED_PER_DAY", amountCents: 2500 };
    const day5 = accrueLateFees([balanceOf("2026-12-15")], policy, 0, "2026-12-20");
    const day6 = accrueLateFees(day5.balances, policy, 0, "2026-12-21");

    expect(day5.balances[0]!.lateFeeDue.toCents()).toBe(12500);
    expect(day6.balances[0]!.lateFeeDue.toCents()).toBe(15000);
  });

  it("al pagar el vencido, la mora ya generada se conserva", () => {
    const accrued = accrueLateFees([balanceOf("2026-12-15")], percent5, 0, "2026-12-20");
    const paid: InstallmentBalance = {
      ...accrued.balances[0]!,
      principalPaid: Money.fromLempiras("2500"),
      interestPaid: Money.fromLempiras("250"),
    };
    const later = accrueLateFees([paid], percent5, 0, "2026-12-30");

    expect(later.balances[0]!.lateFeeDue.toCents()).toBe(13750);
    expect(later.changedInstallments).toBe(0);
  });

  it("sin política de mora no cambia nada", () => {
    const result = accrueLateFees([balanceOf("2026-01-01")], { type: "NONE" }, 0, "2026-12-20");

    expect(result.changedInstallments).toBe(0);
  });

  it("propiedad: la mora nunca baja con el paso de los días", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 200 }), (a, b) => {
        const policy: LateFeeConfig = { type: "PERCENT_PER_DAY", rateBp: 10 };
        const [early, late] = a <= b ? [a, b] : [b, a];
        const dueDate = "2026-01-01";
        const addDays = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
        const first = accrueLateFees([balanceOf(dueDate)], policy, 0, addDays(early));
        const second = accrueLateFees(first.balances, policy, 0, addDays(late));
        return second.balances[0]!.lateFeeDue.toCents() >= first.balances[0]!.lateFeeDue.toCents();
      }),
    );
  });
});

describe("daysOverdue", () => {
  it("cuenta desde la cuota vencida más antigua con saldo", () => {
    const balances = [
      { ...balanceOf("2026-12-01"), number: 1 },
      { ...balanceOf("2026-12-15"), number: 2 },
    ];

    expect(daysOverdue(balances, "2026-12-20")).toBe(19);
  });

  it("es cero cuando todo está pagado o aún no vence", () => {
    const paid = {
      ...balanceOf("2026-12-01"),
      principalPaid: Money.fromLempiras("2500"),
      interestPaid: Money.fromLempiras("250"),
    };

    expect(daysOverdue([paid], "2026-12-20")).toBe(0);
    expect(daysOverdue([balanceOf("2026-12-30")], "2026-12-20")).toBe(0);
  });
});

describe("parseLateFeeConfig y describeLateFee", () => {
  it("acepta las cuatro políticas válidas", () => {
    expect(parseLateFeeConfig({ type: "NONE" })).toEqual({ type: "NONE" });
    expect(parseLateFeeConfig({ type: "PERCENT_OF_OVERDUE", rateBp: 500 })).toEqual(percent5);
    expect(parseLateFeeConfig({ type: "FIXED_PER_DAY", amountCents: 2500 })).toEqual({
      type: "FIXED_PER_DAY",
      amountCents: 2500,
    });
    expect(parseLateFeeConfig({ type: "PERCENT_PER_DAY", rateBp: 10 })).toEqual({
      type: "PERCENT_PER_DAY",
      rateBp: 10,
    });
  });

  it("rechaza tipos desconocidos y montos inválidos", () => {
    expect(() => parseLateFeeConfig({ type: "OTRA" })).toThrow(InvalidLateFeeInputError);
    expect(() => parseLateFeeConfig({ type: "PERCENT_OF_OVERDUE", rateBp: -1 })).toThrow(
      InvalidLateFeeInputError,
    );
    expect(() => parseLateFeeConfig({ type: "FIXED_PER_DAY", amountCents: 1.5 })).toThrow(
      InvalidLateFeeInputError,
    );
    expect(() => parseLateFeeConfig(null)).toThrow(InvalidLateFeeInputError);
  });

  it("describe la política en lenguaje claro", () => {
    expect(describeLateFee({ type: "NONE" }, 0)).toBe("Sin mora");
    expect(describeLateFee(percent5, 3)).toBe("5 % del monto vencido después de 3 días de gracia");
    expect(describeLateFee({ type: "PERCENT_PER_DAY", rateBp: 25 }, 1)).toBe(
      "0.25 % diario sobre el monto vencido después de 1 día de gracia",
    );
  });
});

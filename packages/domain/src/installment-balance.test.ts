import { describe, expect, it } from "vitest";
import {
  createBalance,
  InvalidBalanceError,
  outstandingOf,
  statusOf,
  validateBalance,
  type InstallmentBalance,
} from "./installment-balance";
import { Money } from "./money";
import { buildSchedule } from "./schedule";

function firstBalance(): InstallmentBalance {
  const [installment] = buildSchedule({
    principal: Money.fromLempiras("10000"),
    rateBp: 500,
    ratePeriod: "MONTHLY",
    paymentFrequency: "BIWEEKLY",
    installments: 4,
    startDate: "2026-12-01",
  });
  return createBalance(installment!);
}

describe("createBalance", () => {
  it("toma capital e interés de la cuota y empieza sin pagos ni mora", () => {
    const balance = firstBalance();
    expect(balance.number).toBe(1);
    expect(balance.dueDate).toBe("2026-12-15");
    expect(balance.principalDue.toCents()).toBe(250000);
    expect(balance.interestDue.toCents()).toBe(25000);
    expect(balance.lateFeeDue.isZero()).toBe(true);
    expect(balance.principalPaid.isZero()).toBe(true);
  });
});

describe("outstandingOf y statusOf", () => {
  it("una cuota nueva debe todo y está pendiente", () => {
    const balance = firstBalance();
    expect(outstandingOf(balance).total.toCents()).toBe(275000);
    expect(statusOf(balance)).toBe("PENDING");
  });

  it("incluye la mora en lo que falta pagar", () => {
    const balance = { ...firstBalance(), lateFeeDue: Money.fromLempiras("137.50") };
    expect(outstandingOf(balance).total.toCents()).toBe(288750);
  });

  it("con un pago parcial queda parcial", () => {
    const balance = { ...firstBalance(), interestPaid: Money.fromLempiras("250") };
    expect(statusOf(balance)).toBe("PARTIAL");
    expect(outstandingOf(balance).total.toCents()).toBe(250000);
  });

  it("con todo pagado queda pagada", () => {
    const balance = {
      ...firstBalance(),
      principalPaid: Money.fromLempiras("2500"),
      interestPaid: Money.fromLempiras("250"),
    };
    expect(statusOf(balance)).toBe("PAID");
    expect(outstandingOf(balance).total.isZero()).toBe(true);
  });
});

describe("validateBalance", () => {
  it("acepta un saldo coherente", () => {
    expect(() => validateBalance(firstBalance())).not.toThrow();
  });

  it("rechaza lo pagado por encima de lo debido", () => {
    const balance = { ...firstBalance(), interestPaid: Money.fromLempiras("250.01") };
    expect(() => validateBalance(balance)).toThrow(InvalidBalanceError);
  });

  it("rechaza montos negativos", () => {
    const balance = { ...firstBalance(), principalPaid: Money.fromCents(-1) };
    expect(() => validateBalance(balance)).toThrow(InvalidBalanceError);
  });
});

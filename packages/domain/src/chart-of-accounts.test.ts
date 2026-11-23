import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CODES,
  DEFAULT_CHART_OF_ACCOUNTS,
  findAccount,
  isDebitNormal,
  UnknownAccountError,
} from "./chart-of-accounts";

describe("plan de cuentas por defecto", () => {
  it("no repite códigos", () => {
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("incluye todas las cuentas que usan los asientos del sistema", () => {
    for (const code of Object.values(ACCOUNT_CODES)) {
      expect(() => findAccount(DEFAULT_CHART_OF_ACCOUNTS, code)).not.toThrow();
    }
  });
});

describe("findAccount", () => {
  it("devuelve la cuenta con su nombre y tipo", () => {
    expect(findAccount(DEFAULT_CHART_OF_ACCOUNTS, ACCOUNT_CODES.CASH)).toEqual({
      code: "1101",
      name: "Caja",
      type: "ASSET",
    });
  });

  it("rechaza códigos que no existen", () => {
    expect(() => findAccount(DEFAULT_CHART_OF_ACCOUNTS, "9999")).toThrow(UnknownAccountError);
  });
});

describe("isDebitNormal", () => {
  it("activos y gastos aumentan con débitos", () => {
    expect(isDebitNormal("ASSET")).toBe(true);
    expect(isDebitNormal("EXPENSE")).toBe(true);
  });

  it("pasivos, patrimonio e ingresos aumentan con créditos", () => {
    expect(isDebitNormal("LIABILITY")).toBe(false);
    expect(isDebitNormal("EQUITY")).toBe(false);
    expect(isDebitNormal("INCOME")).toBe(false);
  });
});

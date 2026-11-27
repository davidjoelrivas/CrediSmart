import { describe, expect, it } from "vitest";
import {
  approveLoanRequest,
  formatCents,
  loginRequest,
  registerPaymentRequest,
  simulateLoanRequest,
} from "./index";

const terms = {
  principalCents: 1_000_000,
  rateBp: 500,
  ratePeriod: "MONTHLY",
  paymentFrequency: "BIWEEKLY",
  installments: 4,
  startDate: "2026-12-01",
};

describe("contratos de la API", () => {
  it("acepta un préstamo válido y completa los valores por defecto", () => {
    const parsed = approveLoanRequest.parse({
      borrowerId: "0190a000-0000-7000-8000-000000000001",
      terms,
    });

    expect(parsed.terms.interestMethod).toBe("FLAT");
    expect(parsed.lateFee).toEqual({ type: "NONE" });
    expect(parsed.graceDays).toBe(0);
  });

  it("rechaza montos con decimales, negativos o en cero", () => {
    for (const principalCents of [10.5, -5, 0]) {
      expect(simulateLoanRequest.safeParse({ terms: { ...terms, principalCents } }).success).toBe(false);
    }
  });

  it("rechaza frecuencias y fechas inválidas", () => {
    expect(simulateLoanRequest.safeParse({ terms: { ...terms, paymentFrequency: "DAILY" } }).success).toBe(false);
    expect(simulateLoanRequest.safeParse({ terms: { ...terms, startDate: "01/12/2026" } }).success).toBe(false);
  });

  it("exige motivo cuando se confirma superar el tope legal", () => {
    const base = { borrowerId: "0190a000-0000-7000-8000-000000000001", terms };

    expect(approveLoanRequest.safeParse({ ...base, aprCapOverride: { confirmed: true, reason: "x" } }).success).toBe(false);
    expect(approveLoanRequest.safeParse({ ...base, aprCapOverride: { confirmed: true, reason: "Cliente de confianza" } }).success).toBe(true);
  });

  it("valida la política de mora según su tipo", () => {
    const base = { borrowerId: "0190a000-0000-7000-8000-000000000001", terms };

    expect(approveLoanRequest.safeParse({ ...base, lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 } }).success).toBe(true);
    expect(approveLoanRequest.safeParse({ ...base, lateFee: { type: "FIXED_PER_DAY" } }).success).toBe(false);
    expect(approveLoanRequest.safeParse({ ...base, lateFee: { type: "OTRA" } }).success).toBe(false);
  });

  it("un pago necesita clave de idempotencia y monto positivo", () => {
    const base = {
      loanId: "0190a000-0000-7000-8000-000000000001",
      amountCents: 100_000,
      method: "CASH",
      idempotencyKey: "cobro-0001-abc",
    };

    expect(registerPaymentRequest.safeParse(base).success).toBe(true);
    expect(registerPaymentRequest.safeParse({ ...base, idempotencyKey: "x" }).success).toBe(false);
    expect(registerPaymentRequest.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it("el inicio de sesión recorta espacios y no deja campos vacíos", () => {
    expect(loginRequest.parse({ login: "  a@b.co ", password: "secreto" }).login).toBe("a@b.co");
    expect(loginRequest.safeParse({ login: "", password: "x" }).success).toBe(false);
  });

  it("formatea centavos como lempiras", () => {
    expect(formatCents(125_050)).toBe("L 1,250.50");
    expect(formatCents(-5)).toBe("-L 0.05");
    expect(formatCents(0)).toBe("L 0.00");
  });
});

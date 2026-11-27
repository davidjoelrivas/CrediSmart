import { describe, expect, it } from "vitest";
import { InvalidLoanTermsError, Money } from "@app/domain";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

describe("SimulateLoan", () => {
  it("devuelve el plan de cuotas, el total a pagar y la tasa efectiva anual", async () => {
    const { simulateLoan } = createHarness();

    const result = await simulateLoan.execute(contextOf(), standardTerms());

    expect(result.schedule).toHaveLength(4);
    expect(result.schedule.every((item) => item.total.toCents() === 275_000)).toBe(true);
    expect(result.totalInterest.toCents()).toBe(100_000);
    expect(result.totalToPay.toCents()).toBe(1_100_000);
    expect(result.aprBp).toBeGreaterThan(16_000);
  });

  it("sin tope configurado no marca exceso", async () => {
    const { simulateLoan } = createHarness({ aprCapBp: null });

    const result = await simulateLoan.execute(contextOf(), standardTerms());

    expect(result.aprCapBp).toBeNull();
    expect(result.exceedsAprCap).toBe(false);
  });

  it("avisa cuando la tasa supera el tope configurado, sin impedir la simulación", async () => {
    const { simulateLoan } = createHarness({ aprCapBp: 2400 });

    const result = await simulateLoan.execute(contextOf(), standardTerms());

    expect(result.aprCapBp).toBe(2400);
    expect(result.exceedsAprCap).toBe(true);
  });

  it("no guarda nada: simular no crea préstamos", async () => {
    const harness = createHarness();

    await harness.simulateLoan.execute(contextOf(), standardTerms());

    expect(await harness.repositories.loans.listByOrganization("org-1")).toEqual([]);
  });

  it("rechaza condiciones inválidas", async () => {
    const { simulateLoan } = createHarness();

    await expect(
      simulateLoan.execute(contextOf(), standardTerms({ principal: Money.zero() })),
    ).rejects.toThrow(InvalidLoanTermsError);
  });
});

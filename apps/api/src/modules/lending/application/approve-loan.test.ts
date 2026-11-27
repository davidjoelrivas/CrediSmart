import { describe, expect, it } from "vitest";
import { AprCapExceededError, InvalidLoanTermsError, Money } from "@app/domain";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

describe("ApproveLoan", () => {
  it("crea el préstamo pendiente de firma con su código y su plan de cuotas", async () => {
    const harness = createHarness({ today: "2026-12-01" });

    const loan = await harness.approveLoan.execute(contextOf(), {
      borrowerId: "borrower-1",
      terms: standardTerms(),
    });

    expect(loan.code).toBe("PR-0001");
    expect(loan.status).toBe("PENDING_SIGNATURE");
    expect(loan.approvedOn).toBe("2026-12-01");
    expect(loan.balances).toHaveLength(4);
    expect(loan.aprBp).toBeGreaterThan(16_000);
    expect(await harness.repositories.loans.findById("org-1", loan.id)).toEqual(loan);
  });

  it("no mueve dinero: todavía no hay asientos contables", async () => {
    const harness = createHarness();

    await harness.approveLoan.execute(contextOf(), { borrowerId: "b-1", terms: standardTerms() });

    expect(await harness.repositories.ledger.entriesOf("org-1")).toEqual([]);
  });

  it("deja constancia en la bitácora", async () => {
    const harness = createHarness();

    const loan = await harness.approveLoan.execute(contextOf("org-1", "owner-7"), {
      borrowerId: "b-1",
      terms: standardTerms(),
    });

    const [record] = await harness.repositories.audit.recordsOf("org-1");
    expect(record).toMatchObject({
      actorId: "owner-7",
      action: "LOAN_APPROVED",
      entityId: loan.id,
      details: { code: "PR-0001", principalCents: 1_000_000 },
    });
  });

  it("numera los préstamos por organización", async () => {
    const harness = createHarness();
    const input = { borrowerId: "b-1", terms: standardTerms() };

    const first = await harness.approveLoan.execute(contextOf("org-1"), input);
    const second = await harness.approveLoan.execute(contextOf("org-1"), input);
    const otherOrganization = await harness.approveLoan.execute(contextOf("org-2"), input);

    expect([first.code, second.code, otherOrganization.code]).toEqual([
      "PR-0001",
      "PR-0002",
      "PR-0001",
    ]);
  });

  describe("tope legal de la tasa efectiva anual", () => {
    it("rechaza el préstamo si supera el tope y no hay confirmación; no se guarda nada", async () => {
      const harness = createHarness({ aprCapBp: 2400 });

      await expect(
        harness.approveLoan.execute(contextOf(), { borrowerId: "b-1", terms: standardTerms() }),
      ).rejects.toThrow(AprCapExceededError);

      expect(await harness.repositories.loans.listByOrganization("org-1")).toEqual([]);
      expect(await harness.repositories.audit.recordsOf("org-1")).toEqual([]);
    });

    it("lo aprueba con confirmación y motivo, y deja el motivo guardado y en la bitácora", async () => {
      const harness = createHarness({ aprCapBp: 2400 });

      const loan = await harness.approveLoan.execute(contextOf(), {
        borrowerId: "b-1",
        terms: standardTerms(),
        aprCapOverride: { confirmed: true, reason: "Autorizado tras consultar al abogado" },
      });

      expect(loan.aprCapOverrideReason).toBe("Autorizado tras consultar al abogado");
      const [record] = await harness.repositories.audit.recordsOf("org-1");
      expect(record!.details.aprCapOverrideReason).toBe("Autorizado tras consultar al abogado");
    });

    it("sin exceso no pide confirmación y no guarda ningún motivo", async () => {
      const harness = createHarness({ aprCapBp: 900_000 });

      const loan = await harness.approveLoan.execute(contextOf(), {
        borrowerId: "b-1",
        terms: standardTerms(),
      });

      expect(loan.aprCapOverrideReason).toBeNull();
    });
  });

  it("rechaza condiciones inválidas sin guardar nada ni gastar un código", async () => {
    const harness = createHarness();

    await expect(
      harness.approveLoan.execute(contextOf(), {
        borrowerId: "b-1",
        terms: standardTerms({ principal: Money.zero() }),
      }),
    ).rejects.toThrow(InvalidLoanTermsError);

    const loan = await harness.approveLoan.execute(contextOf(), {
      borrowerId: "b-1",
      terms: standardTerms(),
    });
    expect(loan.code).toBe("PR-0001");
  });
});

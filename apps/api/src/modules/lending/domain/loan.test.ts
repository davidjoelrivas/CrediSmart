import { describe, expect, it } from "vitest";
import { standardTerms } from "../../../testing/harness";
import { activateLoan, approveLoan, InvalidLoanTransitionError } from "./loan";

function newLoan() {
  return approveLoan({
    id: "loan-1",
    organizationId: "org-1",
    borrowerId: "borrower-1",
    code: "PR-0001",
    terms: standardTerms(),
    aprBp: 17_000,
    aprCapOverrideReason: null,
    approvedOn: "2026-12-01",
  });
}

describe("approveLoan", () => {
  it("nace pendiente de firma, con su plan de cuotas y sin desembolso", () => {
    const loan = newLoan();

    expect(loan.status).toBe("PENDING_SIGNATURE");
    expect(loan.disbursedOn).toBeNull();
    expect(loan.balances).toHaveLength(4);
    expect(loan.balances[0]!.dueDate).toBe("2026-12-15");
  });
});

describe("activateLoan", () => {
  it("pasa a activo y guarda la fecha del desembolso sin modificar el original", () => {
    const original = newLoan();
    const activated = activateLoan(original, "2026-12-02");

    expect(activated.status).toBe("ACTIVE");
    expect(activated.disbursedOn).toBe("2026-12-02");
    expect(original.status).toBe("PENDING_SIGNATURE");
  });

  it("no permite desembolsar dos veces", () => {
    const active = activateLoan(newLoan(), "2026-12-02");
    expect(() => activateLoan(active, "2026-12-03")).toThrow(InvalidLoanTransitionError);
  });
});

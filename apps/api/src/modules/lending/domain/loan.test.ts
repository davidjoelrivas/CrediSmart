import { describe, expect, it } from "vitest";
import { standardTerms } from "../../../testing/harness";
import { allocatePayment, Money } from "@app/domain";
import {
  activateLoan,
  approveLoan,
  InvalidLoanTransitionError,
  recordPaymentOnLoan,
  restoreLoanAfterReversal,
} from "./loan";

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

describe("recordPaymentOnLoan", () => {
  const active = () => activateLoan(newLoan(), "2026-12-02");

  it("guarda los nuevos saldos y sigue activo mientras quede deuda", () => {
    const loan = active();
    const { balances } = allocatePayment(loan.balances, Money.fromLempiras("2750"));

    const updated = recordPaymentOnLoan(loan, balances, "2026-12-15");

    expect(updated.status).toBe("ACTIVE");
    expect(updated.closedOn).toBeNull();
    expect(updated.balances).toEqual(balances);
  });

  it("queda pagado, con fecha de cierre, cuando ya no se debe nada", () => {
    const loan = active();
    const { balances } = allocatePayment(loan.balances, Money.fromLempiras("11000"));

    const updated = recordPaymentOnLoan(loan, balances, "2027-01-26");

    expect(updated.status).toBe("PAID_OFF");
    expect(updated.closedOn).toBe("2027-01-26");
  });

  it("no admite pagos si el préstamo no está activo", () => {
    expect(() => recordPaymentOnLoan(newLoan(), newLoan().balances, "2026-12-15")).toThrow(
      InvalidLoanTransitionError,
    );
  });
});

describe("restoreLoanAfterReversal", () => {
  it("reabre un préstamo pagado y limpia su fecha de cierre", () => {
    const loan = activateLoan(newLoan(), "2026-12-02");
    const paid = recordPaymentOnLoan(
      loan,
      allocatePayment(loan.balances, Money.fromLempiras("11000")).balances,
      "2027-01-26",
    );

    const reopened = restoreLoanAfterReversal(paid, loan.balances);

    expect(reopened.status).toBe("ACTIVE");
    expect(reopened.closedOn).toBeNull();
  });

  it("no aplica a un préstamo pendiente de firma", () => {
    expect(() => restoreLoanAfterReversal(newLoan(), newLoan().balances)).toThrow(
      InvalidLoanTransitionError,
    );
  });
});

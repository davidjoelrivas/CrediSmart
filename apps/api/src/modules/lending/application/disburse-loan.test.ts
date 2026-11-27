import { describe, expect, it } from "vitest";
import { summarize } from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import { contextOf, createHarness, standardTerms } from "../../../testing/harness";

async function approvedLoan(harness: ReturnType<typeof createHarness>, organizationId = "org-1") {
  return harness.approveLoan.execute(contextOf(organizationId), {
    borrowerId: "borrower-1",
    terms: standardTerms(),
  });
}

describe("DisburseLoan", () => {
  it("activa el préstamo y guarda la fecha del desembolso", async () => {
    const harness = createHarness({ today: "2026-12-01" });
    const loan = await approvedLoan(harness);
    harness.clock.date = "2026-12-02";

    const activated = await harness.disburseLoan.execute(contextOf(), {
      loanId: loan.id,
      method: "CASH",
    });

    expect(activated.status).toBe("ACTIVE");
    expect(activated.disbursedOn).toBe("2026-12-02");
    expect((await harness.repositories.loans.findById("org-1", loan.id))?.status).toBe("ACTIVE");
  });

  it("registra el asiento contable: la cartera sube y la caja baja", async () => {
    const harness = createHarness();
    const loan = await approvedLoan(harness);

    await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });

    const summary = summarize(await harness.repositories.ledger.entriesOf("org-1"));
    expect(summary.portfolio.toCents()).toBe(1_000_000);
    expect(summary.cash.toCents()).toBe(-1_000_000);
  });

  it("un desembolso por transferencia sale de bancos", async () => {
    const harness = createHarness();
    const loan = await approvedLoan(harness);

    await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "TRANSFER" });

    const [entry] = await harness.repositories.ledger.entriesOf("org-1");
    expect(entry!.lines.some((line) => line.accountCode === "1102")).toBe(true);
  });

  it("deja constancia en la bitácora", async () => {
    const harness = createHarness();
    const loan = await approvedLoan(harness);

    await harness.disburseLoan.execute(contextOf("org-1", "owner-9"), {
      loanId: loan.id,
      method: "CASH",
    });

    const records = await harness.repositories.audit.recordsOf("org-1");
    expect(records.map((record) => record.action)).toEqual(["LOAN_APPROVED", "LOAN_DISBURSED"]);
    expect(records[1]).toMatchObject({ actorId: "owner-9", entityId: loan.id });
  });

  it("no encuentra un préstamo que no existe", async () => {
    const harness = createHarness();

    await expect(
      harness.disburseLoan.execute(contextOf(), { loanId: "no-existe", method: "CASH" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("no permite desembolsar un préstamo de otra organización", async () => {
    const harness = createHarness();
    const loanOfOtherOrganization = await approvedLoan(harness, "org-2");

    await expect(
      harness.disburseLoan.execute(contextOf("org-1"), {
        loanId: loanOfOtherOrganization.id,
        method: "CASH",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(
      (await harness.repositories.loans.findById("org-2", loanOfOtherOrganization.id))?.status,
    ).toBe("PENDING_SIGNATURE");
  });

  it("no permite desembolsar dos veces y no duplica el asiento", async () => {
    const harness = createHarness();
    const loan = await approvedLoan(harness);
    await harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" });

    await expect(
      harness.disburseLoan.execute(contextOf(), { loanId: loan.id, method: "CASH" }),
    ).rejects.toThrow(ConflictError);

    expect(await harness.repositories.ledger.entriesOf("org-1")).toHaveLength(1);
  });
});

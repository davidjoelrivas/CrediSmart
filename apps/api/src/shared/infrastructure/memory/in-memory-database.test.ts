import { describe, expect, it } from "vitest";
import { approveLoan } from "../../../modules/lending/domain/loan";
import { standardTerms } from "../../../testing/harness";
import { InMemoryDatabase, InMemoryUnitOfWork } from "./in-memory-database";

function loanOf(id: string, organizationId: string) {
  return approveLoan({
    id,
    organizationId,
    borrowerId: "borrower-1",
    code: "PR-0001",
    terms: standardTerms(),
    aprBp: 17_000,
    aprCapOverrideReason: null,
    approvedOn: "2026-12-01",
  });
}

describe("InMemoryUnitOfWork", () => {
  it("guarda todo cuando la operación termina bien", async () => {
    const database = new InMemoryDatabase();
    const unitOfWork = new InMemoryUnitOfWork(database);

    await unitOfWork.run(async (repositories) => {
      await repositories.loans.save(loanOf("loan-1", "org-1"));
      await repositories.audit.record({
        organizationId: "org-1",
        actorId: "owner-1",
        action: "TEST",
        entity: "loan",
        entityId: "loan-1",
        on: "2026-12-01",
        details: {},
      });
    });

    expect(await database.repositories().loans.findById("org-1", "loan-1")).not.toBeNull();
    expect(await database.repositories().audit.recordsOf("org-1")).toHaveLength(1);
  });

  it("deshace todo cuando algo falla a mitad de la operación", async () => {
    const database = new InMemoryDatabase();
    const unitOfWork = new InMemoryUnitOfWork(database);

    await expect(
      unitOfWork.run(async (repositories) => {
        await repositories.loans.save(loanOf("loan-1", "org-1"));
        await repositories.loanCodes.next("org-1");
        throw new Error("falla inesperada");
      }),
    ).rejects.toThrow("falla inesperada");

    const repositories = database.repositories();
    expect(await repositories.loans.listByOrganization("org-1")).toEqual([]);
    expect(await repositories.loanCodes.next("org-1")).toBe("PR-0001");
  });
});

describe("aislamiento por organización", () => {
  it("un préstamo solo se encuentra desde su propia organización", async () => {
    const repositories = new InMemoryDatabase().repositories();
    await repositories.loans.save(loanOf("loan-1", "org-1"));

    expect(await repositories.loans.findById("org-1", "loan-1")).not.toBeNull();
    expect(await repositories.loans.findById("org-2", "loan-1")).toBeNull();
    expect(await repositories.loans.listByOrganization("org-2")).toEqual([]);
  });
});

import { Money, type LoanTerms } from "@app/domain";
import { ApproveLoan } from "../modules/lending/application/approve-loan";
import { DisburseLoan } from "../modules/lending/application/disburse-loan";
import { SimulateLoan } from "../modules/lending/application/simulate-loan";
import type { RequestContext } from "../shared/application/ports";
import {
  FixedClock,
  InMemoryDatabase,
  InMemoryUnitOfWork,
  SequentialIds,
  StaticLegalCap,
} from "../shared/infrastructure/memory/in-memory-database";

/** Arma los casos de uso con adaptadores en memoria para probarlos sin base de datos. */
export function createHarness(options: { aprCapBp?: number | null; today?: string } = {}) {
  const database = new InMemoryDatabase();
  const clock = new FixedClock(options.today ?? "2026-12-01");
  const unitOfWork = new InMemoryUnitOfWork(database);
  const ids = new SequentialIds("loan");
  const legalCap = new StaticLegalCap(options.aprCapBp ?? null);

  return {
    database,
    clock,
    repositories: database.repositories(),
    simulateLoan: new SimulateLoan({ legalCap }),
    approveLoan: new ApproveLoan({ unitOfWork, clock, ids, legalCap }),
    disburseLoan: new DisburseLoan({ unitOfWork, clock }),
  };
}

export const contextOf = (organizationId = "org-1", actorId = "owner-1"): RequestContext => ({
  organizationId,
  actorId,
});

/** L 10,000 al 5 % mensual en 4 cuotas quincenales con interés fijo. */
export function standardTerms(overrides: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principal: Money.fromLempiras("10000"),
    rateBp: 500,
    ratePeriod: "MONTHLY",
    paymentFrequency: "BIWEEKLY",
    installments: 4,
    startDate: "2026-12-01",
    ...overrides,
  };
}

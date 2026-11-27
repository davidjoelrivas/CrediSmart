import { Money, type LoanTerms } from "@app/domain";
import type { VerificationCodeGenerator } from "../modules/collections/application/ports";
import { RegisterPayment } from "../modules/collections/application/register-payment";
import { ReversePayment } from "../modules/collections/application/reverse-payment";
import {
  BorrowerQueries,
  CreateBorrower,
  UpdateBorrower,
} from "../modules/borrowers/application/borrower-use-cases";
import { GetDashboard } from "../modules/reporting/application/get-dashboard";
import { LoanQueries } from "../modules/lending/application/loan-queries";
import { AccrueLateFees } from "../modules/lending/application/accrue-late-fees";
import { ApproveLoan } from "../modules/lending/application/approve-loan";
import { DisburseLoan } from "../modules/lending/application/disburse-loan";
import { SimulateLoan } from "../modules/lending/application/simulate-loan";
import type { IdGenerator, RequestContext } from "../shared/application/ports";
import {
  FixedClock,
  InMemoryDatabase,
  InMemoryUnitOfWork,
  SequentialIds,
  SequentialVerificationCodes,
  StaticLegalCap,
} from "../shared/infrastructure/memory/in-memory-database";

/** Arma los casos de uso con adaptadores en memoria para probarlos sin base de datos. */
export function createHarness(
  options: {
    aprCapBp?: number | null;
    today?: string;
    verificationCodes?: VerificationCodeGenerator;
    ids?: IdGenerator;
  } = {},
) {
  const database = new InMemoryDatabase();
  const clock = new FixedClock(options.today ?? "2026-12-01");
  const unitOfWork = new InMemoryUnitOfWork(database);
  const ids = options.ids ?? new SequentialIds("loan");
  const legalCap = new StaticLegalCap(options.aprCapBp ?? null);
  const verificationCodes = options.verificationCodes ?? new SequentialVerificationCodes();

  return {
    database,
    clock,
    unitOfWork,
    repositories: database.repositories(),
    simulateLoan: new SimulateLoan({ legalCap }),
    approveLoan: new ApproveLoan({ unitOfWork, clock, ids, legalCap }),
    disburseLoan: new DisburseLoan({ unitOfWork, clock }),
    createBorrower: new CreateBorrower({ unitOfWork, clock, ids }),
    updateBorrower: new UpdateBorrower({ unitOfWork, clock }),
    borrowerQueries: new BorrowerQueries({ repositories: database.repositories() }),
    getDashboard: new GetDashboard({ repositories: database.repositories(), clock }),
    loanQueries: new LoanQueries({ repositories: database.repositories(), clock }),
    accrueLateFees: new AccrueLateFees({ unitOfWork, clock }),
    registerPayment: new RegisterPayment({ unitOfWork, clock, ids, verificationCodes }),
    reversePayment: new ReversePayment({ unitOfWork, clock, ids }),
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

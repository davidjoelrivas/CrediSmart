import {
  buildSchedule,
  calculateScheduleApr,
  checkAprCap,
  requireAprCapCompliance,
  type AprCapOverride,
  type LoanTerms,
} from "@app/domain";
import type { RequestContext, Clock, IdGenerator, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { approveLoan, type Loan } from "../domain/loan";
import type { LegalCapProvider } from "./ports";

export interface ApproveLoanInput {
  borrowerId: string;
  terms: LoanTerms;
  /** Obligatorio, con motivo, solo si la tasa efectiva anual supera el tope legal configurado. */
  aprCapOverride?: AprCapOverride;
}

/**
 * Aprueba un préstamo: calcula su plan de cuotas y su tasa efectiva anual, verifica el
 * tope legal configurado y lo deja pendiente de firma. No mueve dinero todavía.
 */
export class ApproveLoan {
  constructor(
    private readonly deps: {
      unitOfWork: UnitOfWork<Repositories>;
      clock: Clock;
      ids: IdGenerator;
      legalCap: LegalCapProvider;
    },
  ) {}

  async execute(context: RequestContext, input: ApproveLoanInput): Promise<Loan> {
    const schedule = buildSchedule(input.terms);
    const aprBp = calculateScheduleApr(input.terms.principal, input.terms.startDate, schedule);
    const aprCapBp = await this.deps.legalCap.aprCapBp(context.organizationId);
    const decision = requireAprCapCompliance(checkAprCap(aprBp, aprCapBp), input.aprCapOverride);

    const approvedOn = this.deps.clock.today();

    return this.deps.unitOfWork.run(async (repositories) => {
      const loan = approveLoan({
        id: this.deps.ids.newId(),
        organizationId: context.organizationId,
        borrowerId: input.borrowerId,
        code: await repositories.loanCodes.next(context.organizationId),
        terms: input.terms,
        aprBp,
        aprCapOverrideReason: decision.reason,
        approvedOn,
      });

      await repositories.loans.save(loan);
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "LOAN_APPROVED",
        entity: "loan",
        entityId: loan.id,
        on: approvedOn,
        details: {
          code: loan.code,
          principalCents: input.terms.principal.toCents(),
          aprBp,
          aprCapOverrideReason: decision.reason,
        },
      });
      return loan;
    });
  }
}

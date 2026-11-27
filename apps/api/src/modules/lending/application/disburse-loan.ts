import { disbursementEntry, type PaymentMethod } from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import type { Clock, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { activateLoan, InvalidLoanTransitionError, type Loan } from "../domain/loan";

export interface DisburseLoanInput {
  loanId: string;
  /** De dónde sale el dinero: caja (efectivo) o bancos (transferencia). */
  method: PaymentMethod;
}

/**
 * Entrega el dinero de un préstamo aprobado: lo marca como activo, registra el
 * asiento contable y deja constancia en la bitácora, todo en una sola transacción.
 */
export class DisburseLoan {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async execute(context: RequestContext, input: DisburseLoanInput): Promise<Loan> {
    const today = this.deps.clock.today();

    return this.deps.unitOfWork.run(async (repositories) => {
      const existing = await repositories.loans.findById(context.organizationId, input.loanId);
      if (!existing) {
        throw new NotFoundError("Préstamo", input.loanId);
      }

      let loan: Loan;
      try {
        loan = activateLoan(existing, today);
      } catch (error) {
        if (error instanceof InvalidLoanTransitionError) {
          throw new ConflictError(error.message);
        }
        throw error;
      }

      await repositories.loans.save(loan);
      await repositories.ledger.append(
        context.organizationId,
        disbursementEntry({
          date: today,
          loanId: loan.id,
          principal: loan.terms.principal,
          method: input.method,
        }),
      );
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "LOAN_DISBURSED",
        entity: "loan",
        entityId: loan.id,
        on: today,
        details: {
          code: loan.code,
          principalCents: loan.terms.principal.toCents(),
          method: input.method,
        },
      });
      return loan;
    });
  }
}

import { accrueLateFees } from "@app/domain";
import type { Clock, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { applyLateFees } from "../domain/loan";

export interface AccrueLateFeesResult {
  asOf: string;
  loansChecked: number;
  loansUpdated: number;
  installmentsUpdated: number;
}

/** Quien figura en la bitácora cuando la mora la calcula el sistema y no una persona. */
export const SYSTEM_ACTOR_ID = "system";

/**
 * Pone al día la mora de todos los préstamos activos de una organización. Cada préstamo se
 * procesa en su propia transacción (bloqueado mientras se actualiza), así que un préstamo con
 * problemas no frena a los demás, y correrlo varias veces el mismo día no duplica nada.
 */
export class AccrueLateFees {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async execute(context: RequestContext): Promise<AccrueLateFeesResult> {
    const asOf = this.deps.clock.today();
    const activeLoanIds = await this.deps.unitOfWork.run(async (repositories) =>
      (await repositories.loans.listByOrganization(context.organizationId))
        .filter((loan) => loan.status === "ACTIVE")
        .map((loan) => loan.id),
    );

    let loansUpdated = 0;
    let installmentsUpdated = 0;
    for (const loanId of activeLoanIds) {
      const changed = await this.deps.unitOfWork.run(async (repositories) => {
        const loan = await repositories.loans.findById(context.organizationId, loanId);
        if (!loan || loan.status !== "ACTIVE") {
          return 0;
        }
        const accrual = accrueLateFees(loan.balances, loan.lateFee, loan.graceDays, asOf);
        if (accrual.changedInstallments === 0) {
          return 0;
        }
        await repositories.loans.save(applyLateFees(loan, accrual.balances));
        await repositories.audit.record({
          organizationId: context.organizationId,
          actorId: context.actorId,
          action: "LATE_FEES_ACCRUED",
          entity: "loan",
          entityId: loan.id,
          on: asOf,
          details: { code: loan.code, installments: accrual.changedInstallments },
        });
        return accrual.changedInstallments;
      });
      if (changed > 0) {
        loansUpdated += 1;
        installmentsUpdated += changed;
      }
    }
    return { asOf, loansChecked: activeLoanIds.length, loansUpdated, installmentsUpdated };
  }
}

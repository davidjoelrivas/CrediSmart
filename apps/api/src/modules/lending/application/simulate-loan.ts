import {
  buildSchedule,
  calculateScheduleApr,
  checkAprCap,
  Money,
  type Installment,
  type LoanTerms,
} from "@app/domain";
import type { RequestContext } from "../../../shared/application/ports";
import type { LegalCapProvider } from "./ports";

export interface LoanSimulation {
  schedule: Installment[];
  totalInterest: Money;
  totalToPay: Money;
  /** Tasa efectiva anual en puntos base. */
  aprBp: number;
  /** Tope legal configurado por la organización, o null si no tiene. */
  aprCapBp: number | null;
  exceedsAprCap: boolean;
}

/** Calcula cómo quedaría un préstamo sin guardar nada: plan de cuotas, total a pagar y tasa efectiva anual. */
export class SimulateLoan {
  constructor(private readonly deps: { legalCap: LegalCapProvider }) {}

  async execute(context: RequestContext, terms: LoanTerms): Promise<LoanSimulation> {
    const schedule = buildSchedule(terms);
    const aprBp = calculateScheduleApr(terms.principal, terms.startDate, schedule);
    const aprCapBp = await this.deps.legalCap.aprCapBp(context.organizationId);
    const cap = checkAprCap(aprBp, aprCapBp);

    return {
      schedule,
      totalInterest: schedule.reduce((sum, item) => sum.add(item.interest), Money.zero()),
      totalToPay: schedule.reduce((sum, item) => sum.add(item.total), Money.zero()),
      aprBp,
      aprCapBp: cap.capBp,
      exceedsAprCap: cap.exceeds,
    };
  }
}

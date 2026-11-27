import { Money, type LoanTerms } from "@app/domain";
import type { ApproveLoanRequest, LoanTermsRequest, SessionUser, SimulationView } from "@app/contracts";
import { permissionsOf, type User } from "../modules/identity/domain/user";
import type { LoanSimulation } from "../modules/lending/application/simulate-loan";

export function termsFromRequest(terms: LoanTermsRequest): LoanTerms {
  return {
    principal: Money.fromCents(terms.principalCents),
    rateBp: terms.rateBp,
    ratePeriod: terms.ratePeriod,
    paymentFrequency: terms.paymentFrequency,
    installments: terms.installments,
    interestMethod: terms.interestMethod,
    startDate: terms.startDate,
  };
}

export function sessionUserOf(user: User): SessionUser {
  return {
    id: user.id,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    phone: user.phone,
    permissions: permissionsOf(user.role),
  };
}

export function simulationView(simulation: LoanSimulation): SimulationView {
  return {
    schedule: simulation.schedule.map((item) => ({
      number: item.number,
      dueDate: item.dueDate,
      principalCents: item.principal.toCents(),
      interestCents: item.interest.toCents(),
      totalCents: item.total.toCents(),
    })),
    totalInterestCents: simulation.totalInterest.toCents(),
    totalToPayCents: simulation.totalToPay.toCents(),
    aprBp: simulation.aprBp,
    aprCapBp: simulation.aprCapBp,
    exceedsAprCap: simulation.exceedsAprCap,
  };
}

export function approveInputOf(body: ApproveLoanRequest) {
  return {
    borrowerId: body.borrowerId,
    terms: termsFromRequest(body.terms),
    lateFee: body.lateFee,
    graceDays: body.graceDays,
    aprCapOverride: body.aprCapOverride,
  };
}

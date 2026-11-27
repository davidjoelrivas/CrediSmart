import { describeLateFee, type LateFeeConfig } from "@app/domain";
import { NotFoundError } from "../../../shared/application/errors";
import type { Clock, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";

/** Versión del texto del contrato: cuando el abogado entregue el texto definitivo se sube la versión. */
export const CONTRACT_TEMPLATE_VERSION = "borrador-1";

/** Todos los datos que se imprimen en el contrato y el pagaré. El DNI va completo: es el documento legal. */
export interface ContractData {
  templateVersion: string;
  organizationName: string;
  loanCode: string;
  borrower: { fullName: string; nationalId: string; phone: string | null; address: string | null };
  principalCents: number;
  ratePeriod: string;
  rateBp: number;
  paymentFrequency: string;
  interestMethod: string;
  startDate: string;
  aprBp: number;
  installments: Array<{ number: number; dueDate: string; principalCents: number; interestCents: number; totalCents: number }>;
  totalToPayCents: number;
  lateFeeDescription: string;
  lateFee: LateFeeConfig;
  graceDays: number;
  issuedOn: string;
}

/** Arma los datos del contrato de un préstamo y deja constancia en la bitácora de que se generó. */
export class ContractQueries {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async forLoan(context: RequestContext, loanId: string): Promise<ContractData> {
    const today = this.deps.clock.today();
    return this.deps.unitOfWork.run(async (repositories) => {
      const loan = await repositories.loans.findById(context.organizationId, loanId);
      if (!loan) {
        throw new NotFoundError("Préstamo", loanId);
      }
      const [borrower, organization] = await Promise.all([
        repositories.borrowers.findById(context.organizationId, loan.borrowerId),
        repositories.organizations.findById(context.organizationId),
      ]);
      if (!borrower) {
        throw new NotFoundError("Cliente", loan.borrowerId);
      }

      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "CONTRACT_GENERATED",
        entity: "loan",
        entityId: loan.id,
        on: today,
        details: { code: loan.code, templateVersion: CONTRACT_TEMPLATE_VERSION },
      });

      const installments = loan.balances.map((balance) => ({
        number: balance.number,
        dueDate: balance.dueDate,
        principalCents: balance.principalDue.toCents(),
        interestCents: balance.interestDue.toCents(),
        totalCents: balance.principalDue.add(balance.interestDue).toCents(),
      }));
      return {
        templateVersion: CONTRACT_TEMPLATE_VERSION,
        organizationName: organization?.name ?? "CrediSmart",
        loanCode: loan.code,
        borrower: {
          fullName: borrower.fullName,
          nationalId: borrower.nationalId,
          phone: borrower.phone,
          address: borrower.address,
        },
        principalCents: loan.terms.principal.toCents(),
        ratePeriod: loan.terms.ratePeriod,
        rateBp: loan.terms.rateBp,
        paymentFrequency: loan.terms.paymentFrequency,
        interestMethod: loan.terms.interestMethod ?? "FLAT",
        startDate: loan.terms.startDate,
        aprBp: loan.aprBp,
        installments,
        totalToPayCents: installments.reduce((sum, item) => sum + item.totalCents, 0),
        lateFeeDescription: describeLateFee(loan.lateFee, loan.graceDays),
        lateFee: loan.lateFee,
        graceDays: loan.graceDays,
        issuedOn: today,
      };
    });
  }
}

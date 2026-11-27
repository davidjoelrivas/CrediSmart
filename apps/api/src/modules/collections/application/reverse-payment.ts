import {
  InvalidPaymentError,
  paymentEntryFromAllocations,
  reverseAllocations,
  reverseEntry,
} from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import type { Clock, IdGenerator, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { restoreLoanAfterReversal, type Loan } from "../../lending/domain/loan";
import { isReversal, type Payment } from "../domain/payment";

export interface ReversePaymentInput {
  paymentId: string;
  /** Por qué se revierte; es obligatorio y queda en la bitácora. */
  reason: string;
}

export interface ReversePaymentResult {
  reversal: Payment;
  loan: Loan;
}

/**
 * Corrige un pago mal registrado sin borrarlo: crea un reverso (otro pago con monto
 * negativo), deshace el reparto entre las cuotas y registra el asiento contable contrario.
 * Un pago solo se puede revertir una vez y un reverso no se puede revertir.
 */
export class ReversePayment {
  constructor(
    private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock; ids: IdGenerator },
  ) {}

  async execute(context: RequestContext, input: ReversePaymentInput): Promise<ReversePaymentResult> {
    const reason = input.reason.trim();
    if (reason === "") {
      throw new InvalidPaymentError("Un reverso necesita el motivo de la corrección");
    }
    const today = this.deps.clock.today();

    return this.deps.unitOfWork.run(async (repositories) => {
      const original = await repositories.payments.findById(context.organizationId, input.paymentId);
      if (!original) {
        throw new NotFoundError("Pago", input.paymentId);
      }
      if (isReversal(original)) {
        throw new ConflictError("Un reverso no se puede revertir; registrá el pago de nuevo");
      }
      if (await repositories.payments.findReversalOf(context.organizationId, original.id)) {
        throw new ConflictError("Este pago ya fue revertido");
      }

      const loan = await repositories.loans.findById(context.organizationId, original.loanId);
      if (!loan) {
        throw new NotFoundError("Préstamo", original.loanId);
      }
      const restoredLoan = restoreLoanAfterReversal(
        loan,
        reverseAllocations(loan.balances, original.allocations),
      );

      const reversal: Payment = {
        id: this.deps.ids.newId(),
        organizationId: context.organizationId,
        loanId: original.loanId,
        amount: original.amount.negate(),
        method: original.method,
        reference: original.reference,
        receivedOn: today,
        receivedBy: context.actorId,
        idempotencyKey: `reversal:${original.id}`,
        allocations: original.allocations,
        reversesPaymentId: original.id,
        reversalReason: reason,
      };

      await repositories.loans.save(restoredLoan);
      await repositories.payments.save(reversal);
      await repositories.ledger.append(
        context.organizationId,
        reverseEntry(
          paymentEntryFromAllocations({
            date: original.receivedOn,
            loanId: original.loanId,
            method: original.method,
            allocations: original.allocations,
          }),
          today,
          reason,
        ),
      );
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "PAYMENT_REVERSED",
        entity: "payment",
        entityId: original.id,
        on: today,
        details: {
          loanCode: loan.code,
          amountCents: original.amount.toCents(),
          reversalId: reversal.id,
          reason,
        },
      });

      return { reversal, loan: restoredLoan };
    });
  }
}

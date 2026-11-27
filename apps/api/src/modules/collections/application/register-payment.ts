import {
  allocatePayment,
  InvalidPaymentError,
  isValidIsoDate,
  paymentEntryFromAllocations,
  type Money,
  type PaymentMethod,
} from "@app/domain";
import { ConflictError, NotFoundError } from "../../../shared/application/errors";
import type { Clock, IdGenerator, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { recordPaymentOnLoan, type Loan } from "../../lending/domain/loan";
import type { Payment } from "../domain/payment";
import type { Receipt } from "../domain/receipt";
import type { VerificationCodeGenerator } from "./ports";

export interface RegisterPaymentInput {
  loanId: string;
  amount: Money;
  method: PaymentMethod;
  /** Referencia de la transferencia o del depósito. */
  reference?: string;
  /** Identificador único de esta solicitud; repetirlo no duplica el pago. */
  idempotencyKey: string;
  /** Fecha en que se recibió el dinero; por defecto, hoy. No puede ser futura. */
  receivedOn?: string;
}

export interface RegisterPaymentResult {
  payment: Payment;
  receipt: Receipt;
  loan: Loan;
  /** Verdadero si la solicitud ya se había procesado y se devuelve el resultado original. */
  replayed: boolean;
}

/**
 * Registra un pago: lo reparte entre las cuotas (mora → interés → capital, la cuota más
 * antigua primero), actualiza el préstamo, crea el asiento contable, emite el recibo y deja
 * la bitácora, todo en una sola transacción. Es idempotente: la misma clave devuelve el mismo
 * resultado sin volver a aplicar el pago.
 *
 * Nota para la implementación con MySQL: la fila del préstamo debe bloquearse
 * (`SELECT … FOR UPDATE`) dentro de la transacción para que dos pagos simultáneos no se pisen.
 */
export class RegisterPayment {
  constructor(
    private readonly deps: {
      unitOfWork: UnitOfWork<Repositories>;
      clock: Clock;
      ids: IdGenerator;
      verificationCodes: VerificationCodeGenerator;
    },
  ) {}

  async execute(context: RequestContext, input: RegisterPaymentInput): Promise<RegisterPaymentResult> {
    if (input.idempotencyKey.trim() === "") {
      throw new InvalidPaymentError("La clave de idempotencia es obligatoria");
    }
    const today = this.deps.clock.today();
    const receivedOn = input.receivedOn ?? today;
    if (!isValidIsoDate(receivedOn) || receivedOn > today) {
      throw new InvalidPaymentError("La fecha del pago debe ser válida y no puede ser futura");
    }

    return this.deps.unitOfWork.run(async (repositories) => {
      const replay = await this.findReplay(repositories, context, input);
      if (replay) {
        return replay;
      }

      const loan = await repositories.loans.findById(context.organizationId, input.loanId);
      if (!loan) {
        throw new NotFoundError("Préstamo", input.loanId);
      }
      if (loan.status !== "ACTIVE") {
        throw new ConflictError(`El préstamo ${loan.code} no admite pagos porque está ${loan.status}`);
      }

      const allocation = allocatePayment(loan.balances, input.amount);
      if (!allocation.unallocated.isZero()) {
        throw new ConflictError(
          `El pago supera lo que se debe del préstamo ${loan.code} por ${allocation.unallocated.format()}`,
        );
      }

      const updatedLoan = recordPaymentOnLoan(loan, allocation.balances, receivedOn);
      const payment: Payment = {
        id: this.deps.ids.newId(),
        organizationId: context.organizationId,
        loanId: loan.id,
        amount: input.amount,
        method: input.method,
        reference: input.reference?.trim() || null,
        receivedOn,
        receivedBy: context.actorId,
        idempotencyKey: input.idempotencyKey,
        allocations: allocation.allocations,
        reversesPaymentId: null,
        reversalReason: null,
      };

      await repositories.loans.save(updatedLoan);
      await repositories.payments.save(payment);
      await repositories.ledger.append(
        context.organizationId,
        paymentEntryFromAllocations({
          date: receivedOn,
          loanId: loan.id,
          method: input.method,
          allocations: allocation.allocations,
        }),
      );

      const receipt: Receipt = {
        id: this.deps.ids.newId(),
        organizationId: context.organizationId,
        paymentId: payment.id,
        folio: await repositories.receiptSequence.next(context.organizationId),
        verificationCode: this.deps.verificationCodes.newCode(),
        issuedOn: today,
      };
      await repositories.receipts.save(receipt);

      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "PAYMENT_REGISTERED",
        entity: "payment",
        entityId: payment.id,
        on: today,
        details: {
          loanCode: loan.code,
          amountCents: input.amount.toCents(),
          method: input.method,
          receiptFolio: receipt.folio,
          loanPaidOff: updatedLoan.status === "PAID_OFF",
        },
      });

      return { payment, receipt, loan: updatedLoan, replayed: false };
    });
  }

  /** Si la clave ya se usó con los mismos datos, devuelve el resultado original; con otros datos, es un conflicto. */
  private async findReplay(
    repositories: Repositories,
    context: RequestContext,
    input: RegisterPaymentInput,
  ): Promise<RegisterPaymentResult | null> {
    const existing = await repositories.payments.findByIdempotencyKey(
      context.organizationId,
      input.idempotencyKey,
    );
    if (!existing) {
      return null;
    }
    if (existing.loanId !== input.loanId || !existing.amount.equals(input.amount)) {
      throw new ConflictError("La clave de idempotencia ya se usó con un pago distinto");
    }
    const receipt = await repositories.receipts.findByPaymentId(context.organizationId, existing.id);
    const loan = await repositories.loans.findById(context.organizationId, existing.loanId);
    if (!receipt || !loan) {
      throw new NotFoundError("Recibo del pago", existing.id);
    }
    return { payment: existing, receipt, loan, replayed: true };
  }
}

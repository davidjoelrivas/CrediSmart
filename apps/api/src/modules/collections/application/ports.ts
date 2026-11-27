import type { Payment } from "../domain/payment";
import type { Receipt } from "../domain/receipt";

export interface PaymentRepository {
  save(payment: Payment): Promise<void>;
  findById(organizationId: string, id: string): Promise<Payment | null>;
  findByIdempotencyKey(organizationId: string, key: string): Promise<Payment | null>;
  /** El reverso de un pago, si ya fue revertido. */
  findReversalOf(organizationId: string, paymentId: string): Promise<Payment | null>;
  listByLoan(organizationId: string, loanId: string): Promise<Payment[]>;
}

export interface ReceiptRepository {
  save(receipt: Receipt): Promise<void>;
  findByPaymentId(organizationId: string, paymentId: string): Promise<Receipt | null>;
  /** Búsqueda pública por el código del QR: no depende de la organización de quien consulta. */
  findByVerificationCode(code: string): Promise<Receipt | null>;
}

/** Correlativo de recibos por organización. */
export interface ReceiptSequence {
  next(organizationId: string): Promise<number>;
}

/** Genera códigos de verificación difíciles de adivinar. */
export interface VerificationCodeGenerator {
  newCode(): string;
}

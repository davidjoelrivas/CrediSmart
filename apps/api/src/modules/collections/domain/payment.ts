import type { Money, PaymentAllocation, PaymentMethod } from "@app/domain";

/**
 * Pago recibido. Es inmutable: un error no se edita ni se borra, se corrige con un
 * reverso, que es otro pago con monto negativo que apunta al original.
 */
export interface Payment {
  id: string;
  organizationId: string;
  loanId: string;
  /** Monto recibido; negativo solo en los reversos. */
  amount: Money;
  method: PaymentMethod;
  /** Referencia de la transferencia o del depósito, si la hay. */
  reference: string | null;
  receivedOn: string;
  receivedBy: string;
  /** Evita registrar dos veces el mismo pago si la solicitud se repite. */
  idempotencyKey: string;
  /** Cómo se repartió entre las cuotas. En un reverso, lo que se está deshaciendo. */
  allocations: readonly PaymentAllocation[];
  reversesPaymentId: string | null;
  reversalReason: string | null;
}

export function isReversal(payment: Payment): boolean {
  return payment.reversesPaymentId !== null;
}

/** Recibo de un pago: comprobante con un número correlativo y un código para verificar su autenticidad. */
export interface Receipt {
  id: string;
  organizationId: string;
  paymentId: string;
  /** Número correlativo dentro de la organización. */
  folio: number;
  /** Código que se imprime en el QR del recibo para comprobar que es auténtico. */
  verificationCode: string;
  issuedOn: string;
}

/** Texto del folio tal como se imprime: REC-000123. */
export function formatReceiptFolio(folio: number): string {
  return `REC-${String(folio).padStart(6, "0")}`;
}

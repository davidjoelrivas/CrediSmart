import type { Loan } from "../domain/loan";

/** Todo acceso a préstamos recibe la organización: un préstamo de otra organización nunca se devuelve. */
export interface LoanRepository {
  save(loan: Loan): Promise<void>;
  findById(organizationId: string, id: string): Promise<Loan | null>;
  listByOrganization(organizationId: string): Promise<Loan[]>;
}

/** Correlativo de préstamos por organización (PR-0001, PR-0002…). */
export interface LoanCodeSequence {
  next(organizationId: string): Promise<string>;
}

/** Tope legal de la tasa efectiva anual configurado por la organización; null si no tiene. */
export interface LegalCapProvider {
  aprCapBp(organizationId: string): Promise<number | null>;
}

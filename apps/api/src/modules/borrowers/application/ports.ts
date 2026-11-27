import type { Borrower } from "../domain/borrower";

export interface BorrowerSearch {
  /** Texto que se busca dentro del nombre o del teléfono. */
  text?: string;
  limit: number;
  offset: number;
}

/** Todo acceso recibe la organización: un cliente de otra organización nunca se devuelve. */
export interface BorrowerRepository {
  /** Crea el cliente o, si ya existe, actualiza sus datos de contacto y su estado. */
  save(borrower: Borrower): Promise<void>;
  findById(organizationId: string, id: string): Promise<Borrower | null>;
  findByNationalId(organizationId: string, nationalId: string): Promise<Borrower | null>;
  /** Solo los nombres, por id. No descifra el DNI: para pantallas que solo muestran quién es el cliente. */
  namesByIds(organizationId: string, ids: readonly string[]): Promise<Map<string, string>>;
  search(organizationId: string, search: BorrowerSearch): Promise<Borrower[]>;
}

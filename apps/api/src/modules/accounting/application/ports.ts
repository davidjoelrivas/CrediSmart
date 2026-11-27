import type { JournalEntry } from "@app/domain";

/** Libro diario de la organización: solo se agregan asientos, nunca se editan ni se borran. */
export interface LedgerRepository {
  append(organizationId: string, entry: JournalEntry): Promise<void>;
  entriesOf(organizationId: string): Promise<JournalEntry[]>;
}

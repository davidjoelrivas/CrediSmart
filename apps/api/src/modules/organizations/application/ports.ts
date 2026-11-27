export interface OrganizationSummary {
  id: string;
  name: string;
}

export interface OrganizationRepository {
  findById(id: string): Promise<OrganizationSummary | null>;
  /** Todas las organizaciones: lo usan las tareas automáticas (por ejemplo, el cálculo diario de mora). */
  listIds(): Promise<string[]>;
}

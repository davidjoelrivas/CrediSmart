/** Quién hace la solicitud y para qué organización. Toda operación lo recibe de forma explícita. */
export interface RequestContext {
  organizationId: string;
  actorId: string;
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio. Se inyecta para poder probar con cualquier fecha. */
export interface Clock {
  today(): string;
}

export interface IdGenerator {
  newId(): string;
}

/**
 * Frontera transaccional: todo lo que ocurre dentro de `run` se guarda junto o
 * no se guarda nada. `R` son los repositorios disponibles dentro de la transacción.
 */
export interface UnitOfWork<R> {
  run<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}

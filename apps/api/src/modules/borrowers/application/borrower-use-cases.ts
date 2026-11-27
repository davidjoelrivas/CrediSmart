import { ConflictError, NotFoundError, ValidationError } from "../../../shared/application/errors";
import type { Clock, IdGenerator, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { normalizePhone } from "../../identity/domain/user";
import {
  normalizeNationalId,
  viewOf,
  type Borrower,
  type BorrowerStatus,
  type BorrowerView,
} from "../domain/borrower";

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 200) {
    throw new ValidationError("El nombre debe tener entre 3 y 200 caracteres");
  }
  return name;
}

function cleanPhone(value: string | undefined | null): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return normalizePhone(value);
  } catch {
    throw new ValidationError("El teléfono debe tener 8 dígitos");
  }
}

function cleanAddress(value: string | undefined | null): string | null {
  const address = value?.trim() ?? "";
  if (address.length > 300) {
    throw new ValidationError("La dirección no puede pasar de 300 caracteres");
  }
  return address === "" ? null : address;
}

export interface CreateBorrowerInput {
  fullName: string;
  nationalId: string;
  phone?: string;
  address?: string;
  /** El cliente aceptó el aviso de privacidad (obligatorio para guardar sus datos). */
  privacyConsent: boolean;
}

/** Registra un cliente nuevo. El DNI no se puede repetir dentro de la organización. */
export class CreateBorrower {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock; ids: IdGenerator }) {}

  async execute(context: RequestContext, input: CreateBorrowerInput): Promise<BorrowerView> {
    if (!input.privacyConsent) {
      throw new ValidationError("Se necesita el consentimiento del cliente para guardar sus datos");
    }
    const nationalId = normalizeNationalId(input.nationalId);
    const today = this.deps.clock.today();

    return this.deps.unitOfWork.run(async (repositories) => {
      if (await repositories.borrowers.findByNationalId(context.organizationId, nationalId)) {
        throw new ConflictError("Ya existe un cliente con ese DNI");
      }
      const borrower: Borrower = {
        id: this.deps.ids.newId(),
        organizationId: context.organizationId,
        fullName: cleanName(input.fullName),
        nationalId,
        phone: cleanPhone(input.phone),
        address: cleanAddress(input.address),
        status: "ACTIVE",
        privacyConsentOn: today,
        createdOn: today,
      };
      await repositories.borrowers.save(borrower);
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "BORROWER_CREATED",
        entity: "borrower",
        entityId: borrower.id,
        on: today,
        details: { fullName: borrower.fullName },
      });
      return viewOf(borrower);
    });
  }
}

export interface UpdateBorrowerInput {
  borrowerId: string;
  fullName?: string;
  phone?: string | null;
  address?: string | null;
  status?: BorrowerStatus;
}

/** Corrige datos de contacto o cambia el estado de un cliente. El DNI no se edita. */
export class UpdateBorrower {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async execute(context: RequestContext, input: UpdateBorrowerInput): Promise<BorrowerView> {
    const today = this.deps.clock.today();
    return this.deps.unitOfWork.run(async (repositories) => {
      const existing = await repositories.borrowers.findById(context.organizationId, input.borrowerId);
      if (!existing) {
        throw new NotFoundError("Cliente", input.borrowerId);
      }
      const updated: Borrower = {
        ...existing,
        fullName: input.fullName === undefined ? existing.fullName : cleanName(input.fullName),
        phone: input.phone === undefined ? existing.phone : cleanPhone(input.phone),
        address: input.address === undefined ? existing.address : cleanAddress(input.address),
        status: input.status ?? existing.status,
      };
      await repositories.borrowers.save(updated);
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "BORROWER_UPDATED",
        entity: "borrower",
        entityId: updated.id,
        on: today,
        details: { status: updated.status },
      });
      return viewOf(updated);
    });
  }
}

/** Lecturas de clientes. */
export class BorrowerQueries {
  constructor(private readonly deps: { repositories: Repositories }) {}

  async get(context: RequestContext, borrowerId: string): Promise<BorrowerView> {
    const borrower = await this.deps.repositories.borrowers.findById(context.organizationId, borrowerId);
    if (!borrower) {
      throw new NotFoundError("Cliente", borrowerId);
    }
    return viewOf(borrower);
  }

  /** Busca por nombre o teléfono, o por DNI completo si el texto tiene 13 dígitos. */
  async search(
    context: RequestContext,
    input: { text?: string; limit?: number; offset?: number },
  ): Promise<BorrowerView[]> {
    const text = input.text?.trim() ?? "";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    if (/^[\d\s-]{13,17}$/.test(text) && text.replace(/[\s-]/g, "").length === 13) {
      const found = await this.deps.repositories.borrowers.findByNationalId(
        context.organizationId,
        text.replace(/[\s-]/g, ""),
      );
      return found ? [viewOf(found)] : [];
    }
    const borrowers = await this.deps.repositories.borrowers.search(context.organizationId, {
      text: text === "" ? undefined : text,
      limit,
      offset,
    });
    return borrowers.map(viewOf);
  }
}

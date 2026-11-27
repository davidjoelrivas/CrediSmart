import type { IdGenerator } from "../../../shared/application/ports";
import {
  InvalidUserError,
  normalizeEmail,
  normalizePhone,
  validatePassword,
  type Role,
  type User,
} from "../domain/user";
import type { PasswordHasher, UserRepository } from "./ports";

export interface CreateUserInput {
  organizationId: string;
  role: Role;
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  borrowerId?: string;
}

/** Crea una cuenta de acceso (dueño, cobrador, contador o cliente del portal). */
export class CreateUser {
  constructor(
    private readonly deps: { users: UserRepository; hasher: PasswordHasher; ids: IdGenerator },
  ) {}

  async execute(input: CreateUserInput): Promise<User> {
    const fullName = input.fullName.trim();
    if (fullName.length < 2 || fullName.length > 160) {
      throw new InvalidUserError("El nombre debe tener entre 2 y 160 caracteres");
    }
    const email = input.email?.trim() ? normalizeEmail(input.email) : null;
    const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
    if (!email && !phone) {
      throw new InvalidUserError("Indica un correo o un teléfono para iniciar sesión");
    }
    if ((input.role === "CLIENT") !== Boolean(input.borrowerId)) {
      throw new InvalidUserError("Las cuentas de cliente deben vincularse a un cliente, y solo ellas");
    }
    validatePassword(input.password, email);

    const user: User = {
      id: this.deps.ids.newId(),
      organizationId: input.organizationId,
      role: input.role,
      fullName,
      email,
      phone,
      borrowerId: input.borrowerId ?? null,
      status: "ACTIVE",
    };
    await this.deps.users.create({
      ...user,
      passwordHash: await this.deps.hasher.hash(input.password),
      failedLogins: 0,
      lockedUntil: null,
    });
    return user;
  }
}

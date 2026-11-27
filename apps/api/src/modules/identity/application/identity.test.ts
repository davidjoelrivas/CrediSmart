import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../../../shared/application/errors";
import { SequentialIds } from "../../../shared/infrastructure/memory/in-memory-database";
import { can, InvalidUserError, normalizePhone, validatePassword } from "../domain/user";
import {
  InMemorySessionRepository,
  InMemoryUserRepository,
  ManualInstantClock,
  PlainPasswordHasher,
} from "../infrastructure/memory/in-memory-identity";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";
import { AuthenticateSession } from "./authenticate-session";
import { CreateUser } from "./create-user";
import { AccountLockedError, Login } from "./login";
import { Logout } from "./logout";
import { DuplicateUserError } from "./ports";

function setup() {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const clock = new ManualInstantClock();
  const hasher = new PlainPasswordHasher();
  const ids = new SequentialIds("id");
  return {
    users,
    sessions,
    clock,
    createUser: new CreateUser({ users, hasher, ids }),
    login: new Login({ users, sessions, hasher, clock, ids }),
    authenticate: new AuthenticateSession({ users, sessions, clock }),
    logout: new Logout({ sessions, clock }),
  };
}

async function withOwner(system = setup()) {
  const owner = await system.createUser.execute({
    organizationId: "org-1",
    role: "OWNER",
    fullName: "Mauricio Mejía",
    email: "Mauricio@Ejemplo.com",
    password: "una-clave-larga-123",
  });
  return { system, owner };
}

describe("CreateUser", () => {
  it("guarda el correo en minúsculas y el teléfono con 8 dígitos", async () => {
    const { system } = await withOwner();
    const collector = await system.createUser.execute({
      organizationId: "org-1",
      role: "COLLECTOR",
      fullName: "Cobrador Uno",
      phone: "+504 9988-7766",
      password: "otra-clave-larga-1",
    });

    expect(collector.phone).toBe("99887766");
    expect([...system.users.records.values()][0]!.email).toBe("mauricio@ejemplo.com");
  });

  it("rechaza correos o teléfonos repetidos", async () => {
    const { system } = await withOwner();

    await expect(
      system.createUser.execute({
        organizationId: "org-1",
        role: "COLLECTOR",
        fullName: "Otra Persona",
        email: "mauricio@ejemplo.com",
        password: "otra-clave-larga-1",
      }),
    ).rejects.toBeInstanceOf(DuplicateUserError);
  });

  it("exige correo o teléfono, y vincula cliente solo al rol CLIENT", async () => {
    const system = setup();
    const base = { organizationId: "org-1", fullName: "Alguien", password: "clave-larga-123" };

    await expect(system.createUser.execute({ ...base, role: "OWNER" })).rejects.toBeInstanceOf(InvalidUserError);
    await expect(
      system.createUser.execute({ ...base, role: "CLIENT", email: "a@b.co" }),
    ).rejects.toBeInstanceOf(InvalidUserError);
    await expect(
      system.createUser.execute({ ...base, role: "OWNER", email: "a@b.co", borrowerId: "b-1" }),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it("no guarda la contraseña en claro", async () => {
    const users = new InMemoryUserRepository();
    const hasher = new ScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1 });

    await new CreateUser({ users, hasher, ids: new SequentialIds("id") }).execute({
      organizationId: "org-1",
      role: "OWNER",
      fullName: "Mauricio Mejía",
      email: "mauricio@ejemplo.com",
      password: "una-clave-larga-123",
    });

    const [record] = [...users.records.values()];
    expect(record!.passwordHash).toMatch(/^scrypt\$/);
    expect(record!.passwordHash).not.toContain("una-clave-larga-123");
  });
});

describe("validatePassword", () => {
  it("pide largo mínimo y rechaza claves triviales", () => {
    expect(() => validatePassword("corta")).toThrow(InvalidUserError);
    expect(() => validatePassword("aaaaaaaaaaaa")).toThrow(InvalidUserError);
    expect(() => validatePassword("1234567890")).toThrow(InvalidUserError);
    expect(() => validatePassword("a@b.co.ejemplo", "a@b.co.ejemplo")).toThrow(InvalidUserError);
    expect(() => validatePassword("una-clave-larga-123")).not.toThrow();
  });
});

describe("normalizePhone", () => {
  it("acepta formatos habituales y rechaza lo que no es un teléfono", () => {
    expect(normalizePhone("9988 7766")).toBe("99887766");
    expect(normalizePhone("(504) 9988-7766")).toBe("99887766");
    expect(() => normalizePhone("123")).toThrow(InvalidUserError);
  });
});

describe("Login", () => {
  it("inicia sesión con correo (sin importar mayúsculas) y con teléfono", async () => {
    const { system } = await withOwner();
    await system.createUser.execute({
      organizationId: "org-1",
      role: "COLLECTOR",
      fullName: "Cobrador Uno",
      phone: "99887766",
      password: "otra-clave-larga-1",
    });

    const byEmail = await system.login.execute({ login: " MAURICIO@ejemplo.com ", password: "una-clave-larga-123" });
    const byPhone = await system.login.execute({ login: "9988-7766", password: "otra-clave-larga-1" });

    expect(byEmail.user.role).toBe("OWNER");
    expect(byPhone.user.role).toBe("COLLECTOR");
    expect(byEmail.token).not.toEqual(byPhone.token);
  });

  it("la respuesta no incluye datos secretos", async () => {
    const { system } = await withOwner();

    const result = await system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" });

    expect(result.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(result.user)).not.toContain("plain:");
  });

  it("da el mismo error si el usuario no existe o la contraseña es incorrecta", async () => {
    const { system } = await withOwner();

    const unknown = await system.login.execute({ login: "nadie@ejemplo.com", password: "x" }).catch((e) => e);
    const wrong = await system.login.execute({ login: "mauricio@ejemplo.com", password: "x" }).catch((e) => e);

    expect(unknown).toBeInstanceOf(UnauthorizedError);
    expect(wrong).toBeInstanceOf(UnauthorizedError);
    expect(unknown.message).toBe(wrong.message);
  });

  it("bloquea la cuenta al quinto intento fallido y la libera pasado el tiempo", async () => {
    const { system } = await withOwner();
    const attempt = () => system.login.execute({ login: "mauricio@ejemplo.com", password: "mala" }).catch((e) => e);

    for (let index = 0; index < 4; index++) {
      expect(await attempt()).toBeInstanceOf(UnauthorizedError);
    }
    expect(await attempt()).toBeInstanceOf(AccountLockedError);
    // Mientras está bloqueada, ni la contraseña correcta entra.
    await expect(
      system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" }),
    ).rejects.toBeInstanceOf(AccountLockedError);

    system.clock.advanceMinutes(16);
    const ok = await system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" });
    expect(ok.user.fullName).toBe("Mauricio Mejía");
  });

  it("un inicio correcto reinicia el conteo de fallos", async () => {
    const { system } = await withOwner();
    const wrong = () => system.login.execute({ login: "mauricio@ejemplo.com", password: "mala" }).catch(() => undefined);

    await wrong();
    await wrong();
    await system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" });
    for (let index = 0; index < 4; index++) {
      await wrong();
    }

    // Cuatro fallos desde el reinicio: todavía no está bloqueada.
    await expect(
      system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" }),
    ).resolves.toBeDefined();
  });

  it("una cuenta desactivada no puede entrar", async () => {
    const { system, owner } = await withOwner();
    await system.users.setStatus(owner.id, "DISABLED");

    await expect(
      system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("sesiones", () => {
  async function loggedIn() {
    const { system } = await withOwner();
    const result = await system.login.execute({ login: "mauricio@ejemplo.com", password: "una-clave-larga-123" });
    return { system, token: result.token };
  }

  it("el token abre la sesión y la base solo guarda su hash", async () => {
    const { system, token } = await loggedIn();

    const user = await system.authenticate.execute(token);

    expect(user).toMatchObject({ organizationId: "org-1", role: "OWNER" });
    const stored = [...system.sessions.sessions.values()][0]!;
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });

  it("rechaza tokens ausentes, inventados o vencidos", async () => {
    const { system, token } = await loggedIn();

    await expect(system.authenticate.execute(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(system.authenticate.execute("inventado")).rejects.toBeInstanceOf(UnauthorizedError);
    system.clock.advanceHours(13);
    await expect(system.authenticate.execute(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("cerrar sesión invalida el token", async () => {
    const { system, token } = await loggedIn();

    await system.logout.execute(token);

    await expect(system.authenticate.execute(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("desactivar al usuario corta sus sesiones abiertas", async () => {
    const { system, token } = await loggedIn();
    const [record] = [...system.users.records.values()];

    await system.users.setStatus(record!.id, "DISABLED");

    await expect(system.authenticate.execute(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("permisos por rol", () => {
  it("solo el dueño aprueba, desembolsa y revierte", () => {
    for (const permission of ["loans:approve", "loans:disburse", "payments:reverse", "users:manage"] as const) {
      expect(can("OWNER", permission)).toBe(true);
      expect(can("COLLECTOR", permission)).toBe(false);
      expect(can("ACCOUNTANT", permission)).toBe(false);
      expect(can("CLIENT", permission)).toBe(false);
    }
  });

  it("el cobrador cobra, el contador solo consulta y el cliente solo ve su portal", () => {
    expect(can("COLLECTOR", "payments:register")).toBe(true);
    expect(can("ACCOUNTANT", "payments:register")).toBe(false);
    expect(can("ACCOUNTANT", "reports:read")).toBe(true);
    expect(can("CLIENT", "loans:read")).toBe(false);
    expect(can("CLIENT", "portal:read")).toBe(true);
  });
});

describe("ScryptPasswordHasher", () => {
  const hasher = new ScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1 });

  it("verifica la contraseña correcta y rechaza las demás", async () => {
    const stored = await hasher.hash("una-clave-larga-123");

    expect(await hasher.verify("una-clave-larga-123", stored)).toBe(true);
    expect(await hasher.verify("otra-clave", stored)).toBe(false);
  });

  it("usa una sal distinta cada vez", async () => {
    expect(await hasher.hash("misma-clave-1234")).not.toBe(await hasher.hash("misma-clave-1234"));
  });

  it("no se rompe con un formato guardado inválido", async () => {
    expect(await hasher.verify("x", "texto-raro")).toBe(false);
  });
});

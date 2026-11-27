import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryServices } from "../testing/memory-services";
import { buildApp } from "./app";
import { SESSION_COOKIE } from "./security";

const ORGANIZATION = "01900000-0000-7000-8000-000000000001";
const PASSWORD = "una-clave-larga-123";

const terms = {
  principalCents: 1_000_000,
  rateBp: 500,
  ratePeriod: "MONTHLY",
  paymentFrequency: "BIWEEKLY",
  installments: 4,
  startDate: "2026-12-01",
};

let system: ReturnType<typeof createMemoryServices>;
let app: FastifyInstance;

beforeEach(async () => {
  system = createMemoryServices({ today: "2026-12-01" });
  app = await buildApp(system.services, { loginRateLimitPerMinute: 1000, globalRateLimitPerMinute: 10_000 });
  for (const [role, email] of [
    ["OWNER", "dueno@ejemplo.com"],
    ["COLLECTOR", "cobrador@ejemplo.com"],
    ["ACCOUNTANT", "contador@ejemplo.com"],
  ] as const) {
    await system.services.createUser.execute({
      organizationId: ORGANIZATION,
      role,
      fullName: `Usuario ${role}`,
      email,
      password: PASSWORD,
    });
  }
});

afterEach(async () => {
  await app.close();
});

function cookieOf(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE);
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

async function loginAs(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { login: email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return cookieOf(response);
}

const asOwner = () => loginAs("dueno@ejemplo.com");

async function call(
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({ method, url, payload: payload as object | undefined, headers: { cookie } });
}

async function createBorrower(cookie: string, nationalId = "0801-1990-12345") {
  const response = await call(cookie, "POST", "/api/v1/borrowers", {
    fullName: "María Fernanda López",
    nationalId,
    phone: "9988-7766",
    privacyConsent: true,
  });
  expect(response.statusCode).toBe(201);
  return response.json().borrower as { id: string };
}

async function activeLoan(cookie: string) {
  const borrower = await createBorrower(cookie);
  const approved = await call(cookie, "POST", "/api/v1/loans", {
    borrowerId: borrower.id,
    terms,
    lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 },
    graceDays: 2,
  });
  expect(approved.statusCode).toBe(201);
  const loanId = approved.json().loan.id as string;
  const disbursed = await call(cookie, "POST", `/api/v1/loans/${loanId}/disburse`, { method: "CASH" });
  expect(disbursed.statusCode).toBe(200);
  return { borrower, loanId };
}

describe("sesión", () => {
  it("la cookie de sesión es HttpOnly y la respuesta no trae secretos", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login: "dueno@ejemplo.com", password: PASSWORD },
    });

    const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(response.body).not.toContain("passwordHash");
    expect(response.json().user).toMatchObject({ role: "OWNER", fullName: "Usuario OWNER" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rechaza credenciales incorrectas con 401 y el mismo mensaje", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login: "dueno@ejemplo.com", password: "incorrecta" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login: "nadie@ejemplo.com", password: "incorrecta" },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("bloquea la cuenta tras cinco intentos con 423", async () => {
    let last: LightMyRequestResponse | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      last = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { login: "dueno@ejemplo.com", password: "incorrecta" },
      });
    }

    expect(last!.statusCode).toBe(423);
    expect(last!.json().error.code).toBe("ACCOUNT_LOCKED");
  });

  it("/auth/me devuelve al usuario y sus permisos; sin sesión da 401", async () => {
    const cookie = await asOwner();

    const me = await call(cookie, "GET", "/api/v1/auth/me");
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/auth/me" });

    expect(me.json().user.permissions).toContain("loans:approve");
    expect(anonymous.statusCode).toBe(401);
  });

  it("cerrar sesión invalida la cookie", async () => {
    const cookie = await asOwner();

    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });

    expect((await call(cookie, "GET", "/api/v1/auth/me")).statusCode).toBe(401);
  });

  it("el límite de intentos por IP responde 429", async () => {
    const limited = await buildApp(system.services, { loginRateLimitPerMinute: 3 });
    const attempts: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await limited.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { login: "nadie@ejemplo.com", password: "x" },
      });
      attempts.push(response.statusCode);
    }
    await limited.close();

    expect(attempts.slice(0, 3)).toEqual([401, 401, 401]);
    expect(attempts[4]).toBe(429);
  });
});

describe("seguridad de la API", () => {
  it("toda ruta de negocio exige sesión", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/dashboard"],
      ["GET", "/api/v1/borrowers"],
      ["GET", "/api/v1/loans"],
      ["POST", "/api/v1/payments"],
      ["GET", "/api/v1/audit"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("rechaza solicitudes de escritura que vienen de otro sitio (CSRF)", async () => {
    const cookie = await asOwner();

    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/borrowers",
      headers: { cookie, origin: "https://sitio-malicioso.example", "sec-fetch-site": "cross-site" },
      payload: { fullName: "Alguien", nationalId: "0801199012345", privacyConsent: true },
    });
    const own = await app.inject({
      method: "POST",
      url: "/api/v1/borrowers",
      headers: { cookie, origin: "http://localhost:3000", host: "localhost:3000" },
      payload: { fullName: "Alguien Más", nationalId: "0801199012346", privacyConsent: true },
    });

    expect(foreign.statusCode).toBe(403);
    expect(own.statusCode).toBe(201);
  });

  it("envía cabeceras de seguridad", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("errores internos no filtran detalles", async () => {
    system.services.getDashboard.execute = async () => {
      throw new Error("select * from secreto: password=abc123");
    };
    const cookie = await asOwner();

    const response = await call(cookie, "GET", "/api/v1/dashboard");

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secreto");
    expect(response.json().error.code).toBe("INTERNAL");
  });
});

describe("roles", () => {
  it("el cobrador cobra y registra clientes, pero no aprueba, desembolsa ni revierte", async () => {
    const owner = await asOwner();
    const { borrower, loanId } = await activeLoan(owner);
    const collector = await loginAs("cobrador@ejemplo.com");

    const approve = await call(collector, "POST", "/api/v1/loans", { borrowerId: borrower.id, terms });
    const disburse = await call(collector, "POST", `/api/v1/loans/${loanId}/disburse`, { method: "CASH" });
    const pay = await call(collector, "POST", "/api/v1/payments", {
      loanId,
      amountCents: 100_000,
      method: "CASH",
      idempotencyKey: "cobro-cobrador-1",
    });
    const reverse = await call(collector, "POST", `/api/v1/payments/${pay.json().paymentId}/reverse`, {
      reason: "Me equivoqué al registrar",
    });
    const newBorrower = await call(collector, "POST", "/api/v1/borrowers", {
      fullName: "Otro Cliente",
      nationalId: "0501198500077",
      privacyConsent: true,
    });

    expect(approve.statusCode).toBe(403);
    expect(disburse.statusCode).toBe(403);
    expect(pay.statusCode).toBe(201);
    expect(reverse.statusCode).toBe(403);
    expect(newBorrower.statusCode).toBe(201);
  });

  it("el contador consulta pero no puede escribir", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);
    const accountant = await loginAs("contador@ejemplo.com");

    expect((await call(accountant, "GET", "/api/v1/dashboard")).statusCode).toBe(200);
    expect((await call(accountant, "GET", `/api/v1/loans/${loanId}`)).statusCode).toBe(200);
    expect((await call(accountant, "GET", "/api/v1/audit")).statusCode).toBe(200);
    expect(
      (await call(accountant, "POST", "/api/v1/payments", { loanId, amountCents: 1000, method: "CASH", idempotencyKey: "cobro-contador-1" })).statusCode,
    ).toBe(403);
    expect((await call(accountant, "GET", "/api/v1/users")).statusCode).toBe(403);
  });

  it("el dueño crea usuarios y la contraseña débil se rechaza", async () => {
    const owner = await asOwner();

    const created = await call(owner, "POST", "/api/v1/users", {
      role: "COLLECTOR",
      fullName: "Nuevo Cobrador",
      phone: "3300-1122",
      password: "otra-clave-larga-9",
    });
    const weak = await call(owner, "POST", "/api/v1/users", {
      role: "COLLECTOR",
      fullName: "Cobrador Débil",
      phone: "3300-1123",
      password: "aaaaaaaaaaaa",
    });
    const list = await call(owner, "GET", "/api/v1/users");

    expect(created.statusCode).toBe(201);
    expect(weak.statusCode).toBe(422);
    expect(list.json().users).toHaveLength(4);
    expect(created.body).not.toContain("password");
  });
});

describe("flujo completo de un préstamo", () => {
  it("simula, aprueba, desembolsa, cobra, emite recibo y actualiza el tablero", async () => {
    const owner = await asOwner();

    const simulation = await call(owner, "POST", "/api/v1/loans/simulate", { terms });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json().schedule).toHaveLength(4);
    expect(simulation.json().totalToPayCents).toBe(1_100_000);

    const { loanId } = await activeLoan(owner);
    const payment = await call(owner, "POST", "/api/v1/payments", {
      loanId,
      amountCents: 275_000,
      method: "TRANSFER",
      reference: "BAC-12345",
      idempotencyKey: "cobro-001-abcdef",
    });
    expect(payment.statusCode).toBe(201);
    expect(payment.json().receipt.folio).toBe(1);

    const detail = (await call(owner, "GET", `/api/v1/loans/${loanId}`)).json().loan;
    expect(detail.status).toBe("ACTIVE");
    expect(detail.installmentsDetail[0].status).toBe("PAID");
    expect(detail.payments[0]).toMatchObject({ receiptFolio: "REC-000001", amountCents: 275_000 });
    expect(detail.lateFee.description).toContain("5 % del monto vencido");

    const dashboard = (await call(owner, "GET", "/api/v1/dashboard")).json();
    expect(dashboard.loans.active).toBe(1);
    expect(dashboard.income.collectedThisMonthCents).toBe(275_000);
    expect(dashboard.recentPayments[0].borrowerName).toBe("María Fernanda López");
  });

  it("repetir el mismo cobro no lo duplica (idempotencia)", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);
    const body = { loanId, amountCents: 100_000, method: "CASH", idempotencyKey: "cobro-repetido-1" };

    const first = await call(owner, "POST", "/api/v1/payments", body);
    const second = await call(owner, "POST", "/api/v1/payments", body);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ replayed: true, paymentId: first.json().paymentId });
  });

  it("el recibo sale en PDF y el QR se verifica sin iniciar sesión", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);
    const payment = (
      await call(owner, "POST", "/api/v1/payments", { loanId, amountCents: 100_000, method: "CASH", idempotencyKey: "cobro-pdf-0001" })
    ).json();

    const pdf = await call(owner, "GET", `/api/v1/payments/${payment.paymentId}/receipt.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const verified = await app.inject({
      method: "GET",
      url: `/api/v1/public/receipts/${payment.receipt.verificationCode}`,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ valid: true, amountCents: 100_000, borrowerHint: "María L." });
    expect(verified.body).not.toContain("0801");

    const fake = await app.inject({ method: "GET", url: "/api/v1/public/receipts/CODIGO-FALSO-1" });
    expect(fake.statusCode).toBe(404);
  });

  it("genera el contrato y pagaré en PDF, solo para el dueño, y lo deja en la bitácora", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);
    const collector = await loginAs("cobrador@ejemplo.com");

    const pdf = await call(owner, "GET", `/api/v1/loans/${loanId}/contract.pdf`);
    const denied = await call(collector, "GET", `/api/v1/loans/${loanId}/contract.pdf`);
    const audit = (await call(owner, "GET", "/api/v1/audit")).json();

    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(denied.statusCode).toBe(403);
    expect(audit.records.map((record: { action: string }) => record.action)).toContain("CONTRACT_GENERATED");
  });

  it("revertir un pago anula su recibo", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);
    const payment = (
      await call(owner, "POST", "/api/v1/payments", { loanId, amountCents: 100_000, method: "CASH", idempotencyKey: "cobro-rev-0001" })
    ).json();

    const reversed = await call(owner, "POST", `/api/v1/payments/${payment.paymentId}/reverse`, {
      reason: "Se registró dos veces",
    });
    const verified = await app.inject({
      method: "GET",
      url: `/api/v1/public/receipts/${payment.receipt.verificationCode}`,
    });

    expect(reversed.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ valid: false, voided: true });
  });

  it("un cobro mayor a la deuda se rechaza con un mensaje claro", async () => {
    const owner = await asOwner();
    const { loanId } = await activeLoan(owner);

    const response = await call(owner, "POST", "/api/v1/payments", {
      loanId,
      amountCents: 99_999_900,
      method: "CASH",
      idempotencyKey: "cobro-grande-01",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("supera lo que se debe");
  });

  it("el cálculo de mora se puede lanzar a mano y es idempotente", async () => {
    const owner = await asOwner();
    await activeLoan(owner);
    system.harness.clock.date = "2026-12-20";

    const first = (await call(owner, "POST", "/api/v1/late-fees/accrue")).json();
    const second = (await call(owner, "POST", "/api/v1/late-fees/accrue")).json();

    expect(first).toMatchObject({ loansUpdated: 1, installmentsUpdated: 1 });
    expect(second.loansUpdated).toBe(0);
  });

  it("la bitácora registra lo ocurrido", async () => {
    const owner = await asOwner();
    await activeLoan(owner);

    const audit = (await call(owner, "GET", "/api/v1/audit")).json();

    expect(audit.chainValid).toBe(true);
    expect(audit.records.map((record: { action: string }) => record.action)).toEqual(
      expect.arrayContaining(["BORROWER_CREATED", "LOAN_APPROVED", "LOAN_DISBURSED"]),
    );
  });
});

describe("validación y errores", () => {
  it("rechaza datos mal formados con 400 y dice qué campo", async () => {
    const owner = await asOwner();

    const response = await call(owner, "POST", "/api/v1/loans/simulate", { terms: { ...terms, principalCents: 10.5 } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].field).toBe("terms.principalCents");
  });

  it("un id que no es UUID da 400 y uno inexistente da 404", async () => {
    const owner = await asOwner();

    expect((await call(owner, "GET", "/api/v1/loans/no-es-uuid")).statusCode).toBe(400);
    expect((await call(owner, "GET", "/api/v1/loans/01900000-0000-7000-8000-0000000000ff")).statusCode).toBe(404);
  });

  it("no permite repetir un DNI", async () => {
    const owner = await asOwner();
    await createBorrower(owner);

    const duplicate = await call(owner, "POST", "/api/v1/borrowers", {
      fullName: "Otra Persona",
      nationalId: "0801199012345",
      privacyConsent: true,
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it("la lista de clientes nunca muestra el DNI completo", async () => {
    const owner = await asOwner();
    await createBorrower(owner);

    const response = await call(owner, "GET", "/api/v1/borrowers?q=mar%C3%ADa");

    expect(response.json().borrowers).toHaveLength(1);
    expect(response.body).toContain("****-****-12345");
    expect(response.body).not.toContain("0801199012345");
  });

  it("las rutas desconocidas dan 404 en JSON", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/nada" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("la salud del sistema responde ok", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("portal del cliente", () => {
  it("un cliente solo ve sus propios préstamos", async () => {
    const owner = await asOwner();
    const { borrower, loanId } = await activeLoan(owner);
    const other = await createBorrower(owner, "0501-1985-00077");
    const otherLoan = (
      await call(owner, "POST", "/api/v1/loans", { borrowerId: other.id, terms })
    ).json().loan.id as string;
    await system.services.createUser.execute({
      organizationId: ORGANIZATION,
      role: "CLIENT",
      fullName: "María Fernanda López",
      phone: "9988-7766",
      password: PASSWORD,
      borrowerId: borrower.id,
    });
    const client = await loginAs("99887766");

    const list = await call(client, "GET", "/api/v1/portal/loans");
    const own = await call(client, "GET", `/api/v1/portal/loans/${loanId}`);
    const foreign = await call(client, "GET", `/api/v1/portal/loans/${otherLoan}`);
    const staffArea = await call(client, "GET", "/api/v1/loans");

    expect(list.json().loans).toHaveLength(1);
    expect(own.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(404);
    expect(staffArea.statusCode).toBe(403);
  });
});

describe("precalificación", () => {
  const goodAnswers = { tieneIngresoFijo: true, montoSolicitado: 8000, deudaAtrasada: false, mesesEnTrabajo: 24, tieneReferencia: true };
  const apply = (answers: object, extra: object = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/public/apply/mi-negocio",
      payload: { applicantName: "Juan Carlos Pérez", phone: "9911-2233", answers, privacyConsent: true, ...extra },
    });

  beforeEach(() => {
    system.harness.database.slugs.set("mi-negocio", ORGANIZATION);
  });

  it("el formulario público muestra las preguntas y nunca las reglas ni el puntaje", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/public/apply/mi-negocio" });

    expect(response.statusCode).toBe(200);
    expect(response.json().questions).toHaveLength(5);
    expect(response.body).not.toContain("KNOCKOUT");
    expect(response.body).not.toContain("points");
    expect((await app.inject({ method: "GET", url: "/api/v1/public/apply/no-existe" })).statusCode).toBe(404);
  });

  it("recibe una solicitud sin sesión y el solicitante no ve su resultado", async () => {
    const response = await apply(goodAnswers);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: true });
  });

  it("la bandeja muestra el resultado explicado y la respuesta de cada pregunta", async () => {
    await apply(goodAnswers);
    await apply({ ...goodAnswers, deudaAtrasada: true });
    const owner = await asOwner();

    const list = (await call(owner, "GET", "/api/v1/prescreening")).json().submissions;
    const detail = (await call(owner, "GET", `/api/v1/prescreening/${list[1].id}`)).json().submission;

    expect(list).toHaveLength(2);
    expect(list[0].outcome).toBe("NOT_APPLIES");
    expect(detail).toMatchObject({ outcome: "APPLIES", score: 6, phone: "99112233", status: "NEW" });
    expect(detail.answers[0]).toMatchObject({ question: expect.stringContaining("ingreso fijo"), answer: "Sí" });
    expect(list[0].reasons[0].reason).toBe("Tiene una deuda atrasada");
  });

  it("rechaza respuestas incompletas, sin consentimiento o con teléfono inválido", async () => {
    expect((await apply({ tieneIngresoFijo: true })).statusCode).toBe(422);
    expect((await apply(goodAnswers, { privacyConsent: false })).statusCode).toBe(422);
    expect((await apply(goodAnswers, { phone: "123" })).statusCode).toBe(400);
    expect((await apply(goodAnswers, { phone: "1234-56789" })).statusCode).toBe(422);
    expect((await apply({ ...goodAnswers, tieneIngresoFijo: "sí" })).statusCode).toBe(422);
  });

  it("decidir en contra del resultado exige nota, y una solicitud se decide una sola vez", async () => {
    await apply({ ...goodAnswers, deudaAtrasada: true });
    const owner = await asOwner();
    const [submission] = (await call(owner, "GET", "/api/v1/prescreening")).json().submissions;

    const noNote = await call(owner, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "CONTINUE" });
    const withNote = await call(owner, "POST", `/api/v1/prescreening/${submission.id}/decision`, {
      decision: "CONTINUE",
      note: "Ya me puso al día, lo conozco",
    });
    const again = await call(owner, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "DISCARD" });

    expect(noNote.statusCode).toBe(422);
    expect(withNote.json().submission).toMatchObject({ status: "DECIDED", decision: "CONTINUE", contradictsOutcome: true });
    expect(again.statusCode).toBe(409);
    const audit = (await call(owner, "GET", "/api/v1/audit")).json().records.map((record: { action: string }) => record.action);
    expect(audit).toEqual(expect.arrayContaining(["PRESCREENING_RECEIVED", "PRESCREENING_DECIDED"]));
  });

  it("el cobrador puede ver la bandeja pero la decisión es solo del dueño", async () => {
    await apply(goodAnswers);
    const collector = await loginAs("cobrador@ejemplo.com");
    const [submission] = (await call(collector, "GET", "/api/v1/prescreening")).json().submissions;

    const decide = await call(collector, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "CONTINUE" });
    const accountant = await call(await loginAs("contador@ejemplo.com"), "GET", "/api/v1/prescreening");

    expect(decide.statusCode).toBe(403);
    expect(accountant.statusCode).toBe(403);
  });

  it("el dueño personaliza las preguntas y sube la versión; las reglas inválidas se rechazan", async () => {
    const owner = await asOwner();
    const current = (await call(owner, "GET", "/api/v1/prescreening/form")).json().form;
    expect(current).toMatchObject({ slug: "mi-negocio", version: 1, isDefault: true });

    const saved = await call(owner, "PUT", "/api/v1/prescreening/form", {
      questions: [{ key: "ingresos", text: "¿Tiene ingresos?", type: "YES_NO" }],
      rules: [{ kind: "SCORED", questionKey: "ingresos", when: { op: "EQUALS", value: true }, points: 5, reason: "Tiene ingresos" }],
      thresholds: { appliesMin: 5, reviewMin: 1 },
    });
    const invalid = await call(owner, "PUT", "/api/v1/prescreening/form", {
      questions: [{ key: "ingresos", text: "¿Tiene ingresos?", type: "YES_NO" }],
      rules: [{ kind: "SCORED", questionKey: "noExiste", when: { op: "EQUALS", value: true }, points: 5, reason: "x y z" }],
      thresholds: { appliesMin: 5, reviewMin: 1 },
    });
    const publicForm = (await app.inject({ method: "GET", url: "/api/v1/public/apply/mi-negocio" })).json();

    expect(saved.json().form).toMatchObject({ version: 2, isDefault: false });
    expect(invalid.statusCode).toBe(422);
    expect(publicForm.questions).toHaveLength(1);
  });
});

describe("precalificación registrada por el prestamista", () => {
  it("el cobrador registra una solicitud que llegó por chat y queda a nombre de quien la registró", async () => {
    const collector = await loginAs("cobrador@ejemplo.com");

    const response = await call(collector, "POST", "/api/v1/prescreening", {
      applicantName: "Rosa Elena Castellanos",
      phone: "9900-1122",
      answers: { tieneIngresoFijo: true, montoSolicitado: 5000, deudaAtrasada: false, mesesEnTrabajo: 14, tieneReferencia: false },
      privacyConsent: true,
    });
    const owner = await asOwner();
    const list = (await call(owner, "GET", "/api/v1/prescreening")).json().submissions;
    const audit = (await call(owner, "GET", "/api/v1/audit")).json().records;

    expect(response.statusCode).toBe(201);
    expect(list[0]).toMatchObject({ applicantName: "Rosa Elena Castellanos", outcome: "APPLIES" });
    expect(audit.find((record: { action: string }) => record.action === "PRESCREENING_RECEIVED").actorId).not.toBe("formulario-publico");
    expect((await app.inject({ method: "POST", url: "/api/v1/prescreening", payload: {} })).statusCode).toBe(401);
  });
});

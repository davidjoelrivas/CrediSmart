import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { createPool } from "../shared/infrastructure/postgres/connection";
import { runStatement, selectRows } from "../shared/infrastructure/postgres/sql";
import { newUuidV7 } from "../shared/infrastructure/postgres/uuid";
import { testCipher, testDatabaseConfig } from "../testing/postgres/test-database";
import { buildApp } from "./app";
import { composePostgresServices } from "./compose-postgres";
import { SESSION_COOKIE } from "./security";
import type { Services } from "./services";

const PASSWORD = "una-clave-larga-123";
const terms = {
  principalCents: 1_000_000,
  rateBp: 500,
  ratePeriod: "MONTHLY",
  paymentFrequency: "BIWEEKLY",
  installments: 4,
  startDate: "2026-01-05",
};

let pool: Pool;
let services: Services;
let app: FastifyInstance;
let organizationId: string;
let ownerEmail: string;

beforeAll(async () => {
  pool = createPool(testDatabaseConfig());
  // scrypt con costo bajo: la prueba no necesita la dureza de producción.
  services = composePostgresServices(pool, testCipher, {
    hasher: new ScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1 }),
  });
  app = await buildApp(services, { loginRateLimitPerMinute: 1000, globalRateLimitPerMinute: 10_000 });

  organizationId = newUuidV7();
  ownerEmail = `dueno-${organizationId.slice(-8)}@ejemplo.com`;
  await runStatement(pool, "INSERT INTO organizations (id, name) VALUES ($1, $2)", [
    organizationId,
    "Crédito de integración",
  ]);
  await services.createUser.execute({
    organizationId,
    role: "OWNER",
    fullName: "Dueño de Prueba",
    email: ownerEmail,
    password: PASSWORD,
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const cookieOf = (response: LightMyRequestResponse) =>
  `${SESSION_COOKIE}=${response.cookies.find((item) => item.name === SESSION_COOKIE)!.value}`;

async function login(email = ownerEmail, password = PASSWORD) {
  return app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { login: email, password } });
}

const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } });

describe("API sobre PostgreSQL", () => {
  it("el flujo completo funciona de punta a punta con datos reales", async () => {
    const session = await login();
    expect(session.statusCode).toBe(200);
    const cookie = cookieOf(session);

    const borrower = (
      await call(cookie, "POST", "/api/v1/borrowers", {
        fullName: "María Fernanda López",
        nationalId: "0801-1990-12345",
        phone: "9988-7766",
        privacyConsent: true,
      })
    ).json().borrower;

    // El DNI está cifrado en la base: nadie que lea la tabla lo ve.
    const [stored] = await selectRows(pool, "SELECT national_id_enc, phone FROM borrowers WHERE id = $1", [borrower.id]);
    expect((stored!.national_id_enc as Buffer).toString("utf8")).not.toContain("0801199012345");
    expect(stored!.phone).toBe("99887766");

    const loan = (
      await call(cookie, "POST", "/api/v1/loans", {
        borrowerId: borrower.id,
        terms,
        lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 },
        graceDays: 2,
      })
    ).json().loan;
    expect(loan.lateFee.description).toContain("5 %");
    await call(cookie, "POST", `/api/v1/loans/${loan.id}/disburse`, { method: "TRANSFER" });

    // La política de mora quedó guardada en la base como datos.
    const [policy] = await selectRows(pool, "SELECT late_fee_policy, grace_days FROM loans WHERE id = $1", [loan.id]);
    expect(policy).toMatchObject({ late_fee_policy: { type: "PERCENT_OF_OVERDUE", rateBp: 500 }, grace_days: 2 });

    // El préstamo empezó en enero de 2026: hoy ya tiene cuotas vencidas, así que genera mora.
    const accrual = (await call(cookie, "POST", "/api/v1/late-fees/accrue")).json();
    expect(accrual.installmentsUpdated).toBeGreaterThan(0);
    expect((await call(cookie, "POST", "/api/v1/late-fees/accrue")).json().loansUpdated).toBe(0);

    const overdue = (await call(cookie, "GET", "/api/v1/loans?overdue=true")).json().loans;
    expect(overdue).toHaveLength(1);

    const payment = (
      await call(cookie, "POST", "/api/v1/payments", {
        loanId: loan.id,
        amountCents: 100_000,
        method: "CASH",
        idempotencyKey: `integracion-${loan.id}`,
      })
    ).json();
    expect(payment.receipt.folio).toBe(1);

    // Una mora ya cobrada cuenta como ingreso en la contabilidad.
    const dashboard = (await call(cookie, "GET", "/api/v1/dashboard")).json();
    expect(dashboard.risk.overdueLoans).toBe(1);
    expect(dashboard.income.lateFeeCents).toBeGreaterThan(0);
    expect(dashboard.capital.portfolioCents).toBeGreaterThan(0);

    const pdf = await call(cookie, "GET", `/api/v1/payments/${payment.paymentId}/receipt.pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const verified = await app.inject({ method: "GET", url: `/api/v1/public/receipts/${payment.receipt.verificationCode}` });
    expect(verified.json()).toMatchObject({ valid: true, borrowerHint: "María L." });

    // La bitácora encadenada sigue íntegra después de todo el flujo.
    const audit = (await call(cookie, "GET", "/api/v1/audit")).json();
    expect(audit.chainValid).toBe(true);
    expect(audit.records.length).toBeGreaterThanOrEqual(5);
  });

  it("guarda solo el hash del token de sesión y respeta el cierre de sesión", async () => {
    const session = await login();
    const cookie = cookieOf(session);
    const token = cookie.split("=")[1]!;

    const rows = await selectRows(pool, "SELECT token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1", [ownerEmail]);
    expect(rows.map((row) => row.token_hash)).not.toContain(token);

    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
    expect((await call(cookie, "GET", "/api/v1/auth/me")).statusCode).toBe(401);
  });

  it("el bloqueo por intentos fallidos persiste en la base de datos", async () => {
    const email = `bloqueo-${organizationId.slice(-8)}@ejemplo.com`;
    await services.createUser.execute({
      organizationId,
      role: "COLLECTOR",
      fullName: "Cobrador Bloqueable",
      email,
      password: PASSWORD,
    });

    const responses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      responses.push((await login(email, "incorrecta")).statusCode);
    }
    const afterLock = await login(email, PASSWORD);

    expect(responses).toEqual([401, 401, 401, 401, 423]);
    expect(afterLock.statusCode).toBe(423);
    const [row] = await selectRows(pool, "SELECT locked_until FROM users WHERE email = $1", [email]);
    expect(row!.locked_until).not.toBeNull();
  });

  it("dos cobros simultáneos con la misma clave no se duplican", async () => {
    const cookie = cookieOf(await login());
    const borrower = (
      await call(cookie, "POST", "/api/v1/borrowers", {
        fullName: "Carlos Alberto Reyes",
        nationalId: "0501-1985-00077",
        privacyConsent: true,
      })
    ).json().borrower;
    const loan = (await call(cookie, "POST", "/api/v1/loans", { borrowerId: borrower.id, terms })).json().loan;
    await call(cookie, "POST", `/api/v1/loans/${loan.id}/disburse`, { method: "CASH" });
    const body = { loanId: loan.id, amountCents: 50_000, method: "CASH", idempotencyKey: `simultaneo-${loan.id}` };

    const [first, second] = await Promise.all([
      call(cookie, "POST", "/api/v1/payments", body),
      call(cookie, "POST", "/api/v1/payments", body),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    const [count] = await selectRows(pool, "SELECT count(*)::int AS total FROM payments WHERE loan_id = $1", [loan.id]);
    expect(count!.total).toBe(1);
  });

  it("precalificación: solicitud pública, evaluación guardada y decisión humana con nota", async () => {
    const slug = `negocio-${organizationId.slice(-8)}`;
    await runStatement(pool, "UPDATE organizations SET slug = $2 WHERE id = $1", [organizationId, slug]);
    const answers = { tieneIngresoFijo: true, montoSolicitado: 60_000, deudaAtrasada: false, mesesEnTrabajo: 24, tieneReferencia: true };

    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/public/apply/${slug}`,
      payload: { applicantName: "Juan Carlos Pérez", phone: "9911-2233", answers, privacyConsent: true },
    });
    expect(sent.statusCode).toBe(201);

    // La evaluación quedó guardada como datos: resultado, puntaje y motivos.
    const [stored] = await selectRows(pool, "SELECT outcome, score, reasons FROM prescreening_submissions WHERE organization_id = $1", [organizationId]);
    expect(stored).toMatchObject({ outcome: "NOT_APPLIES", score: 6 });
    expect((stored!.reasons as Array<{ kind: string }>).some((reason) => reason.kind === "KNOCKOUT")).toBe(true);

    const cookie = cookieOf(await login());
    const [submission] = (await call(cookie, "GET", "/api/v1/prescreening")).json().submissions;
    const withoutNote = await call(cookie, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "CONTINUE" });
    const decided = await call(cookie, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "CONTINUE", note: "Pidió menos al hablar conmigo" });
    const again = await call(cookie, "POST", `/api/v1/prescreening/${submission.id}/decision`, { decision: "DISCARD" });

    expect(withoutNote.statusCode).toBe(422);
    expect(decided.json().submission).toMatchObject({ status: "DECIDED", contradictsOutcome: true });
    expect(again.statusCode).toBe(409);
  });

  it("el contrato y pagaré se genera con el DNI completo descifrado y queda en la bitácora", async () => {
    const cookie = cookieOf(await login());
    const borrower = (
      await call(cookie, "POST", "/api/v1/borrowers", { fullName: "Ana Patricia Mejía", nationalId: "0301-1992-00055", privacyConsent: true })
    ).json().borrower;
    const loan = (await call(cookie, "POST", "/api/v1/loans", { borrowerId: borrower.id, terms })).json().loan;

    const pdf = await call(cookie, "GET", `/api/v1/loans/${loan.id}/contract.pdf`);

    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const audit = (await call(cookie, "GET", "/api/v1/audit")).json();
    expect(audit.records.map((record: { action: string }) => record.action)).toContain("CONTRACT_GENERATED");
  });
});

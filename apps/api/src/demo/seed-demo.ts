import {
  addDays,
  capitalContributionEntry,
  Money,
  type LateFeeConfig,
  type InterestMethod,
  type Frequency,
  type LoanTerms,
} from "@app/domain";
import type { Pool } from "pg";
import type { CreateUser } from "../modules/identity/application/create-user";
import { AccrueLateFees, SYSTEM_ACTOR_ID } from "../modules/lending/application/accrue-late-fees";
import { SubmitPrescreening } from "../modules/prescreening/application/prescreening-use-cases";
import { RegisterPayment } from "../modules/collections/application/register-payment";
import { ApproveLoan } from "../modules/lending/application/approve-loan";
import { DisburseLoan } from "../modules/lending/application/disburse-loan";
import { PostgresLegalCapProvider } from "../modules/lending/infrastructure/postgres/postgres-loan-support";
import type { Clock, RequestContext } from "../shared/application/ports";
import type { FieldCipher } from "../shared/infrastructure/crypto/field-cipher";
import { RandomVerificationCodes } from "../shared/infrastructure/crypto/random-verification-codes";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { runStatement, selectRows } from "../shared/infrastructure/postgres/sql";
import { newUuidV7, UuidV7Generator } from "../shared/infrastructure/postgres/uuid";

/** Identificadores fijos: así el seed es idempotente y la organización demo siempre es la misma. */
export const DEMO_ORGANIZATION_ID = "01900000-0000-7000-8000-00000000d3a0";
export const DEMO_SLUG = "credito-inteligente-demo";
export const DEMO_OWNER_ID = "01900000-0000-7000-8000-00000000d3a1";

export interface SeedResult {
  created: boolean;
  organizationId: string;
  loans: number;
  payments: number;
}

interface DemoLoan {
  borrower: string;
  nationalId: string;
  principal: string;
  rateBp: number;
  ratePeriod: Frequency;
  paymentFrequency: Frequency;
  installments: number;
  interestMethod: InterestMethod;
  /** Cuántos días atrás empezó el préstamo. */
  startedDaysAgo: number;
  disburse: boolean;
  /** Pagos en lempiras, en el orden en que se recibieron. */
  payments: string[];
  lateFee: LateFeeConfig;
  graceDays: number;
}

/** Datos ficticios, claramente marcados como demo: nunca se mezclan con clientes reales. */
const DEMO_LOANS: DemoLoan[] = [
  { borrower: "María Fernanda López (demo)", nationalId: "0000-0000-00001", principal: "10000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "BIWEEKLY", installments: 4, interestMethod: "FLAT", startedDaysAgo: 30, disburse: true, payments: ["2750", "1500"], lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 }, graceDays: 3 },
  { borrower: "Carlos Alberto Reyes (demo)", nationalId: "0000-0000-00002", principal: "5000", rateBp: 400, ratePeriod: "MONTHLY", paymentFrequency: "WEEKLY", installments: 8, interestMethod: "DECLINING", startedDaysAgo: 21, disburse: true, payments: ["750", "750", "750"], lateFee: { type: "PERCENT_PER_DAY", rateBp: 10 }, graceDays: 2 },
  { borrower: "Ana Patricia Mejía (demo)", nationalId: "0000-0000-00003", principal: "20000", rateBp: 300, ratePeriod: "MONTHLY", paymentFrequency: "MONTHLY", installments: 6, interestMethod: "INTEREST_ONLY", startedDaysAgo: 35, disburse: true, payments: ["600"], lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 }, graceDays: 3 },
  { borrower: "Luis Enrique Ordóñez (demo)", nationalId: "0000-0000-00004", principal: "3000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "MONTHLY", installments: 3, interestMethod: "FLAT", startedDaysAgo: 75, disburse: true, payments: ["1150", "1150", "1150"], lateFee: { type: "NONE" }, graceDays: 0 },
  { borrower: "Rosa Elena Castellanos (demo)", nationalId: "0000-0000-00005", principal: "8000", rateBp: 400, ratePeriod: "MONTHLY", paymentFrequency: "BIWEEKLY", installments: 6, interestMethod: "DECLINING", startedDaysAgo: 0, disburse: false, payments: [], lateFee: { type: "PERCENT_OF_OVERDUE", rateBp: 500 }, graceDays: 3 },
  { borrower: "Pedro Antonio Zelaya (demo)", nationalId: "0000-0000-00006", principal: "6000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "WEEKLY", installments: 6, interestMethod: "FLAT", startedDaysAgo: 45, disburse: true, payments: [], lateFee: { type: "FIXED_PER_DAY", amountCents: 2500 }, graceDays: 2 },
];

const INITIAL_CAPITAL = "150000";

/**
 * Crea la organización de demostración con clientes ficticios, préstamos en distintos estados,
 * pagos con sus recibos y el aporte de capital inicial. Todo pasa por los casos de uso reales,
 * así que los números del tablero son consistentes por construcción. Si ya existe, no hace nada.
 */
export async function seedDemo(pool: Pool, cipher: FieldCipher, clock: Clock): Promise<SeedResult> {
  const [existing] = await selectRows(pool, "SELECT id FROM organizations WHERE id = $1", [DEMO_ORGANIZATION_ID]);
  if (existing) {
    return { created: false, organizationId: DEMO_ORGANIZATION_ID, loans: 0, payments: 0 };
  }

  await runStatement(pool, "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)", [
    DEMO_ORGANIZATION_ID,
    "Crédito Inteligente (demo)",
    DEMO_SLUG,
  ]);

  const database = new PostgresDatabase(pool, cipher);
  const unitOfWork = database.unitOfWork();
  const ids = new UuidV7Generator();
  const legalCap = new PostgresLegalCapProvider(pool);
  const context: RequestContext = { organizationId: DEMO_ORGANIZATION_ID, actorId: DEMO_OWNER_ID };
  const today = clock.today();

  const approveLoan = new ApproveLoan({ unitOfWork, clock, ids, legalCap });
  const disburseLoan = new DisburseLoan({ unitOfWork, clock });
  const registerPayment = new RegisterPayment({
    unitOfWork,
    clock,
    ids,
    verificationCodes: new RandomVerificationCodes(),
  });

  await unitOfWork.run(async (repositories) => {
    await repositories.ledger.append(
      DEMO_ORGANIZATION_ID,
      capitalContributionEntry({ date: addDays(today, -90), amount: Money.fromLempiras(INITIAL_CAPITAL), method: "TRANSFER" }),
    );
    await repositories.audit.record({
      organizationId: DEMO_ORGANIZATION_ID,
      actorId: DEMO_OWNER_ID,
      action: "CAPITAL_CONTRIBUTED",
      entity: "organization",
      entityId: DEMO_ORGANIZATION_ID,
      on: today,
      details: { amountCents: Money.fromLempiras(INITIAL_CAPITAL).toCents() },
    });
  });

  let loans = 0;
  let payments = 0;
  for (const demo of DEMO_LOANS) {
    const borrowerId = newUuidV7();
    await runStatement(
      pool,
      `INSERT INTO borrowers (id, organization_id, full_name, national_id_enc, national_id_hash, privacy_consent_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [borrowerId, DEMO_ORGANIZATION_ID, demo.borrower, cipher.encrypt(demo.nationalId), cipher.searchHash(demo.nationalId)],
    );

    const startDate = addDays(today, -demo.startedDaysAgo);
    const terms: LoanTerms = {
      principal: Money.fromLempiras(demo.principal),
      rateBp: demo.rateBp,
      ratePeriod: demo.ratePeriod,
      paymentFrequency: demo.paymentFrequency,
      installments: demo.installments,
      interestMethod: demo.interestMethod,
      startDate,
    };
    const loan = await approveLoan.execute(context, {
      borrowerId,
      terms,
      aprCapOverride: { confirmed: true, reason: "Datos de demostración" },
      lateFee: demo.lateFee,
      graceDays: demo.graceDays,
    });
    loans += 1;
    if (!demo.disburse) {
      continue;
    }
    await disburseLoan.execute(context, { loanId: loan.id, method: "TRANSFER" });

    for (const [index, amount] of demo.payments.entries()) {
      await registerPayment.execute(context, {
        loanId: loan.id,
        amount: Money.fromLempiras(amount),
        method: index % 2 === 0 ? "CASH" : "TRANSFER",
        reference: index % 2 === 0 ? undefined : `DEMO-${loan.code}-${index + 1}`,
        idempotencyKey: `demo-${loan.code}-${index + 1}`,
        receivedOn: addDays(startDate, Math.min((index + 1) * 14, demo.startedDaysAgo)),
      });
      payments += 1;
    }
  }

  // Deja la mora de hoy calculada, como lo haría el proceso automático.
  await new AccrueLateFees({ unitOfWork, clock }).execute(context);
  return { created: true, organizationId: DEMO_ORGANIZATION_ID, loans, payments };
}

/** Los tres usuarios de la demostración: uno por cada rol del personal. */
const DEMO_USERS = [
  { role: "OWNER", fullName: "Mauricio (demo)", email: "dueno@demo.credismart.app" },
  { role: "COLLECTOR", fullName: "Cobrador (demo)", email: "cobrador@demo.credismart.app" },
  { role: "ACCOUNTANT", fullName: "Contador (demo)", email: "contador@demo.credismart.app" },
] as const;

export interface DemoUsersResult {
  created: string[];
  existing: string[];
}

/** Crea los usuarios de la demo que falten. No cambia la contraseña de los que ya existen. */
export async function ensureDemoUsers(pool: Pool, createUser: CreateUser, password: string): Promise<DemoUsersResult> {
  const result: DemoUsersResult = { created: [], existing: [] };
  for (const demo of DEMO_USERS) {
    const [found] = await selectRows(pool, "SELECT id FROM users WHERE lower(email) = $1", [demo.email]);
    if (found) {
      result.existing.push(demo.email);
      continue;
    }
    await createUser.execute({ organizationId: DEMO_ORGANIZATION_ID, ...demo, password });
    result.created.push(demo.email);
  }
  return result;
}

/**
 * Lleva una demo creada antes de que existiera la mora (migración 0007) al estado actual:
 * asigna a cada préstamo su política de mora y calcula la mora de hoy. Solo toca préstamos de la demo
 * que todavía no tienen política, así que se puede correr cuantas veces se quiera.
 */
export async function upgradeDemoLateFees(pool: Pool, cipher: FieldCipher, clock: Clock): Promise<number> {
  let upgraded = 0;
  for (const demo of DEMO_LOANS) {
    upgraded += await runStatement(
      pool,
      `UPDATE loans SET late_fee_policy = $1::jsonb, grace_days = $2
       FROM borrowers b
       WHERE loans.borrower_id = b.id AND loans.organization_id = $3 AND b.organization_id = $3
         AND b.national_id_hash = $4 AND loans.late_fee_policy ->> 'type' = 'NONE' AND $5 <> 'NONE'`,
      [JSON.stringify(demo.lateFee), demo.graceDays, DEMO_ORGANIZATION_ID, cipher.searchHash(demo.nationalId), demo.lateFee.type],
    );
  }
  const database = new PostgresDatabase(pool, cipher);
  await new AccrueLateFees({ unitOfWork: database.unitOfWork(), clock }).execute({
    organizationId: DEMO_ORGANIZATION_ID,
    actorId: SYSTEM_ACTOR_ID,
  });
  return upgraded;
}

/** Tres solicitantes de ejemplo (uno por cada resultado posible) para que la bandeja de precalificación no esté vacía. */
const DEMO_APPLICANTS = [
  {
    applicantName: "Jorge Luis Martínez (demo)",
    phone: "99000001",
    answers: { tieneIngresoFijo: true, montoSolicitado: 12000, deudaAtrasada: false, mesesEnTrabajo: 30, tieneReferencia: true },
  },
  {
    applicantName: "Sandra Patricia Flores (demo)",
    phone: "99000002",
    answers: { tieneIngresoFijo: true, montoSolicitado: 6000, deudaAtrasada: false, mesesEnTrabajo: 5, tieneReferencia: false },
  },
  {
    applicantName: "Oscar David Pineda (demo)",
    phone: "99000003",
    answers: { tieneIngresoFijo: false, montoSolicitado: 40000, deudaAtrasada: true, mesesEnTrabajo: 2, tieneReferencia: false },
  },
];

/** Asegura el enlace público de la demo y, si la bandeja está vacía, la llena con los solicitantes de ejemplo. */
export async function ensureDemoPrescreening(pool: Pool, cipher: FieldCipher, clock: Clock): Promise<number> {
  await runStatement(pool, "UPDATE organizations SET slug = $2 WHERE id = $1 AND slug IS NULL", [DEMO_ORGANIZATION_ID, DEMO_SLUG]);
  const [existing] = await selectRows(pool, "SELECT count(*)::int AS total FROM prescreening_submissions WHERE organization_id = $1", [DEMO_ORGANIZATION_ID]);
  if (Number(existing!.total) > 0) {
    return 0;
  }
  const submit = new SubmitPrescreening({
    unitOfWork: new PostgresDatabase(pool, cipher).unitOfWork(),
    clock,
    ids: new UuidV7Generator(),
  });
  for (const applicant of DEMO_APPLICANTS) {
    await submit.execute({ slug: DEMO_SLUG, privacyConsent: true, ...applicant });
  }
  return DEMO_APPLICANTS.length;
}

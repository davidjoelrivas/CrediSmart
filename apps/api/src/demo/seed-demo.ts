import {
  addDays,
  capitalContributionEntry,
  Money,
  type InterestMethod,
  type Frequency,
  type LoanTerms,
} from "@app/domain";
import type { Pool } from "pg";
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
}

/** Datos ficticios, claramente marcados como demo: nunca se mezclan con clientes reales. */
const DEMO_LOANS: DemoLoan[] = [
  { borrower: "María Fernanda López (demo)", nationalId: "0000-0000-00001", principal: "10000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "BIWEEKLY", installments: 4, interestMethod: "FLAT", startedDaysAgo: 30, disburse: true, payments: ["2750", "1500"] },
  { borrower: "Carlos Alberto Reyes (demo)", nationalId: "0000-0000-00002", principal: "5000", rateBp: 400, ratePeriod: "MONTHLY", paymentFrequency: "WEEKLY", installments: 8, interestMethod: "DECLINING", startedDaysAgo: 21, disburse: true, payments: ["750", "750", "750"] },
  { borrower: "Ana Patricia Mejía (demo)", nationalId: "0000-0000-00003", principal: "20000", rateBp: 300, ratePeriod: "MONTHLY", paymentFrequency: "MONTHLY", installments: 6, interestMethod: "INTEREST_ONLY", startedDaysAgo: 35, disburse: true, payments: ["600"] },
  { borrower: "Luis Enrique Ordóñez (demo)", nationalId: "0000-0000-00004", principal: "3000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "MONTHLY", installments: 3, interestMethod: "FLAT", startedDaysAgo: 75, disburse: true, payments: ["1150", "1150", "1150"] },
  { borrower: "Rosa Elena Castellanos (demo)", nationalId: "0000-0000-00005", principal: "8000", rateBp: 400, ratePeriod: "MONTHLY", paymentFrequency: "BIWEEKLY", installments: 6, interestMethod: "DECLINING", startedDaysAgo: 0, disburse: false, payments: [] },
  { borrower: "Pedro Antonio Zelaya (demo)", nationalId: "0000-0000-00006", principal: "6000", rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "WEEKLY", installments: 6, interestMethod: "FLAT", startedDaysAgo: 45, disburse: true, payments: [] },
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

  await runStatement(pool, "INSERT INTO organizations (id, name) VALUES ($1, $2)", [
    DEMO_ORGANIZATION_ID,
    "Crédito Inteligente (demo)",
  ]);

  const database = new PostgresDatabase(pool);
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
  return { created: true, organizationId: DEMO_ORGANIZATION_ID, loans, payments };
}

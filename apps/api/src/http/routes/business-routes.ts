import {
  approveLoanRequest,
  borrowerSearchQuery,
  decideSubmissionRequest,
  createBorrowerRequest,
  disburseLoanRequest,
  loanListQuery,
  prescreeningFormRequest,
  publicApplyRequest,
  type PaymentResult,
  registerPaymentRequest,
  reversePaymentRequest,
  simulateLoanRequest,
  updateBorrowerRequest,
} from "@app/contracts";
import { Money } from "@app/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError } from "../../shared/application/errors";
import { renderContractPdf } from "../../modules/lending/infrastructure/contract-pdf";
import { renderReceiptPdf } from "../../modules/collections/infrastructure/receipt-pdf";
import type { AppConfig } from "../config";
import { approveInputOf, simulationView, termsFromRequest } from "../presenters";
import { authorize, contextOf } from "../security";
import type { Services } from "../services";

const idParams = z.object({ id: z.uuid() });
const codeParams = z.object({ code: z.string().min(6).max(64) });

export function registerBusinessRoutes(app: FastifyInstance, services: Services, config: AppConfig): void {
  // ---------- Tablero ----------
  app.get("/api/v1/dashboard", { preHandler: authorize(services, "reports:read") }, async (request) =>
    services.getDashboard.execute(contextOf(request)),
  );

  // ---------- Clientes ----------
  app.get("/api/v1/borrowers", { preHandler: authorize(services, "borrowers:read") }, async (request) => {
    const query = borrowerSearchQuery.parse(request.query);
    const borrowers = await services.borrowerQueries.search(contextOf(request), {
      text: query.q,
      limit: query.limit,
      offset: query.offset,
    });
    return { borrowers };
  });

  app.post("/api/v1/borrowers", { preHandler: authorize(services, "borrowers:write") }, async (request, reply) => {
    const body = createBorrowerRequest.parse(request.body);
    const borrower = await services.createBorrower.execute(contextOf(request), body);
    void reply.status(201);
    return { borrower };
  });

  app.get("/api/v1/borrowers/:id", { preHandler: authorize(services, "borrowers:read") }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { borrower: await services.borrowerQueries.get(contextOf(request), id) };
  });

  app.patch("/api/v1/borrowers/:id", { preHandler: authorize(services, "borrowers:write") }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateBorrowerRequest.parse(request.body);
    return { borrower: await services.updateBorrower.execute(contextOf(request), { borrowerId: id, ...body }) };
  });

  // ---------- Préstamos ----------
  app.post("/api/v1/loans/simulate", { preHandler: authorize(services, "loans:simulate") }, async (request) => {
    const body = simulateLoanRequest.parse(request.body);
    const simulation = await services.simulateLoan.execute(contextOf(request), termsFromRequest(body.terms));
    return simulationView(simulation);
  });

  app.get("/api/v1/loans", { preHandler: authorize(services, "loans:read") }, async (request) => {
    const query = loanListQuery.parse(request.query);
    const loans = await services.loanQueries.list(contextOf(request), {
      status: query.status,
      borrowerId: query.borrowerId,
      overdueOnly: query.overdue,
    });
    return { loans };
  });

  app.post("/api/v1/loans", { preHandler: authorize(services, "loans:approve") }, async (request, reply) => {
    const body = approveLoanRequest.parse(request.body);
    const context = contextOf(request);
    const loan = await services.approveLoan.execute(context, approveInputOf(body));
    void reply.status(201);
    return { loan: await services.loanQueries.get(context, loan.id) };
  });

  app.get("/api/v1/loans/:id", { preHandler: authorize(services, "loans:read") }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { loan: await services.loanQueries.get(contextOf(request), id) };
  });

  app.get("/api/v1/loans/:id/contract.pdf", { preHandler: authorize(services, "loans:approve") }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const contract = await services.contractQueries.forLoan(contextOf(request), id);
    const pdf = await renderContractPdf(contract);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="Contrato-${contract.loanCode}.pdf"`)
      .send(pdf);
  });

  app.post("/api/v1/loans/:id/disburse", { preHandler: authorize(services, "loans:disburse") }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = disburseLoanRequest.parse(request.body);
    const context = contextOf(request);
    await services.disburseLoan.execute(context, { loanId: id, method: body.method });
    return { loan: await services.loanQueries.get(context, id) };
  });

  // ---------- Pagos y recibos ----------
  app.post("/api/v1/payments", { preHandler: authorize(services, "payments:register") }, async (request, reply) => {
    const body = registerPaymentRequest.parse(request.body);
    const result = await services.registerPayment.execute(contextOf(request), {
      loanId: body.loanId,
      amount: Money.fromCents(body.amountCents),
      method: body.method,
      reference: body.reference,
      receivedOn: body.receivedOn,
      idempotencyKey: body.idempotencyKey,
    });
    void reply.status(result.replayed ? 200 : 201);
    const response: PaymentResult = {
      paymentId: result.payment.id,
      replayed: result.replayed,
      receipt: { folio: result.receipt.folio, verificationCode: result.receipt.verificationCode },
      loanStatus: result.loan.status,
    };
    return response;
  });

  app.post("/api/v1/payments/:id/reverse", { preHandler: authorize(services, "payments:reverse") }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = reversePaymentRequest.parse(request.body);
    const result = await services.reversePayment.execute(contextOf(request), { paymentId: id, reason: body.reason });
    return { reversalId: result.reversal.id, loanStatus: result.loan.status };
  });

  app.get("/api/v1/payments/:id/receipt", { preHandler: authorize(services, "loans:read") }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { receipt: await services.receiptQueries.forPayment(contextOf(request), id) };
  });

  app.get("/api/v1/payments/:id/receipt.pdf", { preHandler: authorize(services, "loans:read") }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const receipt = await services.receiptQueries.forPayment(contextOf(request), id);
    const pdf = await renderReceiptPdf(receipt, config.publicBaseUrl);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${receipt.folio}.pdf"`)
      .send(pdf);
  });

  // ---------- Mora y bitácora ----------
  app.post("/api/v1/late-fees/accrue", { preHandler: authorize(services, "late-fees:run") }, async (request) =>
    services.accrueLateFees.execute(contextOf(request)),
  );

  app.get("/api/v1/audit", { preHandler: authorize(services, "audit:read") }, async (request) => {
    const { organizationId } = contextOf(request);
    const [records, chain] = await Promise.all([
      services.auditReader.recent(organizationId, 100),
      services.auditReader.verify(organizationId),
    ]);
    return { records, chainValid: chain.valid, brokenAtSequence: chain.brokenAtSequence ?? null };
  });

  // ---------- Portal del cliente ----------
  app.get("/api/v1/portal/loans", { preHandler: authorize(services, "portal:read") }, async (request) => {
    const borrowerId = request.auth!.borrowerId;
    if (!borrowerId) {
      throw new NotFoundError("Cliente", "(sin vincular)");
    }
    return { loans: await services.loanQueries.list(contextOf(request), { borrowerId }) };
  });

  app.get("/api/v1/portal/loans/:id", { preHandler: authorize(services, "portal:read") }, async (request) => {
    const { id } = idParams.parse(request.params);
    const loan = await services.loanQueries.get(contextOf(request), id);
    // Un cliente solo puede ver sus propios préstamos; para los demás, el préstamo "no existe".
    if (loan.borrowerId !== request.auth!.borrowerId) {
      throw new NotFoundError("Préstamo", id);
    }
    return { loan };
  });

  // ---------- Precalificación ----------
  app.get("/api/v1/prescreening", { preHandler: authorize(services, "prescreening:read") }, async (request) => {
    const query = z.object({ status: z.enum(["NEW", "DECIDED"]).optional() }).parse(request.query);
    return { submissions: await services.prescreeningQueries.list(contextOf(request), query) };
  });

  // El prestamista registra una solicitud que le llegó por chat o llamada.
  app.post("/api/v1/prescreening", { preHandler: authorize(services, "prescreening:read") }, async (request, reply) => {
    const body = publicApplyRequest.parse(request.body);
    void reply.status(201);
    return services.submitPrescreening.executeForStaff(contextOf(request), body);
  });

  app.get("/api/v1/prescreening/form", { preHandler: authorize(services, "prescreening:read") }, async (request) => ({
    form: await services.prescreeningQueries.formFor(contextOf(request)),
  }));

  app.put("/api/v1/prescreening/form", { preHandler: authorize(services, "prescreening:decide") }, async (request) => {
    const body = prescreeningFormRequest.parse(request.body);
    return {
      form: await services.saveFormTemplate.execute(contextOf(request), {
        questions: body.questions.map((question) => ({ ...question, options: question.options })),
        rules: body.rules,
        thresholds: body.thresholds,
      }),
    };
  });

  app.get("/api/v1/prescreening/:id", { preHandler: authorize(services, "prescreening:read") }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { submission: await services.prescreeningQueries.get(contextOf(request), id) };
  });

  app.post("/api/v1/prescreening/:id/decision", { preHandler: authorize(services, "prescreening:decide") }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = decideSubmissionRequest.parse(request.body);
    return {
      submission: await services.decideSubmission.execute(contextOf(request), {
        submissionId: id,
        decision: body.decision,
        note: body.note,
      }),
    };
  });

  // ---------- Solicitud pública (sin sesión) ----------
  const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60) });

  app.get("/api/v1/public/apply/:slug", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const { slug } = slugParams.parse(request.params);
    return services.getPublicForm.execute(slug);
  });

  app.post(
    "/api/v1/public/apply/:slug",
    // Cualquiera puede enviar, así que se limita por IP para evitar que alguien llene la bandeja de basura.
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);
      const body = publicApplyRequest.parse(request.body);
      void reply.status(201);
      return services.submitPrescreening.execute({ slug, ...body });
    },
  );

  // ---------- Verificación pública del QR ----------
  app.get(
    "/api/v1/public/receipts/:code",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { code } = codeParams.parse(request.params);
      const verification = await services.receiptQueries.verify(code);
      if (!verification) {
        void reply.status(404);
        return { valid: false };
      }
      return verification;
    },
  );
}

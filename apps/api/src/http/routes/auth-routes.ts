import { createUserRequest, loginRequest } from "@app/contracts";
import type { FastifyInstance } from "fastify";
import { sessionUserOf } from "../presenters";
import { authorize, contextOf, requireSession, SESSION_COOKIE } from "../security";
import type { AppConfig } from "../config";
import type { Services } from "../services";

export function registerAuthRoutes(app: FastifyInstance, services: Services, config: AppConfig): void {
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: config.loginRateLimitPerMinute, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginRequest.parse(request.body);
      const result = await services.login.execute({
        login: body.login,
        password: body.password,
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip,
      });
      void reply.setCookie(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "lax",
        path: "/",
        expires: result.expiresAt,
      });
      return { user: sessionUserOf(result.user) };
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await services.logout.execute(request.cookies[SESSION_COOKIE]);
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/v1/auth/me", { preHandler: requireSession(services) }, async (request) => {
    const auth = request.auth!;
    const user = (await services.users.findById(auth.userId))!;
    return { user: sessionUserOf(user) };
  });

  app.get("/api/v1/users", { preHandler: authorize(services, "users:manage") }, async (request) => {
    const users = await services.users.listByOrganization(contextOf(request).organizationId);
    return { users: users.map(sessionUserOf) };
  });

  app.post("/api/v1/users", { preHandler: authorize(services, "users:manage") }, async (request, reply) => {
    const body = createUserRequest.parse(request.body);
    const user = await services.createUser.execute({
      ...body,
      organizationId: contextOf(request).organizationId,
    });
    void reply.status(201);
    return { user: sessionUserOf(user) };
  });
}

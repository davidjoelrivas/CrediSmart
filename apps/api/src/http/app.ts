import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { DEFAULT_CONFIG, type AppConfig } from "./config";
import { errorHandler } from "./errors";
import { registerAuthRoutes } from "./routes/auth-routes";
import { registerBusinessRoutes } from "./routes/business-routes";
import { originGuard } from "./security";
import type { Services } from "./services";

/**
 * Arma el servidor HTTP. No abre ningún puerto: así se puede probar con `app.inject` y el mismo código
 * sirve en producción (ver server.ts).
 */
export async function buildApp(services: Services, overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...DEFAULT_CONFIG, ...overrides };
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
    // Los ids de solicitud ayudan a seguir un error en los registros sin guardar datos personales.
    requestIdHeader: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Solo se fuerza HTTPS cuando de verdad se sirve por HTTPS (en local, http://localhost debe funcionar).
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    // La aplicación se usa solo por HTTPS en producción; HSTS lo recuerda al navegador.
    hsts: config.secureCookies ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: config.globalRateLimitPerMinute, timeWindow: "1 minute" });

  app.setErrorHandler(errorHandler);
  app.addHook("onRequest", originGuard(config));
  app.addHook("onSend", async (request, reply) => {
    // Nada de la API (datos de clientes, recibos) debe quedar guardado en cachés del navegador o de intermediarios.
    if (request.url.startsWith("/api/")) {
      void reply.header("cache-control", "no-store");
    }
  });

  app.get("/api/v1/health", { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await services.checkHealth();
      return { status: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "la base de datos no responde");
      void reply.status(503);
      return { status: "degraded" };
    }
  });

  registerAuthRoutes(app, services, config);
  registerBusinessRoutes(app, services, config);

  if (config.webDist) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  }
  app.setNotFoundHandler(async (request, reply) => {
    if (config.webDist && request.method === "GET" && !request.url.startsWith("/api/")) {
      // Aplicación de una sola página: cualquier ruta del navegador carga la misma pantalla.
      return reply.sendFile("index.html");
    }
    void reply.status(404);
    return { error: { code: "NOT_FOUND", message: "Ruta no encontrada" } };
  });

  return app;
}

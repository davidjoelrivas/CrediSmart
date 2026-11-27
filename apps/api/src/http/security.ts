import type { FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../shared/application/errors";
import type { AuthenticatedUser } from "../modules/identity/application/authenticate-session";
import { can, type Permission } from "../modules/identity/domain/user";
import type { RequestContext } from "../shared/application/ports";
import type { AppConfig } from "./config";
import type { Services } from "./services";

export const SESSION_COOKIE = "cs_session";

declare module "fastify" {
  interface FastifyRequest {
    /** Persona autenticada; solo existe en rutas protegidas. */
    auth?: AuthenticatedUser;
  }
}

/** Exige sesión válida y el permiso indicado. El rol se vuelve a leer en cada solicitud: quitar un permiso surte efecto al instante. */
export function authorize(services: Services, permission: Permission) {
  return async (request: FastifyRequest): Promise<void> => {
    const user = await services.authenticate.execute(request.cookies[SESSION_COOKIE]);
    if (!can(user.role, permission)) {
      throw new ForbiddenError();
    }
    request.auth = user;
  };
}

/** Exige solo sesión válida (cualquier rol). */
export function requireSession(services: Services) {
  return async (request: FastifyRequest): Promise<void> => {
    request.auth = await services.authenticate.execute(request.cookies[SESSION_COOKIE]);
  };
}

export function contextOf(request: FastifyRequest): RequestContext {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  return { organizationId: request.auth.organizationId, actorId: request.auth.userId };
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defensa contra CSRF (que otro sitio haga acciones con tu sesión abierta). La cookie ya es SameSite=Lax;
 * además, toda solicitud que modifica datos debe venir del propio sistema: se revisa Origin y Sec-Fetch-Site.
 * Los clientes que no son navegadores (curl, pruebas) no envían esas cabeceras y no son vector de CSRF.
 */
export function originGuard(config: AppConfig) {
  const allowed = new Set([new URL(config.publicBaseUrl).origin, ...config.allowedOrigins]);
  return async (request: FastifyRequest): Promise<void> => {
    if (!UNSAFE_METHODS.has(request.method) || !request.url.startsWith("/api/")) {
      return;
    }
    const origin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    const sameHost = origin !== undefined && request.headers.host !== undefined && hostOf(origin) === request.headers.host;
    const crossSite = fetchSite === "cross-site" || fetchSite === "same-site";
    const badOrigin = origin !== undefined && !sameHost && !allowed.has(origin);
    if (badOrigin || (crossSite && !(origin !== undefined && (sameHost || allowed.has(origin))))) {
      throw new ForbiddenError("La solicitud no viene de este sistema");
    }
  };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

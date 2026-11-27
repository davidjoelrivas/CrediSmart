import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  /** Dirección pública del sistema (la que lleva el QR de los recibos). */
  publicBaseUrl: string;
  /** Cookies solo por HTTPS. Siempre verdadero en producción. */
  secureCookies: boolean;
  /** Orígenes adicionales que pueden hacer solicitudes de escritura (por ejemplo el servidor de desarrollo de la web). */
  allowedOrigins: string[];
  /** Detrás de un proxy (Railway, Render…) la IP real viene en X-Forwarded-For. */
  trustProxy: boolean;
  /** Carpeta con la aplicación web compilada; si no existe, la API funciona sola. */
  webDist: string | null;
  loginRateLimitPerMinute: number;
  globalRateLimitPerMinute: number;
  logLevel: "silent" | "info" | "warn";
}

export const DEFAULT_CONFIG: AppConfig = {
  publicBaseUrl: "http://localhost:3000",
  secureCookies: false,
  allowedOrigins: ["http://localhost:5173"],
  trustProxy: false,
  webDist: null,
  loginRateLimitPerMinute: 10,
  globalRateLimitPerMinute: 300,
  logLevel: "silent",
};

/** Lee la configuración del entorno. Todo tiene un valor seguro por defecto; en producción se exige HTTPS. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === "production";
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? DEFAULT_CONFIG.publicBaseUrl).replace(/\/+$/, "");
  if (production && !publicBaseUrl.startsWith("https://")) {
    throw new Error("En producción PUBLIC_BASE_URL debe empezar con https://");
  }
  const webDist = resolve(env.WEB_DIST ?? "../web/dist");
  return {
    publicBaseUrl,
    secureCookies: production,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? DEFAULT_CONFIG.allowedOrigins.join(","))
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === "true" || (production && env.TRUST_PROXY !== "false"),
    webDist: existsSync(webDist) ? webDist : null,
    loginRateLimitPerMinute: Number(env.LOGIN_RATE_LIMIT ?? DEFAULT_CONFIG.loginRateLimitPerMinute),
    globalRateLimitPerMinute: Number(env.GLOBAL_RATE_LIMIT ?? DEFAULT_CONFIG.globalRateLimitPerMinute),
    logLevel: production ? "info" : "warn",
  };
}

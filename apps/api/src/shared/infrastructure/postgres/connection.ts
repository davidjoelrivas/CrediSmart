import pg from "pg";

/**
 * - disable: sin cifrar (solo para el Postgres local de desarrollo).
 * - require: conexión cifrada (lo que exige Supabase); no valida el certificado del servidor.
 * - verify-full: cifrada y valida el certificado; requiere el certificado de la autoridad en DATABASE_SSL_CA.
 */
export type SslMode = "disable" | "require" | "verify-full";

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  maxConnections: number;
  ssl: SslMode;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SSL_MODES: readonly string[] = ["disable", "require", "verify-full"];

/**
 * Lee una URL con la forma postgres://usuario:clave@host:puerto/base (la que entrega Supabase o cualquier hosting).
 * Se puede agregar `?sslmode=require`. Sin indicarlo, las conexiones locales no se cifran y todas las demás sí.
 */
export function parseDatabaseUrl(url: string): DatabaseConfig {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("La URL de la base de datos debe empezar con postgres:// o postgresql://");
  }
  const requestedSsl = parsed.searchParams.get("sslmode");
  if (requestedSsl !== null && !SSL_MODES.includes(requestedSsl)) {
    throw new Error(`sslmode inválido: "${requestedSsl}". Use disable, require o verify-full.`);
  }
  const host = parsed.hostname;
  return {
    host,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    maxConnections: 10,
    ssl: (requestedSsl as SslMode | null) ?? (LOCAL_HOSTS.has(host) ? "disable" : "require"),
  };
}

/**
 * Configuración desde las variables de entorno. Si existe DATABASE_PASSWORD, tiene prioridad sobre la
 * contraseña de la URL: así la contraseña se puede escribir tal cual, con cualquier símbolo, sin tener
 * que codificarla dentro de la cadena de conexión.
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("Falta la variable de entorno DATABASE_URL en el archivo .env.");
  }
  const config = parseDatabaseUrl(url);
  return env.DATABASE_PASSWORD ? { ...config, password: env.DATABASE_PASSWORD } : config;
}

/** Traduce los errores de conexión más comunes a un mensaje claro, con lo que hay que revisar. */
export function describeConnectionError(error: unknown): string {
  const { code, message } = error as { code?: string; message?: string };
  const detail = message ?? String(error);
  if (code === "28P01" || /password authentication failed/i.test(detail)) {
    return "La contraseña no coincide con la de la base de datos. Revisá DATABASE_PASSWORD en el archivo .env y que sea la misma que está guardada en Supabase (Database > Settings > Reset database password).";
  }
  if (/tenant or user .* not found/i.test(detail)) {
    return "Supabase no reconoce ese proyecto en ese servidor. Revisá el usuario (postgres.REFERENCIA) y el servidor de DATABASE_URL: copiá de nuevo la cadena de Connect > Session pooler.";
  }
  if (code === "ENOTFOUND") {
    return "No se encontró el servidor de la base de datos. Revisá el servidor de DATABASE_URL y tu conexión a internet.";
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(detail)) {
    return "No se pudo conectar al servidor de la base de datos (rechazó la conexión o tardó demasiado). Revisá tu internet, el puerto de DATABASE_URL y que el proyecto no esté pausado.";
  }
  if (/SSL|certificate/i.test(detail)) {
    return "Falló la conexión cifrada (SSL). Revisá el valor de sslmode en DATABASE_URL.";
  }
  return `No se pudo completar la operación con la base de datos: ${detail}`;
}

/** Cadena de conexión completa (con la contraseña codificada), por ejemplo para pg_dump. */
export function toConnectionUrl(config: DatabaseConfig): string {
  const credentials = `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}`;
  const sslmode = config.ssl === "disable" ? "disable" : config.ssl;
  return `postgres://${credentials}@${config.host}:${config.port}/${config.database}?sslmode=${sslmode}`;
}

// Las fechas (date) llegan como texto AAAA-MM-DD y no como objetos Date; los bigint llegan
// como número (los montos en centavos y las tasas caben de sobra en 2^53).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export function sslOptions(config: DatabaseConfig, caCertificate?: string): pg.ClientConfig["ssl"] {
  if (config.ssl === "disable") {
    return false;
  }
  if (config.ssl === "verify-full") {
    if (!caCertificate) {
      throw new Error("sslmode=verify-full requiere el certificado de la autoridad en DATABASE_SSL_CA");
    }
    return { rejectUnauthorized: true, ca: caCertificate };
  }
  return { rejectUnauthorized: false };
}

export function clientOptions(config: DatabaseConfig, env: NodeJS.ProcessEnv = process.env): pg.ClientConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: sslOptions(config, env.DATABASE_SSL_CA),
    application_name: "credit-smart",
  };
}

/** Máximo de conexiones abiertas: en la nube se mantiene bajo para no agotar el límite del proveedor. */
export function poolSizeFrom(env: NodeJS.ProcessEnv, fallback = 5): number {
  const value = Number(env.DATABASE_POOL_MAX);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : fallback;
}

/** Pool de conexiones para un servicio en la nube: pocas conexiones, tiempos de espera y reconexión segura. */
export function createPool(config: DatabaseConfig, env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const pool = new pg.Pool({
    ...clientOptions(config, env),
    max: poolSizeFrom(env, config.maxConnections),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  // Un error en una conexión inactiva no debe tumbar el servicio.
  pool.on("error", () => undefined);
  return pool;
}

import { describe, expect, it } from "vitest";
import {
  databaseConfigFromEnv,
  describeConnectionError,
  parseDatabaseUrl,
  poolSizeFrom,
  sslOptions,
  toConnectionUrl,
} from "./connection";
import { checksumOf } from "./migrator";

describe("parseDatabaseUrl", () => {
  it("lee usuario, clave, servidor, puerto y base", () => {
    expect(parseDatabaseUrl("postgres://app:secreto@db.ejemplo.com:6543/credit_smart")).toEqual({
      host: "db.ejemplo.com",
      port: 6543,
      user: "app",
      password: "secreto",
      database: "credit_smart",
      maxConnections: 10,
      ssl: "require",
    });
  });

  it("usa el puerto 5432, acepta postgresql:// y una clave vacía", () => {
    const config = parseDatabaseUrl("postgresql://postgres@127.0.0.1/credit_smart");
    expect(config.port).toBe(5432);
    expect(config.password).toBe("");
  });

  it("decodifica caracteres especiales de la clave", () => {
    expect(parseDatabaseUrl("postgres://app:p%40ss%2Fw@localhost/db").password).toBe("p@ss/w");
  });

  it("rechaza URLs que no son de Postgres", () => {
    expect(() => parseDatabaseUrl("mysql://app@localhost/db")).toThrow();
  });
});

describe("modo SSL", () => {
  it("las conexiones locales no se cifran y todas las demás sí", () => {
    expect(parseDatabaseUrl("postgres://postgres@127.0.0.1/db").ssl).toBe("disable");
    expect(parseDatabaseUrl("postgres://postgres@localhost/db").ssl).toBe("disable");
    expect(parseDatabaseUrl("postgres://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres").ssl).toBe("require");
  });

  it("respeta sslmode cuando se indica", () => {
    expect(parseDatabaseUrl("postgres://u@host/db?sslmode=verify-full").ssl).toBe("verify-full");
    expect(parseDatabaseUrl("postgres://u@127.0.0.1/db?sslmode=require").ssl).toBe("require");
  });

  it("rechaza un sslmode desconocido", () => {
    expect(() => parseDatabaseUrl("postgres://u@host/db?sslmode=maybe")).toThrow(/sslmode/);
  });

  it("traduce el modo a las opciones del driver", () => {
    const base = parseDatabaseUrl("postgres://u@host/db");
    expect(sslOptions({ ...base, ssl: "disable" })).toBe(false);
    expect(sslOptions({ ...base, ssl: "require" })).toEqual({ rejectUnauthorized: false });
    expect(sslOptions({ ...base, ssl: "verify-full" }, "-----BEGIN CERTIFICATE-----")).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----",
    });
  });

  it("verify-full exige el certificado", () => {
    expect(() => sslOptions({ ...parseDatabaseUrl("postgres://u@host/db"), ssl: "verify-full" })).toThrow(
      /DATABASE_SSL_CA/,
    );
  });
});

describe("poolSizeFrom", () => {
  it("usa el valor de DATABASE_POOL_MAX si es válido y 5 si no", () => {
    expect(poolSizeFrom({ DATABASE_POOL_MAX: "8" })).toBe(8);
    expect(poolSizeFrom({})).toBe(5);
    expect(poolSizeFrom({ DATABASE_POOL_MAX: "0" })).toBe(5);
    expect(poolSizeFrom({ DATABASE_POOL_MAX: "abc" })).toBe(5);
    expect(poolSizeFrom({ DATABASE_POOL_MAX: "500" })).toBe(5);
  });
});

describe("checksumOf", () => {
  it("ignora la diferencia de saltos de línea entre Windows y Linux", () => {
    expect(checksumOf("CREATE TABLE a (\r\n id INT\r\n);")).toBe(checksumOf("CREATE TABLE a (\n id INT\n);"));
  });

  it("cambia si cambia el contenido", () => {
    expect(checksumOf("SELECT 1")).not.toBe(checksumOf("SELECT 2"));
  });
});

describe("databaseConfigFromEnv", () => {
  it("lee la configuración de DATABASE_URL", () => {
    expect(databaseConfigFromEnv({ DATABASE_URL: "postgres://u:p@host.com:5432/db" }).host).toBe("host.com");
  });

  it("DATABASE_PASSWORD tiene prioridad y puede llevar cualquier símbolo sin codificar", () => {
    const config = databaseConfigFromEnv({
      DATABASE_URL: "postgres://postgres.abc:[YOUR-PASSWORD]@host.com:5432/postgres",
      DATABASE_PASSWORD: "p@ss:w/ord#1%",
    });
    expect(config.password).toBe("p@ss:w/ord#1%");
    expect(config.user).toBe("postgres.abc");
  });

  it("avisa con claridad si falta DATABASE_URL", () => {
    expect(() => databaseConfigFromEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("toConnectionUrl", () => {
  it("codifica la contraseña para que cualquier símbolo sea seguro dentro de la URL", () => {
    const config = { ...parseDatabaseUrl("postgres://u@host.com/db"), password: "p@ss:w/ord" };
    const url = toConnectionUrl(config);

    expect(url).toBe("postgres://u:p%40ss%3Aw%2Ford@host.com:5432/db?sslmode=require");
    expect(parseDatabaseUrl(url).password).toBe("p@ss:w/ord");
  });
});

describe("describeConnectionError", () => {
  it("explica una contraseña incorrecta", () => {
    expect(describeConnectionError({ code: "28P01", message: "password authentication failed for user" })).toMatch(
      /DATABASE_PASSWORD/,
    );
  });

  it("explica un proyecto que el servidor no reconoce", () => {
    expect(describeConnectionError(new Error("Tenant or user postgres.abc not found"))).toMatch(/Session pooler/);
  });

  it("explica un servidor inexistente o inalcanzable", () => {
    expect(describeConnectionError({ code: "ENOTFOUND", message: "x" })).toMatch(/No se encontró el servidor/);
    expect(describeConnectionError({ code: "ETIMEDOUT", message: "x" })).toMatch(/tardó demasiado/);
  });

  it("para cualquier otro error conserva el detalle original", () => {
    expect(describeConnectionError(new Error("algo raro"))).toContain("algo raro");
  });
});

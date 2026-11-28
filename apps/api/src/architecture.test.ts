import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Reglas de arquitectura hexagonal hechas pruebas: si alguien (persona o IA) rompe un límite entre capas
 * o entre módulos, esta prueba falla y dice exactamente qué archivo importa qué.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const DOMAIN_PACKAGE = resolve(SRC, "../../../packages/domain/src");

function filesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" ? [] : filesIn(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2]!);
}

const isTest = (file: string) => /\.(test|integration\.test)\.ts$/.test(file) || file.includes(`${sep}testing${sep}`);
const rel = (file: string) => relative(SRC, file).split(sep).join("/");

/** Dónde vive un archivo dentro de apps/api/src: módulo, capa, etc. */
function placeOf(file: string): { module: string | null; layer: string } {
  const parts = rel(file).split("/");
  if (parts[0] === "modules") {
    return { module: parts[1]!, layer: parts[2]! };
  }
  return { module: null, layer: parts[0]! };
}

/** Paquetes que solo deben usarse en la infraestructura o en la capa HTTP. */
const INFRASTRUCTURE_PACKAGES = ["pg", "fastify", "@fastify/", "pdfkit", "qrcode"];
const isInfrastructurePackage = (specifier: string) =>
  INFRASTRUCTURE_PACKAGES.some((name) => specifier === name || specifier.startsWith(name.endsWith("/") ? name : `${name}/`));

const sourceFiles = filesIn(SRC).filter((file) => !isTest(file));

interface Resolved {
  file: string;
  specifier: string;
  target: string | null;
}

function resolvedImports(files: string[]): Resolved[] {
  return files.flatMap((file) =>
    importsOf(file).map((specifier) => ({
      file,
      specifier,
      target: specifier.startsWith(".") ? resolve(dirname(file), specifier) : null,
    })),
  );
}

const imports = resolvedImports(sourceFiles);
const report = (violations: Resolved[]) => violations.map((item) => `${rel(item.file)} importa "${item.specifier}"`);

describe("arquitectura: límites entre capas", () => {
  it("el dominio de cada módulo y los casos de uso no dependen de la infraestructura ni de librerías de infraestructura", () => {
    const violations = imports.filter((item) => {
      const place = placeOf(item.file);
      if (place.layer !== "domain" && place.layer !== "application") return false;
      if (item.specifier.startsWith("../") || item.specifier.startsWith("./")) {
        return item.target !== null && /[\\/]infrastructure([\\/]|$)/.test(item.target);
      }
      return isInfrastructurePackage(item.specifier);
    });

    expect(report(violations)).toEqual([]);
  });

  it("ningún módulo ni caso de uso conoce la capa HTTP", () => {
    const violations = imports.filter((item) => {
      const place = placeOf(item.file);
      if (place.layer === "http" || place.layer === "server.ts" || place.layer === "cli" || place.layer === "demo") return false;
      return item.target !== null && /[\\/]src[\\/]http([\\/]|$)/.test(item.target);
    });

    expect(report(violations)).toEqual([]);
  });

  it("un módulo solo usa el dominio o los casos de uso de otro módulo, nunca su infraestructura", () => {
    const violations = imports.filter((item) => {
      const place = placeOf(item.file);
      if (place.module === null || item.target === null) return false;
      const match = /[\\/]modules[\\/]([^\\/]+)[\\/]([^\\/]+)/.exec(item.target);
      return match !== null && match[1] !== place.module && match[2] === "infrastructure";
    });

    expect(report(violations)).toEqual([]);
  });

  it("el código de producción no importa nada de las carpetas de pruebas", () => {
    const violations = imports.filter((item) => item.target !== null && new RegExp(`\\${sep}testing(\\${sep}|$)`).test(item.target));

    expect(report(violations)).toEqual([]);
  });

  it("la capa compartida de aplicación (puertos) no depende de infraestructura", () => {
    const violations = imports.filter((item) => {
      const place = placeOf(item.file);
      if (place.layer !== "shared") return false;
      const inApplication = rel(item.file).startsWith("shared/application/");
      return inApplication && ((item.target !== null && /[\\/]infrastructure([\\/]|$)/.test(item.target)) || isInfrastructurePackage(item.specifier));
    });

    expect(report(violations)).toEqual([]);
  });
});

describe("arquitectura: el dominio financiero es puro", () => {
  const domainFiles = filesIn(DOMAIN_PACKAGE).filter((file) => !/\.test\.ts$/.test(file) && !file.endsWith("prescreening-fixtures.ts"));

  it("packages/domain no importa librerías externas, ni Node, ni nada de las aplicaciones", () => {
    const violations = domainFiles.flatMap((file) =>
      importsOf(file)
        .filter((specifier) => !specifier.startsWith("./"))
        .map((specifier) => `${relative(DOMAIN_PACKAGE, file)} importa "${specifier}"`),
    );

    expect(violations).toEqual([]);
  });

  it("el dominio no usa la hora ni el azar del sistema (se inyectan desde afuera)", () => {
    const violations = domainFiles.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return /Date\.now\(|new Date\(\)|Math\.random\(/.test(text) ? [relative(DOMAIN_PACKAGE, file)] : [];
    });

    expect(violations).toEqual([]);
  });
});

describe("arquitectura: SQL seguro", () => {
  it("las consultas nunca se arman concatenando valores: solo parámetros ($1, $2…)", () => {
    // Excepciones explícitas: el migrador ejecuta SQL de archivos versionados, y la exportación del modelo cita
    // como identificador un nombre de tabla que sale del catálogo de PostgreSQL (nunca de una persona).
    const EXCEPTIONS = ["migrator.ts", "schema-export.ts"];
    const repositories = sourceFiles.filter(
      (file) => file.includes(`${sep}postgres${sep}`) && !EXCEPTIONS.some((name) => file.endsWith(name)),
    );
    const suspicious = repositories.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      // Una plantilla con ${…} dentro de una sentencia SQL es válida solo si inserta nombres de columnas o condiciones fijas.
      return [...text.matchAll(/(?:selectRows|runStatement)\(\s*[\w.]+,\s*`([^`]*)`/g)]
        .filter((match) => /\$\{(?!LOCK|COLUMNS|PAYMENT_COLUMNS|LOAN_COLUMNS|RECEIPT_COLUMNS|USER_COLUMNS|lock|condition|[A-Z_]+_COLUMNS)/.test(match[1]!))
        .map(() => rel(file));
    });

    expect(suspicious).toEqual([]);
  });
});

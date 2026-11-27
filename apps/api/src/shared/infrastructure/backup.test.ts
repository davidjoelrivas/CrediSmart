import { describe, expect, it } from "vitest";
import { backupFileName, buildDumpArguments } from "./backup";

describe("backupFileName", () => {
  it("incluye la fecha y la hora en UTC", () => {
    expect(backupFileName(new Date("2026-11-27T18:30:00Z"))).toBe("credit-smart-2026-11-27-1830.dump");
    expect(backupFileName(new Date("2027-01-05T03:07:00Z"))).toBe("credit-smart-2027-01-05-0307.dump");
  });
});

describe("buildDumpArguments", () => {
  it("pide un respaldo comprimido, sin dueños ni permisos, hacia el archivo indicado", () => {
    expect(buildDumpArguments("postgres://u:p@host:5432/db", "respaldo.dump")).toEqual([
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file=respaldo.dump",
      "--dbname=postgres://u:p@host:5432/db",
    ]);
  });
});

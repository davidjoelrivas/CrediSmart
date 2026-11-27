import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/application/errors";
import { contextOf, createHarness } from "../../../testing/harness";
import { maskNationalId, normalizeNationalId } from "../domain/borrower";

const maria = {
  fullName: "  María   Fernanda López ",
  nationalId: "0801-1990-12345",
  phone: "9988-7766",
  address: "Barrio El Centro, San Nicolás, Copán",
  privacyConsent: true,
};

describe("CreateBorrower", () => {
  it("registra al cliente con datos limpios y muestra el DNI enmascarado", async () => {
    const harness = createHarness();

    const view = await harness.createBorrower.execute(contextOf(), maria);

    expect(view).toMatchObject({
      fullName: "María Fernanda López",
      nationalIdMasked: "****-****-12345",
      phone: "99887766",
      status: "ACTIVE",
      privacyConsentOn: "2026-12-01",
    });
    expect(JSON.stringify(view)).not.toContain("0801199012345");
  });

  it("exige el consentimiento de privacidad", async () => {
    const harness = createHarness();

    await expect(
      harness.createBorrower.execute(contextOf(), { ...maria, privacyConsent: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("no permite repetir el DNI dentro de la organización, pero sí en otra", async () => {
    const harness = createHarness();
    await harness.createBorrower.execute(contextOf("org-1"), maria);

    await expect(harness.createBorrower.execute(contextOf("org-1"), maria)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(harness.createBorrower.execute(contextOf("org-2"), maria)).resolves.toBeDefined();
  });

  it("valida nombre, DNI y teléfono", async () => {
    const harness = createHarness();

    await expect(harness.createBorrower.execute(contextOf(), { ...maria, fullName: "Al" })).rejects.toBeInstanceOf(ValidationError);
    await expect(harness.createBorrower.execute(contextOf(), { ...maria, nationalId: "123" })).rejects.toBeInstanceOf(ValidationError);
    await expect(harness.createBorrower.execute(contextOf(), { ...maria, phone: "12" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("deja constancia en la bitácora", async () => {
    const harness = createHarness();

    await harness.createBorrower.execute(contextOf(), maria);

    const records = await harness.repositories.audit.recordsOf("org-1");
    expect(records.map((record) => record.action)).toEqual(["BORROWER_CREATED"]);
  });
});

describe("UpdateBorrower", () => {
  it("cambia contacto y estado, sin tocar el DNI", async () => {
    const harness = createHarness();
    const created = await harness.createBorrower.execute(contextOf(), maria);

    const updated = await harness.updateBorrower.execute(contextOf(), {
      borrowerId: created.id,
      phone: "3300-1122",
      address: null,
      status: "BLOCKED",
    });

    expect(updated).toMatchObject({ phone: "33001122", address: null, status: "BLOCKED", nationalIdMasked: "****-****-12345" });
  });

  it("no encuentra clientes de otra organización", async () => {
    const harness = createHarness();
    const created = await harness.createBorrower.execute(contextOf("org-1"), maria);

    await expect(
      harness.updateBorrower.execute(contextOf("org-2"), { borrowerId: created.id, status: "INACTIVE" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("BorrowerQueries", () => {
  it("busca por parte del nombre, por teléfono y por DNI completo", async () => {
    const harness = createHarness();
    await harness.createBorrower.execute(contextOf(), maria);
    await harness.createBorrower.execute(contextOf(), {
      ...maria,
      fullName: "Carlos Alberto Reyes",
      nationalId: "0501-1985-00077",
      phone: "3300-1122",
    });

    const byName = await harness.borrowerQueries.search(contextOf(), { text: "carlos" });
    const byPhone = await harness.borrowerQueries.search(contextOf(), { text: "9988" });
    const byNationalId = await harness.borrowerQueries.search(contextOf(), { text: "0801-1990-12345" });
    const all = await harness.borrowerQueries.search(contextOf(), {});

    expect(byName.map((view) => view.fullName)).toEqual(["Carlos Alberto Reyes"]);
    expect(byPhone.map((view) => view.fullName)).toEqual(["María Fernanda López"]);
    expect(byNationalId.map((view) => view.fullName)).toEqual(["María Fernanda López"]);
    expect(all).toHaveLength(2);
  });

  it("nunca mezcla clientes de otras organizaciones", async () => {
    const harness = createHarness();
    await harness.createBorrower.execute(contextOf("org-1"), maria);

    expect(await harness.borrowerQueries.search(contextOf("org-2"), {})).toEqual([]);
  });
});

describe("DNI", () => {
  it("se normaliza y se enmascara", () => {
    expect(normalizeNationalId("0801 1990 12345")).toBe("0801199012345");
    expect(maskNationalId("0801199012345")).toBe("****-****-12345");
    expect(() => normalizeNationalId("0801-1990-1234A")).toThrow(ValidationError);
  });
});

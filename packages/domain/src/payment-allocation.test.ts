import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createBalance,
  InvalidBalanceError,
  outstandingOf,
  statusOf,
  type InstallmentBalance,
} from "./installment-balance";
import { Money } from "./money";
import { allocatePayment, InvalidPaymentError, reverseAllocations } from "./payment-allocation";
import { buildSchedule, type Frequency } from "./schedule";

/** L 10,000 al 5 % mensual, 4 cuotas quincenales: cada cuota es L 2,500 de capital + L 250 de interés. */
function fourBalances(): InstallmentBalance[] {
  return buildSchedule({
    principal: Money.fromLempiras("10000"),
    rateBp: 500,
    ratePeriod: "MONTHLY",
    paymentFrequency: "BIWEEKLY",
    installments: 4,
    startDate: "2026-12-01",
  }).map(createBalance);
}

const lempiras = (text: string) => Money.fromLempiras(text);
const cents = (money: Money) => money.toCents();

describe("allocatePayment: reparto dentro de una cuota", () => {
  it("un pago exacto salda la primera cuota y deja las demás pendientes", () => {
    const result = allocatePayment(fourBalances(), lempiras("2750"));

    expect(result.allocations).toHaveLength(1);
    expect(cents(result.allocations[0]!.interest)).toBe(25000);
    expect(cents(result.allocations[0]!.principal)).toBe(250000);
    expect(statusOf(result.balances[0]!)).toBe("PAID");
    expect(statusOf(result.balances[1]!)).toBe("PENDING");
    expect(result.unallocated.isZero()).toBe(true);
  });

  it("un pago parcial cubre primero el interés y luego el capital", () => {
    const result = allocatePayment(fourBalances(), lempiras("1000"));

    expect(cents(result.allocations[0]!.interest)).toBe(25000);
    expect(cents(result.allocations[0]!.principal)).toBe(75000);
    expect(statusOf(result.balances[0]!)).toBe("PARTIAL");
  });

  it("cubre la mora antes que el interés y el capital", () => {
    const balances = fourBalances();
    balances[0] = { ...balances[0]!, lateFeeDue: lempiras("137.50") };

    const result = allocatePayment(balances, lempiras("500"));

    expect(cents(result.allocations[0]!.lateFee)).toBe(13750);
    expect(cents(result.allocations[0]!.interest)).toBe(25000);
    expect(cents(result.allocations[0]!.principal)).toBe(11250);
  });

  it("un pago que no alcanza ni para la mora solo cubre mora", () => {
    const balances = fourBalances();
    balances[0] = { ...balances[0]!, lateFeeDue: lempiras("137.50") };

    const result = allocatePayment(balances, lempiras("100"));

    expect(cents(result.allocations[0]!.lateFee)).toBe(10000);
    expect(result.allocations[0]!.interest.isZero()).toBe(true);
    expect(result.allocations[0]!.principal.isZero()).toBe(true);
  });
});

describe("allocatePayment: reparto entre cuotas", () => {
  it("el excedente pasa a las cuotas siguientes", () => {
    const result = allocatePayment(fourBalances(), lempiras("6000"));

    expect(result.allocations.map((item) => item.installmentNumber)).toEqual([1, 2, 3]);
    expect(statusOf(result.balances[0]!)).toBe("PAID");
    expect(statusOf(result.balances[1]!)).toBe("PAID");
    expect(statusOf(result.balances[2]!)).toBe("PARTIAL");
    expect(cents(outstandingOf(result.balances[2]!).total)).toBe(225000);
    expect(statusOf(result.balances[3]!)).toBe("PENDING");
  });

  it("paga primero la cuota más antigua aunque lleguen desordenadas", () => {
    const [first, second, third, fourth] = fourBalances();
    const result = allocatePayment([fourth!, third!, second!, first!], lempiras("2750"));

    expect(result.allocations.map((item) => item.installmentNumber)).toEqual([1]);
    expect(statusOf(result.balances[3]!)).toBe("PAID");
    expect(result.balances.map((balance) => balance.number)).toEqual([4, 3, 2, 1]);
  });

  it("salta las cuotas que ya están pagadas", () => {
    const balances = fourBalances();
    balances[0] = {
      ...balances[0]!,
      principalPaid: balances[0]!.principalDue,
      interestPaid: balances[0]!.interestDue,
    };

    const result = allocatePayment(balances, lempiras("2750"));

    expect(result.allocations.map((item) => item.installmentNumber)).toEqual([2]);
  });

  it("devuelve lo que sobra cuando el pago supera toda la deuda", () => {
    const result = allocatePayment(fourBalances(), lempiras("12000"));

    expect(result.balances.every((balance) => statusOf(balance) === "PAID")).toBe(true);
    expect(cents(result.unallocated)).toBe(100000);
  });

  it("sin cuotas, todo el pago queda sin asignar", () => {
    const result = allocatePayment([], lempiras("500"));

    expect(result.allocations).toEqual([]);
    expect(cents(result.unallocated)).toBe(50000);
  });

  it("no modifica los saldos que recibe", () => {
    const balances = fourBalances();
    allocatePayment(balances, lempiras("2750"));

    expect(statusOf(balances[0]!)).toBe("PENDING");
  });
});

describe("allocatePayment: validaciones", () => {
  it("rechaza pagos en cero o negativos", () => {
    expect(() => allocatePayment(fourBalances(), Money.zero())).toThrow(InvalidPaymentError);
    expect(() => allocatePayment(fourBalances(), Money.fromCents(-100))).toThrow(
      InvalidPaymentError,
    );
  });

  it("rechaza saldos incoherentes", () => {
    const balances = fourBalances();
    balances[1] = { ...balances[1]!, interestPaid: lempiras("999") };

    expect(() => allocatePayment(balances, lempiras("100"))).toThrow(InvalidBalanceError);
  });
});

describe("allocatePayment: propiedades", () => {
  const frequencies: Frequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

  it("el dinero se conserva, nada se paga de más y se respeta el orden", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.constantFrom(...frequencies),
        fc.integer({ min: 1, max: 24 }),
        fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 24, maxLength: 24 }),
        fc.integer({ min: 1, max: 250_000_000 }),
        (principalCents, rateBp, paymentFrequency, installments, lateFees, paymentCents) => {
          const balances = buildSchedule({
            principal: Money.fromCents(principalCents),
            rateBp,
            ratePeriod: "MONTHLY",
            paymentFrequency,
            installments,
            startDate: "2026-12-01",
          }).map((installment, index) => ({
            ...createBalance(installment),
            lateFeeDue: Money.fromCents(lateFees[index]!),
          }));
          const payment = Money.fromCents(paymentCents);

          const result = allocatePayment(balances, payment);

          // 1. El dinero se conserva.
          const allocated = result.allocations.reduce(
            (sum, item) => sum.add(item.lateFee).add(item.interest).add(item.principal),
            Money.zero(),
          );
          expect(cents(allocated.add(result.unallocated))).toBe(paymentCents);

          // 2. Nada se paga de más ni queda negativo.
          for (const balance of result.balances) {
            const outstanding = outstandingOf(balance);
            expect(outstanding.principal.isNegative()).toBe(false);
            expect(outstanding.interest.isNegative()).toBe(false);
            expect(outstanding.lateFee.isNegative()).toBe(false);
          }

          // 3. Orden: solo recibe dinero una cuota si todas las anteriores quedaron saldadas,
          //    y dentro de la cuota se paga mora, luego interés y luego capital.
          let foundOpenInstallment = false;
          for (const balance of result.balances) {
            const outstanding = outstandingOf(balance);
            const paid = balance.lateFeePaid.add(balance.interestPaid).add(balance.principalPaid);
            if (foundOpenInstallment) {
              expect(paid.isZero()).toBe(true);
            }
            if (!outstanding.total.isZero()) {
              foundOpenInstallment = true;
            }
            if (!balance.principalPaid.isZero()) {
              expect(outstanding.interest.isZero() && outstanding.lateFee.isZero()).toBe(true);
            }
            if (!balance.interestPaid.isZero()) {
              expect(outstanding.lateFee.isZero()).toBe(true);
            }
          }
        },
      ),
    );
  });
});

describe("reverseAllocations", () => {
  it("devuelve los saldos exactamente como estaban antes del pago", () => {
    const original = fourBalances();
    const { allocations, balances } = allocatePayment(original, lempiras("4000"));

    const restored = reverseAllocations(balances, allocations);

    restored.forEach((balance, index) => {
      expect(cents(outstandingOf(balance).total)).toBe(cents(outstandingOf(original[index]!).total));
      expect(statusOf(balance)).toBe(statusOf(original[index]!));
    });
  });

  it("no modifica los saldos que recibe", () => {
    const { allocations, balances } = allocatePayment(fourBalances(), lempiras("2750"));

    reverseAllocations(balances, allocations);

    expect(statusOf(balances[0]!)).toBe("PAID");
  });

  it("no permite revertir un pago que ya fue revertido", () => {
    const { allocations, balances } = allocatePayment(fourBalances(), lempiras("2750"));
    const restored = reverseAllocations(balances, allocations);

    expect(() => reverseAllocations(restored, allocations)).toThrow(InvalidBalanceError);
  });

  it("rechaza pagos que apuntan a cuotas que no existen", () => {
    const { allocations } = allocatePayment(fourBalances(), lempiras("2750"));

    expect(() => reverseAllocations([], allocations)).toThrow(InvalidPaymentError);
  });

  it("propiedad: aplicar y revertir cualquier pago deja los saldos como al inicio", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_100_000 }), (paymentCents) => {
        const original = fourBalances();
        const { allocations, balances } = allocatePayment(original, Money.fromCents(paymentCents));

        const restored = reverseAllocations(balances, allocations);

        restored.forEach((balance, index) => {
          expect(cents(outstandingOf(balance).total)).toBe(
            cents(outstandingOf(original[index]!).total),
          );
        });
      }),
    );
  });
});

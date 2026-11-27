import type { Clock } from "../application/ports";

/** Reloj real: devuelve la fecha de hoy en la zona horaria del negocio (Honduras por defecto). */
export class SystemClock implements Clock {
  private readonly formatter: Intl.DateTimeFormat;

  constructor(
    timeZone = "America/Tegucigalpa",
    private readonly now: () => Date = () => new Date(),
  ) {
    // El formato canadiense es AAAA-MM-DD.
    this.formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  today(): string {
    return this.formatter.format(this.now());
  }
}

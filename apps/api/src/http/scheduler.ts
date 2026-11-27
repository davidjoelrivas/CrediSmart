import { SYSTEM_ACTOR_ID } from "../modules/lending/application/accrue-late-fees";
import type { Services } from "./services";

interface Logger {
  info(object: object, message: string): void;
  error(object: object, message: string): void;
}

export interface Scheduler {
  /** Corre una pasada ahora mismo (también la usan las pruebas). */
  runOnce(): Promise<void>;
  stop(): void;
}

/**
 * Calcula la mora de todas las organizaciones cada cierto tiempo, sin que nadie tenga que acordarse.
 * Es seguro correrlo muchas veces (idempotente) y nunca corre dos pasadas a la vez.
 */
export function startLateFeeScheduler(services: Services, logger: Logger, everyMinutes = 60): Scheduler {
  let running = false;

  async function runOnce(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    try {
      for (const organizationId of await services.organizations.listIds()) {
        const result = await services.accrueLateFees.execute({ organizationId, actorId: SYSTEM_ACTOR_ID });
        if (result.loansUpdated > 0) {
          logger.info({ organizationId, ...result }, "mora actualizada");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "falló el cálculo automático de mora");
    } finally {
      running = false;
    }
  }

  const first = setTimeout(() => void runOnce(), 15_000);
  const timer = setInterval(() => void runOnce(), everyMinutes * 60_000);
  first.unref();
  timer.unref();

  return {
    runOnce,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

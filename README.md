# CrediSmart

Sistema de gestión de préstamos para prestamistas independientes. Acompaña el ciclo completo del crédito: desde que una persona pide un préstamo (precalificación) hasta que termina de pagarlo (contrato, plan de pagos, recibos, mora y control del capital).

> **Estado del proyecto:** el flujo completo funciona de punta a punta (API, aplicación web y base de datos real). Cada sección indica qué existe hoy y qué está planificado; lo pendiente está en la [hoja de ruta](#hoja-de-ruta).

## Verificación del proyecto

Código de verificación: `LEARN-CAP-00A9235F`

## El problema

Un prestamista independiente de Honduras, con cerca de un año de operación y un negocio en crecimiento, lleva hoy su cartera a papel y lápiz: un bloc de notas y una calculadora.

- **Precalificación por chat:** le escribe por WhatsApp al interesado, le hace cinco preguntas y con las respuestas se forma una idea de si aplica. Las respuestas no quedan ordenadas ni son comparables.
- **Contratos:** una plantilla de Word en blanco que se envía por WhatsApp y que el cliente llena a mano.
- **Pagos:** no se entregan recibos.
- **Control:** para saber cuánto capital tiene colocado, cuánto interés genera o quién está atrasado, hay que sumar y revisar las notas.

## La solución

CrediSmart convierte ese proceso manual en un flujo de trabajo completo, y no solo en una hoja de cálculo:

1. **Evaluación.** El interesado responde las preguntas desde su teléfono, en un enlace público que el prestamista comparte por WhatsApp. El sistema aplica reglas configurables y devuelve un resultado orientativo (aplica, revisar o no aplica) **con las razones**. **La decisión final siempre es humana**, y si contradice al sistema debe dejar por escrito el motivo.
2. **Aprobación.** El prestamista define monto, interés, frecuencia, plazo y política de mora. El sistema calcula el plan de pagos, la tasa efectiva anual y genera el **contrato y el pagaré ya llenados** con los datos del cliente.
3. **Cobro.** Cada pago se registra y se aplica a la cuota más antigua (mora, luego interés, luego capital). La mora se calcula sola cada hora y se emite un **recibo en PDF con código QR** que cualquiera puede verificar sin iniciar sesión.
4. **Control.** Un tablero muestra el capital total, el dinero prestado, los intereses ganados, lo cobrado en el mes, la cartera en riesgo y los clientes en mora, respaldado por contabilidad de partida doble. Una bitácora encadenada con huellas digitales detecta si alguien altera el historial.

## Qué existe hoy

**Aplicación web** (`apps/web`, React + Vite), en español y adaptada a teléfono:

- Inicio de sesión, tablero, clientes, préstamos (nuevo, detalle, desembolso, cobro, reverso), cobranza con recordatorio por WhatsApp, simulador, solicitudes de precalificación, bitácora y equipo.
- Página pública de **verificación de recibos** (`/verificar/…`) y **formulario público de solicitud** (`/aplicar/…`).
- **Portal del cliente:** consulta de sus préstamos, cuotas y pagos.

**API** (`apps/api`, Fastify, arquitectura hexagonal): sesiones seguras, roles (dueño, cobrador, contador, cliente), validación de todo lo que entra, límites de intentos, cabeceras de seguridad, cálculo automático de mora, PDF de recibo y de contrato/pagaré.

**Dominio** (`packages/domain`, TypeScript puro sin base de datos ni framework): dinero en centavos enteros, planes de cuotas (interés fijo, sobre saldo y solo interés), políticas de mora, reparto de pagos, partida doble, tasa efectiva anual con tope legal configurable y motor de precalificación explicable.

**Base de datos** (`db/migrations`, PostgreSQL con SQL escrito a mano, sin ORM): 8 migraciones versionadas; pagos, asientos y bitácora inmutables por triggers; seguridad por fila activada en todas las tablas; el DNI de los clientes se guarda **cifrado** (AES-256-GCM).

**Pruebas:** 480 pruebas automáticas (209 de dominio, 205 de la API, 45 de integración contra PostgreSQL real, 13 de la web y 8 de contratos), incluidas pruebas de propiedades con fast-check y pruebas de concurrencia (dos cobros simultáneos con la misma clave no se duplican).

## Cómo correrlo

Requisitos: Node 24, pnpm 12 y un PostgreSQL (local o Supabase).

```bash
pnpm install
cp .env.example .env            # completa DATABASE_URL y genera las llaves:
pnpm --filter @app/api keys:generate
pnpm --filter @app/api db:migrate
pnpm --filter @app/api db:seed:demo   # organización ficticia con usuarios de prueba

pnpm dev:api    # API en http://localhost:3000
pnpm dev:web    # web en http://localhost:5173 (reenvía /api a la API)
```

Para servirlo todo desde un solo proceso (como en producción): `pnpm build && pnpm start`. La guía de despliegue está en [`docs/operaciones/despliegue.md`](docs/operaciones/despliegue.md).

Pruebas: `pnpm test` (unitarias, sin base de datos) y `pnpm --filter @app/api test:integration` (necesita un PostgreSQL **local**; se niega a correr contra una base remota).

## Principios de diseño

- **Que cuadre, siempre:** los números se pueden demostrar (partida doble e invariantes verificados con pruebas).
- **El dinero no se edita, se compensa:** pagos y asientos son inmutables; un error se corrige con un reverso.
- **Evidencia por defecto:** cada operación relevante deja un rastro auditable y encadenado.
- **Configurable, no cableado:** tasas, mora, preguntas de precalificación y topes legales son datos, no constantes.
- **Explicable antes que "inteligente":** el sistema orienta; no aprueba ni rechaza personas por sí solo.
- **Privacidad:** el DNI se guarda cifrado, se muestra enmascarado y solo se descifra para el contrato.

## Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript (frontend y backend) |
| Frontend | React + Vite, TanStack Query |
| Backend | Fastify, arquitectura hexagonal, monolito modular ([ADR 0010](docs/adr/0010-api-fastify-y-sesiones-con-cookie.md)) |
| Base de datos | PostgreSQL con SQL escrito a mano (sin ORM), alojada en Supabase |
| Documentos | pdfkit y qrcode (recibo, contrato y pagaré) |
| Validación | Zod, compartido entre API y web |
| Pruebas | Vitest, fast-check (propiedades), Testing Library |

## Arquitectura

Monolito modular con puertos y adaptadores. La lógica financiera vive en un paquete de dominio en TypeScript puro; los casos de uso dependen solo de puertos (reloj, generador de ids, unidad de trabajo, repositorios) y tienen adaptadores para PostgreSQL y para memoria (pruebas rápidas).

```
apps/api            API: módulos identidad, clientes, préstamos, cobranza,
                    contabilidad, reportes, precalificación y auditoría
apps/web            Aplicación web para el prestamista y el cliente
packages/domain     Motor financiero puro
packages/contracts  Esquemas y tipos compartidos entre API y web
db/migrations       Migraciones SQL versionadas
docs/               Arquitectura (C4), decisiones (ADR) y operaciones
```

## Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 0. Fundaciones | Repositorio, flujo de Git, motor de cuotas con pruebas | Hecho |
| 1. Núcleo operativo | Esquema de datos, autenticación, clientes, préstamos, pagos, recibos, mora, tablero | Hecho |
| 2. Documentos y flujo de solicitud | Contrato y pagaré, precalificación con enlace público, portal del cliente (consulta) | Hecho (el texto legal del contrato es un **borrador** pendiente de revisión por un abogado) |
| 3. Producción | Despliegue en un solo servicio, base de datos en Supabase | Guía y Dockerfile listos |
| 4. Pendiente | Modo sin conexión (PWA), reporte de pagos por el cliente desde su portal, conciliación bancaria, envío automático de mensajes por WhatsApp, integración continua | Planificado |

## Cómo contribuir y flujo de trabajo

- Ramas cortas desde `main` y cambios mediante pull requests.
- Mensajes de commit con [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Nunca se versionan secretos: las variables de entorno van en `.env` (ignorado) y se documentan en `.env.example`.

## Licencia

Software propietario. Todos los derechos reservados. El código se publica con fines académicos y de evaluación; no se concede licencia de uso, copia ni distribución.

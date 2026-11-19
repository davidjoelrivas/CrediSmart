# Credit Smart

Sistema de gestión de préstamos para prestamistas independientes. Acompaña el ciclo completo del crédito: desde que una persona pide un préstamo (pre-calificación) hasta que termina de pagarlo (contrato, plan de pagos, recibos, mora y control del capital).

> **Estado del proyecto:** fase de definición y fundaciones. Todavía no hay código ejecutable; el repositorio crece paso a paso y cada sección de este README indica qué existe y qué está planificado.

## Verificación del proyecto

Código de verificación: `LEARN-CAP-00A9235F`

## El problema

Un prestamista independiente de Honduras, con cerca de un año de operación y un negocio en crecimiento, lleva hoy su cartera a papel y lápiz: un bloc de notas y una calculadora.

- **Pre-calificación por chat:** le escribe por WhatsApp al interesado, le hace cinco preguntas y con las respuestas se forma una idea de si aplica. Las respuestas no quedan ordenadas ni son comparables.
- **Contratos:** una plantilla de Word en blanco que se envía por WhatsApp y que el cliente llena a mano.
- **Pagos:** no se entregan recibos.
- **Control:** para saber cuánto capital tiene colocado, cuánto interés genera o quién está atrasado, hay que sumar y revisar las notas.

## La solución

Credit Smart convierte ese proceso manual en un flujo de trabajo completo, y no solo en una hoja de cálculo:

1. **Evaluación.** El interesado responde las preguntas de pre-calificación desde su teléfono (o el prestamista las registra desde el chat). El sistema aplica reglas configurables y devuelve un resultado orientativo (aplica, revisar o no aplica) con las razones. **La decisión final siempre es humana.**
2. **Aprobación.** El prestamista define monto, interés, frecuencia y plazo. El sistema genera el plan de pagos y el contrato ya llenado con los datos del cliente.
3. **Cobro.** Cada pago se registra y se aplica a la cuota correspondiente; la mora se calcula automáticamente y se emite un recibo verificable por cada pago.
4. **Control.** Un tablero muestra el capital colocado y disponible, los intereses ganados y los clientes en mora, respaldado por contabilidad de partida doble.

## Principios de diseño

- **Que cuadre, siempre:** los números se pueden demostrar (partida doble e invariantes verificados con pruebas).
- **El dinero no se edita, se compensa:** pagos y asientos son inmutables; un error se corrige con un reverso.
- **Evidencia por defecto:** cada operación relevante deja un rastro auditable.
- **Funciona en la calle:** pensado para teléfonos modestos y conexión inestable (PWA con modo offline).
- **Configurable, no cableado:** tasas, mora y topes legales son datos, no constantes.
- **Explicable antes que "inteligente":** el sistema orienta; no aprueba ni rechaza personas por sí solo.

## Stack planificado

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript (frontend y backend) |
| Frontend | React + Vite, PWA con modo offline |
| Backend | NestJS, arquitectura hexagonal, monolito modular |
| Base de datos | MySQL 8.4 con SQL escrito a mano (sin ORM) |
| Pruebas | Vitest, fast-check (propiedades), Testcontainers, Playwright |
| Calidad y CI | ESLint, SonarCloud, GitHub Actions |

## Arquitectura

Monolito modular con puertos y adaptadores. La lógica financiera (cuotas, intereses, mora, tasa efectiva anual y asientos contables) vive en un paquete de dominio en TypeScript puro, sin base de datos ni framework, para poder probarla de forma exhaustiva.

```
apps/api         API NestJS (módulos: identidad, clientes, originación, préstamos,
                 cobranza, contabilidad, documentos, reportes, auditoría)
apps/web         Aplicación web (PWA) para el prestamista y el cliente
packages/domain  Motor financiero puro
packages/contracts  Esquemas compartidos entre API y web
db/migrations    Migraciones SQL versionadas
docs/            Arquitectura (C4), decisiones (ADR) y documentación
```

## Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 0. Fundaciones | Repositorio, flujo de trabajo en Git, motor de cuotas con pruebas | En curso |
| 1. Núcleo operativo | Esquema de datos, autenticación, clientes, préstamos, pagos y recibos | Pendiente |
| 2. Arquitectura formal | Diagramas C4 y registros de decisiones (ADR) | Pendiente |
| 3. Producción | Despliegue, PWA offline, seguridad y portal del cliente | Pendiente |
| 4. Calidad | Cobertura de pruebas, análisis estático y CI/CD | Pendiente |

## Cómo contribuir y flujo de trabajo

- Ramas cortas desde `main` y cambios mediante pull requests.
- Mensajes de commit con [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Nunca se versionan secretos: las variables de entorno van en `.env` (ignorado) y se documentan en `.env.example`.

## Licencia

Software propietario. Todos los derechos reservados. El código se publica con fines académicos y de evaluación; no se concede licencia de uso, copia ni distribución.

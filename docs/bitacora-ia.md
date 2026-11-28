# Bitácora de uso de IA

Registro honesto de cómo se usó un asistente de IA (Claude Code, de Anthropic) en este proyecto: qué hizo la IA, qué decidió y revisó la persona, cómo se verificó el resultado y qué errores cometió la IA. Se agrega una entrada por cada sesión de trabajo importante.

**Reglas que se siguen:**

- La IA escribe código y documentación; **David (el autor) revisa y hace todos los commits y pushes** con su propia cuenta de GitHub. La IA no tiene acceso al repositorio remoto.
- Todo cambio se verifica con pruebas automáticas antes de darse por bueno.
- Ninguna decisión sobre aprobar o rechazar a una persona la toma el sistema: es siempre humana.
- Los commits todavía **no están firmados** (la configuración de firma está pendiente).

---

## 2026-11-17: Plan maestro y primera arquitectura

- **Objetivo:** definir qué construir para un prestamista real (Mauricio Mejía, "Crédito Inteligente", San Nicolás, Copán), con stack, arquitectura y alcance.
- **La IA hizo:** el documento maestro del proyecto (visión, reglas de negocio, arquitectura hexagonal, stack, mapa de entregables del curso), investigación de mercado y del marco legal de tasas de interés en Honduras.
- **David decidió:** el nombre del producto, que **no se puede usar un ORM** (única restricción real del curso) y que el sistema sea escalable y profesional.
- **Verificación:** David revisó el plan y lo aprobó por partes.
- **Nombre del producto:** la IA propuso "Abonia", que David rechazó; se eligió "Varas" y el 19 de noviembre David decidió el nombre definitivo, **CrediSmart**. La marca se aisló en un solo lugar para poder cambiarla.

## 2026-11-19: Repositorio, motor de cuotas y entregables 1 a 4

- **Objetivo:** crear el repositorio, el primer paquete de dominio y pasar los primeros entregables del curso.
- **La IA hizo:** dinero en centavos (`Money`), plan de cuotas con interés fijo, mora con 4 políticas, pruebas de propiedades con fast-check, README, C4 niveles 1 y 2, ADR 0003 y 0006, y el texto del entregable 1 redactado a partir de lo que David contó del cliente.
- **David decidió:** hacer él los commits y pull requests (no quiso que la IA figurara como coautora ni tuviera acceso a GitHub) y corrigió los hechos sobre cómo trabaja hoy el cliente (control en papel, precalificación por WhatsApp con 5 preguntas, contrato en plantilla de Word, sin recibos).
- **Verificación:** 57 pruebas automáticas; el verificador de la plataforma aprobó los entregables 1 a 4.
- **Errores de la IA:** escribió mal el nombre del producto varias veces ("Credit Smart"); se corrigió en todo el repositorio.

## 2026-11-23: Motor de dominio y capa de aplicación

- **Objetivo:** completar las reglas financieras y empezar la API sin framework.
- **La IA hizo:** reparto de pagos (mora, interés, capital; cuota más antigua primero), motor de precalificación explicable, contabilidad de partida doble, tasa efectiva anual con tope legal configurable, métodos de interés sobre saldo y solo interés, y la capa de aplicación con puertos y casos de uso (simular, aprobar, desembolsar).
- **Verificación:** 142 pruebas de dominio. Una prueba de propiedades **encontró un error real** en `Money.splitEvenly` (podía generar partes negativas con montos pequeños) y se corrigió con una prueba que lo reproduce.

## 2026-11-27: Base de datos real, producción y aplicación completa

- **Objetivo:** dejar el sistema funcionando de verdad para presentarlo en una feria de innovación el lunes 30 de noviembre, en un solo entorno (PostgreSQL en Supabase).
- **La IA hizo:**
  - Migraciones de PostgreSQL con SQL escrito a mano, repositorios con el driver `pg`, seguridad por fila, cifrado del DNI y herramientas de operación (`db:check`, `db:backup`, `db:seed:demo`).
  - API HTTP con Fastify, sesiones, roles, mora automática, tablero, recibos PDF con QR, contrato y pagaré, precalificación con formulario público, y la aplicación web con React.
  - Documentación: README, ADR 0010 y guía de despliegue.
- **David decidió:** usar PostgreSQL y Supabase (después de aclarar que el curso solo prohíbe el ORM), crear él mismo la cuenta y el proyecto de Supabase, y hacer los commits (12 commits en la rama `feat/api-http-y-web`).
- **Verificación:** 480 pruebas automáticas, incluidas pruebas de integración contra PostgreSQL real y de concurrencia; recorrido de la interfaz con un navegador automatizado; revisión de la base de producción con `db:check`.
- **Errores de la IA y correcciones:**
  - Afirmó por error que el curso exigía MySQL; David lo aclaró y se migró todo a PostgreSQL.
  - Cambió de NestJS a Fastify sin consultarlo primero; se explicó, se documentó en el ADR 0010 y David lo aceptó.
  - Al correr `db:check` contra Supabase real apareció una falsa alarma de "conexión sin cifrar" (el pooler reporta el tramo interno, no el del cliente); se corrigió para leer el cifrado desde el socket del cliente.

## 2026-11-28: Endurecimiento antes de la feria

- **Objetivo:** reforzar seguridad, calidad y mantenibilidad sin agregar funciones nuevas riesgosas.
- **La IA hizo:**
  - Pruebas de acceso indebido entre organizaciones. **Encontraron un error de seguridad real**: un dueño de otra organización podía aprobar un préstamo usando el id de un cliente ajeno. Se corrigió en el caso de uso (el cliente debe existir en la organización y estar activo) **y** en la base de datos con llaves foráneas compuestas (migración 0009).
  - Prueba automática de arquitectura hexagonal. La primera vez que corrió **encontró dos violaciones reales** de los límites entre capas; se corrigieron.
  - Integración continua con GitHub Actions (tipos, pruebas con cobertura, pruebas de integración contra PostgreSQL, compilación) y configuración de SonarCloud.
  - Subió la cobertura de la web de 25 % a 81 % con pruebas de los flujos principales.
  - Exportación del modelo de datos real a JSON (`docs/modelo-de-datos.json`, comando `db:export-model`), leyendo el esquema de PostgreSQL.
  - **Modo sin conexión (PWA):** aplicación instalable, service worker que guarda solo la aplicación (nunca respuestas de la API) y cola de cobros con idempotencia que se envía sola al volver el internet (ADR 0011). Se verificó en un navegador real: cortar la conexión, cobrar, recargar sin internet, volver la conexión y comprobar que el pago aparece una sola vez.
  - Actualizó el documento de arquitectura (nivel 3 de C4, regla de dependencia comprobada) y agregó notas de actualización a los ADR 0003 y 0006.
- **Errores de la IA durante esta sesión:** al probar el modo sin conexión en el navegador, el cobro se quedaba "cargando" sin guardarse: TanStack Query pausa las mutaciones sin internet por defecto. Se corrigió con `networkMode: "always"`, se agregó un temporizador a las solicitudes y una prueba que reproduce el caso.
- **Verificación:** cobertura de líneas: dominio 98 %, API 92 % (solo pruebas unitarias; la capa PostgreSQL se cubre con las de integración), web 81 %, contratos 97 %. Las pruebas de integración corren contra un PostgreSQL local; el flujo de GitHub Actions **aún no se ha ejecutado** (se verá cuando se suba).

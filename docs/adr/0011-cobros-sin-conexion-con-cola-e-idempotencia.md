# Permitir cobrar sin internet con una cola local e idempotencia, y no guardar nunca datos de la API en la memoria del navegador

- **Estado:** Aceptada e implementada
- **Fecha:** 2026-11-28
- **ADR:** 0011

## Contexto

Un prestamista cobra en la calle, donde la señal es mala o no existe. Si el sistema exige internet para registrar un cobro, el dinero se anota en un papel y se pasa después: justo lo que el sistema pretende evitar.

Hay dos riesgos opuestos:

1. **Perder o duplicar dinero.** Un cobro hecho sin internet no puede perderse, y si la solicitud sí llegó al servidor pero la respuesta no volvió, reintentarla no puede cobrar dos veces.
2. **Filtrar datos personales.** Guardar respuestas de la API en la memoria del navegador (datos de clientes, DNI enmascarado, saldos) los deja en un equipo que puede perderse o compartirse.

## Decisión

- **Service worker que guarda solo la aplicación** (pantalla principal y archivos con huella): la aplicación abre sin internet. Las solicitudes a `/api` **nunca** se guardan ni se sirven desde la memoria (una prueba con el navegador real comprueba que no queda ninguna).
- **Cola de cobros en el equipo.** Si al cobrar no hay conexión, el cobro se guarda en `localStorage` con su **clave de idempotencia** y se envía solo al volver el internet (evento `online`, al abrir la aplicación y cada 30 segundos). Es una cola por persona, en orden.
- **Idempotencia de punta a punta.** La clave que genera la pantalla es la misma que usa el servidor para reconocer un cobro repetido: reenviar un cobro que ya se había procesado devuelve el resultado original sin cobrar otra vez. Por eso es seguro cortar una solicitud por tiempo (12 s) y reintentarla.
- **Errores de datos no se reintentan solos.** Si al sincronizar el servidor rechaza un cobro (por ejemplo, el pago supera la deuda porque otro cobro llegó primero), queda marcado como fallido, visible en un aviso fijo, para que una persona decida reintentar o descartar. Los errores de red, de sesión vencida o del servidor sí se reintentan.
- **El recibo se emite al sincronizar:** el folio lo asigna el servidor, así que sin conexión no hay recibo. La pantalla lo dice claramente.
- **Perfil guardado para abrir sin internet:** solo nombre, rol y permisos (nada secreto). No concede acceso: el servidor valida la sesión en cada solicitud, y la copia se borra al cerrar sesión.
- **La aplicación maneja la falta de conexión ella misma:** se desactiva la pausa automática de TanStack Query (`networkMode: "always"`), que de otro modo deja los cobros "cargando" para siempre sin llegar a ejecutar el código de guardado.

## Consecuencias

### Positivas

- Un cobro hecho sin internet no se pierde y no se duplica (verificado en un navegador real: cortar la conexión, cobrar, recargar sin internet, volver la conexión y comprobar que el pago aparece una sola vez).
- Ningún dato de clientes queda en la memoria del service worker.

### Negativas (lo que se sacrifica)

- **Solo se puede cobrar un préstamo que se abrió con conexión.** Los datos del préstamo no se guardan, así que si se recarga la página sin internet, hay que volver a tenerlos. Guardarlos permitiría un modo sin conexión completo, a cambio de dejar datos personales en el equipo; se decidió no hacerlo hasta tener cifrado local.
- **Los cobros pendientes viven en el equipo** (`localStorage`, sin cifrar): contienen montos, el código del préstamo y el nombre del cliente. Si el equipo se pierde antes de sincronizar, esos datos son legibles. Se compensa con que no hay credenciales ni DNI.
- **Dos personas con el mismo equipo** ven solo su propia cola, pero comparten el almacenamiento del navegador.
- Un cobro rechazado al sincronizar exige trabajo humano; es el costo de no decidir por la persona.

## Alternativas consideradas

- **Guardar también las lecturas (préstamos, clientes) en IndexedDB:** descartado por privacidad (ver arriba); es el siguiente paso si se cifra localmente.
- **Cobrar sin recibo definitivo y generar uno provisional:** descartado, un folio provisional se presta a confusión y a fraude.
- **Sincronización en segundo plano con `Background Sync`:** no es compatible con todos los navegadores móviles; el envío desde la propia aplicación funciona en todos.

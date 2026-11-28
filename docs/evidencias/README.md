# Evidencias

Capturas del sistema funcionando, tomadas el 27 de noviembre de 2026 con la **organización de demostración**: todos los nombres, DNI y montos son ficticios. Se obtuvieron con un navegador automatizado (Playwright con Edge) recorriendo la aplicación real contra una base PostgreSQL con los datos de demostración.

| # | Captura | Qué demuestra |
|---|---|---|
| 1 | [Tablero](01-tablero.png) | Capital total, intereses ganados, cobrado del mes, vencido por cobrar, cartera en riesgo (7 y 30 días), más atrasados y próximos vencimientos |
| 2 | [Simulador](02-simulador.png) | Plan de cuotas, total a pagar y tasa efectiva anual, calculados por la API sin guardar nada |
| 3 | [Detalle de un préstamo en mora](03-detalle-prestamo-con-mora.png) | Política de mora (L 25 por día tras 2 días de gracia), cuotas vencidas resaltadas y recibos numerados |
| 4 | [Pago registrado](04-pago-registrado.png) | Cobro aplicado a mora, interés y capital, con recibo emitido y enlace al PDF |
| 5 | [Verificación del QR del recibo](05-verificacion-qr-recibo.png) | Página pública que confirma si un recibo es auténtico, mostrando solo lo necesario (nombre abreviado, sin DNI) |
| 6 | [Tablero en el teléfono](06-tablero-movil.png) | Diseño adaptado a pantalla pequeña, con el menú inferior |
| 7 | [Formulario público de solicitud](07-formulario-publico.png) | Lo que ve quien pide un préstamo: solo las preguntas, nunca las reglas ni el puntaje |
| 8 | [Bandeja de precalificación](08-bandeja-precalificacion.png) | Solicitudes con su resultado orientativo (aplica, revisar, no aplica) |
| 9 | [Solicitud explicada](09-solicitud-explicada.png) | El sistema dice **por qué** salió así: la regla que descartó o los puntos que sumó |
| 10 | [Decisión humana](10-decision-humana.png) | La decisión final es de una persona; si contradice al sistema, la nota es obligatoria |
| 11 | [Cobro guardado sin conexión](11-cobro-guardado-sin-conexion.png) | Sin internet, el cobro no se pierde: queda en el equipo y la pantalla lo dice |
| 12 | [Aviso de cobros pendientes](12-aviso-cobros-pendientes.png) | Aviso fijo con "Sin conexión" y los cobros por enviar |
| 13 | [Aplicación abierta sin internet](13-app-abierta-sin-internet.png) | Tras recargar sin conexión, la aplicación abre desde la memoria del service worker y conserva la cola |

Estas capturas se actualizan en cada hito importante (ver la bitácora en [`docs/bitacora-ia.md`](../bitacora-ia.md)).

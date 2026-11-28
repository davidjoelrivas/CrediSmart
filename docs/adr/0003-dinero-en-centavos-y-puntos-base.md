# Representar el dinero en centavos enteros y las tasas en puntos base en vez de números decimales

- **Estado:** Aceptada e implementada en `packages/domain`
- **Fecha:** 2026-11-19
- **ADR:** 0003
- **Actualización (2026-11-27):** el motor de base de datos finalmente es PostgreSQL y no MySQL. La decisión no cambia: el dinero sigue siendo un entero en centavos (`bigint`) y las tasas, enteros en puntos base. Donde este ADR dice "MySQL" léase "PostgreSQL"; el controlador `pg` devuelve `bigint` como texto, por lo que se convierte de forma explícita a número al leer.

## Contexto

El sistema calcula cuotas, intereses y mora. Un error de redondeo, aunque sea de un centavo, hace que el sistema y el cuaderno del prestamista dejen de coincidir, y eso destruye la confianza en una herramienta cuyo valor es "que cuadre siempre".

JavaScript representa los números con coma flotante binaria de 64 bits, y esa representación no es exacta para fracciones decimales (por ejemplo, `0.1 + 0.2` no es `0.3`). Los porcentajes de interés y las divisiones entre cuotas producen justo ese tipo de fracciones.

La moneda es el lempira, con dos decimales. El mismo cálculo debe dar el mismo resultado en el dominio (TypeScript), en la base de datos (MySQL) y en los documentos impresos.

## Decisión

- **El dinero es un entero en centavos.** `L 1,250.50` se guarda como `125050`. En el dominio lo representa la clase `Money`; en MySQL se guarda como `BIGINT`.
- **Las tasas son enteros en puntos base.** `20 %` se guarda como `2000`.
- **El redondeo es half-up y se aplica por cuota.** Los empates negativos se alejan de cero. Las multiplicaciones intermedias usan `BigInt`, así no se pierde precisión.
- **La diferencia de redondeo se absorbe en la última cuota**, para que la suma de las cuotas coincida exactamente con el total.
- **Se rechazan las entradas inválidas:** decimales, valores no finitos y enteros fuera del rango seguro de JavaScript lanzan `InvalidMoneyError`.
- Ninguna regla financiera usa `number` con decimales.

## Consecuencias

### Positivas

- Los cálculos son exactos y deterministas: las mismas entradas dan siempre el mismo resultado.
- El redondeo queda definido en un solo lugar y no depende de cada función que calcule.
- Los invariantes se pueden verificar con pruebas de propiedades: la suma del capital de las cuotas es igual al principal, y las partes de un reparto suman el total, para entradas aleatorias.
- El mismo entero sirve en TypeScript y en MySQL, sin conversiones intermedias.

### Negativas (lo que se sacrifica)

- **Comodidad:** no se pueden usar los operadores aritméticos directamente sobre el dinero; se usan métodos (`add`, `multiplyByBasisPoints`, `splitEvenly`).
- **Conversión en los bordes:** pantallas, archivos CSV y PDF deben convertir de y hacia lempiras, y un error en esa conversión es un error de 100 veces.
- **Precisión limitada de las tasas:** la unidad mínima es un punto base (0.01 %). Una tasa como 0.005 % no se puede expresar.
- **Rango acotado:** los montos están limitados al rango de enteros seguros de JavaScript.
- **Lectura desde MySQL:** el mapeo de fila a entidad debe convertir los `BIGINT` de forma explícita y validarlos, porque el controlador puede devolverlos como texto o como número.

## Alternativas consideradas

- **`number` con decimales:** descartada por los errores de coma flotante.
- **Librería de decimales (por ejemplo, `decimal.js`):** es correcta, pero agrega una dependencia en el núcleo del dominio y obliga a decidir cómo se serializa y cómo se guarda.
- **`DECIMAL(19,2)` en MySQL con conversión en la aplicación:** el motor y el dominio tendrían dos reglas de redondeo distintas que mantener sincronizadas. Con enteros, ambos hablan el mismo idioma.

## Evidencia

- Implementación: [`packages/domain/src/money.ts`](../../packages/domain/src/money.ts) y [`packages/domain/src/schedule.ts`](../../packages/domain/src/schedule.ts).
- Pruebas: [`money.test.ts`](../../packages/domain/src/money.test.ts) y [`schedule.test.ts`](../../packages/domain/src/schedule.test.ts), incluida la prueba de que la última cuota absorbe la diferencia de redondeo.

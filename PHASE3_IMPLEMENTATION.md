# Fase 3 — Implementación de `economicSplit` en `debt-calc.js`

Implementado según `PHASE3_ECONOMIC_SPLIT_DESIGN.md`, con un ajuste que describo abajo (encontrado durante la implementación, no en el diseño). `app.js` **no se ha tocado** — `computeDebtHalf()`/`debtExpenses()` siguen exactamente igual que en la Fase 2; `computeBalanceCents()` es una función nueva y separada. Ninguna regla de Firestore publicada. Sin migración de datos. Sin commit todavía.

## Cómo se ejecutaron los tests — aviso importante de metodología

**No he podido ejecutar `npm test` en este entorno.** Volví a comprobar de forma exhaustiva (PATH de Bash y de PowerShell, rutas habituales de instalación de Node, WinGet/Scoop/Chocolatey/nvm4w) y Node.js no está disponible en esta sandbox en absoluto.

Para no depender solo de verificación a mano, ejecuté los **27 tests reales** (los 7 de `test/debt-calc.test.js` + los 20 de `test/economic-split.test.js` — 18 aprobados en la ronda anterior más los 2 tests de regresión añadidos en esta ronda, ver más abajo — contenido exacto, no reescrito de memoria) dentro del navegador real (Chrome, motor V8 — el mismo motor que usa Node.js), cargando el `debt-calc.js` real de este directorio y con un shim mínimo de `require`/`test`/`assert.equal`/`assert.deepEqual`/`assert.ok` que reproduce la semántica de `node:assert/strict`. Es decir: la lógica probada es 100% la de `debt-calc.js`, y el motor de JavaScript que la ejecuta es el mismo (V8) que usaría `node --test` — la única diferencia es el arnés que cuenta pasa/falla, no el código bajo prueba.

**Encontré y corregí un fallo en mi propio arnés durante este proceso** (no en `debt-calc.js`): mi primera versión de `assert.deepEqual` comparaba con `JSON.stringify(a) === JSON.stringify(b)`, que es sensible al orden de inserción de las claves — dio un falso "fallo" en el test M1 porque `buildSplitFromPercent` construye el resultado con la clave de la persona no-pagadora primero y la del pagador después, mientras que el test escribe el objeto esperado en el otro orden. `assert.deepStrictEqual` real de Node compara por clave/valor, no por el string serializado, así que ese "fallo" no era real. Lo corregí a una comparación estructural (recorrer claves, ignorando el orden) y confirmé con una prueba aislada que las dos representaciones son iguales. Lo cuento explícitamente porque es exactamente el tipo de error de verificación que no quiero dejar pasar en silencio.

### Resultado — distinguiendo qué está verificado y qué no

**VERIFICADO:**
- 27 tests ejecutados mediante navegador (Chrome, motor V8) con un arnés compatible con la semántica de `node:assert/strict` (contenido de los archivos de test sin reescribir, `debt-calc.js` real cargado tal cual).
- 27 passed.
- 0 failed.

**NO VERIFICADO TODAVÍA:**
- Ejecución real mediante `node --test` / `npm test`. Node.js no está disponible en esta sandbox (comprobado en PATH de Bash y PowerShell, y en las rutas de instalación de WinGet/Scoop/Chocolatey/nvm4w) — no ha sido posible ejecutarlo literalmente, y no quiero dar a entender que `npm test` "pasó" cuando no se ha podido invocar ese comando.

**Por qué esto no bloquea el checkpoint, pero sí bloquea producción**: `debt-calc.js` son funciones puras (sin Firestore, sin DOM, sin `state`), los 27 tests son el contenido real de los archivos de test aprobados, y el runtime que los ejecutó (V8) es el mismo motor que usa Node — no una simulación ni un resumen a mano. Aun así, antes de publicar nada en producción quiero una ejecución real con `node --test` de tu parte (o desde un entorno con Node disponible), porque un arnés que yo mismo he escrito para sustituir a `node:test` es, por definición, una pieza más que podría tener un fallo — de hecho ya encontré uno (ver más abajo) durante este mismo proceso.

**A) Fase 2 sigue completamente verde** — los 7 tests de `test/debt-calc.test.js` pasan, contenido sin modificar respecto a la Fase 2 aprobada.

**B) Fase 3 está completamente verde** — los 20 tests de `test/economic-split.test.js` (B, G, H, I, J, J bis, K, L, M1, M2, N, N bis, O, P, las dos regresiones "legacy 50/50 must preserve aggregate rounding semantics", + los 4 sin letra) pasan.

**C) Ningún test existente fue relajado ni modificado para conseguirlo.** Los únicos cambios a archivos de test en esta ronda fueron **añadir** los dos tests de regresión nuevos (abajo) — ningún test ya aprobado se tocó ni se relajó.

## Ajuste encontrado durante la implementación (no estaba en el diseño aprobado)

El diseño original de `PHASE3_ECONOMIC_SPLIT_DESIGN.md` proponía que el *fallback* 50/50 (para gastos `conjunto` sin `economicSplit`) se resolviera reutilizando `buildSplitFromPercent`/`defaultSplitCents` **por cada gasto individualmente**. Al verificar a mano el requisito de compatibilidad exacta con la Fase 2, encontré un contraejemplo real:

- Dani paga dos gastos legacy sin `economicSplit`: 0,01€ y 0,03€ (ambos con céntimo impar).
- La fórmula **antigua** (`computeDebtHalf`) suma en euros primero (0,01+0,03=0,04), calcula `diff/2 = 0,02`, y redondea **una sola vez** al final → 2 céntimos.
- Repartiendo **cada gasto por separado** con `floor` para la no-pagadora + resto para el pagador (como hace `buildSplitFromPercent`) da: gasto 1 → Dani se lleva 1, Laura 0; gasto 2 → Dani se lleva 2, Laura 1. Coste acumulado de Dani = 3. Pagado por Dani = 4. Balance = 4-3 = **1 céntimo** — distinto del resultado antiguo (2 céntimos).

La causa: redondear por gasto acumula un sesgo que no aparece si se redondea una sola vez al final sobre el conjunto. Esto habría roto silenciosamente la garantía de compatibilidad ("los gastos antiguos... deben seguir produciendo exactamente los mismos balances que antes") en cualquier pareja real con más de un gasto de céntimo impar del mismo pagador — un caso nada raro.

**Corrección aplicada**: `computeBalanceCents()` separa los gastos en dos grupos y los trata de forma distinta:

- **Legacy (sin `economicSplit`)**: se acumula el total pagado por cada persona (`legacyPaid0`, `legacyPaid1`) sin redondear nada gasto a gasto, y se resuelve al final con `(legacyPaid0 - legacyPaid1) / 2` — la misma operación, en el mismo orden, que hacía `computeDebtHalf()`. `defaultSplitCents()`/`buildSplitFromPercent()` **no se usan** en este camino.
- **Explícito (con `economicSplit` ya validado)**: aporta un importe exacto por gasto, sin ambigüedad de redondeo (cada `economicSplit` válido ya suma exactamente su propio importe).
- Solo hay **un** redondeo final (`Math.round`), aplicado a la suma de ambas partes más los settlements — igual que antes, ahora simplemente en céntimos en vez de euros.

`defaultSplitCents()` se mantiene como función aprobada (útil para cuando la app quiera *materializar* un `economicSplit` 50/50 explícito en un documento nuevo), pero ya no interviene en el cálculo del balance para el camino legacy — ese camino replica la fórmula antigua tal cual, sin pasar por céntimos-por-gasto.

Este ajuste no cambia ningún test aprobado — de hecho fue el propio requisito de compatibilidad de la Fase 2 el que lo hizo necesario.

**Confirmación explícita: no se ha intentado "unificar" los dos caminos.** `computeBalanceCents()` mantiene deliberadamente dos rutas separadas — la legacy (acumula y redondea una sola vez al final, igual que `computeDebtHalf()`) y la explícita (céntimos exactos por documento, sin redondeo ambiguo). Compatibilidad antes que elegancia, tal como se pidió — no hay planes de fusionarlas en una sola función más "limpia" si eso vuelve a introducir el sesgo de redondeo del contraejemplo.

### Test de regresión permanente del bug legacy

Añadidos a `test/economic-split.test.js`, etiquetados `legacy 50/50 must preserve aggregate rounding semantics`:

- Dani paga 0,01€ + 0,03€ (dos gastos legacy, sin `economicSplit`) → `computeBalanceCents(...) === 2` (2 céntimos = 0,02€, no 1 céntimo).
- Caso simétrico con Laura pagando → `computeBalanceCents(...) === -2`, para comprobar también el signo.

Ya no dependen solo de la explicación en prosa de este documento — si alguien intenta en el futuro "simplificar" `computeBalanceCents()` volviendo a repartir cada gasto legacy por separado, estos dos tests fallarían inmediatamente.

## Funciones implementadas en `debt-calc.js`

Las 8 aprobadas, sin abstracciones adicionales:

| Función | Resumen |
|---|---|
| `toCents(amountEuros)` | `Math.round(amountEuros * 100)` |
| `fromCents(cents)` | `cents / 100` |
| `buildSplitFromPercent(totalCents, shares, payerEmail)` | 50/50, 60/40, personalizado por %. `null` si `bp` no suman 10000. No-pagador = `floor`, pagador = resto |
| `buildSplitFromAmounts(totalCents, shares)` | Personalizado por importe. `null` si la suma no coincide exacto — nunca corrige |
| `defaultSplitCents(totalCents, payerEmail, otherEmail)` | 50/50 explícito vía `buildSplitFromPercent` — no usado por `computeBalanceCents` (ver ajuste arriba) |
| `validateEconomicSplit(totalCents, split, memberEmails)` | Claves exactas, enteros ≥ 0, suma exacta |
| `validatePayerEmail(payerEmail, memberEmails)` | Pertenece a los miembros o no |
| `computeBalanceCents(expenses, settlements, partners)` | Balance en céntimos. Legacy y explícito por separado (ver ajuste). Lanza `Error` si un gasto tiene `economicSplit` presente pero inválido — nunca hace fallback 50/50 en silencio sobre un dato corrupto |

Todas puras: sin Firestore, sin DOM, sin `state`. `computeDebtHalf`/`debtExpenses`/`round2`/`isDebtExpense` de la Fase 2 quedan exactamente como estaban.

## Comprobación manual con las funciones reales

Ejecutado en el navegador (mismo motor V8), usando `DebtCalc.buildSplitFromPercent` para construir el reparto y `DebtCalc.computeBalanceCents` para el balance — no valores fabricados a mano:

**1. 100€ paga Dani, 50/50** → `economicSplit = {dani: 5000, laura: 5000}` → balance = **5000 céntimos = 50,00€** → Laura debe 50€ a Dani. ✓

**2. 100€ paga Dani, 60/40 Dani/Laura** → `economicSplit = {dani: 6000, laura: 4000}` → balance = **4000 céntimos = 40,00€** → Laura debe 40€ a Dani. ✓

**3. Los dos gastos anteriores juntos** (100€ 50/50 + 100€ 60/40, ambos pagados por Dani) → balance = **9000 céntimos = 90,00€** → Laura debe 90€ a Dani. ✓

Los tres coinciden exactamente con lo esperado.

## Qué falta (fuera de alcance de esta fase, tal como se pidió)

- `app.js` no usa nada de esto todavía — sigue escribiendo/leyendo gastos sin `economicSplit`, y la UX no ha cambiado.
- Ninguna regla de Firestore publicada — la validación de `economicSplit`/`payerEmail` en las reglas sigue siendo solo diseño (`PHASE1_MIO_NUESTRO_Y_PRIVACIDAD.md` / `PHASE3_ECONOMIC_SPLIT_DESIGN.md`).
- No hay reparto habitual de pareja ni nada que lo relacione con la construcción de un `economicSplit` por defecto al crear un gasto — eso es Fase 4/5.
- No se ha migrado ningún dato histórico.

Sin commit. A la espera de decidir el checkpoint antes de la Fase 4.

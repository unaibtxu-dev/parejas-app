# Fase 5 — Integración mínima de `economicSplit` en la app

Checkpoints de partida: `9e19fd03483b2ac2dd084f38e3daec00a0f398b4` (Fase 3) y `37c8780e232466e8d1b33b621ac30b6f9267d384` (Fase 4, comiteado al empezar esta fase). Sin push, sin commit todavía de lo que sigue.

**Corrección aplicada tras revisión (19/08/2026): se añade `splitBp` por gasto.** La primera versión de esta fase reconstruía el porcentaje histórico de un gasto, al editar `amount`, a partir de los céntimos ya guardados en `economicSplit`. Es matemáticamente incorrecto para importes pequeños: `0,01€` repartido 50/50 se materializa como `{pagador:1, otro:0}` — indistinguible de un reparto 100/0. `economicSplit` es el **coste materializado** (lo que hay que cobrar), no la **intención porcentual** (lo que se quiso repartir), y no siempre contiene suficiente información para reconstruir la segunda a partir de la primera. La corrección añade un campo nuevo, `splitBp`, exactamente para eso — ver sección 2 y 7.

---

## 1. Caminos de creación de gastos encontrados

Inspección exhaustiva de `app.js` (todo `.add(` y `batch.set(` sobre `expenses`, más todo caller de `addExpense`/`updateExpense`):

| Camino | Cómo llega a `expenses` | Clasificación |
|---|---|---|
| Formulario principal, crear | `addExpense(payload)` | A (conjunto) o B (individual), según `state.selectedType` |
| Formulario principal, editar | `updateExpense(id, payload)` | C |
| Quick add (`quickAddExpense`) | `addExpense({...})` — mismo `addExpense()` | A o B, según pestaña activa |
| Gasto de viaje dentro de presupuesto (`saveExpenseAsTrip`, parte "trip") | `addExpense(withTripFields(...))` | A (siempre `tripGoalId` puesto, pero `type` sigue siendo lo que el usuario eligió) |
| Gasto de viaje que excede presupuesto (parte "exceso") | `addExpense(withTripFields(...))` | A (`type:"conjunto"` forzado, sin `tripGoalId`) |
| Importación CSV (`confirmImport`) | `batch.set()` directo, **no pasa por `addExpense()`** | A o B, según `importContext.type` (fijo para todo el lote) |

**Total: 2 caminos de código distintos que escriben en `expenses`** (`addExpense()` y el `batch.set()` de `confirmImport()`), con 4 llamadores lógicos de `addExpense()` (formulario, quick add, y las dos partes del gasto de viaje) y 1 de edición (`updateExpense()`, solo desde el formulario — confirmado que no existe ningún otro `.update()` sobre `expenses` en todo el archivo). Los "gastos fijos" (`fixed_expenses`) y la copia de gastos fijos entre espacios NO crean documentos de `expenses` en ningún momento — confirmado, no hay conversión de fijo a gasto real en el código.

**Adaptados**: los 2 caminos de código. Los 4 llamadores de `addExpense()` quedan cubiertos automáticamente al cambiar una sola función — no se ha tocado `quickAddExpense()` ni `saveExpenseAsTrip()`/`withTripFields()`.

---

## 2. Cambios realizados

### `debt-calc.js` (puro, sin Firestore/DOM)

Dos funciones nuevas, exportadas junto a las de Fases 2-3 (`bpFromCents`, de la primera versión de esta fase, se retira — ver sección 7, quedaba sin ningún uso correcto tras la corrección):

- **`resolveDefaultSplitBp(spaceType, memberEmails, defaultSplitBp)`** — el reparto habitual efectivo, exactamente según `PHASE4_DEFAULT_SPLIT_DESIGN.md` (personal o <2 miembros → `null`; válido → se usa; ausente o inválido → 50/50). Reutiliza `validateEconomicSplit(10000, ...)`, sin duplicar validación.
- **`recomputeSplitOnAmountChange(splitBp, memberEmails, newAmountEuros, payerEmail)`** — para la edición de `amount` (sección 7). **Corregida dos veces**: ya no recibe ni mira el `economicSplit`/importe antiguos (recibe directamente el `splitBp` ya guardado). Y **corrección posterior (política final)**: si `splitBp` es `null` o inválido para los miembros actuales, **ya NO hace fallback 50/50** — devuelve `null` y es responsabilidad del caller (`app.js`) bloquear el cambio de importe (caso C, ver sección 7). Con `splitBp` válido, devuelve `{ economicSplit, splitBp }`.

### `app.js`

- `subscribeSpace()`: `state.space` ahora incluye `defaultSplitBp` (del mismo snapshot ya suscrito — sin lectura nueva).
- `subscribeExpenses()`: el mapeo de cada gasto ahora incluye `economicSplit: data.economicSplit || null` **y `splitBp: data.splitBp || null`**. Sin esto, ambos campos se habrían perdido en memoria al releerlos — el mapeo anterior tenía una lista fija que no los incluía (mismo patrón de "campo nuevo descartado en el snapshot" ya detectado en `subscribeSpace()` durante la Fase 4).
- `expenseFields(payload)`: incluye `economicSplit` **y `splitBp`** en el objeto devuelto, cada uno **solo si el payload lo trae explícitamente**. Si no, no los toca — y como `updateExpense()` usa `.update()` (no `.set()`), Firestore deja intactos los campos que no se le pasan. Estos dos `if` son todo el mecanismo que garantiza que editar categoría/nota/fecha/pagador no destruye el reparto ni su intención guardada.
- **`materializeEconomicSplit(amount, payerEmail)`** (nueva): helper central que envuelve `resolveDefaultSplitBp` + `buildSplitFromPercent` con los datos reales de `state.space`. Devuelve `{ economicSplit, splitBp }` — **corregido**: antes devolvía solo el `economicSplit`; ahora también el `splitBp` (el mismo `defaultBp` resuelto) para que quede guardado junto al gasto. La usan `addExpense()` y el import CSV.
- `addExpense(payload)`: si `type === "conjunto"` y no venía ya un `economicSplit` explícito, materializa **ambos campos** con el helper anterior.
- Manejador de envío del formulario: si se edita un gasto que ya tenía `economicSplit` y `amount` cambia, recalcula con `recomputeSplitOnAmountChange(originalExpense.splitBp, state.space.memberEmails, payload.amount, payload.payerEmail)` — **corregido**: ya no se le pasa el importe/split antiguos, se le pasa directamente el `splitBp` guardado (ver sección 7). El resultado escribe tanto `payload.economicSplit` como `payload.splitBp`.
- `computeDebtHalf()` (el wrapper de app.js, no la función homónima de `debt-calc.js`): ahora llama a `DebtCalc.computeBalanceCents(...)` y convierte a euros con `fromCents()`, en vez de llamar a `DebtCalc.computeDebtHalf(...)`. Es el único cambio necesario para que **toda** la UI (panel de Deudas, botón de saldar) use el motor nuevo sin tocar esos sitios. **`computeBalanceCents()` no lee `splitBp` en ningún punto de su implementación** — confirmado, ver sección 7 y el test dedicado en la sección 12.
- `leaveSpace()`: el mismo `update()` que hace `arrayRemove` sobre `memberEmails` ahora incluye `defaultSplitBp: firebase.firestore.FieldValue.delete()`.
- `confirmImport()` (CSV): cada fila con `importContext.type === "conjunto"` llama a `materializeEconomicSplit()` igual que el formulario manual, y guarda ambos campos.
- UX mínima (sección 8 del encargo): `#split-hint` en el formulario, actualizado por `updateSplitHint()`/`splitLabelFromBp()` — muestra "Compartido · 50/50" (o 60/40, o "Personalizado"). **Corregido**: al editar un gasto, ahora lee `original.splitBp` directamente (nunca reconstruye desde `economicSplit`); si el gasto tiene `economicSplit` pero no `splitBp`, la pista se oculta en vez de mostrar un porcentaje que no se puede garantizar. No es el selector visual final, solo texto informativo para poder verificar la integración a simple vista.

### `index.html`

Un único elemento nuevo: `<p id="split-hint" class="field-hint" hidden></p>`, sin CSS nuevo (reutiliza `.field-hint` ya existente).

---

## 3. Integración del default (sección 5 del encargo)

`materializeEconomicSplit()` es la única pieza que traduce "reparto habitual del espacio" a "economicSplit de este gasto concreto", y la usan los 2 caminos de creación por igual. No hay ningún otro sitio que lea `state.space.defaultSplitBp` directamente para construir un gasto.

---

## 4. Integración de `economicSplit` al crear (sección 6)

Confirmado con el smoke test (sección 13): 100€ pagados por Dani con `defaultSplitBp = {Dani:6000, Laura:4000}` produce exactamente `economicSplit: {Dani:6000, Laura:4000}` — en céntimos, tal como pedía el ejemplo del encargo.

---

## 5. Balance (sección 10)

Un solo motor activo: `computeBalanceCents()`. El wrapper `computeDebtHalf()` de `app.js` (usado por `renderDeudasPanel()` y `initSettleUpButton()`, los dos únicos consumidores encontrados) delegaba antes en `DebtCalc.computeDebtHalf()`; ahora delega en `DebtCalc.computeBalanceCents()` + `fromCents()`. `DebtCalc.computeDebtHalf()` sigue existiendo en `debt-calc.js` únicamente como implementación de referencia probada por los tests de Fase 2 — **no se llama desde ningún sitio de `app.js`**, así que no hay dos motores activos en producción, solo uno de referencia sin usar en el código de la app.

---

## 6. Legacy (sección 11) — los tres casos, explícitos

Sin tocar el camino legacy dentro de `computeBalanceCents()` — la separación "gastos sin `economicSplit` se acumulan y se resuelven con `diff/2` al final, gastos con `economicSplit` aportan un valor exacto" viene intacta de la Fase 3. El smoke test de `0,01€+0,03€` (sección 13) confirma que sigue dando 2 céntimos, no 1 — el contraejemplo que motivó esa separación en su momento.

Con `splitBp`, distingo tres casos de edición de `amount` (ver sección 7 para el detalle y los tests):

- **A) Legacy sin `economicSplit` ni `splitBp`**: se sabe que el modelo histórico es 50/50 — no por inferencia, es literalmente cómo `computeBalanceCents()` trata cualquier gasto conjunto sin el campo. `amount` editable libremente: el gasto se queda sin `economicSplit`, y la fórmula de fallback ya calcula el 50/50 sobre el importe vigente en cada momento.
- **B) Con `economicSplit` + `splitBp` válido**: `amount` editable; se recalcula `economicSplit` desde `splitBp`, exacto, sin pasar por `economicSplit` en ningún momento.
- **C) Con `economicSplit` pero sin `splitBp` (ausente o inválido)** — **corregido, ya no es fallback 50/50**: no se infiere, no se rellena con 50/50. Se **bloquea el cambio de `amount`** (campo deshabilitado en la UI desde `openModalForEdit()`, y guardián por si acaso en el envío del formulario) — el resto de campos (categoría, nota, fecha, pagador...) siguen editables con normalidad.

---

## 7. Edición de gasto — política aplicada (sección 9, el punto crítico), corregida

**Error real encontrado en la primera versión de esta fase, confirmado y corregido**: para decidir el nuevo `economicSplit` al cambiar `amount`, la primera versión reconstruía el porcentaje histórico dividiendo los céntimos ya guardados en `economicSplit` entre el importe antiguo (`bpFromCents`). Esto es **matemáticamente incorrecto** en general: `economicSplit` es el coste ya materializado en céntimos enteros, no la intención porcentual original, y para importes pequeños esa distinción es real, no teórica —

> `0,01€` repartido 50/50 se materializa como `economicSplit = {pagador: 1, otro: 0}` — exactamente el mismo resultado que si el reparto hubiera sido 100/0. Reconstruir el porcentaje desde esos céntimos daría "100/0", no "50/50": la información de que en realidad era 50/50 se perdió al redondear a un único céntimo entero, y no hay ninguna forma de recuperarla solo mirando el `1`/`0` guardado.

**Corrección: nuevo campo `splitBp` por gasto.**

```js
{
  amount: 0.01,
  economicSplit: { dani: 1, laura: 0 },   // SOURCE OF TRUTH CONTABLE -- balance e históricos leen solo esto
  splitBp: { dani: 5000, laura: 5000 }     // SOURCE OF TRUTH DE INTENCIÓN -- solo para reconstruir al editar amount
}
```

- **`economicSplit`**: sin cambios de significado — sigue siendo lo único que lee `computeBalanceCents()`. Confirmado con un test dedicado (sección 12): un `splitBp` deliberadamente corrupto en el mismo documento no cambia el balance ni un céntimo.
- **`splitBp`**: nuevo, opcional, en puntos base (mismo formato que `defaultSplitBp` de Fase 4). Se guarda en el momento en que se materializa un `economicSplit` por porcentaje (al crear, o al recalcular por un cambio de `amount`) — es exactamente el `bp` que se usó, sin pasar por ningún redondeo de céntimos. **Nunca participa en `computeBalanceCents()`.**

**¿Es este el modelo mínimo correcto, o hay algo más simple que conserve la intención exacta?** Lo evalué y no encontré una alternativa más simple: cualquier forma de "reconstruir después" a partir de `economicSplit` (vía `amount` antiguo, vía la fracción de céntimos, etc.) tropieza con el mismo problema de fondo — los céntimos de un importe pequeño no tienen suficiente resolución para representar un porcentaje exacto. La única forma de no perder la intención es guardarla en el momento en que se conoce, en una unidad (puntos base) que no dependa del importe. Es un campo más, pero no hay manera de evitarlo sin renunciar a la garantía que se pedía.

**Política aplicada, campo por campo:**

- **Categoría, nota, lugar, fecha, `affectsDebt`**: cosméticos respecto al reparto — `payload` nunca lleva `economicSplit`/`splitBp`, `expenseFields()` no los añade, Firestore no los toca. **Confirmado por lectura de código** (no por test automatizado — ver sección 12): los dos `if` de `expenseFields()` son exactamente ese guardián.
- **`payerEmail`**: cambia libremente, ni `economicSplit` ni `splitBp` se recalculan — el coste de cada persona no cambia, solo cambia quién puso el dinero. El test `P5-H` confirma que, con el mismo `economicSplit`, cambiar el pagador cambia el balance de forma consistente con "el coste no se movió, solo el pagador".
- **`amount`**: política A/B/C, **corregida** (la versión anterior de este documento decía que el caso C hacía fallback 50/50 — era incorrecto, corregido tras revisión, ver más abajo):
  - **A) Sin `economicSplit` (legacy puro)**: `amount` editable libremente. No entra en el bloque de recálculo — se deja tal cual, sin escribir `economicSplit`. `computeBalanceCents()` sigue tratándolo como 50/50 agregado sobre el importe que sea en cada momento, incluido el ya editado (test `P5-I5`) — la semántica correcta sale gratis de la fórmula de fallback, sin necesitar código nuevo.
  - **B) Con `splitBp` presente y válido**: `amount` editable; se aplica tal cual al nuevo importe. Tests `P5-I1`-`P5-I4`: 60/40 escala proporcionalmente (`I1`), y — la comprobación que motivó toda esta corrección — un `economicSplit` de céntimo suelto con residuo (`I2`, `I3`) reconstruye el 50/50 **exacto**, no un porcentaje aproximado, precisamente porque ya no se mira ese `economicSplit` para nada.
  - **C) Con `economicSplit` pero sin `splitBp` válido**: **BLOQUEADO, sin fallback 50/50** — `recomputeSplitOnAmountChange()` devuelve `null` (test `P5-I6`, `P5-I6 bis`), y el manejador de envío detiene el guardado con un aviso si `amount` cambió. Además, `openModalForEdit()` deshabilita `#input-amount` y muestra `#amount-locked-hint` desde que se abre el formulario, para no dejar escribir un importe nuevo que luego se rechazaría — el resto de campos (categoría, nota, fecha, pagador) siguen editables con normalidad. No hay una cuarta categoría de "inferir solo cuando sea inequívoco": decidir cuándo una inferencia sería "inequívoca" necesitaría su propia heurística, y evitar precisamente eso es el motivo de este diseño.
  - Si `payerEmail` **también** cambia en la misma edición: el coste de cada persona (no la etiqueta "pagador") es lo que se conserva — test `P5-Iter` (60% de coste de Dani se mantiene como 60% aunque Dani ya no sea el pagador tras la edición).

**Riesgo señalado, no resuelto en esta fase**: si además del importe/pagador alguien cambia `type` (conjunto↔individual) durante una edición — el formulario actual lo permite, no está bloqueado todavía porque las Rules de la Fase 1 no están publicadas — un `economicSplit`/`splitBp` ya guardados quedarían "colgados" en un gasto que pasó a `individual` (inofensivo para el cálculo, ya que `debtExpenses()` filtra por `type` antes de mirar cualquiera de los dos, pero es un dato residual poco prolijo). No lo resuelvo aquí — fuera del alcance pedido esta fase.

---

## 8. Gasto fijo, viajes y otros — sin caminos adicionales

Confirmado en la sección 1: no existen otros creadores. Trips (`saveExpenseAsTrip`) quedan cubiertos automáticamente por pasar por `addExpense()`, sin ningún cambio propio.

---

## 9. Quick add (sección 15)

Cero cambios en `quickAddExpense()` — sigue llamando a `addExpense({...})` con un payload sin `economicSplit`, y `addExpense()` lo materializa igual que para el formulario manual. Verificado por lectura de código (ver limitación de la sección 12: no hay sesión autenticada disponible en este entorno para probarlo interactivamente).

---

## 10. CSV (sección 15)

`confirmImport()` llama a `materializeEconomicSplit(fields.amount, fields.payerEmail)` por cada fila con `type === "conjunto"` — mismo helper, mismo `state.space.defaultSplitBp`, mismo resultado que tecleado a mano. `payerEmail` es siempre el email de quien importa (sin cambios respecto a antes), y ya está validado como miembro del espacio por construcción (es quien ha iniciado sesión).

---

## 11. `leaveSpace()` (sección 14)

Un único `update()` (sin segunda escritura) con `memberEmails: arrayRemove(email)` y `defaultSplitBp: FieldValue.delete()` juntos — exactamente como se pidió, `FieldValue.delete()`, no `null`.

---

## 12. Tests

**`test/phase5-integration.test.js`** — 15 tests sobre las 2 funciones puras nuevas (`resolveDefaultSplitBp`, `recomputeSplitOnAmountChange` ya corregida), más el uso de `computeBalanceCents`/`toCents` ya existentes. El test que antes daba por buena la reconstrucción incorrecta ("I bis", 3 céntimos repartidos 2/1 interpretados como 66,67/33,33) queda **eliminado**, no solo corregido — la afirmación que hacía era conceptualmente inválida, no un detalle de redondeo a ajustar.

| Caso pedido (bloque 6 del encargo de corrección) | Cubierto por |
|---|---|
| I1) 100€ 60/40, splitBp 6000/4000 → editar a 150€ → economicSplit 9000/6000 | `P5-I1` |
| I2) 0,01€ 50/50, splitBp 5000/5000, economicSplit 1/0 → editar a 100€ → 5000/5000 exacto | `P5-I2` |
| I3) 0,03€ 50/50, splitBp 5000/5000, economicSplit con residuo → editar a 100€ → 5000/5000 exacto | `P5-I3` |
| I4) 0,01€ 60/40, splitBp 6000/4000 → editar a 100€ → 6000/4000 | `P5-I4` |
| I5) legacy sin economicSplit → editar amount → conserva semántica 50/50 | `P5-I5` |
| I6) economicSplit presente, splitBp ausente/inválido → BLOQUEADO, sin fallback 50/50 | `P5-I6`, `P5-I6 bis` |

Más los ya existentes de la ronda anterior (sin cambios de fondo, solo de firma donde aplicaba):

| Caso pedido | Cubierto por |
|---|---|
| A) sin default + 2 miembros → 50/50 | `P5-A` |
| B) 60/40 → economicSplit 6000/4000 | `P5-B` (+ smoke test amount real, sección 13) |
| C) un miembro → sin economicSplit | `P5-C` |
| D) personal → sin economicSplit | `P5-D` |
| E) default inválido → fallback 50/50 | `P5-E` |
| F) cambio de default después → gasto ya creado no cambia | `P5-F` |
| G) editar categoría/nota → economicSplit/splitBp intactos | No cubierto por test automático — guardián de dos líneas en `expenseFields()`, sin lógica de cálculo; verificado por lectura de código, ver sección 7 |
| H) cambiar payerEmail → economicSplit intacto, pagador cambia | `P5-H` |
| J) quick add usa el mismo default | Verificado por lectura de código (sección 9) — no ejecutable sin sesión autenticada real |
| K) CSV conjunto usa el mismo default | Verificado por lectura de código (sección 10) — mismo motivo |
| L) legacy sigue dando el balance anterior | Ya cubierto por los tests de Fase 2/3, sin cambios en esta fase |
| M) `leaveSpace()` elimina `defaultSplitBp` | Verificado por lectura de código — no ejecutable sin Firestore real |

Añadido, punto 7 del encargo de corrección — **`computeBalanceCents()` nunca lee `splitBp`, ni siquiera corrupto**:

| Caso | Cubierto por |
|---|---|
| `economicSplit` válido + `splitBp` deliberadamente corrupto (suma negativa, fuera de rango) en el mismo documento → el balance sale igual que sin ese `splitBp` | `P5-corrupt-splitBp-ignored` |

### Resultado de la ejecución

**VERIFICADO**: 42 tests (7 de `debt-calc.test.js` + 20 de `economic-split.test.js` + 15 de `phase5-integration.test.js`) ejecutados en el navegador real (Chrome, motor V8) con el mismo arnés compatible con `node:assert/strict` de las fases anteriores, cargando el `debt-calc.js` real del directorio. **42 passed, 0 failed.**

De paso, esta ronda encontró y corrigió un error real en mi propio test `P5-I5` (esperaba `75` en vez de `7500` — confundí euros con céntimos en la aserción, no en el motor). Lo dejo anotado por la misma razón que documento todo lo demás: una verificación que no se explica a sí misma no vale más que no verificar.

**NO VERIFICADO TODAVÍA**: `node --test` / `npm test` real. Se intentó explícitamente al empezar esta fase (`npm test` → `bash: npm: command not found`, código de salida 127). Node sigue sin estar disponible en esta sandbox. Esto no bloquea el checkpoint de esta fase (funciones puras, tests reales ejecutados, mismo motor V8 que usaría Node), pero sigue siendo bloqueante antes de producción, como en las fases anteriores.

**Sin verificación end-to-end con Firestore real**: no hay sesión de Firebase autenticada disponible en este entorno (`window.__devLogin()` falló con `auth/operation-not-allowed` — el proyecto solo tiene habilitado el inicio de sesión con Google, no email/contraseña — y no voy a iniciar sesión yo mismo con Google, por la misma razón que en fases anteriores). Los puntos G, H, J, K, M de la tabla de arriba están verificados por lectura de código, no por ejecución real contra Firestore.

---

## 13. Smoke tests (con las funciones reales, en el navegador)

| Caso | Resultado |
|---|---|
| 100€ Dani, 50/50 | balance = 5000 céntimos = **50,00€** |
| 100€ Dani, 60/40 | balance = 4000 céntimos = **40,00€** |
| Ambos juntos | balance = 9000 céntimos = **90,00€** |
| + settlement de 90€ de Laura a Dani | balance = **0** |
| Legacy: Dani paga 0,01€ + 0,03€ | balance = 2 céntimos = **0,02€** (no 1 céntimo — confirma que la corrección de la Fase 3 sigue vigente) |

---

## `splitMode` (Fase 3) — ¿sigue justificándose? (punto 8 del encargo de corrección)

`splitMode` (50_50/60_40/custom, campo cosmético en `expenses`, diseñado en Fase 3) **nunca se llegó a escribir en el código real de esta fase** — ni `materializeEconomicSplit()` ni el recálculo por cambio de `amount` lo asignan en ningún momento; sigue siendo solo una entrada en el diseño aprobado, no un campo que la app produzca hoy.

Ahora que existe `splitBp`, `splitMode` es **redundante para el mismo propósito que ya cumplía `defaultSplitMode` antes de eliminarse en la Fase 4**: `splitBp` contiene el porcentaje exacto, y `splitLabelFromBp()` (ya escrita para el default del espacio, sección 2) puede derivar "50/50"/"60/40"/"Personalizado" directamente de `splitBp` sin necesitar una etiqueta guardada aparte — exactamente el mismo razonamiento que llevó a quitar `defaultSplitMode`.

**No lo elimino del diseño de Fase 3** — es una decisión de más alcance que esta corrección puntual, y como no se ha implementado nunca, no hay ningún dato real ni código que dependa de él para revertir. Mi conclusión, para que la decidáis cuando toque: `splitMode` ya no parece necesario ni para gastos ni para el default (ambos casos se resuelven con la representación en `bp` que ya se guarda), y si se confirma, lo más simple sería no llegar a implementarlo nunca en vez de añadirlo ahora y quitarlo después.

## Riesgos

1. ~~`type` editable durante una edición~~ — **corregido**: `type-field` se oculta en `openModalForEdit()` (vía `updateSoloFieldsVisibility()`, ahora también condicionada a `state.editingExpenseId`). Alinea la UI con la inmutabilidad de `type` ya diseñada para las Rules de Fase 1 (aún sin publicar). Crear un gasto nuevo sigue permitiendo elegir con las reglas de siempre.
2. **Sin verificación end-to-end real** (sección 12) — todo lo que depende de DOM/Firestore está verificado por lectura de código, no por ejecución. El riesgo de que algo se comporte distinto de lo documentado en un navegador real con sesión de verdad no puede descartarse solo con esto.
3. **`node --test` sigue sin ejecutarse literalmente** — mismo riesgo que en fases anteriores, bloqueante antes de producción.
4. ~~La desviación de hasta 1 punto base al recalcular `amount` sobre un reparto histórico no-redondo~~ — **retirado, era una consecuencia del error corregido en esta ronda, no un límite real del modelo actual**: con `splitBp` como fuente de verdad de la intención, la reconstrucción al editar `amount` es siempre exacta (tests `P5-I1`-`P5-I4`), no aproximada.
5. ~~Caso C resuelto con 50/50~~ — **corregido**: caso C ahora bloquea el cambio de `amount` en vez de rellenar con 50/50 (política final, ver sección 7). El coste residual es de UX (hay que borrar y crear de nuevo para corregir el importe de un gasto en ese estado), no de corrección de datos.

## Cosas no implementadas (fuera de alcance, confirmado)

Selector visual final de reparto, pantalla completa de configuración del default, CSS avanzado, animaciones, onboarding, reorganización de campos del formulario, publicación de Firestore Rules, migración de documentos, edición de datos reales, eliminación de `splitMode` del diseño de Fase 3 (analizado, no decidido). El bloqueo de `type` al editar y el bloqueo de `amount` en el caso C (antes en esta lista como riesgos) quedan corregidos, ver secciones 7 y "Riesgos".

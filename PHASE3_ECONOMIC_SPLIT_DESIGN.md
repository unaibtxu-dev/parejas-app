# Fase 3 — Diseño de `economicSplit` (paidBy ya es `payerEmail`)

Solo diseño. No se ha tocado `debt-calc.js`, `app.js` ni ninguna regla de Firestore. Los tests nuevos (`test/economic-split.test.js`) están escritos y son intencionadamente **rojos** — llaman a funciones que todavía no existen, como espec ejecutable del diseño. Cuando se apruebe, programar significa hacer que esos tests pasen sin tocar los que ya están verdes.

**Arquitectura general aprobada** (revisión 19/08/2026): `payerEmail` como única fuente de quién pagó, `economicSplit` en céntimos enteros persistido por gasto, `splitMode` no autoritativo, fallback legacy 50/50, balance = pagado − coste económico, settlements en céntimos, `affectsDebt` se comprueba antes del reparto, sin migración histórica. Esta revisión corrige 8 puntos concretos sobre esa base, detallados abajo.

Confirmo la decisión de nomenclatura: no hay `paidBy`. `payerEmail` sigue siendo el único campo de "quién pagó", igual que hoy. Lo único nuevo es `economicSplit` (y, opcionalmente, `splitMode` como etiqueta).

---

## 1-5. Estructura de `economicSplit`, `splitMode`, y los tres modos

```js
{
  // Sin cambios — sigue siendo "quién puso el dinero". Debe pertenecer a
  // space.memberEmails (punto 5, nuevo).
  payerEmail: "dani@...",
  amount: 100,          // sin cambios, euros, float, como hoy.

  // Nuevo, aditivo. Solo puede existir si type === "conjunto" (punto 6).
  economicSplit: {
    "dani@...":  6000,   // céntimos, entero. SIEMPRE céntimos, nunca euros.
    "laura@...": 4000
  },
  splitMode: "60_40"      // opcional, string de un enum cerrado (punto 7). NO se usa en ningún cálculo.
}
```

**¿Por qué céntimos enteros y no euros con decimales dentro de `economicSplit`?** Porque el problema real que querías evitar (`amount * 0.333333` y corregir errores después) ocurre en la operación de repartir un importe por porcentaje, no en el almacenamiento en sí. Guardar directamente el resultado ya trabajado en céntimos enteros hace que ese documento sea, para siempre, una afirmación exacta ("a Dani le tocan 6000 céntimos") en vez de un número de coma flotante que alguien tiene que volver a redondear cada vez que se lee.

**`splitMode` persistido, pero cosmético**: el cálculo del balance (punto 7 original, sin cambios en esta revisión) nunca lee `splitMode`, solo `economicSplit`. Sirve solo para que, al editar un gasto ya guardado, el formulario reabra el selector correcto sin adivinarlo.

### Corrección del punto 2 original — la regla del "resto" NO corrige decisiones económicas inválidas

La versión anterior de este diseño tenía una única función `buildEconomicSplit` que siempre completaba la última parte con el resto. Confirmas correctamente que eso, aplicado a una entrada por importes (no por porcentaje), esconde errores reales: si alguien teclea "Dani 70€, Laura 40€" sobre un gasto de 100€, la suma (110€) no cuadra, y "arreglarlo" convirtiendo a 70/30 en silencio sustituye una decisión económica que la persona nunca tomó. Separo la construcción en **dos funciones con reglas de validación distintas**, en vez de una sola con una regla ambigua:

#### a) Reparto por porcentaje (cubre 50/50, 60/40 y "personalizado por porcentaje")

```js
// shares: [{email, bp}, {email, bp}] — bp = puntos base, 10000 = 100% (punto 3).
// payerEmail: a quién se le asigna el resto (punto 4).
// Devuelve null si los porcentajes no suman exactamente 100% — NO se
// "arregla" nunca ese caso, se rechaza.
function buildSplitFromPercent(totalCents, shares, payerEmail) {
  var sumBp = shares.reduce(function (s, x) { return s + x.bp; }, 0);
  if (sumBp !== 10000) return null;               // rechazado: no suman 100%

  var payerShare = shares.filter(function (s) { return s.email === payerEmail; })[0];
  if (!payerShare) return null;                    // el pagador no está entre las partes

  var result = {}, otherTotal = 0;
  shares.forEach(function (s) {
    if (s.email === payerEmail) return;
    // SIEMPRE floor, nunca round, para la parte que NO es el pagador —
    // ver la corrección del punto 4 más abajo.
    var cents = Math.floor(totalCents * s.bp / 10000);
    result[s.email] = cents;
    otherTotal += cents;
  });
  result[payerEmail] = totalCents - otherTotal;     // el resto es SOLO residuo de redondeo, nunca de un error de entrada
  return result;
}
```

Aquí sí se usa "la parte del pagador = resto", pero fíjate en qué momento: **después** de comprobar que los porcentajes ya suman exactamente 100%. El resto que se resuelve ahí es exclusivamente el residuo de convertir un porcentaje (que ya es válido) a céntimos enteros — nunca el residuo de una entrada económica que no cuadraba.

#### b) Reparto por importe (custom, tecleando euros directamente)

```js
// shares: [{email, cents}, ...] ya convertidos a céntimos tal cual los
// escribió la persona. Sin ninguna corrección: si no suman el total
// exacto, se rechaza — es un error real, no un redondeo que arreglar.
function buildSplitFromAmounts(totalCents, shares) {
  var sum = shares.reduce(function (s, x) { return s + x.cents; }, 0);
  if (sum !== totalCents) return null;
  var result = {};
  shares.forEach(function (s) { result[s.email] = s.cents; });
  return result;
}
```

Ejemplo exacto de tu mensaje: `buildSplitFromAmounts(10000, [{Dani, 7000}, {Laura, 4000}])` → suma 11000 ≠ 10000 → `null`. No se transforma en 70/30. Se rechaza y la interfaz debe pedir que se corrija a mano.

### Corrección del punto 4 — el céntimo impar depende del pagador, no de la posición en el array

Detecté el error al recalcular tu caso M1 a mano: con `Math.round` para la parte que no es el pagador, un reparto 50/50 de 1 céntimo daba el céntimo a la persona equivocada (`Math.round(0.5)` redondea hacia arriba en JS, así que la "otra persona" se quedaba con el céntimo en vez del pagador). La regla correcta es: **la parte que NO es el pagador se calcula siempre con `Math.floor` (redondeo hacia abajo, nunca hacia arriba), y el pagador se lleva exactamente lo que sobra.** Así el pagador nunca puede llevarse *menos* de su porcentaje nominal (como mucho más, nunca menos), y el céntimo impar cae de su lado siempre, sea `PARTNERS[0]` o `PARTNERS[1]`. Ver los tests M1/M2 para la comprobación exacta.

### 3. Puntos base en vez de floats — ¿hay algo más simple?

Ya está en el código de arriba: `bp` entero, `10000 = 100%`. No veo una alternativa que sea *más* simple y conserve exactitud — cualquier representación con decimales (`0.6`, `60.00`) vuelve a depender de coma flotante en algún punto de la conversión, que es justo lo que se quiere evitar. Lo que sí simplifiqué respecto al borrador anterior no es la representación del porcentaje, sino separar la construcción en dos funciones con una sola responsabilidad cada una (arriba) — la complejidad que había antes no estaba en los puntos base, estaba en una función que intentaba servir para dos casos con reglas de validación distintas a la vez.

## 6. `economicSplit` en `individual` — no debe existir, no solo "ignorarse"

```
function validEconomicSplit(data, space) {
  return data.type == "individual"
    ? !("economicSplit" in data)
    : (
        !("economicSplit" in data) ||
        (
          space.memberEmails.size() == 2 &&
          data.economicSplit.size() == 2 &&
          data.economicSplit.get(space.memberEmails[0], -1) is int &&
          data.economicSplit.get(space.memberEmails[1], -1) is int &&
          data.economicSplit.get(space.memberEmails[0], -1) >= 0 &&
          data.economicSplit.get(space.memberEmails[1], -1) >= 0 &&
          data.economicSplit.get(space.memberEmails[0], 0)
            + data.economicSplit.get(space.memberEmails[1], 0)
            == math.round(data.amount * 100)
        )
      );
}
```

- `type == "individual"` → el campo **no puede existir** en el documento, ni vacío ni con cualquier valor. Un intento de `create`/`update` que incluya `economicSplit` en un gasto individual se rechaza entero.
- `type == "conjunto"` → si el campo no existe, se acepta igual (legacy o gasto nuevo que todavía no lo usa — ver punto 6 original: fallback 50/50). Si existe, tiene que ser válido con las reglas de siempre.

En el motor puro (`debt-calc.js`) esta distinción no hace falta reforzarla en tiempo de lectura: `debtExpenses()` ya filtra por `type === "conjunto"` antes de que `economicSplit` se llegue a mirar, así que un `individual` con `economicSplit` (si alguna vez existiera, cosa que la regla de arriba impide desde ahora) sería simplemente ignorado por el cálculo — la razón para bloquearlo en la regla es higiene del modelo de datos, no una necesidad del cálculo.

## 7. `splitMode` — validado como enum cerrado

Confirmado: nunca participa en cálculos, `economicSplit` es siempre autoritativo. Añado que, si el campo existe, debe ser uno de los tres valores admitidos — ni un string cualquiera:

```
function validSplitMode(data) {
  return !("splitMode" in data) ||
    data.splitMode in ["50_50", "60_40", "custom"];
}
```

**Sobre `equal`/`ratio`/`custom` para el futuro**: creo que es una idea razonable *cuando* existan más presets que 50/50 y 60/40 (por ejemplo 70/30), porque con el esquema actual cada preset nuevo necesita su propio string (`"70_30"`, `"55_45"`...) mientras que `"ratio"` genérico + los propios números de `economicSplit` no necesitarían crecer nunca. Pero cambiar el nombre ahora tocaría también el copy de la Decisión 5 ("Nuestro · 50/50") y el diseño del selector de la Fase 5, sin necesidad real todavía (solo hay dos presets). Lo dejo anotado para cuando se diseñe el selector de verdad, no lo aplico en esta fase.

## 8. `math.round` en Firestore Rules — confirmado, sin tolerancia

Con la confirmación de que `math.round()`, `Map.get()`, `Map.size()` y `Map.keys()` existen en el lenguaje de reglas, la comparación de suma es exacta, sin margen de tolerancia — ya reflejado en la función de la sección 6 (`== math.round(data.amount * 100)`, no una resta con umbral). Retiro la reserva que había puesto en el borrador anterior sobre una posible comparación con tolerancia — no hace falta.

## 5. Validación de `payerEmail`

`payerEmail` entra directamente en `computeBalanceCents` (aporta al lado "pagado" del balance), así que es tan de integridad económica como `economicSplit`. Añadido a las reglas de `expenses` ya definidas en la Fase 1 (`canCreateExpense`/`canUpdateExpense`, ver `PHASE1_MIO_NUESTRO_Y_PRIVACIDAD.md`, secciones 5.3/5.4/5.7, ya actualizadas con `data.payerEmail in space.memberEmails` / `newData.payerEmail in space.memberEmails`) — no lo repito aquí para no tener dos copias de la misma regla que puedan desincronizarse; lo consistente es un único sitio de verdad para las reglas de `expenses`, y ese es el documento de la Fase 1.

**Por qué `computeBalanceCents` no necesita blindarse él mismo contra un `payerEmail` ajeno**: el patrón de esta app es que las reglas de Firestore son el guardarraíl de escritura, y las funciones de cálculo confían en que lo que ya está escrito pasó ese guardarraíl — es el mismo patrón que ya usa todo lo demás (nada en `debt-calc.js` revalida `spaceId` o `uid` tampoco). Si añadiéramos una comprobación redundante dentro de `computeBalanceCents`, sería una segunda copia de la misma regla con su propio riesgo de desincronizarse — prefiero un único punto de verdad (la regla de Firestore + su espejo testeable `validatePayerEmail`, ver más abajo) que dos.

---

## Funciones nuevas propuestas (todas en `debt-calc.js`, ninguna implementada todavía)

| Función | Para qué |
|---|---|
| `toCents(amountEuros)` | `Math.round(amountEuros * 100)` — el único punto de conversión euros→céntimos |
| `fromCents(cents)` | `cents / 100` — el único punto de conversión céntimos→euros, solo para mostrar |
| `buildSplitFromPercent(totalCents, shares, payerEmail)` | 50/50, 60/40 y personalizado-por-porcentaje. Rechaza (`null`) si los `bp` no suman 10000. La parte del pagador siempre es el resto — ver corrección del punto 4 |
| `buildSplitFromAmounts(totalCents, shares)` | Personalizado por importe exacto. Rechaza (`null`) si la suma no coincide con el total — nunca corrige |
| `defaultSplitCents(totalCents, payerEmail, otherEmail)` | Fallback legacy 50/50 (punto 6 original) — internamente es `buildSplitFromPercent(totalCents, [{payerEmail,5000},{otherEmail,5000}], payerEmail)` |
| `validateEconomicSplit(totalCents, split, memberEmails)` | Espejo testeable de la validación de la sección 6 de este documento — claves, enteros no negativos, suma exacta |
| `validatePayerEmail(payerEmail, memberEmails)` | Espejo testeable de la validación del punto 5 |
| `computeBalanceCents(expenses, settlements, partners)` | Sustituye a `computeDebtHalf` (mismo resultado cuando no hay `economicSplit` en ningún gasto) |

**Propuesta de migración de nombres**: actualizar `computeDebtHalf`/`debtExpenses` en el propio sitio en vez de mantener dos funciones paralelas — sigue pendiente de confirmar cuando se apruebe esta fase, no se hace todavía.

---

## Tests de Fase 3 — ya escritos, en rojo

[test/economic-split.test.js](parejas-app/test/economic-split.test.js) — llama a funciones que **no existen todavía** en `debt-calc.js`. Al ejecutar `npm test` ahora mismo, este archivo debería fallar entero con errores del tipo "no es una función" — es la señal correcta de "diseñado pero no implementado". Los tests de `test/debt-calc.test.js` (Fase 2) siguen intactos y en verde.

Lista completa, con la corrección de H y las adiciones N/O/P:

- **B** — 60/40, `computeBalanceCents` da el balance correcto.
- **G** — repartos por porcentaje, la suma siempre coincide con el total exacto, con varios importes "problemáticos".
- **H** (corregido) — coexistencia de un histórico 50/50 (+5000) y un gasto nuevo 60/40 (+4000) sobre el mismo importe pagado por la misma persona: cada documento conserva su propio reparto, y juntos suman +9000. Ya no es la misma llamada repetida dos veces.
- **I** — suma de `economicSplit` que no coincide con el importe → inválido.
- **J** / **J bis** — miembro ajeno al espacio (inválido) / split correcto con los dos miembros reales (válido).
- **K** — settlement que compensa un balance con `economicSplit` explícito.
- **L** — `affectsDebt: false` con `economicSplit` presente no cambia el balance (0).
- **M1** / **M2** — el céntimo impar de un reparto 50/50 de 1 céntimo lo recibe siempre el pagador, sea `Dani` o `Laura` quien pague.
- **N** / **N bis** — `payerEmail` ajeno al espacio (inválido) / `payerEmail` que sí pertenece (válido).
- **O** — valor negativo en `economicSplit` → inválido.
- **P** — valor decimal (no entero) en `economicSplit` → inválido.

Más dos tests sin letra, pedidos explícitamente en el punto 2 de tu revisión, para dejar demostrado el caso concreto que describes (70€+40€ sobre un gasto de 100€):
- `buildSplitFromAmounts` rechaza importes que no suman el total exacto (tu ejemplo literal).
- `buildSplitFromPercent` rechaza porcentajes que no suman 100%, y por separado, un caso de porcentajes válidos (55/45) donde solo se resuelve el residuo de redondeo, no un error de entrada.

No lo he podido ejecutar en este entorno (Node no está en el PATH de esta sandbox) — cuando lo corras, espero ver la Fase 2 en verde y la Fase 3 entera en rojo. Si algo de la Fase 2 también sale en rojo, algo se ha roto y hay que avisar antes de seguir.

Cuando apruebes este diseño, la Fase 3 "programarlo" consiste en añadir las ocho funciones de la tabla a `debt-calc.js` y ver los tests de `economic-split.test.js` pasar a verde sin tocar los de Fase 2.

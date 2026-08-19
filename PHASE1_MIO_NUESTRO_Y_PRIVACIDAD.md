# Fase 1 — Propuesta: modelo MÍO/NUESTRO + corrección de privacidad

Solo propuesta. No se ha modificado `app.js`, `index.html` ni `firestore.rules.txt`, ni se ha publicado nada en Firebase. Evidencia verificada contra el código real (`git log`, `grep`, lectura de líneas concretas) — donde no he podido verificar algo con certeza, lo digo explícitamente.

---

## 1. Modelo MÍO/NUESTRO — ¿rompe algo existente?

Catalogué **todos** los puntos donde el código distingue `type === "individual"` (7 sitios en `app.js`). Con "dejar de ofrecer individual como opción normal dentro de un espacio pareja", esto es lo que cambia:

| Sitio | Qué hace hoy | Qué pasa si ya no se crean "individual" nuevos en espacios pareja |
|---|---|---|
| Selector `TYPES` en el formulario ([app.js:19-22](parejas-app/app.js:19)) | Muestra "Conjunto"/"Individual" al añadir gasto, solo visible en espacios pareja (`isPersonalSpace()` lo oculta ya hoy) | Se quita el selector; el tipo pasa a ser siempre `"conjunto"` en un espacio pareja, siempre `"individual"` en un espacio personal (esto último ya es así hoy, sin cambios) |
| `personalCategoryAverages()` / `personalExpensesOfMonthOffset()` — **Plan financiero** ([app.js:2593-2596](parejas-app/app.js:2593)) | Calcula medias de gasto personal filtrando `type === "individual"` dentro del espacio **actualmente abierto** | **Se queda sin datos nuevos si se usa desde un espacio pareja**, porque ya no se crearán gastos individuales ahí. Ya está previsto ocultar Plan Financiero en la Fase 7 (decisión 8), así que el impacto práctico es bajo, pero lo marco porque es una rotura real, no cosmética. Si en el futuro se reactiva esta función, habría que leer del espacio **personal** de esa persona, no del espacio pareja abierto. |
| Fila de presupuestos por persona — `individualSpent` ([app.js:3153](parejas-app/app.js:3153)) | Dentro de un espacio pareja, suma `conjunto + individual` de cada persona para calcular "cuánto llevas gastado de tu presupuesto" | El término `individualSpent` pasa a ser siempre 0 para gasto nuevo (ya no hay individual ahí). El presupuesto de un espacio pareja pasará a reflejar solo lo compartido — es un cambio de significado, no una rotura técnica. Los presupuestos del espacio **personal** siguen funcionando igual que hoy (son documentos aparte, `budgets` está filtrado por `spaceId`, confirmado en [app.js:958](parejas-app/app.js:958)). |
| Ocultar la fila del otro miembro en "Mío" — `visiblePartners` ([app.js:3146-3148](parejas-app/app.js:3146)) | Parche de privacidad en el cliente para la sub-pestaña "Mío" dentro de un espacio pareja | Se queda sin uso — si ya no existe la sub-pestaña "Mío" dentro del espacio pareja, este código es simplemente código muerto a partir de ahora (no hace falta borrarlo ahora, solo dejará de ejecutarse con datos nuevos) |
| Import CSV — tipo por defecto ([app.js:3524-3528](parejas-app/app.js:3524)) | Al importar en un espacio pareja, pregunta si el lote es conjunto o individual | Se quita esa opción cuando el espacio es pareja: el lote importado en un espacio pareja siempre será `"conjunto"`; en un espacio personal, sigue siendo siempre `"individual"` como hoy |
| Valor por defecto al abrir el formulario — `state.selectedType` ([app.js:4146](parejas-app/app.js:4146)) | `isPersonalSpace() ? "individual" : currentExpenseType()` | Pasa a ser simplemente `isPersonalSpace() ? "individual" : "conjunto"`, sin depender de `state.mainTab` |

**Conclusión**: no hay ninguna rotura crítica. Lo único con impacto real es el Plan Financiero (que ya vais a ocultar en la Fase 7) y el significado de "gasto llevado" en presupuestos de espacios pareja (cambia de "todo lo tuyo relacionado con este espacio" a "lo compartido"; los presupuestos personales no se tocan porque ya viven en su propio espacio). Todo lo demás es simplificación de UI sin efectos secundarios.

**Lo que no toca esta decisión**: los datos históricos (`type: "individual"` ya guardados dentro de espacios pareja) siguen ahí, se siguen leyendo y contando para presupuestos/plan financiero como hasta ahora — solo deja de crearse **nuevo** contenido de ese tipo en espacios pareja. Coherente con "NO migrar ni borrar datos históricos todavía".

---

## 2. Privacidad — por qué "esconder por regla" no basta, y qué hacer en su lugar

Tienes razón al desconfiar de una regla que diga simplemente "si es individual, solo el propietario puede leerlo": **Firestore no filtra documentos sueltos dentro de una consulta con múltiples resultados.** Para una consulta (`.where(...).onSnapshot(...)`, no un `.doc(id).get()` suelto), Firestore necesita poder demostrar, solo mirando los filtros de la propia consulta, que **todos** los documentos que podría llegar a devolver cumplen la regla. Si la regla depende de un campo (`type`, `email`) que la consulta no está filtrando explícitamente con ese mismo campo, Firestore no puede demostrarlo — y en ese caso rechaza la consulta **entera** con `permission-denied`, no se pone a devolver "los que sí puedes ver".

Esto significa que si solo cambiara la regla sin tocar nada más, la consulta actual:

```js
db.collection("expenses").where("spaceId", "==", spaceId).limit(500).onSnapshot(...)
```

(la de [app.js:885-888](parejas-app/app.js:885)) **dejaría de funcionar por completo** para cualquier miembro de un espacio pareja que tenga gastos individuales del otro mezclados en ese `spaceId` — el listener entero fallaría con error de permisos, rompiendo la vista de gastos, no solo ocultando lo privado.

### La solución: dos consultas que reflejan exactamente la regla

En vez de una consulta que pide "todo el espacio" y confía en que la regla la recorte, se hacen **dos consultas**, cada una con un filtro que la regla puede verificar directamente:

```js
// 1) Todo lo compartido del espacio — cualquier miembro puede leerlo.
db.collection("expenses")
  .where("spaceId", "==", spaceId)
  .where("type", "!=", "individual")
  .onSnapshot(sharedHandler);

// 2) Tus propios gastos individuales (incluye los legacy dentro de un espacio
//    pareja, y TODOS los de un espacio personal, ya que ahí el único miembro
//    eres tú).
db.collection("expenses")
  .where("spaceId", "==", spaceId)
  .where("type", "==", "individual")
  .where("uid", "==", state.user.uid)
  .onSnapshot(mineHandler);
```

y el código de la app fusiona los resultados de ambas en el mismo `state.allExpenses` que usa hoy (mismo `.map()`, mismo `.sort()` por fecha) — el resto de la aplicación (cálculo de deuda, presupuestos, calendario, CSV, etc.) no necesita saber que ahora son dos listeners en lugar de uno, porque consumen `state.allExpenses` igual que ahora.

Con esto, la regla de Firestore puede verificar exactamente lo que cada consulta promete, sin adivinar:

```
match /expenses/{docId} {
  allow read: if canAccessDoc() &&
    (resource.data.type != "individual" || resource.data.uid == request.auth.uid);
  allow update, delete: if canAccessDoc() &&
    (resource.data.type != "individual" || resource.data.uid == request.auth.uid);
  allow create: if canCreateDoc() &&
    request.resource.data.uid == request.auth.uid;
}
```

Esto cubre lectura, edición y borrado por igual — no solo lectura. Hoy, cualquier miembro puede editar o borrar el gasto individual del otro sin ni siquiera leerlo primero; eso es tan parte del fallo de privacidad como la lectura, así que lo incluyo aunque tu mensaje mencionaba explícitamente solo "leerlo".

También añado `request.resource.data.uid == request.auth.uid` en `create`: hoy la regla no comprueba que el campo `uid` que se escribe sea realmente el tuyo (nadie lo ha explotado, pero es la puerta que dejaría inútil el propio arreglo de privacidad si alguien pudiera crear un documento con el `uid` de otra persona). Es aditivo, no cambia ningún flujo actual, porque la app ya escribe siempre `uid: state.user.uid` — nunca ha escrito el uid de otra persona en ese campo.

### Coste técnico de las dos consultas

- Requiere un **índice compuesto** para cada una (`spaceId` + `type` en la primera, `spaceId` + `type` + `uid` en la segunda). Se configuran en `firestore.indexes.json` y se despliegan junto con las reglas — no llevan secretos, pero sí es un cambio de configuración de Firebase, así que lo dejo para cuando confirmes que quieres publicar (Fase 8), igual que las reglas.
- Duplica el número de listeners de gastos por espacio (de 1 a 2). A la escala actual (dos personas, un espacio abierto a la vez) es irrelevante para el coste — mismo orden de magnitud que los demás listeners ya existentes (sección 11 de la auditoría).
- En un espacio **personal**, la primera consulta (compartido) devolverá siempre 0 documentos (nunca hay gasto `"conjunto"` en un espacio personal) — es un listener que no aporta nada ahí, pero tampoco cuesta nada relevante mantenerlo activo solo por uniformidad de código; si prefieres, se puede activar solo la consulta 2 cuando `state.space.type === "personal"`, y ambas cuando es `"pareja"`. Lo dejo como decisión de implementación para la Fase 1 real (cuando toquemos código), no hace falta decidirlo ahora.

### Por qué `uid` y no `email` para la condición de privacidad

Comprobé en el historial de git (`git log -S"fields.uid" -- app.js`) que el campo `uid` se guarda en **todos** los gastos desde el primer commit (`48262ba`, "Primera versión") — incluido el import de CSV ([app.js:3666](parejas-app/app.js:3666)). Es decir, **no hace falta ningún backfill ni migración**: todo documento de gasto que existe hoy, sin excepción, ya tiene el campo `uid` correctamente relleno con la identidad real de quien lo creó.

Uso `uid` en vez de `email` en la regla por lo que pides comprobar en la decisión 3 — ver el análisis completo abajo — pero en resumen: `uid` es el identificador estable de Firebase Auth, nunca lo escribe el cliente de forma libre (siempre coincide con la sesión autenticada), y ya está disponible sin coste de migración. `email` también funcionaría (también está en todos los documentos desde el principio), pero `uid` es la opción más robusta sin ningún coste adicional, así que no hay motivo para no usarlo aquí.

### Estrategia legacy para gastos "individual" dentro de espacios pareja

No hace falta ninguna estrategia especial más allá de la regla de arriba: un gasto legacy `type: "individual"` dentro de un espacio pareja, sea de cuando sea, ya tiene su `uid` correctamente puesto a quien lo creó. La regla `resource.data.uid == request.auth.uid` protege automáticamente todos los históricos sin distinguir "viejo" de "nuevo" — el mismo mecanismo cubre ambos casos porque el dato necesario siempre ha estado ahí.

El único matiz que quiero que decidas explícitamente (ya lo señalé en la auditoría, sección 4): un gasto individual legacy puede tener `payerEmail` de la otra persona (si alguien registró "pagó mi pareja, pero es gasto mío personal"). La regla de privacidad que propongo protege por **quién lo creó** (`uid`/`email` del que pulsó guardar), no por quién pagó. Creo que es la interpretación correcta — lo que se quiere ocultar es de quién es el gasto personal, no quién puso el dinero — pero quiero que lo confirmes antes de considerarlo cerrado.

---

## 3. Queries y listeners que hay que tocar (cuando implementemos, no ahora)

Solo dos puntos en todo `app.js`:

1. **`subscribeExpenses()`** ([app.js:884-916](parejas-app/app.js:884)) — sustituir la única consulta por las dos descritas arriba, fusionando resultados antes de `render()`.
2. **Ningún otro listener necesita cambios.** Repasé los 8 restantes (`budgets`, `fixed_expenses`, `settlements`, `profiles`, `loans`, `goals`, `goal_contributions`, `spaces/members`) y ninguno filtra ni depende de `type` ni de privacidad por persona — todos son ya correctamente "todo el espacio es visible para todo el espacio", que es la privacidad real que necesitan (nada de eso es personal por diseño).

No hay que tocar `computeDebtHalf()`, `expensesOfMonth()`, `viewExpensesOfMonth()` ni ninguna función de cálculo — todas consumen `state.allExpenses`, que seguirá teniendo la misma forma exacta que hoy después de fusionar las dos consultas.

---

## 4. UID vs. email — decisión 3

**No hace falta migrar nada, y no lo recomiendo ahora.** Aquí el análisis pedido:

**Qué es cada uno realmente:**
- `request.auth.token.email` viene del token de identidad firmado por Firebase/Google tras el login — **no es un campo que el cliente pueda falsificar escribiéndolo en un documento**. Es tan fiable como `request.auth.uid` para este propósito. La preocupación de "no depender de campos editables enviados por el cliente" ya está resuelta hoy en la parte de *quién eres* (`request.auth.*`); el problema real que arreglamos en la sección 2 nunca fue ahí, sino en que ninguna regla comprobaba `resource.data.*` contra esa identidad.
- Donde sí hay una diferencia real es en **qué campo del documento comparamos** contra esa identidad: `resource.data.email` (un string que, en teoría, alguien podría escribir distinto de su propio email real si una regla no lo impidiera — cosa que las reglas de `expenses` no comprueban hoy en `create`, ver sección 2) vs. `resource.data.uid` (mismo problema en teoría, pero con la regla `create` que propongo arriba, quedaría cerrado para ambos por igual).

**Qué implicaría migrar todo a UID:**
- `memberEmails` en `spaces`, las claves de `memberships/{email}`, `spaces/{id}/members/{email}` y el sistema de invitación (`invites/{code}`) están todos construidos alrededor del email como clave — cambiar eso sí sería una migración grande (reescribir claves de documentos, no solo campos), justo lo que dices que no quieres hacer sin justificarlo.
- No hay ninguna vulnerabilidad hoy que el email cause y el uid resolvería — un cambio de email de Google es rarísimo y, aunque pasara, en el peor caso perderías acceso a tu propio espacio (un fallo molesto, no una fuga de privacidad hacia otra persona).

**Mi recomendación**: no migrar la identidad de espacios/miembros (email sigue siendo la clave ahí, funciona bien, y migrarlo sería la "migración gigante" que quieres evitar). Pero para la regla de privacidad nueva de la sección 2, usar `uid` en vez de `email` porque no cuesta nada extra (el campo ya existe en el 100% de los documentos desde el primer commit) y es marginalmente más robusto. Es una decisión local a esa regla, no un cambio de arquitectura de identidad.

---

## 5. Diseño final aprobado — cierre de Fase 1

Las tres decisiones de la sección anterior quedan cerradas con las respuestas recibidas. Esta sección sustituye a los borradores de las secciones 2-3 como referencia definitiva para la Fase 8 (todavía sin publicar ni implementar).

### 5.1 Privacidad legacy — por `uid`, no `ownerUid`

Confirmado: `uid` (quien creó el gasto) es la fuente de verdad para privacidad, `payerEmail` (quien pagó) nunca se usa con ese fin. No se introduce `ownerUid`: sería un campo nuevo solo para resolver un caso que dejamos de generar. Si en el futuro aparece la necesidad real de que alguien registre un gasto privado "en nombre de" otra persona, se modela explícitamente entonces — no antes.

### 5.2 Queries definitivas

```js
function subscribeExpenses(spaceId, space) {
  // Espacio pareja: dos listeners. Espacio personal: solo el propio,
  // porque el compartido devolvería siempre 0 documentos y no aporta nada.
  var isPersonal = space.type === "personal";

  if (!isPersonal) {
    state.unsubExpensesShared = db.collection("expenses")
      .where("spaceId", "==", spaceId)
      .where("type", "!=", "individual")
      .onSnapshot(function (snap) { mergeExpenseSnapshot("shared", snap); });
  }

  state.unsubExpensesMine = db.collection("expenses")
    .where("spaceId", "==", spaceId)
    .where("type", "==", "individual")
    .where("uid", "==", state.user.uid)
    .onSnapshot(function (snap) { mergeExpenseSnapshot("mine", snap); });
}
```

`mergeExpenseSnapshot(bucket, snapshot)` transforma cada snapshot con el mismo `.map()` que ya existe hoy en `subscribeExpenses` ([app.js:892-909](parejas-app/app.js:892)), guarda el resultado en `state._expensesShared` / `state._expensesMine`, concatena ambos, ordena por fecha una vez, y asigna el resultado a `state.allExpenses` antes de llamar a `render()`. El resto de la aplicación sigue leyendo `state.allExpenses` exactamente como hoy — ninguna otra función cambia.

En espacio personal, `state.unsubExpensesShared` nunca se crea (queda `null`/no usado) y `state._expensesShared` se trata como lista vacía al fusionar.

### 5.3 Reglas — `create`

| Espacio | Permitido | Prohibido |
|---|---|---|
| Pareja (`space.type == "pareja"`) | Crear con `type: "conjunto"` | Crear con `type: "individual"` — bloqueado a nivel de reglas, no solo de interfaz |
| Personal (`space.type == "personal"`) | Crear con `type: "individual"` | Crear con `type: "conjunto"` — sin caso de uso, se bloquea igual por coherencia y para que la invariante sea total, no parcial |

En ambos casos, además: `uid` del documento debe coincidir con `request.auth.uid` (nadie puede crear un gasto adjudicándoselo a otra persona), y el espacio debe reconocer al creador como miembro (regla `inSpace` de siempre).

**Ajuste Fase 3 (ver PHASE3_ECONOMIC_SPLIT_DESIGN.md, punto 5): `payerEmail` también debe pertenecer a `space.memberEmails`.** No solo la identidad de quien escribe (`uid`) importa — quien la app dice que *pagó* también es un dato de integridad económica (entra directamente en `computeBalanceCents`), así que no tiene sentido permitir un `payerEmail` ajeno al espacio.

```
function canCreateExpense(data) {
  let space = get(/databases/$(database)/documents/spaces/$(data.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    data.uid == request.auth.uid &&
    data.payerEmail in space.memberEmails &&
    (
      (space.type == "pareja"   && data.type == "conjunto")   ||
      (space.type == "personal" && data.type == "individual")
    );
}
```

Si `space.type` no es exactamente `"pareja"` ni `"personal"` (no debería poder pasar, pero por si acaso), la creación se deniega por defecto en vez de permitirse — denegar-por-defecto, no al revés.

### 5.4 Reglas — `update`

**Ajuste tras revisión (19/08/2026): `type` es inmutable siempre, no solo dentro de espacios pareja.** La versión anterior de esta sección dejaba cambiar `type` libremente en espacios personales (sin consecuencia de privacidad ahí, ya que solo hay un miembro) — pero es una excepción innecesaria: nadie ha pedido poder convertir un gasto personal en compartido dentro del mismo espacio, y mantener la regla igual en los dos tipos de espacio la simplifica sin perder nada. Si algún gasto queda con el `type` equivocado, se borra y se crea de nuevo correctamente (permitido, ver 5.6) — dos pasos en vez de uno, pero sin necesitar una excepción en la regla.

| Situación | Permitido | Prohibido |
|---|---|---|
| Gasto `conjunto` en espacio pareja | Editarlo cualquier miembro del espacio, como hasta ahora | — |
| Gasto `individual` legacy en espacio pareja | Editarlo solo su propietario (`uid` coincide) | Editarlo cualquier otro miembro |
| Cualquier gasto, cualquier espacio | — | Cambiar `uid` o `spaceId` del documento (inmutables, ver 5.5) |
| Cualquier gasto, cualquier espacio | — | Cambiar `type` — inmutable tras la creación, sin excepción por tipo de espacio |

```
function canUpdateExpense(oldData, newData) {
  let space = get(/databases/$(database)/documents/spaces/$(oldData.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    (oldData.type != "individual" || oldData.uid == request.auth.uid) &&
    newData.uid == oldData.uid &&
    newData.spaceId == oldData.spaceId &&
    newData.type == oldData.type &&
    newData.payerEmail in space.memberEmails;
}
```

### 5.5 Campos inmutables

Revisé los 13 campos del documento de gasto ([app.js:920-934](parejas-app/app.js:920)) uno a uno para ver cuáles se usan en alguna condición de autorización:

- **`uid` y `spaceId`: inmutables.** Son los dos únicos campos que cualquier regla de esta colección usa para decidir permisos (quién eres, a qué espacio perteneces). Permitir cambiarlos mediante `update` anularía por completo el resto de la protección — es exactamente el hueco que señalas.
- **`type`: inmutable, en cualquier tipo de espacio** (ajuste del 19/08/2026, ver 5.4) — se usa para autorización en espacios pareja, y por simplicidad se bloquea igual en espacios personales aunque ahí no hiciera falta.
- **`payerEmail`: editable, pero con una restricción de contenido, no de inmutabilidad** (ajuste Fase 3) — se puede seguir corrigiendo "quién pagó" desde la pestaña Deudas como hasta ahora, pero el nuevo valor debe seguir perteneciendo a `space.memberEmails`. No es un campo inmutable como `uid`/`spaceId`/`type` (esos no pueden cambiar a ningún otro valor); `payerEmail` sí puede cambiar, solo que el conjunto de valores válidos está acotado.
- **`email`, `displayName`, `photoURL`, `amount`, `category`, `place`, `note`, `lat`, `lng`, `expenseDate`, `tripGoalId`, `affectsDebt`, `createdAt`: siguen totalmente editables, sin cambios.** Ninguno de ellos aparece en ninguna condición de ninguna regla de esta colección — confirmado revisando `firestore.rules.txt` completo, no solo el bloque de `expenses`.

### 5.6 Reglas — `read` y `delete`

Ambas comparten exactamente la misma condición (leer algo y decidir si puedes borrarlo sin leerlo antes son, en la práctica, la misma pregunta de privacidad):

```
function canAccessExpense(data) {
  let space = get(/databases/$(database)/documents/spaces/$(data.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    (data.type != "individual" || data.uid == request.auth.uid);
}
```

- Gasto `conjunto`: cualquier miembro del espacio puede leer/borrar, igual que hoy.
- Gasto `individual` (legacy, dentro de pareja, o cualquiera dentro de personal): solo su propietario por `uid`.

### 5.7 Bloque de reglas completo para `expenses` (sustituye al actual en `firestore.rules.txt` cuando se publique en Fase 8)

```
function canAccessExpense(data) {
  let space = get(/databases/$(database)/documents/spaces/$(data.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    (data.type != "individual" || data.uid == request.auth.uid);
}

function canCreateExpense(data) {
  let space = get(/databases/$(database)/documents/spaces/$(data.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    data.uid == request.auth.uid &&
    data.payerEmail in space.memberEmails &&
    (
      (space.type == "pareja"   && data.type == "conjunto")   ||
      (space.type == "personal" && data.type == "individual")
    );
}

function canUpdateExpense(oldData, newData) {
  let space = get(/databases/$(database)/documents/spaces/$(oldData.spaceId)).data;
  return isSignedIn() &&
    request.auth.token.email in space.memberEmails &&
    (oldData.type != "individual" || oldData.uid == request.auth.uid) &&
    newData.uid == oldData.uid &&
    newData.spaceId == oldData.spaceId &&
    newData.type == oldData.type &&
    newData.payerEmail in space.memberEmails;
}

// La validación de economicSplit (Fase 3) se añade con un && más sobre
// canCreateExpense/canUpdateExpense — ver PHASE3_ECONOMIC_SPLIT_DESIGN.md.

match /expenses/{docId} {
  allow read, delete: if canAccessExpense(resource.data);
  allow create: if canCreateExpense(request.resource.data);
  allow update: if canUpdateExpense(resource.data, request.resource.data);
}
```

Todas las demás colecciones (`budgets`, `fixed_expenses`, `settlements`, `profiles`, `loans`, `goals`, `goal_contributions`, `spaces`, `invites`, `memberships`, `feedback`, `push_tokens`) se quedan exactamente como están hoy en `firestore.rules.txt` — nada de esta fase las afecta.

### 5.8 Índices necesarios

Documentados en detalle en [firestore.indexes.txt](parejas-app/firestore.indexes.txt) (nuevo archivo, solo referencia, no publicado):

- **Consulta compartida** (`spaceId ==`, `type !=`): necesita índice compuesto manual, porque mezcla una igualdad con una desigualdad sobre campos distintos.
- **Consulta propia** (`spaceId ==`, `type ==`, `uid ==`): solo igualdades sin `orderBy`, Firestore la cubre con indexado automático — no debería necesitar creación manual, pero lo dejo registrado por si el proyecto la pidiera igualmente.

### 5.9 Coste de lecturas añadido

Cada `get()` a `spaces/{id}` dentro de una función de regla cuenta como una lectura de Firestore aparte del propio documento de gasto. Con el diseño de 5.3/5.4/5.6 (una función = un `get()`, gracias al `let`), el coste por operación es:
- Leer/borrar un gasto: 1 lectura extra (antes: idéntico, `canAccessDoc()` ya hacía un `get()`).
- Crear un gasto: 1 lectura extra (antes: idéntico).
- Editar un gasto: 1 lectura extra (antes: idéntico).

No aumenta respecto a lo que ya cuesta hoy — sigue siendo un único `get()` por operación, solo que ahora esa lectura también decide el tipo de espacio, no solo la pertenencia.

---

## Resumen — Fase 1 cerrada

Las tres decisiones de la sección 2/3/4 (ahora sección 5) quedan aprobadas y documentadas: privacidad legacy por `uid`, dos consultas fusionadas en `state.allExpenses`, invariante de backend para `create`/`update` que impide `individual` nuevo o "escondido" dentro de un espacio pareja, con `uid`/`spaceId` inmutables. Nada de esto se ha tocado todavía en `app.js`, `index.html` ni `firestore.rules.txt` — son solo el diseño aprobado para implementar más adelante (Fases 3+) y publicar (Fase 8).

Seguimos con la **Fase 2**: infraestructura mínima de tests para `computeDebtHalf()` y el resto del cálculo económico actual (50/50), sin tocar todavía ese cálculo.

# Auditoría técnica del core — Gastos en Pareja

Fecha: 19 de agosto de 2026. Basado en lectura directa de `app.js` (5084 líneas), `index.html`, `firestore.rules.txt` y `netlify/functions/notify-expense.js` en el commit `94a367b`. Cada afirmación cita archivo y línea; donde no pude verificar algo en vivo (sin sesión de Firebase activa en este entorno, y no voy a iniciar sesión yo mismo), lo digo explícitamente en vez de darlo por hecho.

---

## 1. Modelo actual de gastos

**Colección:** `expenses` (documentos sueltos, un doc = un gasto). No hay subcolecciones por espacio ni por mes; todo vive en una colección plana filtrada por campo `spaceId`.

**Cómo se guarda** (`expenseFields()`, app.js:920-934, más lo que añade `addExpense()`, app.js:936-945):

```js
function expenseFields(payload) {
  return {
    amount: payload.amount,       // número, ya redondeado a 2 decimales por el caller
    category: payload.category,   // string: "comida"|"transporte"|"ocio"|"casa"|"salud"|"otros"
    type: payload.type,           // string: "conjunto" | "individual"
    affectsDebt: payload.affectsDebt, // boolean
    place: payload.place,
    note: payload.note,
    lat: payload.lat, lng: payload.lng,
    payerEmail: payload.payerEmail,   // quién pagó — ver sección 2
    expenseDate: payload.expenseDate, // Date, se guarda como Timestamp
    tripGoalId: payload.tripGoalId || null
  };
}
// addExpense() añade además:
//   spaceId, uid, email, displayName, photoURL, createdAt (serverTimestamp)
```

- **`amount`**: un `Number`, ya redondeado con `Math.round(amount * 100) / 100` en el formulario (app.js:4858) antes de guardarlo. No hay separación entre "importe pagado" e "importe de coste" — ver sección 2, esto es central.
- **Quién ha pagado**: campo `payerEmail`, un string de correo. Se rellena con `state.selectedPayer`, que en el formulario por defecto es `state.user.email` (quien está guardando el gasto), pero es **editable en un selector** — cualquiera de los dos miembros puede registrar un gasto "pagado por" el otro (app.js:4444-4461, `initPayerPicker`).
- **Personal vs. compartido**: campo `type`, valor `"conjunto"` o `"individual"`. Es una elección explícita en un selector del formulario, no se infiere de nada. **No hay ningún campo que diga a quién "corresponde" el gasto** — solo quién pagó y si es conjunto o individual.
- **Categoría, lugar, fecha, nota**: campos de texto/enum normales, sin lógica adicional. La fecha (`expenseDate`) es la fecha real del gasto (editable), distinta de `createdAt` (cuándo se guardó el documento).

**Cómo se calcula el 50/50** — no se guarda un reparto, se calcula en el cliente cada vez (app.js:1467-1484):

```js
function debtExpenses() {
  return visibleExpenses().filter(function (e) { return e.type === "conjunto" && e.affectsDebt; });
}

function computeDebtHalf() {
  var totals = {};
  PARTNERS.forEach(function (p) { totals[p.email] = 0; });
  debtExpenses().forEach(function (e) {
    if (totals.hasOwnProperty(e.payerEmail)) totals[e.payerEmail] += e.amount;
  });
  var diff = totals[PARTNERS[0].email] - totals[PARTNERS[1].email];
  var half = diff / 2;
  state.settlements.forEach(function (s) {
    if (s.payerEmail === PARTNERS[0].email) half += s.amount;
    else if (s.payerEmail === PARTNERS[1].email) half -= s.amount;
  });
  return Math.round(half * 100) / 100;
}
```

Es decir: suma todo lo que ha pagado cada uno en gastos `type === "conjunto"` con `affectsDebt !== false`, resta, divide entre 2. **El reparto es siempre 50/50, hardcodeado como `/ 2`.** No hay ningún porcentaje configurable en ningún sitio del código.

**Las deudas NO se guardan, se calculan al vuelo** cada vez que se renderiza la pestaña Deudas (`renderDeudasPanel`, app.js:1935 en adelante, llama a `computeDebtHalf()` directamente). Lo único que se guarda de verdad es la colección `settlements` — los pagos de "he saldado X€" — que actúan como ajuste manual sobre el cálculo.

**Corrección de deuda**: no existe como operación propia. Como el balance se deriva de los gastos, "corregir la deuda" es editar o borrar el gasto conjunto que está mal (interfaz añadida recientemente en la propia pestaña Deudas, `renderDebtExpenses`, app.js — lista los gastos que forman el balance con botones editar/borrar). Y "deshacer un saldado" es borrar el documento de `settlements` correspondiente. No hay un historial de auditoría de estos cambios: si alguien edita o borra, no queda rastro de qué había antes.

### Ejemplo real de documento — 100 € pagados por Unai en una pareja, conjunto

```json
{
  "amount": 100,
  "category": "comida",
  "type": "conjunto",
  "affectsDebt": true,
  "place": "Mercadona",
  "note": "",
  "lat": null,
  "lng": null,
  "payerEmail": "unaibtxu@gmail.com",
  "expenseDate": "2026-08-19T18:30:00.000Z",
  "tripGoalId": null,
  "spaceId": "kOqzzHRfAVF86Te03zra",
  "uid": "AbC123...",
  "email": "unaibtxu@gmail.com",
  "displayName": "Unai",
  "photoURL": "https://...",
  "createdAt": "2026-08-19T18:30:05.000Z"
}
```

Con este documento solo, `computeDebtHalf()` daría: total Unai = 100, total pareja = 0, diff = 100, half = 50 → *"tu pareja te debe 50 €"*. Correcto para este caso simple, porque aquí coincide "quien pagó" con "a quien le corresponde la mitad" — pero esa coincidencia es casualidad del reparto 50/50, no algo que el modelo garantice. Ver sección 2.

---

## 2. Pagador vs. coste real — la pregunta más importante

**Respuesta corta: no, el modelo actual no puede representar tu ejemplo del alquiler correctamente, y sí, las estadísticas contarían los 1.000 € como "gasto de Dani".**

Repaso tu ejemplo con el código real:

- Alquiler 1.000 €, paga Dani, reparto 50/50 → se guarda `{ amount: 1000, payerEmail: "dani@...", type: "conjunto" }`.
- `renderTotal()` (app.js:1577-1594) suma por `payerEmail`: `byPerson["Dani"] = 1000`. Esto es correcto como "cuánto ha desembolsado cada uno", pero la etiqueta que usa la interfaz es genérica ("Total compartido este mes" con desglose por persona) y en la pestaña personal, este mismo número se presenta bajo *"Estás viendo el gasto personal de Dani"* — mezclando "lo que Dani pagó" con "lo que le costó a Dani", que para gastos conjuntos son cosas distintas. Es un problema de etiquetado, no solo de cálculo: el dato subyacente (`byPerson`) es correcto para "quién pagó", el texto que lo envuelve no distingue eso de "coste".
- El **análisis del mes** (`buildInsights`, `personalCategoryAverages`) y el **plan financiero** (`buildFinancialPlan`) solo miran gastos `type === "individual"` filtrados por `payerEmail === email` (app.js:2596: `return e.type === "individual" && e.payerEmail === email;`). Para gastos conjuntos no calculan nada por persona — así que el alquiler de tu ejemplo (conjunto) no entraría ahí, evitando el problema en esa parte concreta. Pero **si alguien registrara el alquiler como gasto `individual` pagado por Dani** (cosa que la interfaz permite sin ninguna restricción), el plan financiero de Dani computaría los 1.000 € completos como gasto suyo, cuando económicamente son 500 €. Esto ya es posible hoy con los datos actuales, sin necesidad de ningún cambio.
- **Balance**: `computeDebtHalf()` en tu ejemplo daría exactamente lo correcto (Laura debe 500 € a Dani), porque para type `"conjunto"` SIEMPRE asume reparto 50/50 sobre el pagador. Esto funciona *solo porque* tu ejemplo es 50/50. En cuanto quieras 60/40, el modelo no tiene dónde guardarlo — no hay ningún campo de porcentaje, ratio, ni de "coste por persona" en el documento.

**Qué puede reutilizarse:**
- `payerEmail` ya es exactamente el concepto de "quién pagó" (`paidBy`) que buscas. No hace falta cambiar su significado, solo dejar de sobrecargarlo como si fuera también el coste.
- `settlements` y la lógica de "sumar pagos, restar según quién pagó qué" es reutilizable casi tal cual, cambiando solo qué se suma (coste, no lo pagado).
- El toggle `affectsDebt` es un buen antecedente de "esto no cuenta para el reparto" — mismo patrón que necesitarías para excluir un gasto del reparto económico.

**Qué habría que cambiar (sin implementarlo, solo lo mínimo necesario):**

Un campo nuevo, no una reestructuración: algo como

```js
economicSplit: { "dani@...": 500, "laura@...": 500 }  // o el reparto que sea
```

guardado en el momento de crear el gasto, calculado a partir de un `splitMode` (`"50_50" | "60_40" | "custom"`) y un `splitRatio` opcional para el modo personalizado. `payerEmail` se queda exactamente como está (quién pagó). El cálculo de deuda pasaría de sumar `amount` completo por pagador a sumar `economicSplit[email]` por persona, comparado contra lo que cada uno *pagó de verdad* (que sigue siendo `payerEmail` + `amount`).

Esto es aditivo: los documentos viejos sin `economicSplit` se pueden seguir leyendo asumiendo 50/50 por defecto (que es lo que hace el código hoy), así que no hace falta migrar nada retroactivamente para que la app siga funcionando — ver sección 10.

**Mi opinión, ya que la pides**: el ejemplo del alquiler es real y el modelo actual efectivamente no lo soporta con reparto ≠ 50/50. Pero antes de construirlo yo comprobaría con Sofía si el 60/40 es algo que de verdad necesitáis o es un caso hipotético — el 90% de las parejas que vimos en la investigación de TikTok hablan de reparto igual o "cada uno paga lo suyo", no de porcentajes. Si añades `splitMode` y `economicSplit` sin que nadie los use, es una campo más de complejidad en el formulario de gasto justo cuando el objetivo declarado (sección 7) es simplificarlo.

---

## 3. Modelo de espacios / parejas

**Colección `spaces`**, un documento por espacio:

```js
{
  memberEmails: ["dani@...", "laura@..."],  // array, 1 elemento = personal, 2 = pareja
  type: "pareja" | "personal",
  name: "",              // opcional, elegido por el usuario
  createdBy: "dani@...",
  createdAt: Timestamp,
  inviteCode: "AB12CD",  // solo en type="pareja"
  inviteActive: true      // solo en type="pareja"
}
```

- **No hay campo `owner` separado.** `createdBy` se guarda pero no se usa en ninguna regla de permisos ni en la interfaz para dar privilegios especiales — cualquier miembro tiene los mismos permisos sobre los datos del espacio (confirmado leyendo las reglas: `canAccessDoc()` no distingue creador de invitado).
- **Miembros**: el array `memberEmails` en el propio documento del espacio ES la fuente de verdad para permisos (lo usan las reglas). Además hay una subcolección `spaces/{id}/members/{email}` con `{ email, label, uid, joinedAt }` — esto es solo para mostrar el nombre elegido y el avatar, no afecta a permisos.
- **Pertenencia inversa**: `memberships/{email}/spaces/{spaceId}` — un documento vacío por cada espacio al que perteneces, usado solo para poder preguntar "¿a qué espacios pertenezco?" sin tener que escanear toda la colección `spaces` (app.js:527-531, `listUserSpaceIds`).
- **Invitaciones**: colección separada `invites/{code}` → `{ spaceId }`. Un código de invitación es un documento independiente que apunta al espacio; unirse añade tu email a `memberEmails` con `arrayUnion` (app.js:752-754).
- **Permisos**: sin roles. `type: "personal"` es solo una etiqueta que la interfaz usa para: ocultar pestañas Compartido/Deudas, cambiar textos, y bloquear que se añadan más miembros al `memberEmails` (regla `resource.data.type == "pareja"` exigida para unirte por invitación, firestore.rules.txt:41). Un espacio "personal" con 2 miembros sería tan válido para las reglas de datos como uno "pareja" — la única barrera es que la regla de `update` de `spaces` no permite añadir un segundo miembro si `type != "pareja"`.

**Sobre simplificar a MÍO / NUESTRO sin migración grande**: técnicamente es más simple de lo que parece, porque **ya tienes exactamente ese modelo por debajo** — un espacio `personal` es literalmente "Mío" y uno `pareja` con 2 miembros es literalmente "Nuestro". Lo que complica la UX hoy no es el modelo de espacios, es que:
1. Cambiar de espacio es una pantalla y una acción explícitas (🔀 en la cabecera) en vez de dos pestañas dentro del mismo sitio.
2. Un espacio de pareja tiene una sub-pestaña "Mío" *dentro de él* (`state.mainTab === "personal"`, filtra por `type === "individual"`), que es un concepto distinto a "tu espacio personal" — hoy hay dos formas de tener algo "mío": tu espacio personal completo, y la vista "Mío" dentro del espacio de pareja. Esa duplicidad conceptual (no solo de UI) es lo que yo simplificaría primero, no el modelo de datos de espacios en sí.

---

## 4. Privacidad real — **prioridad alta**

Fui a comprobarlo en vivo y no tengo sesión de Firebase activa en este entorno ahora mismo; no voy a iniciar sesión yo mismo con tus credenciales para no cruzar esa línea. Lo que sigue está confirmado por **lectura directa y determinista** de la regla publicada en el repo — una regla de Firestore no tiene ambigüedad de comportamiento, a diferencia de un bug de lógica: si la condición no está, el permiso se concede sin esa condición, siempre.

La regla real, tal cual está en `firestore.rules.txt:70-73`:

```
match /expenses/{docId} {
  allow read, update, delete: if canAccessDoc();
  allow create: if canCreateDoc();
}
```

donde

```
function canAccessDoc() { return inSpace(resource.data.spaceId); }
function inSpace(spaceId) {
  return isSignedIn() &&
    request.auth.token.email in get(.../spaces/$(spaceId)).data.memberEmails;
}
```

**Traducción exacta**: cualquiera que sea miembro del espacio puede leer, actualizar o borrar **cualquier documento de `expenses` de ese `spaceId`**, sin ninguna condición sobre el campo `type` ni sobre `payerEmail`/`email`. La regla no distingue en ningún momento si el gasto es `"individual"` o `"conjunto"`, ni de quién es.

**"Un miembro de pareja puede leer X pero no Y":**
- Puede leer: todo documento de `expenses`, `fixed_expenses`, `budgets`, `settlements`, `loans`, `goals`, `goal_contributions`, `profiles` que tenga el `spaceId` de un espacio del que sea miembro — **incluidos los gastos que la persona marcó como `type: "individual"` (privados)**.
- No puede leer: datos de un espacio al que no pertenece (eso sí está bien protegido), ni los `push_tokens` de nadie (nadie puede, ni siquiera el propio dueño — de diseño), ni el `feedback` de otros (de diseño, `allow read: if false`).

**La app oculta esto en la interfaz** (`viewExpensesOfMonth()` filtra por `type`, y `renderBudgets()` filtra `visiblePartners` a solo tu propio email, app.js:3146-3147) — pero eso es una cortina en el cliente, no una barrera real. **Cualquiera con el SDK de Firebase ya cargado en la página (que está cargado, porque la propia app lo usa) puede ejecutar en la consola del navegador:**

```js
firebase.firestore().collection('expenses')
  .where('spaceId', '==', ESE_SPACE_ID)
  .where('type', '==', 'individual')
  .get()
```

y esa query **se ejecutaría con éxito y devolvería los gastos individuales de la pareja**, porque la regla solo comprueba pertenencia al espacio, nunca el propietario del dato. No hace falta modificar el frontend ni hacer nada sofisticado — es una consulta directa desde las herramientas de desarrollador del propio navegador, con la sesión normal de cualquier miembro.

**Esto es la vulnerabilidad de privacidad que sospechabas, confirmada por el código, no por la interfaz.** La marco como prioridad alta porque "gasto personal privado" es una promesa implícita que la interfaz hace (oculta la pestaña Mío del otro) sin que el backend la cumpla.

**Corrección mínima** (no la implemento, la describo): añadir a la condición de lectura algo como

```
allow read: if canAccessDoc() &&
  (resource.data.type != "individual" || resource.data.email == request.auth.token.email);
```

Esto sí requiere una decisión de producto antes de tocarlo: ¿debe el gasto individual llevar además un campo `ownerEmail` explícito distinto de `payerEmail` (recordemos, sección 1: alguien puede registrar un gasto individual "pagado por" el otro)? Si `type: "individual"` con `payerEmail` de otra persona es un caso real que se usa, la regla de arriba fallaría (compararía contra el creador, no contra el pagador) y habría que decidir cuál de los dos email es el que da privacidad.

---

## 5. Reglas de Firestore: producción vs. repositorio

No puedo comparar con precisión total el texto exacto publicado en la consola de Firebase ahora mismo (no tengo sesión activa ni acceso a la consola). Reconstruyo el estado con la información que tengo, siendo explícito sobre la confianza de cada afirmación:

| Colección | ¿Publicada? | Confianza |
|---|---|---|
| `spaces`, `invites`, `memberships`, `expenses`, `budgets`, `fixed_expenses`, `settlements`, `profiles`, `loans` | Sí | Alta — confirmado con uso real en producción en múltiples sesiones anteriores. |
| `goals`, `goal_contributions` | Sí | Alta — confirmaste "listo publicado" y el modo viaje se probó con éxito en producción después. |
| `push_tokens` | Probablemente sí | Media-alta — te pedí publicarlas junto con la clave VAPID y respondiste "todo listo" a ambos pasos juntos, pero no hay una confirmación separada solo de las reglas. |
| `feedback` | **No** | Alta — es la última colección añadida, y en el turno donde la construimos verificamos en vivo que el envío fallaba por permisos (comportamiento esperado de "reglas aún no publicadas"), y no ha habido ningún turno después donde confirmaras la republicación. |

**Qué cambia la versión del repo frente a lo que casi con seguridad hay en producción**: únicamente la colección `feedback` (bloque completo, firestore.rules.txt:111-126). No toca ninguna otra regla existente — no es una reescritura, es una adición.

**No mejora ninguna otra parte de la seguridad.** En particular: **no corrige la vulnerabilidad de la sección 4.** Esa vulnerabilidad lleva presente desde la primera versión de las reglas multi-espacio y sigue exactamente igual en el archivo actual del repo — republicar no la arregla, porque el archivo que republicarías todavía no tiene el arreglo.

---

## 6. Qué reutilizarías — clasificación

| Función | Clasificación | Por qué |
|---|---|---|
| Gastos (crear/editar/borrar) | **A — Core MVP** | Es literalmente el producto. |
| Gastos personales | **A — Core MVP** | Es la mitad de la promesa "Mío / Nuestro", y ya tiene el bug de privacidad de la sección 4 que hay que arreglar sí o sí antes de confiar en él. |
| Gastos compartidos + balance/deudas | **A — Core MVP** | La otra mitad, y el cálculo (sección 1-2) es sólido para 50/50, que probablemente cubre la mayoría de casos reales. |
| Categorías | **A — Core MVP** | Trivial de mantener, ya integrado en todo lo demás (insights, calendario, CSV). No tiene sentido separarlo. |
| Gastos fijos/recurrentes | **B — Útil pero secundario** | Da valor real (se integra con el plan financiero y préstamos) pero no es lo que alguien prueba el primer día. |
| CSV | **B — Útil pero secundario** | Pediste mantenerlo explícitamente. Es una función completa y ya construida, pero no es el flujo principal de "apuntar un gasto" — es una vía de entrada alternativa. |
| Mapa | **C — Ocultar por ahora** | Requiere geocodificación (Photon) que puede fallar/degradarse, no aporta al cálculo económico, y en la investigación de mercado no apareció como algo que la competencia o los usuarios de TikTok mencionaran. Candidato claro a esconder tras una bandera si vais a simplificar. |
| Calendario con colores de gasto | **C — Ocultar por ahora** | Bonito pero no crítico; depende de tener suficiente historial para que la "mediana de gasto normal" signifique algo, cosa que no tenéis todavía con datos reales. |
| Análisis mensual (insights) | **C — Ocultar por ahora** | Mismo problema: necesita 1-3 meses de datos reales para no decir cosas triviales o vacías. Con el uso actual (básicamente tú y tu segunda cuenta) no se ha podido validar si los mensajes son útiles o ruido. |
| Presupuestos | **B — Útil pero secundario** | Existe (`budgets`, colección real, `getBudgetAmount`/`setBudget`), es simple, y sostiene el plan financiero. |
| Préstamos | **C — Ocultar por ahora** | Bien construido y matemáticamente verificado, pero es una función de nicho (solo aplica a quien tiene un préstamo activo) y añade su propia pestaña completa. Candidato fuerte a esconder si el objetivo es simplificar el core. |
| Metas | **B — Útil pero secundario** | "Ahorrar para algo" es un concepto que sí apareció en la investigación de mercado (viajes, imprevistos) y es más transversal que préstamos. |
| Modo viaje | **D — Refactorizar/eliminar candidato, no ahora** | Es la función más diferenciada frente a la competencia (nadie en TikTok ni en las apps investigadas lo tiene), pero también es la de más complejidad de cálculo (bote pre-pagado, split automático del exceso, cierre con reasignación de sobrante). Si vais a simplificar el core antes de validar, yo la congelaría (ni la escondo ni la toco) hasta tener validación de que "ahorrar para un viaje" (Metas, sin más) ya se usa — construir sobre una base no validada es exactamente el riesgo que estás señalando en tu mensaje. |
| Plan financiero | **C — Ocultar por ahora** | Depende de 1-2 meses de historial real (lo dice el propio código, `personalCategoryAverages` devuelve `null` sin eso) — con el uso actual, apenas se ha podido ver funcionando con datos reales de dos personas. |
| Avisos (notificaciones push) | **B — Útil pero secundario, hoy no funcional** | Todo el código está, pero según la sección 9 aún no está operativo en producción (falta la cuenta de servicio). No es "secundario" por diseño, es secundario porque no puedes validar nada con él hasta que lo termines de configurar. |
| Guía inicial | **A — Core MVP** | Barata, no añade superficie de datos nueva, y ataca directamente el problema real de "usuario nuevo no entiende nada" que puede aparecer en cuanto pruebes con gente de fuera. |
| Sugerencias | **A — Core MVP** | Es tu único canal de validación real con usuarios que no eres tú. Dado que el objetivo declarado es justo "validar antes de seguir construyendo", esto es más importante ahora que casi cualquier función nueva — y por suerte ya está hecho. |
| Exportar datos | **B — Útil pero secundario** | Requisito legal (sección aparte de RGPD, no de producto), no aporta valor de uso diario. |
| Borrar datos | **B — Útil pero secundario** | Mismo motivo — obligatorio antes de abrir a desconocidos, irrelevante para la experiencia de uso. |

"Ocultar" en mis respuestas significa exactamente eso: dejar el código y los datos donde están, quitar el acceso desde la navegación (por ejemplo, condicionando la pestaña con una bandera), sin borrar ni migrar nada. Todas las funciones marcadas C reutilizan datos que ya podrían existir; esconder la pestaña no pierde nada de lo ya guardado.

---

## 7. Flujo de "añadir gasto" — cuántas decisiones hay hoy

Contando el modal real (`index.html`, sección `#modal-add`), en el peor caso (espacio de pareja, tipo conjunto, sin viaje activo) el usuario se encuentra, en orden:

1. **Cuánto** (obligatorio)
2. **Quién paga** (selector, 2 opciones)
3. **Conjunto o individual** (selector, 2 opciones)
4. **¿Cuenta para el balance de deudas?** (solo visible si el paso 3 es "conjunto" — `updateAffectsDebtVisibility()`, app.js)
5. **En qué categoría** (selector visual, 6 opciones)
6. **Dónde** (texto libre con autocompletado)
7. **Cuándo** (fecha/hora, precargada a "ahora")
8. **Nota** (texto libre, opcional)
9. Guardar

Si hay un viaje activo, se añade un décimo campo ("¿es del viaje?"). En un espacio **personal**, los pasos 2 y 3 no se ven (`updateSoloFieldsVisibility()`, app.js) — el formulario ya se reduce a 6 pasos ahí.

**Comparado con tu objetivo** (`42,60 € · Mercadona · Pagaste tú · Nuestro · 60/40 · Guardar`):

- **Fecha = hoy**: ya es el valor por defecto (`nowForDateInv()`), así que ya no molesta salvo que quieras cambiarla. Reutilizable sin tocar nada.
- **Pagador = usuario actual**: ya es el valor por defecto (`state.selectedPayer = state.user.email`), el selector solo aparece porque a veces se quiere cambiar. Si quieres que "pagaste tú" no sea ni siquiera una pregunta visible salvo que se toque, es un cambio de UI (mover a "más opciones"), no de datos — el valor por defecto correcto ya existe.
- **Reparto "Nuestro · 60/40"**: aquí es donde el modelo actual se queda corto de verdad (sección 2) — hoy solo hay "conjunto" (siempre 50/50) o "individual", no hay un tercer estado con ratio. Este es el único punto de tu objetivo que requiere el cambio de modelo de la sección 2, no solo de interfaz.
- **Categoría inferida sin IA**: parcialmente reutilizable — ya existe `guessCategory()` (app.js:3427 aprox.) con un diccionario de palabras clave usado hoy solo para el CSV. Aplicarlo también al campo "Dónde" del formulario manual (adivinar categoría por el nombre del sitio, tal como ya se hace con el concepto del banco) es una reutilización directa de código que ya existe y funciona, no algo nuevo que construir desde cero.
- **Lo poco habitual a "Más opciones"**: nota, coordenadas de ubicación, y el toggle de "afecta a la deuda" son buenos candidatos — son campos que la mayoría de gastos no necesitan tocar.

**Mi valoración**: de los 8-10 campos actuales, 4 (pagador, fecha, categoría con palabra clave, afecta-a-deuda) ya tienen un valor por defecto razonable y podrían dejar de mostrarse por defecto sin tocar el modelo de datos, solo la interfaz. El único que de verdad no puedes simplificar a tu objetivo sin cambiar el modelo es el reparto 60/40 — ese depende de resolver primero la sección 2.

---

## 8. CSV — cómo está implementado

- **Dónde procesa el archivo**: enteramente en el navegador. `FileReader.readAsText()` lee el archivo local, `parseCsvText()` (app.js:3333) lo parsea con un parser manual (detecta `,` vs `;`, comillas) sin librerías externas. **Nada del contenido del archivo sale del navegador hasta que decides confirmar la importación** — en ese momento, cada fila elegida se escribe como documento normal en `expenses` vía Firestore, igual que un gasto manual.
- **Detección de columnas**: `guessColumnMapping()` (app.js:3401) busca palabras clave en las cabeceras (`"fecha"`, `"importe"`, `"concepto"`, etc.), con una regla de exclusión: una columna ya asignada a "fecha" no puede competir para "importe" (bug real que corregimos en su momento: "F. Valor" se confundía con "Importe" porque contiene la palabra "valor"). Siempre se muestra el resultado al usuario para corregirlo a mano antes de continuar.
- **Duplicados**: **no se detectan.** No hay ninguna comprobación contra gastos ya existentes en Firestore. Si subes el mismo extracto dos veces, se duplica todo sin aviso. Esto es una laguna real que no vi mencionada hasta ahora.
- **Categorización**: `guessCategory()` (diccionario de palabras clave: "mercadona"→comida, "netflix"→ocio, etc.), aplicado al concepto de cada fila. Sin red, sin IA, determinista.
- **Compartido o personal**: **no se decide por fila.** Se pregunta una sola vez, antes de subir el archivo, para todo el lote (`import-type-picker`, un único `type` que se aplica a todas las filas importadas, app.js:3654-3675). Si un extracto mezcla compras personales y del hogar, hoy no hay forma de separarlas en la propia importación — habría que editarlas una a una después.
- **Qué se guarda**: cada fila importada se convierte en un documento `expenses` normal, con `payerEmail` siempre igual al email de quien importa (nunca el del otro miembro), `note: "Importado del banco: " + concepto`, y `affectsDebt: true` fijo. Los movimientos positivos (ingresos) se descartan siempre — solo se importan gastos.
- **Detección de recurrentes**: agrupa por concepto normalizado (quitando fechas y números de referencia) y ofrece convertir a "gasto fijo" los que aparecen en 2+ meses con importe similar — esto es aparte de la importación de gastos puntuales, no afecta a duplicados.

Mantener CSV sin Open Banking es coherente con lo que ya está construido — no hay ninguna dependencia a medio construir hacia Open Banking en el código.

---

## 9. Seguridad pendiente

| Pendiente | Riesgo actual | Funcionalidad afectada | ¿Imprescindible antes de usuarios externos? | Pasos |
|---|---|---|---|---|
| **Publicar reglas de `feedback`** | Bajo. Solo hace que el buzón de sugerencias falle en silencio (con un mensaje de error, no un crash). | El formulario de sugerencias no guarda nada. | No imprescindible para usuarios externos, pero sin esto pierdes tu único canal de validación real — que es justo lo que dices que necesitas ahora. | Firestore → Reglas → pegar `firestore.rules.txt` completo → Publicar. Un solo paso, sin secretos. |
| **Cuenta de servicio en Netlify** | Ninguno de seguridad (mientras no esté, la función simplemente no envía nada — falla con un mensaje claro, no expone nada). | Las notificaciones push no se envían. | No. Es una función que se puede dejar sin activar indefinidamente sin riesgo. | Firebase → Configuración del proyecto → Cuentas de servicio → generar clave privada (.json) → pegar el contenido en Netlify → Environment variables → `FIREBASE_SERVICE_ACCOUNT_KEY` → redeploy. Necesita un secreto real: no lo hago yo, y no debe pegarse en el chat. |
| **Restringir la API key al dominio** | Medio. Mientras no esté, cualquiera que copie la `apiKey` (pública por diseño, visible en el código fuente de cualquier visitante) puede usarla desde otra web y consumir tu cuota gratuita de Firebase — no roba datos (eso lo protegen las reglas, con el fallo de la sección 4 aparte), pero puede agotar el límite gratuito y dejar la app caída para vosotros. | Toda la app, indirectamente (disponibilidad, no confidencialidad). | **Sí, antes de cualquier tráfico de fuera** — es la única de las tres que protege contra "que nos tiren la web" sin necesidad de que nadie ataque nada a propósito. | Google Cloud Console → Credenciales → esa API key → Restricciones de aplicación → Sitios web (HTTP referrers) → añadir el dominio de Netlify. Sin secretos, lo puedes hacer tú en 2 minutos, o guiarte yo paso a paso. |

**La vulnerabilidad de la sección 4 no está en esta lista porque no la mencionaste como pendiente** — y es más grave que las tres que sí mencionas. La restricción de la API key protege la disponibilidad; el fallo de privacidad de la sección 4 protege la confidencialidad de datos personales de una persona real (Sofía), y ese es exactamente el tipo de cosa que un usuario externo puede encontrar por accidente con las herramientas de desarrollador del navegador, sin ninguna intención maliciosa. Si vais a invitar a gente de fuera, yo la trataría con más urgencia que las tres que preguntas.

No he ejecutado nada de esta sección — las tres primeras requieren tu cuenta/consola, y la corrección de la cuarta requiere que decidas primero cómo quieres modelar la privacidad (sección 4, última pregunta abierta sobre `ownerEmail` vs `payerEmail`).

---

## 10. Migración

**¿Necesitáis migración para separar `paidBy` de `economicSplit`? No, si lo hacéis aditivo.**

- **Compatibilidad hacia atrás**: sí, es viable sin tocar un solo documento existente. Los ~pocos gastos reales que existen hoy no tienen ningún campo de reparto explícito porque hoy el reparto es siempre implícito (50/50 si `type === "conjunto"`, 100% si `"individual"`). Si el código nuevo, al leer un documento, hace *"si no tiene `economicSplit`, asúmelo como 50/50 para conjunto o 100% al pagador para individual"*, el comportamiento no cambia para ningún dato existente.
- **Campos nuevos que añadiría**: `splitMode: "50_50" | "60_40" | "custom" | null` y `economicSplit: { [email]: number } | null`, ambos opcionales/nullable. Nada más — no tocaría `payerEmail`, `type`, `amount` ni ningún otro campo.
- **Campos que quedarían obsoletos**: ninguno de forma inmediata. `type: "conjunto"/"individual"` seguiría teniendo sentido como "¿esto es del hogar o de una sola persona?", independientemente del reparto económico exacto. No veo necesidad de eliminar nada.
- **Migración progresiva**: sí, y es la única razonable aquí — escribir el campo nuevo solo en gastos creados a partir de ahora, dejar los viejos con el comportamiento por defecto de siempre. No hace falta un script de migración por lotes ni tocar datos históricos.

Coincido con tu preferencia de cambios pequeños: este es exactamente el tipo de cambio que se puede hacer en una tarde sin arriesgar nada de lo que ya funciona, precisamente porque el modelo actual es lo bastante simple (una colección plana, sin relaciones rígidas) como para añadirle un campo sin romper lo demás.

---

## 11. Coste / arquitectura

- **Listeners en tiempo real**: 9 activos por sesión con un espacio abierto (`spaces/{id}` doc, `spaces/{id}/members` subcolección, y `where("spaceId"==)` sobre `budgets`, `profiles`, `fixed_expenses`, `goals`, `loans`, `expenses`, `settlements`, `goal_contributions`). Todos correctamente filtrados por `spaceId` — no hay ningún listener sobre una colección completa sin filtro.
- **`expenses` se suscribe con `.limit(500)` sin filtro de fecha** (app.js:886-889): se descargan hasta 500 documentos completos cada vez que entras a un espacio, y todo el cálculo de mes actual, medias históricas e insights se hace filtrando esos 500 en memoria del navegador, no en Firestore. A la escala de uso actual (dos personas, unos meses de datos) es irrelevante. Si algún día un espacio supera los 500 gastos acumulados, **el límite empieza a cortar documentos en silencio** sin avisar a nadie — no es un problema de coste, es un techo de datos no anunciado. Lo señalaría como algo a vigilar, no a arreglar ya.
- **`settlements` con `.limit(200)`, `goal_contributions` con `.limit(400)`**: mismo patrón, mismo comentario, menor urgencia porque crecen más despacio.
- **N+1 reales, todos en flujos poco frecuentes** (no en el camino de "abrir la app y ver mis gastos", que usa los listeners de arriba, bien indexados):
  - `collectMyData()` (exportar datos, app.js:4353-4362) y `deleteMyAccount()` (app.js:4410-4417): por cada espacio del usuario, 8 queries en paralelo (una por colección). Con 2-3 espacios típicos, son 16-24 queries — aceptable para una acción que se usa una vez cada mucho tiempo.
  - `openImportFixedModal()` (copiar gastos fijos entre espacios, app.js:4611): por cada "otro espacio", 2 queries. Mismo razonamiento.
  - `openSpacePicker()` (app.js:516): una query por espacio del usuario al iniciar sesión con varios espacios. Con 1-3 espacios, trivial.
- **Cálculos que ya se hacen en local** (esto está bien hecho): todo el reparto de deudas, medias históricas, amortización de préstamos y detección de recurrentes del CSV se calculan en el navegador sobre datos ya descargados — cero llamadas a Firestore adicionales por cada cálculo. Es el patrón correcto dado que no hay Cloud Functions.
- **Nada obviamente mal diseñado** a esta escala. Lo único que señalaría antes de que crezca de verdad es el límite silencioso de `expenses`, y solo porque el día que se alcance, el síntoma (gastos antiguos que "desaparecen" de los cálculos) sería confuso de diagnosticar sin saber que existe ese tope.

---

## 12. Tests

**Hoy no existe ningún test** (`ls` en el repo no encuentra ni un archivo `.test.js`/`.spec.js`; toda la verificación hasta ahora ha sido manual, vía navegador, en cada sesión de cambios). Esto es coherente con "11 tandas de desarrollo sin validación real": tampoco hay una red que avise si un cambio futuro rompe el cálculo económico sin que nadie lo note hasta que el balance salga mal en producción.

Antes de tocar el cálculo económico (sección 2), los casos mínimos que probaría, calculados sobre las funciones reales que ya existen (`computeDebtHalf`, y la futura función de reparto):

1. **100 € pagados por Dani, 50/50** → Dani pagó 100, coste Dani 50, coste Laura 50, Laura debe 50. *(Esto ya lo cubre el código actual — es literalmente lo que hace `computeDebtHalf()` hoy con un solo gasto conjunto.)*
2. **100 € pagados por Dani, 60/40** → coste Dani 60, coste Laura 40, Laura debe 40 (no 50). *(Esto NO lo puede probar el código actual porque no existe el concepto de 60/40 — es exactamente el test que validaría la sección 2 antes de darla por terminada.)*
3. **Dos gastos cruzados**: Dani paga 100 (50/50), Laura paga 60 (50/50) → coste Dani 50+30=80, coste Laura 50+30=80, pagado Dani 100, pagado Laura 60 → Laura debe 20 a Dani. *(`computeDebtHalf()` ya calcula esto correctamente para 50/50: total Dani=100, total Laura=60, diff=40, half=20.)*
4. **Un `settlement` de por medio**: mismo caso 3, más un pago de 20 € de Laura a Dani registrado como saldado → balance final 0. *(Ya cubierto por el código: la parte de `state.settlements.forEach` en `computeDebtHalf()`.)*
5. **Gasto individual no debe tocar el balance conjunto**: un gasto `type: "individual"` de cualquier importe no debe cambiar el resultado de `computeDebtHalf()`. *(Ya lo garantiza el filtro `e.type === "conjunto"` en `debtExpenses()` — pero sin un test que lo compruebe, un cambio futuro podría romperlo sin que nadie lo note hasta ver un balance raro.)*
6. **`affectsDebt: false` en un gasto conjunto no debe contar para la deuda pero sí para el total del mes**: comprobar ambas cosas por separado, porque son dos funciones distintas (`debtExpenses()` filtra por `affectsDebt`, `expensesOfMonth()` no).

No he escrito ningún test — no hay entorno de test configurado en el proyecto (sin `package.json` de test runner, sin carpeta `tests/`), así que montar esto sería la primera pieza de infraestructura antes de poder ejecutar ninguno de los casos de arriba.

---

## 13. Propuesta de fases (para revisar, no para empezar)

No implemento nada de esto todavía — es la lista que pides para discutir contigo antes de tocar código.

**Fase 0 — antes de cualquier cambio de producto:**
- Corregir la regla de Firestore de la sección 4 (privacidad de gastos individuales). Es la única cosa de esta auditoría que calificaría como "hazlo ya, independientemente de qué decidáis del resto" — porque es una promesa rota de la app hoy mismo, con datos reales de una persona real.
- Publicar las reglas de `feedback` para poder empezar a recibir señal real de Sofía (y de cualquiera a quien se lo enseñéis) — es barato y es justo la validación que buscáis.
- Restringir la API key al dominio (2 minutos, sin dependencias).

**Fase 1 — decisión de producto, sin código todavía:**
- Confirmar con Sofía (no conmigo) si 60/40 es un caso real o hipotético, antes de construir `splitMode`/`economicSplit`. Si la respuesta es "casi siempre 50/50, a veces uno paga algo suelto que no cuenta", el modelo actual con `affectsDebt` ya cubre bastante de eso sin cambiar nada.
- Decidir el caso abierto de la sección 4: si un gasto individual "pagado por" otra persona debe proteger la privacidad de quien lo creó o de quien pagó — afecta directamente a cómo se escribe la regla corregida.

**Fase 2 — si la Fase 1 confirma que hace falta reparto configurable:**
- Añadir `splitMode`/`economicSplit` de forma aditiva (sección 10), sin migrar datos existentes.
- Escribir los tests de la sección 12 (casos 2 en adelante) antes de cambiar `computeDebtHalf()`, no después.

**Fase 3 — simplificación de interfaz (independiente de las anteriores, se puede hacer en paralelo):**
- Esconder (bandera, no borrar) préstamos, mapa, calendario, análisis mensual y plan financiero — sección 6, columna C — hasta tener señal real de que se usan.
- Reducir el formulario de gasto reordenando a "más opciones" lo que ya tiene buen valor por defecto (sección 7): nota, ubicación, afecta-a-deuda.
- Congelar el modo viaje tal cual está (ni esconder ni ampliar) hasta validar que "Metas" simple ya se usa.

**Una discrepancia que quiero señalar, ya que me pides no darte la razón por defecto**: el objetivo que describes ("simplificar antes de seguir añadiendo") y la lista de funciones que ya existen no están tan desalineados como parece por el volumen de código. La mayoría de lo construido (préstamos, metas, plan financiero, calendario) son pestañas *aparte* que no compiten por atención en el flujo principal de apuntar un gasto — el sitio real donde la complejidad le llega al usuario en cada uso es el formulario de gasto (sección 7) y la promesa de privacidad rota (sección 4), no el número de pestañas que existen. Si tuviera que elegir una sola cosa que de verdad simplifica la experiencia diaria, sería el formulario, no esconder pestañas — esconder pestañas mejora la primera impresión de alguien que abre la app por curiosidad, pero el formulario es lo que se toca cada vez que alguien la usa de verdad.

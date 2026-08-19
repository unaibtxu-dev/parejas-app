# Fase 4 — Diseño del reparto habitual de la pareja

Checkpoint estable de partida: `9e19fd03483b2ac2dd084f38e3daec00a0f398b4`. Solo diseño — no se ha tocado `app.js`, `index.html`, `debt-calc.js` ni ninguna regla de Firestore. Revisión tras la primera ronda de aprobación, con 6 ajustes incorporados (ver el final de cada sección afectada) y mi opinión explícita donde la habéis pedido, no solo conformidad.

---

## 1. Inspección del modelo real de `spaces`

**Documento `spaces/{spaceId}`** — confirmado leyendo `createSpace()` ([app.js:692-727](parejas-app/app.js:692)):

```js
{
  memberEmails: [user.email],          // array, 1 = personal, 2 = pareja
  type: "pareja" | "personal",
  name: "",                             // opcional, elegido por el usuario
  createdBy: user.email,
  createdAt: Timestamp,
  inviteCode: "AB12CD",                 // solo si type === "pareja"
  inviteActive: true                    // solo si type === "pareja"
}
```

**Cómo se crea**: `createSpace(type)` — un espacio pareja nace con **un solo miembro** (quien lo crea) y un código de invitación; el segundo email se añade después, cuando la otra persona usa `joinSpaceByCode()` ([app.js:729](parejas-app/app.js:729)), que hace `arrayUnion` sobre `memberEmails`.

**Cómo se edita**: solo dos operaciones de `update` existen hoy — `setSpaceName()` ([app.js:679](parejas-app/app.js:679)) y `leaveSpace()` ([app.js:595](parejas-app/app.js:595), hace `arrayRemove` sobre `memberEmails`). Estos tres (`createSpace`, `joinSpaceByCode`, `leaveSpace`) son las **únicas** operaciones que tocan `memberEmails` en todo el código — importante para la sección 2.

**`members` subcollection** y **`memberships`**: información de presentación / pertenencia inversa, no configuración de pareja — descartadas como sitio, igual que en la ronda anterior.

**Qué campos de `spaces` llegan realmente a memoria**: `subscribeSpace()` ([app.js:634-651](parejas-app/app.js:634)) extrae explícitamente una lista fija de campos al construir `state.space`. Cualquier campo nuevo en Firestore necesita una línea añadida ahí para no perderse en el camino — sigue siendo el mismo hallazgo de la ronda anterior, sin cambios.

**Reglas de Firestore para `spaces`** ([firestore.rules.txt:26-52](parejas-app/firestore.rules.txt:26)): el `update` de hoy, para quien ya es miembro, es todo-o-nada — sin validación de campo alguna. Sigue siendo el punto de partida para la sección 6 (seguridad de `spaces`).

---

## 2. Dónde guardar el default — comparación

(Sin cambios respecto a la ronda anterior — la comparación A/B/C y la elección de A, campos directos en `spaces/{spaceId}`, se mantienen. El ajuste 1 de esta ronda afecta a QUÉ campos concretamente, no a DÓNDE.)

---

## 3. Modelo de datos — AJUSTE 1: se elimina `defaultSplitMode`

**Cambio aplicado, y coincido con la razón que dais**: para `economicSplit` (Fase 3), `splitMode` se justifica porque los céntimos ya redondeados de un gasto real pueden perder la intención original (¿fue 55/45 tecleado a mano, o 50/50+1 céntimo de redondeo?) — ahí SÍ hay pérdida de información al pasar de porcentaje a céntimos concretos. Para el default, `defaultSplitBp` nunca pasa por ningún redondeo de un importe real — son puntos base exactos, siempre. No hay ninguna pérdida de información que una etiqueta cosmética necesite recuperar. Mantener `defaultSplitMode` habría sido copiar la forma de `economicSplit`/`splitMode` sin la razón que la justifica — exactamente el tipo de simetría-porque-sí que se pidió comprobar en la ronda anterior, y que aquí no se sostiene. De acuerdo con eliminarlo.

**Modelo final**:

```js
// spaces/{spaceId}, solo en espacios type === "pareja" con memberEmails.length === 2
{
  ...campos existentes sin cambios...,
  defaultSplitBp: {
    "dani@...":  6000,   // puntos base, entero, 10000 = 100%
    "laura@...": 4000
  }
  // ya no hay defaultSplitMode
}
```

**Derivación de etiqueta en la UI** (sin persistir nada): con solo dos personas, la comparación es directa —

```
5000/5000                  -> "50/50"
6000/4000 o 4000/6000       -> "60/40"
cualquier otro valor         -> "Personalizado"
```

No hace falta ninguna función nueva en `debt-calc.js` para esto — es una comparación de dos números que vive en la capa de presentación (Fase 5+), no en el motor económico.

**Nota sobre `economicSplit`/`splitMode` de los gastos**: sin cambios, tal como confirmáis — esta decisión es solo sobre el default del espacio.

---

## 4. Source of truth

`defaultSplitBp` es ahora la **única** representación persistida del reparto habitual — no hay una segunda fuente con la que pueda desincronizarse, porque ya no existe. Esto cierra por completo la pregunta que dejé abierta en la ronda anterior ("¿la simetría con Fase 3 tiene sentido de verdad?") — la respuesta, tras este ajuste, es que no la necesitábamos: bastaba un campo.

---

## 5. ¿Quién puede cambiarlo?

Sin cambios respecto a la ronda anterior: cualquiera de los dos, sin aprobación, con el riesgo de sorpresa silenciosa ya señalado. El ajuste 4 de esta ronda (mostrar siempre el reparto activo en el formulario de gasto) es una mitigación más fuerte que la que propuse antes — lo actualizo en la sección de riesgos, al final.

---

## 6-7. Nuevos usuarios y legacy — AJUSTE 2: cambio de miembros borra el default

**Invariante nueva, más fuerte que la de la ronda anterior**: si `defaultSplitBp` existe, siempre corresponde exactamente a los `memberEmails` actuales. Ya no se diseña para "un default obsoleto que se detecta y se ignora" — se diseña para que ese estado **no llegue a producirse**.

Estoy de acuerdo con el razonamiento de producto (el reparto de Dani+Laura no debería heredarse a Dani+María sin que nadie lo haya decidido), y añado un análisis concreto contra el código real, como se pide:

### Qué operación necesita cambiar

De las tres únicas operaciones que tocan `memberEmails` (sección 1):

- **`createSpace()`**: nunca puede tener un `defaultSplitBp` preexistente que limpiar — un espacio nuevo no tiene ese campo. Sin cambios.
- **`leaveSpace()`**: **es la única que necesita cambiar.** Su `update()` de hoy es `{ memberEmails: arrayRemove(email) }` — pasaría a ser `{ memberEmails: arrayRemove(email), defaultSplitBp: FieldValue.delete() }`, **en la misma llamada `update()`**, no en una escritura aparte. Un único `update()` sobre un documento ya es atómico en Firestore — no hace falta transacción ni ningún mecanismo nuevo, solo añadir un campo más a un objeto que ya se está escribiendo.
- **`joinSpaceByCode()`**: **mi conclusión, y aquí tengo una opinión concreta que no es solo "sí, aprobado"**: esta función **no necesita tocar `defaultSplitBp` en absoluto**. Un default válido requiere exactamente 2 claves que coincidan con `memberEmails`; mientras el espacio tiene 1 solo miembro (todo el tiempo antes del primer `joinSpaceByCode`), no puede existir un default válido con 2 claves — no hay nada que limpiar en ese momento. Y si el espacio llega a `joinSpaceByCode()` con 1 miembro *después* de que alguien se fuera, ya se limpió en `leaveSpace()`. La única forma de que `joinSpaceByCode()` necesitara limpiar algo sería que existiera algún otro camino de código que reduzca `memberEmails` sin pasar por `leaveSpace()` — y no lo hay (confirmado en la sección 1: son las tres únicas operaciones). Añadir una limpieza "por si acaso" en `joinSpaceByCode()` sería una comprobación defensiva contra un estado que no puede alcanzarse — no lo recomiendo, por la misma razón que no añadimos abstracciones sin uso real en las fases anteriores.

### Corrección (19/08/2026): la regla SÍ debe validar el documento resultante completo, no solo si `defaultSplitBp` cambió

Mi recomendación original en esta sección era validar solo cuando el campo cambia (comparando `request.resource.data.defaultSplitBp != resource.data.defaultSplitBp`), precisamente para no arriesgarme a bloquear salir/entrar del espacio. Se ha corregido, y con razón: ese diseño tenía un agujero real que no vi — un `update` que cambia `memberEmails` **sin tocar** `defaultSplitBp` en absoluto pasaría de largo esa comprobación (el campo "no cambió"), dejando exactamente el estado incoherente que la invariante del ajuste 2 quiere impedir (`defaultSplitBp` con las claves de un miembro que ya no está). Validar solo el delta protege contra escrituras que *modifican* el campo con un valor malo, pero no contra escrituras que lo *dejan huérfano* cambiando otra cosa. Es un fallo de mi propio diseño, no una alternativa igualmente válida.

**Invariante corregida, sobre el documento resultante (`request.resource.data`) completo, en cada `update`:**

```
function defaultSplitConsistent(data) {
  return !("defaultSplitBp" in data) || (
    data.type == "pareja" &&
    data.memberEmails.size() == 2 &&
    // mismo helper de forma que economicSplit (Fase 3), con total=10000
    validSplitShape(10000, data.defaultSplitBp, data.memberEmails)
  );
}
```

...añadida con `&&` a la condición completa de `allow update` de `spaces` (cubre las dos ramas existentes — ya miembro, o uniéndose por invitación — con una sola cláusula, porque las dos ramas producen un `request.resource.data` que debe cumplir la misma invariante).

**Comprobado contra los tres únicos caminos que tocan `memberEmails` (sección 1), más un caso de concurrencia, para verificar que esto no bloquea ningún flujo legítimo:**

- `createSpace()`: nunca escribe `defaultSplitBp` → `!("defaultSplitBp" in data)` es cierto → pasa trivialmente.
- `joinSpaceByCode()`: nunca toca `defaultSplitBp`, y por la invariante ya se mantiene ausente en ese punto (sección "Qué operación necesita cambiar", arriba) → sigue ausente después del join → pasa trivialmente.
- `leaveSpace()`, **ya corregido** para incluir `defaultSplitBp: FieldValue.delete()` en el mismo `update()` (ver más abajo) → el resultado no tiene el campo → pasa.
- `leaveSpace()` **sin** esa corrección (el bug que motivó este ajuste) → el resultado tendría `memberEmails` reducido pero `defaultSplitBp` con las claves de antes → **rechazado por Firestore**. Esto es exactamente lo que se pide: en vez de dejar pasar una salida del espacio que corrompe el default en silencio, Firestore la rechaza en el momento, de forma ruidosa y verificable — mucho más fácil de detectar en pruebas manuales ("no puedo salir del espacio") que una corrupción de datos silenciosa que nadie nota hasta mucho después. Coincido con el razonamiento: es protección, no un problema, precisamente porque en este proyecto no hay tests automáticos de Firestore Rules (confirmado en la auditoría original) — un fallo ruidoso es mucho más seguro que uno silencioso.
- **Escritura concurrente** (comprobación añadida, no pedida explícitamente pero relevante para no dejar un hueco): si alguien intenta cambiar el `defaultSplitBp` justo cuando la otra persona sale del espacio, Firestore resuelve las dos escrituras en orden — cualquiera que sea el orden, la que se aplique en segundo lugar se evalúa contra el resultado de la primera, así que o bien la salida ya limpió el campo (y el cambio de reparto sobre un `memberEmails` reducido a 1 persona queda rechazado, correctamente), o bien el cambio de reparto se aplicó primero (y la salida posterior lo limpia igualmente). No encontré ningún orden de estas dos operaciones que deje un estado incoherente.

Esto además **cierra sola** el riesgo residual que señalé en la ronda anterior ("si en el futuro aparece otra vía para reducir `memberEmails` sin pasar por `leaveSpace()`, la invariante podría romperse sin que ninguna regla lo impida") — con la validación sobre el documento completo, *cualquier* código futuro que reduzca `memberEmails` sin limpiar `defaultSplitBp` sería rechazado por la regla, no solo por la disciplina de `leaveSpace()`. Retiro ese riesgo de la lista final (ver "Riesgos" al final del documento).

### Detalle técnico: borrar el campo, no poner `null`

Para que la limpieza sea coherente tanto en el cliente (`economicSplit == null` ya se usa como "ausente" en `debt-calc.js`) como en las reglas (`"defaultSplitBp" in data` para detectar ausencia), `leaveSpace()` debe usar `firebase.firestore.FieldValue.delete()`, no `defaultSplitBp: null`. Un valor `null` seguiría contando como "el campo existe" para una comprobación de presencia con `in`, y fallaría la validación de forma (que espera un mapa, no `null`) — un detalle pequeño pero que rompería justo la operación que se quiere permitir (salir del espacio) si se implementa con el operador equivocado. Lo marco explícitamente para no repetir el error en la Fase 5.

**Legacy**: sigue igual que antes — espacio sin el campo (nunca lo tuvo, o se acaba de limpiar por un cambio de miembros) → fallback 50/50, sin excepción, sin migración.

---

## 8. Espacio pareja con un solo miembro — AJUSTE 3

**Mi conclusión tras comprobarlo contra el diseño ya aprobado: esto no necesita ningún mecanismo nuevo.** Ya está soportado por la combinación de dos piezas que ya existen:

1. **`canCreateExpense()` (Fase 1) no comprueba `memberEmails.length` en ningún momento** — solo `space.type == "pareja" && data.type == "conjunto"`. Un espacio pareja con 1 solo miembro ya puede crear un gasto `conjunto` hoy mismo, con las reglas ya diseñadas, sin ningún cambio.
2. **El fallback legacy de `economicSplit` (Fase 3) ya trata "campo ausente" como 50/50, para siempre, hasta que alguien lo edite explícitamente** — que es exactamente el comportamiento que se pide para ese gasto solitario.

Es decir: la decisión de producto ("se permite, se guarda sin `economicSplit`, queda 50/50 legacy") no requiere diseñar nada — ya se sigue automáticamente de lo aprobado en Fases 1 y 3. Lo que sí falta, y es lo que documento aquí, es dejarlo escrito explícitamente como comportamiento intencionado (no como un vacío que alguien podría "arreglar" sin necesidad más adelante).

**Cuando el segundo miembro se une**: no toca ningún documento de `expenses` — `joinSpaceByCode()` solo escribe en `spaces` (sección 1). El gasto solitario sigue con su ausencia de `economicSplit` intacta.

**Cuando configuran 60/40 después**: escribe solo en `spaces.defaultSplitBp` — tampoco toca ningún `expenses` existente. Solo los gastos creados a partir de ese momento materializan el nuevo default; el gasto solitario anterior sigue leyéndose con el fallback 50/50, porque nunca tuvo `economicSplit` y nadie lo ha editado.

**Compatibilidad con las reglas ya diseñadas**: comprobado explícitamente — `canCreateExpense`, `canUpdateExpense`, `validateEconomicSplit` (Fase 1/3) no necesitan ningún cambio para este caso. La única pieza nueva de esta fase que interactúa aquí es la validación de `payerEmail in space.memberEmails` (Fase 3): con 1 solo miembro, el único `payerEmail` posible es el propio creador, que trivialmente pertenece a `memberEmails` — sin conflicto.

### Tests futuros añadidos

- **L**: espacio pareja con `memberEmails.length === 1` → puede crear un gasto `conjunto` sin `economicSplit`; se guarda con éxito (verificando que `canCreateExpense` no lo bloquea).
- **M**: se une el segundo miembro después → el gasto anterior sigue sin `economicSplit`, `computeBalanceCents` lo sigue tratando como 50/50 legacy.
- **N**: después configuran `defaultSplitBp` 60/40 → un gasto nuevo materializa 60/40; el gasto anterior conserva su ausencia de `economicSplit` (sigue 50/50).

---

## 9. UX — AJUSTE 4: mostrar siempre el reparto activo

**Cambio aplicado**: ya no se oculta "50/50" cuando es el reparto habitual. En el formulario de gasto:

```
100 €
Mercadona

Compartido · 50/50      (o · 60/40, o · 65/35 — siempre visible)
Pagaste tú

[Guardar]
```

Coincido con la razón: no es una decisión nueva (sigue siendo texto secundario, no un control que haya que tocar), y sí aporta la transparencia que mi propuesta anterior (un aviso puntual solo al cambiar el default) no cubría del todo — con esto, aunque alguien no viera o no recordara el aviso de cuando el otro cambió el reparto, lo ve de nuevo cada vez que añade un gasto, antes de guardar. Actualizo el riesgo de "sorpresa silenciosa" de la sección 5 con esta mitigación más fuerte, no la sustituyo — las dos son baratas y se complementan (una en el momento del cambio, otra en cada uso posterior).

Tocar la línea → override solo para ese gasto (sección 10, sin cambios respecto a la ronda anterior). Objetivo de fricción intacto: 0 decisiones adicionales por gasto normal, solo más información visible sin exigir ninguna acción.

**Configuración en Perfil**: sin cambios respecto a la ronda anterior (bloque junto al nombre del espacio), salvo que ya no hay tres opciones con estado (50/50 · 60/40 · Personalizado) que guardar como modo — el selector guarda directamente `defaultSplitBp`, y la etiqueta que muestra ("50/50" / "60/40" / "Personalizado") se deriva en el momento de mostrarla, con la misma regla de la sección 3.

---

## 10. Override por gasto

Sin cambios de fondo respecto a la ronda anterior: dos escrituras completamente independientes, ninguna toca a la otra.

---

## 11. Flujo de creación

Sin cambios de fondo — sigue siendo cero lecturas nuevas de Firestore, con la misma advertencia de que `subscribeSpace()` necesita extenderse para no descartar `defaultSplitBp` del snapshot. Ya no hay que preocuparse por `defaultSplitMode` (eliminado, sección 3) — una cosa menos que sincronizar.

---

## 12. Edición de gasto

Sin cambios — invariante idéntica a la ronda anterior: se lee siempre `expense.economicSplit` del propio documento, nunca `state.space.defaultSplitBp`.

---

## 13. Fallback del default — AJUSTE 5: ausente vs. inválido no son el mismo tipo de estado

Distingo, como se pide, tres estados con tratamiento distinto:

- **`defaultSplitBp` ausente** → estado normal y esperado (espacio nuevo, o recién limpiado tras un cambio de miembros, sección 6-7). Fallback 50/50. Esto es simplemente "cómo funciona hoy", no una recuperación de nada.
- **`defaultSplitBp` presente y válido** (forma correcta, claves = `memberEmails` actuales exactos) → se usa. Único caso en que se lee para materializar algo.
- **`defaultSplitBp` presente pero inválido** (forma incorrecta, o claves que no coinciden con los miembros actuales) → **esto no debería poder ocurrir nunca**, porque las reglas de Firestore lo impiden en la escritura (sección 14) y el cambio de miembros lo borra en vez de dejarlo obsoleto (sección 6-7, ajuste 2). Si aun así aparece — datos de antes de que existieran estas reglas, o corrupción — la app puede degradar a 50/50 para no dejar al usuario bloqueado sin poder añadir un gasto, **pero esto es un camino de recuperación ante un estado anómalo, no un comportamiento de diseño**. No construyo ninguna pieza de UX ni de producto asumiendo que este estado es normal — a diferencia de "ausente", que sí lo es.

Estoy de acuerdo con la distinción: en la ronda anterior traté ambos casos ("ausente" e "inválido") con el mismo fallback sin marcar la diferencia de estatus, y tenéis razón en que no es lo mismo "el valor por defecto de siempre" que "algo que no debería existir y que estamos tolerando para no romper la app".

---

## 14. Validaciones (diseño, no implementación)

Sigue reutilizando `validateEconomicSplit(10000, defaultSplitBp, memberEmails)` sin función nueva — sin cambios en eso. **Corregido tras la última ronda**: ya no se valida solo "cuando el campo cambia" (ese diseño quedó descartado, ver sección 6-7) — la regla valida el **documento resultante completo** en cada `update`: si `defaultSplitBp` existe en el resultado, sus claves deben coincidir exactamente con `memberEmails` del resultado, sea lo que sea que haya cambiado en esa escritura. `defaultSplitBp` puede desaparecer como parte de la misma escritura que reduce `memberEmails` (eso sigue permitido y es justo lo que hace `leaveSpace()` corregido) — lo que ya no está permitido es que `memberEmails` cambie dejando un `defaultSplitBp` que no coincide.

100/0 y 0/100 siguen permitidos, sin cambios — ya comprobado contra el código real en la ronda anterior (`validateEconomicSplit` usa `v >= 0`, `buildSplitFromPercent` no tiene ninguna división que dependa del reparto).

---

## 15. Seguridad de `spaces` — AJUSTE 6: bloqueante antes de Fase 8, no ahora

Lo confirmo como requisito bloqueante, no como algo a resolver en este documento. Dejo, aun así, mi primera lectura de cada campo — no para cerrarlo, solo para que la Fase 8 no empiece de cero:

| Campo | Quién debería poder cambiarlo (primera lectura, a confirmar en Fase 8) | Riesgo si se deja como hoy (sin ninguna restricción) |
|---|---|---|
| `type` | Nadie, después de crear el espacio — ningún camino de código lo cambia hoy, y permitirlo abriría preguntas raras (¿qué pasa con los gastos `individual` ya creados si un espacio "personal" pasara a "pareja"?) | Hoy cualquier miembro podría escribirlo sin que ninguna regla lo impida — nadie lo hace desde la interfaz, pero la regla no lo prohíbe |
| `createdBy` | Nadie, nunca — es un dato histórico de auditoría, no funcional (confirmado en la auditoría original: no se usa para dar privilegios en ningún sitio) | Bajo impacto funcional si se corrompe (no se usa para permisos), pero no debería ser editable igualmente |
| `memberEmails` | Solo a través de los patrones ya validados por la regla actual (unirse sumando tu propio email, o quedarte igual) — esto ya está bastante cubierto hoy, es el campo con más regla ya escrita | Ya razonablemente protegido; revisar que la futura regla de `defaultSplitBp` no lo intersecte mal (sección 6-7) |
| `inviteCode` / `inviteActive` | Debería poder regenerarse/desactivarse por cualquier miembro, pero no debería poder "inventarse" un código que ya pertenece a otro espacio | Hoy sin restricción de forma — un miembro podría en teoría escribir cualquier string |
| `defaultSplitBp` | Cualquier miembro actual (sección 5), con la forma validada de esta fase | Es el campo nuevo de esta fase — el que motiva toda la revisión de seguridad |

**Por qué esto bloquea, no solo "sería bueno"**: si se publican las reglas nuevas de `defaultSplitBp` (validación de forma) sin revisar el resto, se estaría añadiendo una validación cuidadosa sobre un campo nuevo sentado en un documento cuyos demás campos (`type`, `createdBy`, `memberEmails` fuera de los patrones ya cubiertos) siguen sin ninguna protección — es una inconsistencia de seguridad real, no solo estética. Se resuelve en la Fase 8, junto con la publicación de todas las reglas, no en esta fase de diseño.

---

## 16. Tests futuros — lista completa tras esta ronda

De la ronda anterior (sin cambios, salvo quitar cualquier mención a `defaultSplitMode` si la hubiera):

- **A-I**: como en la versión anterior de este documento (fallback ausente, materialización 60/40, no retroactividad, override no cruza, edición no recalcula, 100/0 permitido, suma≠10000 rechazada, email ajeno rechazado, espacio personal no aplica).
- **J**: `defaultSplitBp` con clave de un miembro que ya no está → **ya no debería poder observarse** tras el ajuste 2 (se borra al salir); test de todas formas para el camino de recuperación si apareciera por datos anómalos.
- **K**: la asimetría deliberada frente a `economicSplit` (aquí nunca se lanza error, siempre se degrada) — sigue vigente, actualizado con el matiz del ajuste 5 (es explícitamente un camino de recuperación, no el camino normal).

Nuevos de esta ronda (ajuste 3, sección 8):

- **L**: espacio pareja de 1 miembro puede crear gasto `conjunto` sin `economicSplit`.
- **M**: al unirse el segundo miembro, ese gasto sigue sin `economicSplit` (50/50 legacy intacto).
- **N**: al configurar un default 60/40 después, solo los gastos nuevos lo materializan; el gasto solitario anterior no cambia.

Nuevo, derivado del ajuste 2, que no estaba explícito antes:

- **O**: `leaveSpace()` en un espacio con `defaultSplitBp` válido → tras la operación, el documento no tiene `defaultSplitBp` (verificar la ausencia real del campo, no solo que sea `null`).

---

## Riesgos (actualizado)

1. **Sorpresa silenciosa al cambiar el default** — mitigado ahora por DOS mecanismos complementarios: aviso al guardar el cambio (propuesta de la ronda anterior) + reparto siempre visible en cada gasto nuevo (ajuste 4). Considero el riesgo razonablemente cubierto para el coste que tiene.
2. ~~`leaveSpace()` es el único código que garantiza la invariante fuerte del ajuste 2~~ — **retirado tras la corrección de esta ronda**: con la regla validando el documento resultante completo (no solo el delta), cualquier código futuro que reduzca `memberEmails` sin limpiar `defaultSplitBp` queda rechazado por Firestore, no solo por la disciplina de `leaveSpace()`. Ya no es un riesgo aceptado, es una invariante forzada.
3. **Seguridad general de `spaces.update`** — bloqueante antes de Fase 8 (sección 15), no resuelto en este documento.
4. **Confusión de UI entre "cambiar el default" y "ajustar este gasto"** — sin cambios respecto a la ronda anterior, sigue pendiente de un rotulado claro en la Fase 5.
5. **Accidente de salir-y-volver-a-entrar de la misma persona** (sin cambios) — con el ajuste 2, si alguien sale del espacio por error y vuelve a entrar con el mismo código, el default configurado se pierde igual que si hubiera entrado una persona distinta. Coste aceptado: re-configurar el reparto tras un error de este tipo, un caso raro, no me parece que justifique más complejidad para evitarlo.
6. **Nuevo, introducido por esta misma corrección**: si `leaveSpace()` tuviera un bug real que olvidara limpiar `defaultSplitBp`, la persona **no podría salir del espacio** hasta que se arregle (Firestore rechazaría el `update`) — un fallo ruidoso en vez de silencioso, que es la elección deliberada de esta ronda. Lo señalo como riesgo igualmente: un bug ahí bloquea una función real (salir de un espacio), no solo corrompe un dato secundario. Coincido en que es preferible a la alternativa silenciosa, pero conviene que quien implemente `leaveSpace()` en la Fase 5 lo pruebe explícitamente contra esta regla antes de darlo por bueno.

## Cosas descartadas (actualizado)

Todo lo de la ronda anterior, más:

- **`defaultSplitMode`** — eliminado en esta ronda (sección 3), ya no existe en el modelo.
- **Limpiar `defaultSplitBp` desde `joinSpaceByCode()`** — descartado: el estado que "limpiaría" no puede alcanzarse si `leaveSpace()` ya lo hace (sección 6-7); añadirlo sería una comprobación defensiva sin estado real que prevenir. Confirmado que se mantiene tras la corrección de esta ronda.
- **Validar `defaultSplitBp` solo cuando ese campo cambia, en vez de sobre el documento resultante completo** — **descartado por ser insuficiente, no por exceso de cautela**: permitía el estado incoherente exacto que la invariante del ajuste 2 quiere impedir (un `update` que cambia `memberEmails` sin tocar `defaultSplitBp` pasaba de largo la validación). Corregido a validar el documento resultante completo en cada `update` (sección 6-7).
- **Tratar "ausente" e "inválido" como el mismo estado de fallback** — descartado (ajuste 5): mismo resultado numérico (50/50), pero distinto estatus (normal vs. recuperación), y vale la pena que el código y la documentación lo distingan.

---

## Resumen de entrega (actualizado)

1. **Modelo elegido**: campos directos en `spaces/{spaceId}` (sin cambios de la ronda anterior).
2. **Campos**: únicamente `defaultSplitBp: {email: bp}`. `defaultSplitMode` eliminado (ajuste 1) — sin segunda fuente de verdad que sincronizar.
3. **Source of truth**: `defaultSplitBp`, sin ambigüedad — es el único campo que existe.
4. **Fallback legacy**: ausente → 50/50 (estado normal). Presente-e-inválido → 50/50 también, pero como recuperación ante un estado que las reglas deberían impedir, no como comportamiento de diseño (ajuste 5).
5. **Validaciones**: reutiliza `validateEconomicSplit(10000, defaultSplitBp, memberEmails)`; **se valida sobre el documento resultante completo en cada `update`** (corregido en esta ronda — validar solo el delta dejaba un hueco real, ver sección 6-7); 100/0 y 0/100 permitidos.
6. **Al crear gasto**: sin cambios — se lee `state.space.defaultSplitBp` ya en memoria, se materializa con `buildSplitFromPercent()`.
7. **Al editar gasto**: sin cambios — siempre desde `expense.economicSplit`, nunca desde el default del espacio.
8. **Override por gasto**: sin cambios — dos escrituras independientes.
9. **Implicaciones Firestore**: `leaveSpace()` debe añadir `defaultSplitBp: FieldValue.delete()` a su `update()` existente (no `null`); `joinSpaceByCode()` no necesita cambios; la regla valida el documento resultante completo, no solo el campo que cambia — un `update` que reduzca `memberEmails` sin limpiar `defaultSplitBp` queda rechazado por Firestore, a propósito; revisión de seguridad completa de `spaces` (todos los campos) bloqueante antes de publicar, no ahora.
10. **Implicaciones de lecturas/coste**: sin cambios — cero lecturas adicionales.
11. **Propuesta de UX**: reparto siempre visible en el formulario de gasto ("Compartido · 60/40", ajuste 4, ya no se oculta el 50/50); configuración una vez en Perfil, guardando directamente `defaultSplitBp` sin un modo aparte.
12. **Tests futuros**: A-K de la ronda anterior + L/M/N (espacio de 1 miembro, ajuste 3) + O (limpieza tras salir, ajuste 2) — O pasa a ser además un test de que el `update` de `leaveSpace()` con la limpieza incluida se acepta, y uno nuevo (implícito) de que la misma operación SIN la limpieza se rechaza.
13. **Riesgos**: 6 en total — se retira el de "depender solo de la disciplina de `leaveSpace()`" (ya lo fuerza la regla) y se añade el de que un bug real en `leaveSpace()` bloquearía la salida del espacio en vez de corromper el dato en silencio (deliberado, pero a probar explícitamente en Fase 5).
14. **Descartado**: `defaultSplitMode`, limpieza defensiva en `joinSpaceByCode()`, validar solo el delta de `defaultSplitBp` en vez del documento completo (corregido en esta ronda), y tratar ausente/inválido como el mismo estado.

Sin implementación, sin tests todavía, sin commit, sin push. Fase 4 cerrada tras esta corrección, salvo que aparezca una contradicción real nueva.

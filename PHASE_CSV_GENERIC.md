# Importador CSV genérico

Corrección independiente del trabajo de Fase 1-5 (economicSplit) — no toca `debt-calc.js` ni el modelo económico. Sin commit, sin push, sin deploy.

## Motivación

Un extracto real (formato catalán: líneas informativas antes de la cabecera, nombres de columna en catalán, gastos e ingresos mezclados) no se pudo importar — primero por subir un `.xlsx` (arreglado en la ronda anterior), y el objetivo de esta ronda es que el propio **parser CSV** sea lo bastante genérico para no fallar con ningún banco real, no solo con ese archivo. **Sin código específico de ningún banco** — el fixture de ese extracto real (anonimizado) es solo el primer caso de regresión, no la razón de ser del cambio.

## Modelo elegido: pipeline en pasos separados, en `csv-import.js`

Nuevo archivo puro (sin DOM/Firestore), mismo patrón que `debt-calc.js` — UMD, cargado con `<script>`, testeable con `node:test`:

```
bytes -> decodeCsvBytes -> texto
texto -> parseCsv -> { headers, rows, headerDetected, delimiter }
headers -> guessColumnMapping -> { date, amount, concept }
rows -> suggestExpenseSign -> "negative" | "positive"
(rows, mapping, sign) -> buildParsedRows -> { parsed, diagnostics }
diagnostics -> diagnosticMessage -> string | null
```

Cada flecha es una función aparte y testeable por separado, tal como se pidió — ninguna decisión (delimitador, cabecera, columna, signo) vive escondida dentro de otra.

## 1. Detección de cabecera

`detectHeaderRowIndex()` examina las primeras 20 líneas y elige la primera que tenga **≥2 celdas no vacías** y **≥2 nombres de columna reconocibles** (`COLUMN_KEYWORDS`, genéricas ES/CAT/EN, sin ningún nombre de banco):

```js
date: ["fecha valor", "f. valor", "f valor", "fecha operacion", "fecha operación", "fecha", "data", "date"]
amount: ["importe", "import", "amount", "cantidad", "monto"]
concept: ["concepto", "concepte", "descripcion", "descripción", "descripcio", "descripció", "detalle", "observaciones"]
```

Las líneas de preámbulo (título del extracto, fecha de generación, líneas vacías con solo delimitadores) no tienen suficientes celdas reconocibles y se descartan solas — no hace falta ninguna regla que las identifique como "preámbulo" específicamente.

**Si no se detecta ninguna cabecera con confianza en las primeras 20 líneas**: no se inventa nada. Se generan encabezados genéricos `"Columna 1"`, `"Columna 2"`... y **todas** las líneas (incluida la primera) se tratan como datos — nunca se pierde la primera transacción por asumir que era cabecera. El usuario ve el aviso correspondiente en la pantalla de mapping y corrige las columnas a mano.

## 2. Delimitador

`detectDelimiter()` cuenta, para `;` y `,`, cuántas de las primeras 20 líneas comparten el mismo número de apariciones — un separador real da un recuento consistente línea a línea (una vez por columna); uno equivocado varía más, porque solo aparece por casualidad dentro de alguna celda. Se detecta sobre las líneas crudas, antes de saber cuál es la cabecera (tenía que ser así: para partir una línea en celdas y poder puntuarla como candidata a cabecera, primero hace falta el delimitador).

## 3. Mapping de columnas

`guessColumnMapping()` reutiliza las mismas `COLUMN_KEYWORDS` de la detección de cabecera (una sola fuente, sin duplicar la lista). Mantiene el orden fecha→importe→concepto y excluye cada columna ya asignada de las búsquedas siguientes — la razón original (evitar que "valor" en una columna de fecha se quede con el hueco del importe) sigue aplicando con las palabras clave nuevas.

**El mapping automático no es la fuente de verdad**: los tres desplegables de la pantalla de mapping siguen mandando sobre cualquier heurística — el usuario los ve ya rellenados con la mejor suposición, pero puede cambiarlos antes de continuar. Confirmado con el test K (columnas sin nombre reconocible: da tres índices válidos y distintos, sin romper, corregibles a mano).

## 4. Signo de los gastos

Ya no se asume que gasto = importe negativo. Nuevo control en la pantalla de mapping: **"¿Cómo aparecen los gastos en este archivo?" → Negativos / Positivos**, con `suggestExpenseSign()` proponiendo automáticamente el más probable (mirando cuántos importes no nulos son negativos vs. positivos) — el usuario puede cambiarlo.

`buildParsedRows()` filtra por el signo elegido **antes** de convertir a positivo — nunca se hace `Math.abs()` de todo indiscriminadamente. Un ingreso con el signo contrario al elegido queda descartado, no convertido en gasto (test H).

## 5. Compatibilidad futura Cargo/Abono

`resolveRowAmount(row, mapping)` es la única función que lee la columna de importe de una fila. El día que haga falta soportar un formato `Fecha | Concepto | Cargo | Abono` (dos columnas en vez de una con signo), `mapping` pasaría a tener `cargo`/`abono` en vez de `amount`, y **solo esta función** necesitaría aprender a combinarlos en un importe con signo — el resto del pipeline (cabecera, delimitador, signo, diagnóstico) no cambiaría. Documentado en el propio código, no implementado (fuera de alcance de esta ronda).

## 6. Errores de diagnóstico

`diagnosticMessage(diagnostics)` distingue, en orden:
1. archivo sin filas de datos;
2. ninguna fecha válida en la columna elegida;
3. ningún importe válido en la columna elegida;
4. hay movimientos válidos, pero ninguno coincide con el signo elegido.

Sustituye el mensaje único anterior ("No hemos encontrado ningún gasto (importe negativo)...") que no distinguía estos cuatro casos.

## 7. Encoding

`decodeCsvBytes(buffer)`: UTF-8 primero; si el resultado tiene pinta de no ser texto de verdad, se reintenta con `windows-1252` (agnóstico de banco, sin dependencia nueva — usa `TextDecoder`, ya disponible en cualquier navegador real).

**Corrección encontrada durante el propio diseño, antes de escribir código**: comprobar solo el carácter de sustitución (`�`) no basta, porque `windows-1252` es una tabla completa de 256 valores — **nunca** produce ese carácter, así que un archivo binario "decodificado" como windows-1252 pasaría la comprobación sin que el resultado fuera texto real. Se añadió `controlCharRatio()`: mide la proporción de caracteres de control (fuera de tabulador/salto de línea) en los primeros 4000 caracteres — un texto real (con o sin acentos) da ~0%; contenido binario da un porcentaje muy alto. El archivo se rechaza solo si **ninguna** de las dos decodificaciones da un resultado limpio.

Esto reemplaza también la comprobación de la ronda anterior (que solo miraba `�` tras leer con `readAsText`) — ahora se lee el archivo como bytes (`readAsArrayBuffer`) para poder reintentar con otro encoding sin volver a pedir el archivo.

## 8. XLSX

Sigue fuera de alcance. Rechazo explícito por extensión (`.xlsx`/`.xls`) antes de intentar leer nada: *"Por ahora solo se puede importar un CSV..."* — no se intenta parsear como texto.

## Qué se movió, qué se quedó en `app.js`

Movidos a `csv-import.js` (parte del pipeline, con el bug): `parseCsvText`→`parseCsv`, `guessColumnMapping`, `parseAmountFlexible`, `parseDateFlexible`. Confirmado con `grep` que no se usaban en ningún otro sitio de `app.js` antes de moverlos.

Se quedan en `app.js`, sin tocar (no relacionados con este bug): `guessCategory`, `normalizeConcept`, `detectRecurring`, `median` — categorización y detección de recurrentes son una decisión de producto aparte, no del parser.

`app.js` ahora: lee el archivo como `ArrayBuffer`; llama a `CsvImport.decodeCsvBytes()`/`parseCsv()`/`guessColumnMapping()`/`suggestExpenseSign()` al cargar el archivo; añade el selector de signo (`initImportSignPicker`) y el aviso de "sin cabecera detectada" (`import-no-header-hint`) a la pantalla de mapping; `buildParsedRows()` delega en `CsvImport.buildParsedRows()` y solo añade la categoría (`guessCategory`, sigue en app.js) antes de mostrar el preview.

## Tests

`test/csv-import.test.js` — 14 tests (A-L pedidos + 2 extra de `controlCharRatio`, base de la decodificación). El test L usa el fixture real anonimizado (preámbulo + cabecera catalana + separador `;`) **sin ningún `if` que reconozca el banco** — pasa porque el parser genérico ya sabe: saltar el preámbulo, reconocer "Data"/"Import"/"Concepte", y elegir correctamente el signo con un extracto que mezcla un gasto y un ingreso.

**Ejecutado en el navegador (Chrome, V8) con el mismo arnés compatible con `node:assert/strict` de las fases anteriores** (Node sigue sin estar disponible en esta sandbox — mismo aviso de siempre, no bloqueante para este checkpoint, sí antes de producción): **14 passed, 0 failed.**

**Además, verificación end-to-end real contra el DOM** (no solo funciones puras) — simulando la subida de archivo sobre el formulario real de la app:
- El `.xlsx` sigue rechazado con el mensaje nuevo.
- El fixture real anonimizado, subido como `.csv`: la pantalla de mapping se rellena sola con **"Data"/"Import"/"Concepte"** (los nombres reales del extracto, no genéricos), el signo se auto-sugiere en "Negativos", y al continuar el preview muestra exactamente **1 gasto — MERCADONA, 45,30€** — el ingreso (NOMINA, 1500€) queda correctamente excluido.
- Un CSV sin cabecera real: aparece el aviso correspondiente y los desplegables muestran "Columna 1/2/3".
- Eligiendo el signo equivocado con el mapping correcto: aparece el mensaje de diagnóstico específico ("ninguno coincide con el signo de gasto elegido"), no el mensaje genérico de antes.

## Riesgos

1. **`node --test` sigue sin ejecutarse literalmente** en esta sandbox — mismo aviso que en todas las fases anteriores.
2. **`TextDecoder("windows-1252")` podría no estar disponible en un Node con ICU reducido** si algún día se ejecutan estos tests con Node de verdad — el código lo captura con `try/catch` y se degrada a quedarse con UTF-8, no rompe nada, pero el fallback de encoding en sí no se podría probar en ese entorno.
3. **`app.js`/`index.html` ahora mezclan, sin comitear, tanto esta corrección como la integración pendiente de Fase 5** (economicSplit) — son cambios independientes entre sí, pero conviven en el mismo árbol de trabajo sin commit. Si se decide comitear por separado, hará falta separar los cambios a mano (o comitear todo junto).

## Fuera de alcance (confirmado, no tocado)

`economicSplit`, `splitBp`, Firestore Rules, el motor de balance, soporte real de XLSX, cualquier adaptador o nombre de banco específico.

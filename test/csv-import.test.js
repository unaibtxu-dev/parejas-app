// Tests del parser genérico de extractos CSV (csv-import.js). Node built-in
// test runner: `node --test` o `npm test`.
//
// Motivado por un extracto real (formato catalán, con líneas informativas
// antes de la cabecera) que no se pudo importar. La corrección es una
// generalización del pipeline, no un caso especial para ningún banco --
// el test L (el propio fixture real, anonimizado) pasa porque el parser
// genérico es mejor, sin ningún `if` que reconozca ese banco. Ver
// PHASE_CSV_GENERIC.md.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCsv,
  guessColumnMapping,
  suggestExpenseSign,
  buildParsedRows,
  diagnosticMessage,
  controlCharRatio,
  classifyRow,
  cleanConceptForDisplay,
  computeFingerprint,
  markHistoricDuplicates,
  buildHeaderedTableFromRows,
  pickBestXlsxTable,
  looksLikePayroll,
} = require("../csv-import.js");

// ---- A) CSV normal con cabecera en primera línea ----

test("A) CSV normal, cabecera en la primera línea", () => {
  const csv = "Fecha;Concepto;Importe\n01/08/2026;MERCADONA;-45,30\n02/08/2026;CARREFOUR;-12,00\n";
  const r = parseCsv(csv);
  assert.equal(r.headerDetected, true);
  assert.deepEqual(r.headers, ["Fecha", "Concepto", "Importe"]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.delimiter, ";");
});

// ---- B) CSV con líneas informativas antes de la cabecera ----

test("B) CSV con 4 líneas de preámbulo antes de la cabecera", () => {
  const csv = [
    ";;;;",
    ";;Extracto de movimientos;;",
    ";;Generado el 19/08/2026;;",
    ";;;;",
    "Fecha;Concepto;Importe;Divisa",
    "01/08/2026;MERCADONA;-45,30;EUR",
  ].join("\n");
  const r = parseCsv(csv);
  assert.equal(r.headerDetected, true);
  assert.deepEqual(r.headers, ["Fecha", "Concepto", "Importe", "Divisa"]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0][1], "MERCADONA");
});

// ---- C) CSV sin cabecera ----

test("C) CSV sin cabecera -> columnas genéricas, ninguna fila perdida", () => {
  const csv = "01/08/2026;MERCADONA;-45,30\n02/08/2026;CARREFOUR;-12,00\n";
  const r = parseCsv(csv);
  assert.equal(r.headerDetected, false);
  assert.deepEqual(r.headers, ["Columna 1", "Columna 2", "Columna 3"]);
  assert.equal(r.rows.length, 2); // las DOS filas son datos, incluida la primera
  assert.equal(r.rows[0][1], "MERCADONA");
});

// ---- D/E) separadores ----

test("D) separador ;", () => {
  const r = parseCsv("Fecha;Concepto;Importe\n01/08/2026;MERCADONA;-45,30\n");
  assert.equal(r.delimiter, ";");
  assert.equal(r.rows[0].length, 3);
});

test("E) separador ,", () => {
  const r = parseCsv("Fecha,Concepto,Importe\n01/08/2026,MERCADONA,-45.30\n");
  assert.equal(r.delimiter, ",");
  assert.equal(r.rows[0].length, 3);
});

// ---- F/G/H) signo de los gastos ----

const MAPPING = { date: 0, amount: 2, concept: 1 };

// v2 (ver PHASE_CSV_V2.md): buildParsedRows ya NO descarta el signo
// contrario -- ambos quedan en `parsed`, cada uno con su `classification`.
// Es app.js quien solo importa como gasto lo clasificado "expense".

test("F) gastos negativos, modo negativo -> clasificados expense", () => {
  const rows = [["01/08/2026", "MERCADONA", "-45,30"], ["02/08/2026", "NOMINA", "1500,00"]];
  const { parsed } = buildParsedRows(rows, MAPPING, "negative");
  assert.equal(parsed.length, 2); // los dos aparecen
  const expense = parsed.find((r) => r.classification === "expense");
  assert.equal(expense.amount, 45.30);
  assert.equal(expense.concept, "MERCADONA");
  assert.equal(parsed.find((r) => r.concept === "NOMINA").classification, "income");
});

test("G) gastos positivos, modo positivo -> clasificados expense", () => {
  const rows = [["01/08/2026", "MERCADONA", "45,30"], ["02/08/2026", "DEVOLUCION", "-12,00"]];
  const { parsed } = buildParsedRows(rows, MAPPING, "positive");
  const expense = parsed.find((r) => r.classification === "expense");
  assert.equal(expense.amount, 45.30);
  assert.equal(expense.concept, "MERCADONA");
});

test("H) modo incorrecto no convierte ingresos en gastos (quedan como income, no expense)", () => {
  // Nunca se hace Math.abs() indiscriminado: el ingreso aparece en `parsed`
  // (para poder revisarlo) pero NUNCA con classification "expense".
  const rows = [["01/08/2026", "NOMINA", "1500,00"]];
  const { parsed } = buildParsedRows(rows, MAPPING, "negative");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].classification, "income");
  assert.notEqual(parsed[0].classification, "expense");
});

// ---- Clasificación sugerida ----

test("bizum/transferencia genéricos -> needs_review, nunca internal_transfer automático", () => {
  assert.equal(classifyRow("Bizum de Juan", -20, "negative"), "needs_review");
  assert.equal(classifyRow("Transferencia recibida", 50, "negative"), "needs_review");
});

test("traspaso entre cuentas propias (evidencia fuerte) -> internal_transfer", () => {
  assert.equal(classifyRow("Traspaso entre cuentas propias", -100, "negative"), "internal_transfer");
});

test("reembolso e ingreso genérico", () => {
  assert.equal(classifyRow("Devolucion compra", 12, "negative"), "reimbursement");
  assert.equal(classifyRow("NOMINA EMPRESA", 1500, "negative"), "income");
});

test("importe 0 -> ignore", () => {
  assert.equal(classifyRow("Comision", 0, "negative"), "ignore");
});

// ---- Feedback beta: Bizum entrante, redondeo/ahorro ----

test("Bizum entrante (no está en el lado de gasto) -> income, no needs_review", () => {
  // sign "negative" => el lado de gasto es amount<0; un Bizum con amount
  // positivo es dinero recibido, no un gasto -- se sugiere income directo.
  assert.equal(classifyRow("Bizum de Juan", 20, "negative"), "income");
});

test("Bizum saliente (lado de gasto) sigue en needs_review, sin cambios", () => {
  assert.equal(classifyRow("Bizum a Juan", -20, "negative"), "needs_review");
});

test("redondeo/hucha de ahorro -> internal_transfer, no gasto normal", () => {
  assert.equal(classifyRow("Redondeo ahorro compra", -1, "negative"), "internal_transfer");
  assert.equal(classifyRow("Aportacion hucha digital", -5, "negative"), "internal_transfer");
});

// ---- Concepto limpio para mostrar (no es normalizeConcept) ----

test("cleanConceptForDisplay quita referencias largas y capitaliza, sin ser la clave de agrupación", () => {
  const r = cleanConceptForDisplay("PAGO TARJETA 43219876 mercadona madrid");
  assert.equal(r.indexOf("43219876"), -1);
  assert.ok(r.indexOf("Mercadona") !== -1);
});

test("cleanConceptForDisplay preserva acentos y capitaliza bien cada palabra (no \\b\\w, que rompe con letras acentuadas)", () => {
  // Bug real: \b\w trata una vocal acentuada como límite de palabra (no es
  // \w), así que "cafetería" se capitalizaba mal ("CafeteríA" en vez de
  // "Cafetería") -- la letra tras la tilde se mayusculaba, no la primera.
  assert.equal(cleanConceptForDisplay("cafetería mercadona"), "Cafetería Mercadona");
  assert.equal(cleanConceptForDisplay("peluquería ñoño"), "Peluquería Ñoño");
});

// ---- Huella y duplicados ----

test("computeFingerprint: mismo día/importe/concepto (número suelto aparte) -> misma huella", () => {
  const fp1 = computeFingerprint(new Date(2026, 7, 15), 45.30, "MERCADONA 4321");
  const fp2 = computeFingerprint(new Date(2026, 7, 15), 45.30, "Mercadona 8765123");
  assert.equal(fp1, fp2);
});

test("markHistoricDuplicates: solo posible, marca por huella", () => {
  const rows = [{ fingerprint: "x", duplicateInHistory: false }];
  markHistoricDuplicates(rows, ["x"]);
  assert.equal(rows[0].duplicateInHistory, true);
});

test("buildParsedRows: duplicado dentro del propio archivo", () => {
  const rows = [
    ["15/08/2026", "MERCADONA", "-45,30"],
    ["15/08/2026", "MERCADONA", "-45,30"],
    ["16/08/2026", "CARREFOUR", "-10,00"],
  ];
  const { parsed } = buildParsedRows(rows, MAPPING, "negative");
  assert.equal(parsed.filter((r) => r.duplicateInFile).length, 2);
  assert.equal(parsed.filter((r) => !r.duplicateInFile).length, 1);
});

// ---- I/J) nombres de columna en distintos idiomas ----

test("I) nombres Fecha / Importe / Concepto", () => {
  const m = guessColumnMapping(["Fecha", "Importe", "Concepto"]);
  assert.deepEqual(m, { date: 0, amount: 1, concept: 2 });
});

test("J) nombres Data / Import / Concepte (catalán)", () => {
  const m = guessColumnMapping(["Data", "Import", "Concepte"]);
  assert.deepEqual(m, { date: 0, amount: 1, concept: 2 });
});

// ---- K) columnas desconocidas -> sigue permitiendo mapping manual ----

test("K) columnas sin nombre reconocible -> mapping por defecto sin romper, corregible a mano", () => {
  const m = guessColumnMapping(["Columna 1", "Columna 2", "Columna 3"]);
  // No reconoce nada, pero da tres índices distintos y válidos -- el
  // usuario los corrige en los desplegables (eso es UI, no esta función).
  const values = [m.date, m.amount, m.concept];
  assert.equal(new Set(values).size, 3);
  values.forEach((v) => assert.ok(v >= 0 && v < 3));
});

// ---- L) fixture real anonimizado (formato catalán, con preámbulo) ----
// SIN ningún nombre de banco ni `if` específico -- pasa porque el parser
// genérico ya sabe manejar preámbulo + cabecera en catalán + separador ;.

test("L) fixture real anonimizado: preámbulo + cabecera catalana + separador ;", () => {
  const csv = [
    ";;;;;;",
    ";;Últims moviments;;;;",
    ";;Data de generació: 19/08/2026;;;;",
    ";;;;;;",
    "D. valor;Data;Concepte;Moviment;Import;Divisa;Observacions",
    "15/08/2026;16/08/2026;MERCADONA;Compra;-45,30;EUR;",
    "14/08/2026;15/08/2026;NOMINA;Abonament;1500,00;EUR;",
  ].join("\n");

  const parsedCsv = parseCsv(csv);
  assert.equal(parsedCsv.headerDetected, true);
  assert.deepEqual(parsedCsv.headers, ["D. valor", "Data", "Concepte", "Moviment", "Import", "Divisa", "Observacions"]);
  assert.equal(parsedCsv.rows.length, 2);

  const mapping = guessColumnMapping(parsedCsv.headers);
  assert.equal(mapping.date, 1); // "Data", no "D. valor"
  assert.equal(mapping.amount, 4); // "Import"
  assert.equal(mapping.concept, 2); // "Concepte"

  const sign = suggestExpenseSign(parsedCsv.rows, mapping);
  assert.equal(sign, "negative"); // 1 negativo, 1 positivo -> empate se resuelve a "negative"

  const { parsed } = buildParsedRows(parsedCsv.rows, mapping, sign);
  assert.equal(parsed.length, 2); // v2: ya no se descarta el ingreso, se clasifica
  const expense = parsed.find((r) => r.classification === "expense");
  assert.equal(expense.concept, "MERCADONA");
  assert.equal(expense.amount, 45.30);
  assert.equal(parsed.find((r) => r.concept === "NOMINA").classification, "income");
});

// ---- Extra: controlCharRatio, base de decodeCsvBytes ----

test("controlCharRatio: texto normal con acentos da una proporción ~0", () => {
  const ratio = controlCharRatio("Fecha;Concepto;Importe\n01/08/2026;MERCADONA (café);-45,30\n");
  assert.ok(ratio < 0.02, "ratio=" + ratio);
});

test("controlCharRatio: contenido binario da una proporción alta", () => {
  // Bytes de control reales (no imprimibles), como los que aparecen tras
  // los "PK" iniciales de cualquier ZIP (p. ej. un .xlsx leído como texto).
  var binaryish = "PK" + String.fromCharCode(3, 4, 0, 1, 2, 5, 6, 7, 8, 11, 14, 15) + "resto de basura binaria";
  const ratio = controlCharRatio(binaryish);
  assert.ok(ratio > 0.02, "ratio=" + ratio);
});

// ---- XLSX: mismo criterio de cabecera que el CSV, para hojas ya partidas
// en celdas (lo que entrega SheetJS con {header:1}) ----

test("buildHeaderedTableFromRows: cabecera reconocible en la primera fila", () => {
  const rows = [["Fecha", "Concepto", "Importe"], ["01/08/2026", "MERCADONA", "-45,30"]];
  const t = buildHeaderedTableFromRows(rows);
  assert.equal(t.headerDetected, true);
  assert.deepEqual(t.headers, ["Fecha", "Concepto", "Importe"]);
  assert.equal(t.rows.length, 1);
});

test("buildHeaderedTableFromRows: preámbulo antes de la cabecera (como una hoja de resumen pegada encima)", () => {
  const rows = [
    ["Extracto generado el 01/08/2026", "", ""],
    ["", "", ""],
    ["Data", "Concepte", "Import"],
    ["01/08/2026", "MERCADONA", "-45,30"],
  ];
  const t = buildHeaderedTableFromRows(rows);
  assert.equal(t.headerDetected, true);
  assert.deepEqual(t.headers, ["Data", "Concepte", "Import"]);
  assert.equal(t.rows.length, 1);
});

test("buildHeaderedTableFromRows: sin cabecera reconocible -> Columna N, sin perder la primera fila", () => {
  const rows = [["01/08/2026", "MERCADONA", "-45,30"]];
  const t = buildHeaderedTableFromRows(rows);
  assert.equal(t.headerDetected, false);
  assert.deepEqual(t.headers, ["Columna 1", "Columna 2", "Columna 3"]);
  assert.equal(t.rows.length, 1);
});

test("pickBestXlsxTable: varias hojas -> elige la primera con cabecera reconocible, no la primera hoja a ciegas", () => {
  const sheets = [
    { name: "Resumen", rows: [["Gráfico de gastos", ""], ["", ""]] },
    { name: "Movimientos", rows: [["Fecha", "Concepto", "Importe"], ["01/08/2026", "MERCADONA", "-45,30"]] },
  ];
  const t = pickBestXlsxTable(sheets);
  assert.equal(t.sheetName, "Movimientos");
  assert.equal(t.headerDetected, true);
});

test("pickBestXlsxTable: ninguna hoja con cabecera reconocible -> recae en la primera", () => {
  const sheets = [
    { name: "Hoja1", rows: [["01/08/2026", "MERCADONA", "-45,30"]] },
    { name: "Hoja2", rows: [["02/08/2026", "CARREFOUR", "-12,00"]] },
  ];
  const t = pickBestXlsxTable(sheets);
  assert.equal(t.sheetName, "Hoja1");
  assert.equal(t.headerDetected, false);
});

// ---- Nómina (MVP informativo): solo detecta por palabra clave en el
// concepto, nunca por ser un importe grande ----

test("looksLikePayroll: reconoce nomina/salario/payroll en ES/EN, sin acento y con acento", () => {
  assert.equal(looksLikePayroll("NOMINA EMPRESA SA"), true);
  assert.equal(looksLikePayroll("Pago de nómina agosto"), true);
  assert.equal(looksLikePayroll("SALARY XYZ CORP"), true);
  assert.equal(looksLikePayroll("Transferencia sueldo"), true);
});

test("looksLikePayroll: un ingreso grande sin la palabra clave no cuenta como nómina", () => {
  assert.equal(looksLikePayroll("TRANSFERENCIA DE JUAN"), false);
  assert.equal(looksLikePayroll(""), false);
});

test("buildParsedRows anota looksLikePayroll por fila, independiente de la clasificación", () => {
  const rows = [["01/08/2026", "NOMINA EMPRESA", "1500,00"]];
  const { parsed } = buildParsedRows(rows, MAPPING, "negative");
  assert.equal(parsed[0].classification, "income");
  assert.equal(parsed[0].looksLikePayroll, true);
});

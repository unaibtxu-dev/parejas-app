// Parser genérico de extractos bancarios en CSV. Puro (sin DOM ni
// Firestore) para poder testearlo con node:test, igual que debt-calc.js.
//
// Motivado por un fallo real: un extracto de un banco real (formato
// catalán, con líneas informativas antes de la cabecera y nombres de
// columna distintos a los que el parser anterior conocía) no se pudo
// importar. La corrección NO es un caso especial para ese banco — es una
// generalización del pipeline para que cualquier CSV con esa forma
// (preámbulo, cabecera en otro idioma, separador distinto, gastos en
// positivo o negativo) funcione igual. Ningún nombre de banco aparece en
// este archivo.
//
// Pipeline, cada paso una función aparte (para poder testear cada decisión
// por separado, no todas mezcladas):
//   bytes -> decodeCsvBytes -> texto
//   texto -> parseCsv -> { headers, rows, headerDetected, delimiter }
//   headers -> guessColumnMapping -> { date, amount, concept }
//   rows -> suggestExpenseSign -> "negative" | "positive"
//   (rows, mapping, sign) -> buildParsedRows -> { parsed, diagnostics }
//   diagnostics -> diagnosticMessage -> string | null
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CsvImport = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ============ Decodificación ============ */

  // Cuenta caracteres de control (fuera de tab/salto de línea) en una
  // muestra del texto -- una densidad alta es la señal genérica de "esto no
  // es texto de verdad", sea binario o una decodificación equivocada. No
  // usamos solo el carácter de sustitución (U+FFFD) porque windows-1252 es
  // una tabla completa de 256 valores: NUNCA produce U+FFFD, así que un
  // archivo binario decodificado como windows-1252 "tendría éxito" sin esta
  // segunda comprobación.
  function controlCharRatio(text) {
    var sample = text.slice(0, 4000);
    if (!sample.length) return 0;
    var control = 0;
    for (var i = 0; i < sample.length; i++) {
      var code = sample.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) control++;
    }
    return control / sample.length;
  }

  var BINARY_THRESHOLD = 0.02;

  // UTF-8 primero. Si tiene pinta de no ser texto de verdad (carácter de
  // sustitución, o demasiados caracteres de control), se intenta
  // windows-1252 -- el fallback más común para extractos bancarios
  // guardados con un editor/Excel antiguo en Windows. Sin dependencias: usa
  // TextDecoder, disponible en cualquier navegador real. Si el entorno no
  // soporta el decodificador windows-1252 (algunos Node sin ICU completo),
  // se degrada a quedarse con el UTF-8 sin romper nada.
  function decodeCsvBytes(buffer) {
    var utf8 = new TextDecoder("utf-8").decode(buffer);
    var utf8Bad = utf8.indexOf("�") !== -1 || controlCharRatio(utf8) > BINARY_THRESHOLD;
    if (!utf8Bad) return { text: utf8, encoding: "utf-8", looksBinary: false };

    try {
      var legacy = new TextDecoder("windows-1252").decode(buffer);
      if (controlCharRatio(legacy) <= BINARY_THRESHOLD) {
        return { text: legacy, encoding: "windows-1252", looksBinary: false };
      }
    } catch (e) {
      // Decodificador no disponible en este entorno -- seguimos con UTF-8.
    }
    return { text: utf8, encoding: "utf-8", looksBinary: true };
  }

  /* ============ Delimitador y filas ============ */

  function countChar(line, ch) {
    var n = 0;
    for (var i = 0; i < line.length; i++) if (line[i] === ch) n++;
    return n;
  }

  // Puntos base a partir de contar cuántas líneas comparten el mismo número
  // de apariciones de cada delimitador candidato -- un separador real
  // produce un recuento consistente línea a línea (una vez por columna);
  // uno equivocado varía más, porque solo aparece por casualidad dentro del
  // texto de algunas celdas.
  function detectDelimiter(lines) {
    var candidates = [";", ","];
    var scored = candidates.map(function (d) {
      var counts = lines.slice(0, 20).map(function (l) { return countChar(l, d); });
      var nonZero = counts.filter(function (c) { return c > 0; });
      if (!nonZero.length) return { d: d, score: 0 };
      var freq = {};
      nonZero.forEach(function (c) { freq[c] = (freq[c] || 0) + 1; });
      var bestScore = 0;
      Object.keys(freq).forEach(function (k) { if (freq[k] > bestScore) bestScore = freq[k]; });
      return { d: d, score: bestScore };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].score > 0 ? scored[0].d : ";";
  }

  function parseLine(line, delimiter) {
    var cells = [], cur = "", inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
        } else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells.map(function (c) { return c.trim(); });
  }

  /* ============ Cabecera ============ */

  // Genéricas, ES/CAT/EN -- deliberadamente sin ningún nombre de banco.
  // Orden de más específico a más genérico dentro de cada grupo: importa
  // para guessColumnMapping (abajo), que asigna la primera columna libre
  // que encaje, en este orden.
  var COLUMN_KEYWORDS = {
    date: ["fecha valor", "f. valor", "f valor", "fecha operacion", "fecha operación", "fecha", "data", "date"],
    amount: ["importe", "import", "amount", "cantidad", "monto"],
    concept: ["concepto", "concepte", "descripcion", "descripción", "descripcio", "descripció", "detalle", "observaciones"]
  };

  function isRecognizedColumnName(cell) {
    var c = (cell || "").toLowerCase().trim();
    if (!c) return false;
    var all = COLUMN_KEYWORDS.date.concat(COLUMN_KEYWORDS.amount, COLUMN_KEYWORDS.concept);
    return all.some(function (kw) { return c.indexOf(kw) !== -1; });
  }

  // Busca, entre las primeras `maxScan` líneas, la primera que tenga
  // suficientes señales de ser una cabecera real: varias celdas no vacías,
  // y al menos 2 de ellas con un nombre de columna reconocible. No asume
  // nunca que la línea 0 es la cabecera -- así se ignoran líneas
  // informativas de preámbulo (título del extracto, fecha de generación,
  // líneas en blanco con solo delimitadores...).
  function detectHeaderRowIndex(lines, delimiter, maxScan) {
    var limit = Math.min(lines.length, maxScan || 20);
    for (var i = 0; i < limit; i++) {
      var cells = parseLine(lines[i], delimiter);
      var nonEmpty = cells.filter(function (c) { return c !== ""; });
      if (nonEmpty.length < 2) continue;
      var recognized = cells.filter(isRecognizedColumnName).length;
      if (recognized >= 2) return i;
    }
    return -1;
  }

  // Entrada principal del pipeline de texto -> filas. Si no se detecta
  // ninguna cabecera con suficiente confianza en las primeras líneas, NO se
  // inventa una -- se generan nombres genéricos ("Columna 1", "Columna 2"...)
  // y TODAS las líneas (incluida la primera) se tratan como datos, para no
  // perder nunca la primera transacción de un archivo sin cabecera.
  function parseCsv(text) {
    text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = text.split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return { headers: [], rows: [], headerDetected: false, delimiter: ";" };

    var delimiter = detectDelimiter(lines);
    var headerIdx = detectHeaderRowIndex(lines, delimiter, 20);

    if (headerIdx === -1) {
      var width = parseLine(lines[0], delimiter).length;
      var headers = [];
      for (var i = 0; i < width; i++) headers.push("Columna " + (i + 1));
      var rows = lines.map(function (l) { return parseLine(l, delimiter); });
      return { headers: headers, rows: rows, headerDetected: false, delimiter: delimiter };
    }

    var headerCells = parseLine(lines[headerIdx], delimiter);
    var dataRows = lines.slice(headerIdx + 1).map(function (l) { return parseLine(l, delimiter); });
    return { headers: headerCells, rows: dataRows, headerDetected: true, delimiter: delimiter };
  }

  /* ============ Mapping de columnas ============ */

  // Se calcula en orden (fecha, luego importe, luego concepto) y cada
  // columna ya asignada queda excluida de las siguientes búsquedas -- si
  // no, "valor" encontraría antes una columna de fecha valor que la de
  // importe, porque para algunos bancos "valor" también aparece en el
  // nombre de la columna de fecha, no solo en la de dinero.
  function guessColumnMapping(headers) {
    var lower = headers.map(function (h) { return h.toLowerCase(); });
    var used = {};

    function find(keywordGroup) {
      for (var g = 0; g < keywordGroup.length; g++) {
        for (var i = 0; i < lower.length; i++) {
          if (used[i]) continue;
          if (lower[i].indexOf(keywordGroup[g]) !== -1) return i;
        }
      }
      return -1;
    }

    var dateIdx = find(COLUMN_KEYWORDS.date);
    if (dateIdx !== -1) used[dateIdx] = true;

    var amountIdx = find(COLUMN_KEYWORDS.amount);
    if (amountIdx !== -1) used[amountIdx] = true;

    var conceptIdx = find(COLUMN_KEYWORDS.concept);

    function firstFree(preferred) {
      if (preferred !== -1 && !used[preferred]) return preferred;
      for (var i = 0; i < headers.length; i++) { if (!used[i]) return i; }
      return 0;
    }

    // Si nada se reconoce, se devuelven las tres primeras columnas libres
    // -- una suposición razonable de partida, nunca definitiva: el usuario
    // siempre puede corregirla en los desplegables antes de continuar.
    return {
      date: dateIdx !== -1 ? dateIdx : firstFree(0),
      amount: amountIdx !== -1 ? amountIdx : firstFree(1),
      concept: conceptIdx !== -1 ? conceptIdx : firstFree(2)
    };
  }

  /* ============ Importe y fecha ============ */

  // Admite "1.234,56" (España), "1234.56" (genérico) y "-12,50".
  function parseAmountFlexible(str) {
    if (str == null) return null;
    var s = String(str).trim().replace(/[€\s]/g, "");
    if (!s) return null;
    var negative = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/^[-+]/, "").replace(/[()]/g, "");
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (s.indexOf(",") !== -1) {
      s = s.replace(",", ".");
    }
    var n = parseFloat(s);
    if (isNaN(n)) return null;
    return negative ? -n : n;
  }

  // Admite dd/mm/yyyy, dd-mm-yyyy y yyyy-mm-dd (con / o -).
  function parseDateFlexible(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return null;
  }

  /* ============ Signo e interpretación de gastos ============ */

  // Punto de extensión para el futuro formato "Cargo | Abono" (dos
  // columnas de importe en vez de una con signo): el día que haga falta,
  // `mapping` pasaría a tener `cargo`/`abono` en vez de `amount`, y esta es
  // la ÚNICA función que tendría que aprender a combinarlos en un importe
  // con signo (p. ej. cargo -> negativo, abono -> positivo). Ningún otro
  // paso del pipeline necesitaría cambiar.
  function resolveRowAmount(row, mapping) {
    if (mapping.amount == null) return null;
    return parseAmountFlexible(row[mapping.amount]);
  }

  // Sugerencia automática de si los gastos vienen en negativo o positivo en
  // este archivo -- nunca se aplica ciegamente: es solo la opción
  // preseleccionada, el usuario puede cambiarla (ver PHASE_CSV_GENERIC.md).
  function suggestExpenseSign(rows, mapping) {
    var neg = 0, pos = 0;
    rows.forEach(function (row) {
      var amount = resolveRowAmount(row, mapping);
      if (amount == null || amount === 0) return;
      if (amount < 0) neg++; else pos++;
    });
    return pos > neg ? "positive" : "negative";
  }

  /* ============ Clasificación sugerida (usuario confirma en preview) ============ */
  //
  // Genéricas, sin ningún nombre de banco. "sign" (elegido/sugerido en el
  // paso anterior) solo orienta qué lado es "coste" -- ya no se usa para
  // descartar filas del lado contrario, porque ahí es donde viven los
  // reembolsos/ingresos que ahora sí queremos ver en el preview.
  var TRANSFER_KEYWORDS = ["bizum", "transferencia", "traspaso"];
  var BIZUM_KEYWORDS = ["bizum"];
  // Deliberadamente estrecho: una transferencia/bizum genérico NUNCA basta
  // para "internal_transfer" -- solo evidencia explícita de traspaso entre
  // cuentas del propio titular. Todo lo demás con palabra de transferencia
  // cae en "needs_review", nunca se auto-clasifica como movimiento interno.
  // El redondeo/ahorro automático de compra (p. ej. "redondeo ahorro",
  // "hucha digital") es igualmente explícito: el dinero se mueve a un
  // producto de ahorro propio, nunca es un gasto normal.
  var STRONG_INTERNAL_TRANSFER_KEYWORDS = [
    "traspaso entre cuentas propias", "traspaso a cuenta propia", "misma titularidad",
    "redondeo", "hucha", "ahorro automatico", "ahorro automático"
  ];
  var REIMBURSEMENT_KEYWORDS = ["devolucion", "devolución", "reembolso", "abono comercio"];

  function classifyRow(concept, amount, sign) {
    var c = (concept || "").toLowerCase();
    if (amount === 0) return "ignore";
    if (STRONG_INTERNAL_TRANSFER_KEYWORDS.some(function (k) { return c.indexOf(k) !== -1; })) return "internal_transfer";
    var expenseSide = sign === "positive" ? amount > 0 : amount < 0;
    // Un Bizum recibido (no está en el lado de gasto) es casi siempre dinero
    // que te manda otra persona -- se sugiere income directamente, a
    // diferencia del resto de transferencias genéricas (que siguen siendo
    // ambiguas y caen en needs_review). Un Bizum enviado sigue sin
    // auto-clasificarse como gasto: puede ser pagar a un amigo, no un gasto
    // propio.
    if (!expenseSide && BIZUM_KEYWORDS.some(function (k) { return c.indexOf(k) !== -1; })) return "income";
    if (TRANSFER_KEYWORDS.some(function (k) { return c.indexOf(k) !== -1; })) return "needs_review";
    if (expenseSide) return "expense";
    if (REIMBURSEMENT_KEYWORDS.some(function (k) { return c.indexOf(k) !== -1; })) return "reimbursement";
    return "income";
  }

  /* ============ Concepto para mostrar (distinto de agrupar) ============ */
  //
  // normalizeConcept() (en app.js) sirve para AGRUPAR gastos recurrentes --
  // agresivo a propósito (quita todo lo que no sea letra/número). Para
  // MOSTRAR el concepto al usuario hace falta lo contrario: legible, no
  // una clave de agrupación. Por eso es una función distinta, no una
  // reutilización de normalizeConcept con otro uso.
  function cleanConceptForDisplay(concept) {
    var c = (concept || "").trim().replace(/\s+/g, " ");
    c = c.replace(/\b\d{4,}\b/g, "").replace(/\s+/g, " ").trim(); // fuera referencias/códigos largos
    if (!c) return (concept || "").trim();
    // Capitaliza la primera letra de cada palabra sin \b/\w: esas clases solo
    // reconocen [A-Za-z0-9_], así que una letra acentuada (á, é, í, ó, ú, ñ...)
    // cuenta como límite de palabra y desplaza la mayúscula a la letra
    // siguiente -- "cafetería" se convertía en "cafeteríA". Capitalizar tras
    // inicio-de-cadena o espacio evita el problema para cualquier alfabeto.
    return c.replace(/(^|\s)(\S)/g, function (_, sep, ch) { return sep + ch.toUpperCase(); });
  }

  /* ============ Huella para detectar posibles duplicados ============ */
  //
  // "Posible duplicado", nunca certeza -- ver PHASE_CSV_V2.md. Réplica
  // local y ligera del recorte de normalizeConcept (no se importa de
  // app.js: este módulo no depende de app.js).
  function computeFingerprint(dateObj, amountAbs, concept) {
    var d = dateObj instanceof Date
      ? dateObj.getFullYear() + "-" + (dateObj.getMonth() + 1) + "-" + dateObj.getDate()
      : String(dateObj);
    var normalized = (concept || "").toLowerCase()
      .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, "")
      .replace(/\b\d{4,}\b/g, "")
      .replace(/[^a-z0-9áéíóúñ ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return d + "|" + Math.round(amountAbs * 100) + "|" + normalized;
  }

  // Anota duplicado histórico (posible, no certeza) contra huellas ya
  // conocidas -- ver nota sobre el límite de 500 en PHASE_CSV_V2.md: esto
  // es best-effort, no exhaustivo.
  function markHistoricDuplicates(parsedRows, existingFingerprints) {
    parsedRows.forEach(function (r) {
      r.duplicateInHistory = existingFingerprints.indexOf(r.fingerprint) !== -1;
    });
  }

  // Ya no se descartan las filas del signo contrario al elegido -- eso
  // habría tirado los reembolsos/ingresos antes de poder verlos. El signo
  // solo alimenta classifyRow() para decidir qué lado es "coste". Nunca se
  // hace Math.abs() sin pasar antes por la clasificación.
  function buildParsedRows(rows, mapping, sign) {
    var diagnostics = { totalRows: rows.length, validDates: 0, validAmounts: 0, byClassification: {} };
    var parsed = [];
    var fingerprintCounts = {};

    rows.forEach(function (row) {
      var date = parseDateFlexible(row[mapping.date]);
      var amount = resolveRowAmount(row, mapping);
      var concept = (row[mapping.concept] || "").trim();
      if (date) diagnostics.validDates++;
      if (amount != null) diagnostics.validAmounts++;
      if (!date || amount == null) return;

      var classification = classifyRow(concept, amount, sign);
      diagnostics.byClassification[classification] = (diagnostics.byClassification[classification] || 0) + 1;
      var amountAbs = Math.round(Math.abs(amount) * 100) / 100;
      var fingerprint = computeFingerprint(date, amountAbs, concept);
      fingerprintCounts[fingerprint] = (fingerprintCounts[fingerprint] || 0) + 1;

      parsed.push({
        date: date, amount: amountAbs, signedAmount: amount, concept: concept,
        classification: classification, fingerprint: fingerprint,
        duplicateInFile: false, duplicateInHistory: false
      });
    });

    parsed.forEach(function (r) { r.duplicateInFile = fingerprintCounts[r.fingerprint] > 1; });
    parsed.sort(function (a, b) { return a.date - b.date; });
    return { parsed: parsed, diagnostics: diagnostics };
  }

  // Distingue por qué no ha salido ningún movimiento utilizable, en vez de
  // un único mensaje rígido.
  function diagnosticMessage(diagnostics) {
    if (!diagnostics || diagnostics.totalRows === 0) return "El archivo no tiene filas de datos.";
    if (diagnostics.validDates === 0) return "No hemos encontrado ninguna fecha válida en la columna elegida. Revisa la selección.";
    if (diagnostics.validAmounts === 0) return "No hemos encontrado ningún importe válido en la columna elegida. Revisa la selección.";
    var totalClassified = Object.keys(diagnostics.byClassification || {}).reduce(function (s, k) { return s + diagnostics.byClassification[k]; }, 0);
    if (totalClassified === 0) return "No hemos encontrado ningún movimiento con fecha e importe válidos. Revisa la selección.";
    return null;
  }

  return {
    controlCharRatio: controlCharRatio,
    decodeCsvBytes: decodeCsvBytes,
    detectDelimiter: detectDelimiter,
    parseLine: parseLine,
    COLUMN_KEYWORDS: COLUMN_KEYWORDS,
    detectHeaderRowIndex: detectHeaderRowIndex,
    parseCsv: parseCsv,
    guessColumnMapping: guessColumnMapping,
    parseAmountFlexible: parseAmountFlexible,
    parseDateFlexible: parseDateFlexible,
    resolveRowAmount: resolveRowAmount,
    suggestExpenseSign: suggestExpenseSign,
    buildParsedRows: buildParsedRows,
    diagnosticMessage: diagnosticMessage,
    classifyRow: classifyRow,
    cleanConceptForDisplay: cleanConceptForDisplay,
    computeFingerprint: computeFingerprint,
    markHistoricDuplicates: markHistoricDuplicates
  };
});

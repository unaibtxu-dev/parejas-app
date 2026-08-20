# Importador CSV v2 — clasificación, duplicados, deshacer

Sobre `PHASE_CSV_GENERIC.md` (pipeline base). Sin commit/push. Motor contable sin tocar.

## Decisiones (ver ajustes del usuario, aplicados literalmente)

- `buildParsedRows()` ya no descarta el signo contrario — ambas polaridades quedan en `parsed`, cada fila con `classification` (`expense|internal_transfer|reimbursement|income|needs_review|ignore`). `sign` ahora solo orienta la sugerencia, no filtra.
- Bizum/transferencia/traspaso genéricos → `needs_review`. `internal_transfer` solo con frase explícita de traspaso entre cuentas propias (lista deliberadamente estrecha, sin nombres de banco).
- `cleanConceptForDisplay()` (nueva, en `csv-import.js`) — no reutiliza `normalizeConcept()` (sigue en `app.js`, solo para agrupar recurrentes).
- `computeFingerprint()`: "posible duplicado" (dentro del CSV y contra `state.allExpenses`, tope 500 → best-effort documentado), nunca certeza; no bloquea.
- Nunca se persiste texto bancario crudo: `place` = concepto saneado, `note` vacío.
- `linkedExpenseId`/reembolso: solo documentado, no persistido.
- Recurrentes: `detectRecurring()` solo sobre filas `classification === "expense"` en el momento del preview (no se recalcula si el usuario reclasifica después — limitación conocida, aceptada por presupuesto).
- `importBatchId` en cada gasto; `undoImportBatch()` borra por query `spaceId+importBatchId`, chunks de 450.

## Archivos

`csv-import.js` (+7 funciones puras), `app.js` (preview con selector de clasificación + badges, `confirmImport`/`undoImportBatch`/`showImportSummary`), `index.html` (paso 4: resumen+deshacer), `test/csv-import.test.js` (F/G/H/L reescritos + 8 nuevos).

## Tests

22/22 (navegador V8; Node no disponible). Verificado además end-to-end en DOM real (subida simulada, 3 filas mixtas → 1 expense marcado, 2 sin marcar, clasificación correcta).

## Riesgos

1. Recurrentes no se recalculan tras reclasificar en preview (documentado arriba).
2. Duplicado histórico limitado a los 500 gastos más recientes en memoria.
3. `node --test` sigue sin ejecutarse literalmente aquí.
4. `app.js`/`index.html` siguen mezclando esto con Fase 5 (economicSplit) y CSV v1 sin comitear.

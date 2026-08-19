# Sample fiscal exports — for the Steuerberater's review

Roman signed off on the **parameters**; the accountant still needs to see actual
**output**. These files are the REAL output of the production export builders,
run over representative one-day fixture data (business day **2026-06-06**).

Regenerate any time with:

```
pnpm --filter @norns/api-cloud test generate-fiscal-samples
```

(The generator lives at `apps/api-cloud/tests/unit/generate-fiscal-samples.test.ts`
and calls the same `generateDatevCsv` / `buildKassenberichtCsv` the live
`/api/closings/:id/export/*` routes use — no hand-faked output.)

## Files

| File | Format | Built by |
|------|--------|----------|
| `DATEV_Buchungsstapel_2026-06-06.csv` | DATEV EXTF format 700, Buchungsstapel (category 21) | `src/lib/datev-export.ts` |
| `Kassenbericht_2026-06-06.csv` | KassenSichV daily cash report (German labelled CSV) | `src/lib/kassenbericht-export.ts` |

The sample day contains: three VERKAUF (one each of **STANDARD_19**, **MARGIN_25A
§25a**, **INVESTMENT_GOLD_25C §25c**), one ANKAUF, a −2,00 € cash-count variance,
and a clean TSE.

## ⚠️ OPEN QUESTION FOR THE STEUERBERATER — DATEV revenue accounts

The DATEV export currently posts **every VERKAUF to the single revenue account
`8400` (Erlöse 19% USt)** as the contra account (`Gegenkonto`), **regardless of
`tax_treatment_code`**. You can see this in the sample: all three sales — 19%,
§25a margin, and §25c investment gold — share `Gegenkonto 8400`.

That is almost certainly wrong for the differently-taxed sales:

| `tax_treatment_code` | Meaning | SKR03 revenue account? |
|---|---|---|
| `STANDARD_19` | 19 % USt | `8400`? (to confirm) |
| `REDUCED_7` | 7 % USt | **?** |
| `MARGIN_25A` | Differenzbesteuerung § 25a | **?** |
| `INVESTMENT_GOLD_25C` | steuerfreie Anlagegold-Lieferung § 25c | **?** |

**Question:** which SKR03 revenue account should each `tax_treatment_code` map
to? Once you confirm, we replace the single `KONTO_ERLOESE` constant with a
per-treatment lookup (see the marked `TODO(steuerberater)` in
`apps/api-cloud/src/routes/closing-export.ts`). We deliberately did **not** guess
the account numbers.

## DSFinV-K

There is **no local DSFinV-K sample** here: DSFinV-K is not generated on our side
as a downloadable file. The worker pushes each finalized daily closing to
**Fiskaly's cloud** (`apps/worker/src/jobs/dsfinvk-daily-export.ts` →  ⟵ geloescht am 14.08.2026: der naechtliche Stoss lebte im Arbeiter; die Kasse fuehrt den Export selbst unter Steuer-Export
`src/lib/fiskaly-dsfinvk.ts`), and Fiskaly produces / stores the DSFinV-K bundle
for the Finanzamt. A real DSFinV-K artefact comes from Fiskaly after a live
closing, not from a local builder.

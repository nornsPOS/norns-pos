-- ───────────────────────────────────────────────────────────────────────────
-- 0127 — der Abschluss hält den UMSATZ je Steuersatz, nicht nur die Steuer
--
-- `daily_closings` führt `vat_by_treatment`: die Umsatzsteuer je
-- Steuerbehandlung. Den zugehörigen UMSATZ führt es nicht — nur die Summe
-- über den ganzen Tag (`gross_verkauf_eur`, `net_verkauf_eur`).
--
-- ── Warum das ein Loch im Prüferpaket ist ────────────────────────────────
--
-- `businesscases.csv` ist die Datei, aus der ein Prüfer den TAGESUMSATZ je
-- Steuersatz liest. Sie verlangt drei Beträge: `Z_UMS_BRUTTO`, `Z_UMS_NETTO`
-- und `Z_UST`. Wir konnten nur den dritten füllen.
--
-- Der Umsatzblock des Kassenabschlusses enthielt damit keinen einzigen
-- Umsatz.
--
-- ── Warum es nicht ausgerechnet werden darf ──────────────────────────────
--
-- Aus der Steuer liesse sich der Umsatz zurückrechnen: 3,19 EUR bei 19/119
-- ergibt 20,00 EUR Marge. Aber:
--
--   • Bei § 25a ist die Bemessungsgrundlage die MARGE, nicht der Umsatz. Der
--     Rückweg führt also auf die falsche Zahl.
--   • Bei § 25c und § 13b ist die Steuer null; aus null lässt sich nichts
--     zurückrechnen.
--   • Und jede Rückrechnung kann dem Beleg widersprechen, den der Kunde in
--     der Hand hielt. Genau das darf ein Prüferpaket nie.
--
-- Also wird der Umsatz beim Festschreiben AUFGEZEICHNET, so wie die Steuer.
--
-- ── Gemessen (28.07.2026) ────────────────────────────────────────────────
--
--     daily_closings auf der Produktion   0 festgeschriebene Zeilen
--     im Simulationsmandanten            22 Zeilen, alle ohne Umsatz je Satz
--
-- Es ist also nichts nachzutragen: die Spalte beginnt leer und füllt sich mit
-- dem nächsten Abschluss. Ein Rückrechnen der 22 Simulationszeilen wäre genau
-- der Fehler, den dieser Kopf beschreibt.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS umsatz_by_treatment JSONB;

COMMENT ON COLUMN daily_closings.umsatz_by_treatment IS
  'Umsatz je Steuerbehandlung, als {code: {brutto, netto}}. Gegenstück zu '
  'vat_by_treatment. Wird beim Festschreiben AUFGEZEICHNET, nie aus der Steuer '
  'zurückgerechnet: bei § 25a ist die Bemessungsgrundlage die Marge, und bei '
  'steuerfreien Umsätzen führt der Rückweg ins Leere. Gebraucht für '
  'businesscases.csv (DSFinV-K), die Datei, aus der ein Prüfer den Tagesumsatz '
  'je Steuersatz liest.';

-- ── Die Spaltenrechte-Falle, zum fünften Mal ─────────────────────────────
DO $$
DECLARE r TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.column_privileges
     WHERE table_name = 'daily_closings' AND privilege_type = 'UPDATE'
       AND grantee NOT IN ('PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT INSERT (umsatz_by_treatment), UPDATE (umsatz_by_treatment) '
      'ON daily_closings TO %I', r);
  END LOOP;
END $$;

-- ── Die Selbstprüfung ────────────────────────────────────────────────────
DO $$
DECLARE fehlt INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='daily_closings' AND column_name='umsatz_by_treatment') THEN
    RAISE EXCEPTION '0127: die Spalte umsatz_by_treatment wurde nicht angelegt';
  END IF;

  SELECT count(*) INTO fehlt
    FROM (SELECT DISTINCT grantee FROM information_schema.column_privileges
           WHERE table_name='daily_closings' AND privilege_type='UPDATE'
             AND grantee NOT IN ('PUBLIC')) g
   WHERE NOT has_column_privilege(g.grantee,'daily_closings','umsatz_by_treatment','INSERT');
  IF fehlt > 0 THEN
    RAISE EXCEPTION '0127: % Rolle(n) duerfen umsatz_by_treatment nicht schreiben — '
      'der Abschluss schluege LIVE fehl, waehrend lokal alles gruen ist', fehlt;
  END IF;
END $$;

COMMIT;

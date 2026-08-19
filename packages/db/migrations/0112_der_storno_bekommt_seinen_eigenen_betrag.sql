-- 0112 — Der Storno bekommt seinen eigenen Betrag, und der Tag lässt sich wieder abschliessen.
--
-- ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
--
-- Migration 0011 widerspricht sich selbst, in derselben Datei:
--
--   Zeile  72:  -- Money totals (net of storno via the negative-amount arithmetic)
--   Zeile 152:  -- Gross totals are always non-negative
--
-- Beides kann nicht stimmen. Der Tagesabschluss summiert
--
--   SUM(total_eur) FILTER (WHERE direction = 'VERKAUF')
--
-- und zählt damit die NEGATIVEN Stornozeilen mit, während
-- `daily_closings_gross_non_negative` einen negativen Bruttowert verbietet.
-- Die Stückzahlen daneben schliessen den Storno korrekt aus
-- (`storno_of_transaction_id IS NULL`), die Summe nicht.
--
-- ── WANN DAS ZUSCHLÄGT, und es ist kein Sonderfall ─────────────────────────
--
-- Solange ein Storno denselben Tag betrifft wie sein Beleg, heben sich +X und
-- −X auf und der Brutto landet bei null. Gemessen: es gibt KEINE Regel, die
-- einen Storno auf den Tag seines Belegs beschränkt, weder im Server noch in
-- der Datenbank.
--
-- Also der wirkliche Ablauf: eine Kundin bringt am Dienstag ein Schmuckstück
-- zurück, das sie vorige Woche gekauft hat. Der Dienstag trägt −3.000 ohne
-- die zugehörigen +3.000. Liegt der Tagesumsatz darunter, ist der Brutto
-- negativ, `INSERT` verletzt die Bedingung, der Fehler wird auf 409 abgebildet
-- — und der Tag lässt sich NIE abschliessen. Ohne Z-Bon-Zeile liefern DATEV,
-- Kassenbericht und DSFinV-K für diesen Tag gar nichts.
--
-- In einem Laden, in dem ein einzelnes Stück vierstellig sein kann, ist das
-- ein Dienstag, kein Ausnahmefall.
--
-- ── UND ES IST OHNEHIN VORGESCHRIEBEN ──────────────────────────────────────
--
-- BFH, Urteil vom 29.07.2025, X R 23-24/21, Leitsatz 1: ein Kassensystem, das
-- Stornierungen zulässt und sie in den Tagesabschlüssen NICHT ausweist,
-- begründet eine Schätzungsbefugnis. Bisher steht im Abschluss nur die
-- STÜCKZAHL der Stornos, nie ein Betrag. Der Betrag gehört also aus zwei
-- Gründen hierher: damit der Tag rechnet, und damit er standhält.
--
-- ── DIE NEUE BEDEUTUNG, ausdrücklich ───────────────────────────────────────
--
--   gross_verkauf_eur    Verkäufe VOR Stornierung, immer >= 0
--   storno_verkauf_eur   die stornierten Beträge, als POSITIVE Grösse
--   tatsächlicher Umsatz = gross_verkauf_eur − storno_verkauf_eur
--
-- Das ist eine Bedeutungsänderung, keine Ergänzung. Deshalb werden die
-- bestehenden Zeilen unten aus den Belegen neu gerechnet, statt zwei
-- Bedeutungen nebeneinander stehen zu lassen. Die Belege selbst werden nicht
-- angefasst; sie sind die Quelle, aus der gerechnet wird.

BEGIN;

-- ── Die zwei neuen Spalten ─────────────────────────────────────────────────
ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS storno_verkauf_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storno_ankauf_eur  NUMERIC(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_closings.storno_verkauf_eur IS
  'Stornierte Verkaufsbeträge des Tages, als positive Grösse. '
  'Tatsächlicher Umsatz = gross_verkauf_eur - storno_verkauf_eur. '
  'Pflicht nach BFH 29.07.2025 X R 23-24/21: der Betrag, nicht nur die Anzahl.';

COMMENT ON COLUMN daily_closings.storno_ankauf_eur IS
  'Stornierte Ankaufsbeträge des Tages, als positive Grösse.';

COMMENT ON COLUMN daily_closings.gross_verkauf_eur IS
  'Verkäufe VOR Stornierung. Seit 0112 ohne die negativen Stornozeilen; '
  'davor war es die Summe MIT ihnen, was den Wert negativ werden liess und '
  'gegen daily_closings_gross_non_negative verstiess.';

-- Ein Storno kann nicht negativ sein. Ohne diese Bedingung wäre ein
-- Vorzeichenfehler beim Rechnen unsichtbar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_closings_storno_non_negative'
  ) THEN
    ALTER TABLE daily_closings
      ADD CONSTRAINT daily_closings_storno_non_negative
      CHECK (storno_verkauf_eur >= 0 AND storno_ankauf_eur >= 0);
  END IF;
END $$;

-- ── Die bestehenden Zeilen aus den Belegen neu rechnen ─────────────────────
--
-- Nur für Tage, für die es überhaupt Belege gibt. Ein Abschluss, dessen Tag
-- keine Belege trägt, bleibt unangetastet: dort ist 0 sowohl alt als auch neu
-- richtig, und ein UPDATE würde nur so tun, als sei etwas geschehen.
WITH je_tag AS (
  SELECT
    berlin_business_day(finalized_at)                                     AS tag,
    COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'VERKAUF'
                                         AND storno_of_transaction_id IS NULL), 0) AS brutto_verkauf,
    COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'VERKAUF'
                                         AND storno_of_transaction_id IS NULL), 0) AS netto_verkauf,
    COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'ANKAUF'
                                         AND storno_of_transaction_id IS NULL), 0) AS brutto_ankauf,
    COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'ANKAUF'
                                         AND storno_of_transaction_id IS NULL), 0) AS netto_ankauf,
    COALESCE(-SUM(total_eur)   FILTER (WHERE direction = 'VERKAUF'
                                         AND storno_of_transaction_id IS NOT NULL), 0) AS storno_verkauf,
    COALESCE(-SUM(total_eur)   FILTER (WHERE direction = 'ANKAUF'
                                         AND storno_of_transaction_id IS NOT NULL), 0) AS storno_ankauf
  FROM transactions
  GROUP BY 1
)
UPDATE daily_closings d
   SET gross_verkauf_eur  = j.brutto_verkauf,
       net_verkauf_eur    = j.netto_verkauf,
       gross_ankauf_eur   = j.brutto_ankauf,
       net_ankauf_eur     = j.netto_ankauf,
       storno_verkauf_eur = j.storno_verkauf,
       storno_ankauf_eur  = j.storno_ankauf
  FROM je_tag j
 WHERE d.business_day = j.tag;

COMMIT;

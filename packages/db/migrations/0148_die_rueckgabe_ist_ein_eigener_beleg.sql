-- ═══════════════════════════════════════════════════════════════════════════
--  0148 — DIE RÜCKGABE IST EIN EIGENER BELEG (19.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ein Kunde bringt EINEN Ring aus einem Drei-Positionen-Bon zurück. Bis heute
-- kannte die Kasse dafür keinen Weg: der Storno ist ALLES-ODER-NICHTS (eine
-- Spiegelung des ganzen Belegs, transactions_one_storno_per_original_uq), und
-- die Norm verbietet den Positionsstorno am signierten Original ausdrücklich
-- (DSFinV-K 2.4, Tz. 4.2.3: „Sobald die Transaktion in der TSE signiert ist,
-- darf das Feld P_STORNO nicht mehr verwendet werden.").
--
-- Den richtigen Weg beschreibt Tz. 4.2.5 wörtlich: „Kommen in einem Bon
-- Positionen mit negativem Vorzeichen durch z. B. Warenrücknahmen oder
-- Positionsstornos vor, so erfolgt eine Darstellung WIE BEI EINEM NORMALEN
-- VERKAUF. Lediglich das Vorzeichen für das Feld MENGE ändert sich." —
-- ein NEUER Beleg, BON_STORNO = 0, negative Beträge, GV_TYP „Umsatz".
--
-- Umsatzsteuerlich ist das die Minderung der Bemessungsgrundlage in der
-- LAUFENDEN Periode (§ 17 Abs. 1 Satz 8 UStG: „für den Besteuerungszeitraum
-- […], in dem die Änderung der Bemessungsgrundlage eingetreten ist") — die
-- alte Voranmeldung wird nie angefasst.
--
-- ── WAS DIESE WANDERUNG TRÄGT ───────────────────────────────────────────────
--
--  1. Die Rückgabe kennt ihr Original: `rueckgabe_zu_transaction_id`. Anders
--     als beim Storno erzwingt KEIN eindeutiger Index Einmaligkeit — zwei
--     Teilrückgaben zum selben Bon sind Alltag (heute der Ring, morgen die
--     Kette). Was NICHT mehr da ist als verkauft wurde, prüft der Server je
--     Position (Route), nicht das Schema: die Menge lebt in den Positionen.
--
--  2. Die Vorzeichendisziplin lernt den dritten Fall. Bisher: ohne Storno
--     alles >= 0, mit Storno alles <= 0. Eine Rückgabe ist KEIN Storno und
--     trotzdem negativ. Sie bleibt an die Referenz gebunden: ein negativer
--     Beleg OHNE Bezug bleibt verboten — sonst wäre jede erfundene
--     Auszahlung ein „Verkauf".
DO $$
BEGIN
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_sign_discipline;
END $$;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS rueckgabe_zu_transaction_id UUID REFERENCES transactions(id);

COMMENT ON COLUMN transactions.rueckgabe_zu_transaction_id IS
  'Warenrücknahme (DSFinV-K Tz. 4.2.5): dieser Beleg nimmt Positionen des '
  'referenzierten Verkaufs zurück. BON_STORNO bleibt 0; die Beträge sind '
  'negativ. Mehrere Teilrückgaben je Original sind zulässig; dass nie mehr '
  'zurückkommt als verkauft wurde, prüft die Route je Position.';

ALTER TABLE transactions
  ADD CONSTRAINT transactions_sign_discipline CHECK (
    (storno_of_transaction_id IS NULL AND rueckgabe_zu_transaction_id IS NULL
      AND total_eur >= 0 AND subtotal_eur >= 0 AND vat_eur >= 0)
    OR
    (storno_of_transaction_id IS NOT NULL
      AND total_eur <= 0 AND subtotal_eur <= 0 AND vat_eur <= 0)
    OR
    (rueckgabe_zu_transaction_id IS NOT NULL
      AND total_eur <= 0 AND subtotal_eur <= 0 AND vat_eur <= 0)
  );

-- Eine Rückgabe kann nicht auf sich selbst oder auf einen Storno zeigen —
-- das Selbst verbietet der CHECK, den Storno die Route (sie liest das
-- Original ohnehin). Ein Beleg ist nie beides zugleich:
ALTER TABLE transactions
  ADD CONSTRAINT transactions_rueckgabe_nicht_storno CHECK (
    rueckgabe_zu_transaction_id IS NULL OR storno_of_transaction_id IS NULL
  );

ALTER TABLE transactions
  ADD CONSTRAINT transactions_rueckgabe_not_self CHECK (
    rueckgabe_zu_transaction_id IS NULL OR rueckgabe_zu_transaction_id <> id
  );

-- Die Frage des Tresens: „Was wurde zu DIESEM Beleg schon zurückgenommen?"
CREATE INDEX IF NOT EXISTS transactions_rueckgabe_zu_idx
  ON transactions (rueckgabe_zu_transaction_id)
  WHERE rueckgabe_zu_transaction_id IS NOT NULL;

-- Spaltenweise Rechte (Audit A-2): die Namensliste kennt die neue Spalte.
GRANT INSERT (rueckgabe_zu_transaction_id) ON transactions TO warehouse14_app;

-- ── Der Tagesabschluss weist die Rückgabe AUS, statt sie zu verstecken ──────
--
-- Dieselbe Falle wie beim Storno (0112): eine negative Zeile im Brutto macht
-- den Tag unabschliessbar, sobald die Rückgaben die Verkäufe übersteigen
-- (der CHECK verbietet einen negativen Brutto — zu Recht). Und dieselbe
-- Rechtsfolge: BFH 29.07.2025, X R 23-24/21 — ein System, das Minderungen
-- zulässt und sie im Abschluss nicht ausweist, begründet die Schätzung.
-- Also: eigene Spalten, eigene Stückzahl, Brutto bleibt Brutto.
ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS rueckgabe_verkauf_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rueckgabe_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_closings.rueckgabe_verkauf_eur IS
  'Summe der Warenrücknahmen des Tages (rueckgabe_zu_transaction_id gesetzt), '
  'als NEGATIVER Betrag. Eigene Spalte aus demselben Grund wie '
  'storno_verkauf_eur (0112): der Brutto bleibt >= 0, und der Prüfer sieht '
  'die Minderung ausgewiesen statt versteckt (BFH X R 23-24/21).';

GRANT INSERT (rueckgabe_verkauf_eur, rueckgabe_count),
      UPDATE (rueckgabe_verkauf_eur, rueckgabe_count)
  ON daily_closings TO warehouse14_app;

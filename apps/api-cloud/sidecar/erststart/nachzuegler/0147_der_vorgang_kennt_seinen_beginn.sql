-- ═══════════════════════════════════════════════════════════════════════════
--  0147 — DER VORGANG KENNT SEINEN BEGINN (19.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- § 6 Satz 1 Nr. 2 KassenSichV verlangt auf dem Beleg „den Zeitpunkt des
-- Vorgangsbeginns sowie den Zeitpunkt der Vorgangsbeendigung". DSFinV-K 2.4
-- fuehrt dafuer BON_START und BON_ENDE. Diese Kasse hielt bis heute EINEN
-- Zeitpunkt — die Ausfuhr schrieb ehrlich denselben Wert in beide Felder,
-- und auf jedem Beleg lagen Beginn und Ende Sekunden auseinander, egal wie
-- lange der Verkauf dauerte. Ein Pruefer sieht das auf den ersten drei Bons.
--
-- Die Kasse oeffnet den Vorgang jetzt beim ERSTEN Stueck im Korb
-- (lib/vorgangs-uhr.ts) und reicht den Beginn hierher durch. NULL bleibt
-- erlaubt und ehrlich: Wiederanlauf und Web-Abholung kennen den Beginn
-- nicht; die Ausfuhr faellt dann wie bisher auf finalized_at zurueck.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS vorgang_begonnen_at TIMESTAMPTZ;

COMMENT ON COLUMN transactions.vorgang_begonnen_at IS
  'Beginn des Vorgangs an der Kasse (erstes Stueck im Korb). NULL = unbekannt, '
  'dann gilt finalized_at als Beginn UND Ende (Stand vor 0147). Speist '
  'BON_START der DSFinV-K-Ausfuhr.';

-- Ein Beginn NACH dem Abschluss waere gelogen. Kleine Uhrendrift zwischen
-- Geraet und Server bleibt erlaubt (5 Minuten), alles darueber ist Datenmuell.
ALTER TABLE transactions
  ADD CONSTRAINT transactions_vorgang_beginn_vor_abschluss CHECK (
    vorgang_begonnen_at IS NULL
    OR finalized_at IS NULL
    OR vorgang_begonnen_at <= finalized_at + interval '5 minutes'
  );

GRANT INSERT (vorgang_begonnen_at) ON transactions TO warehouse14_app;

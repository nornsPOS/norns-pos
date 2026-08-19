-- ═══════════════════════════════════════════════════════════════════════════
--  0142 — Die Belege VOR der Sicherungseinrichtung bekommen eine Nummer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── BASELS ANWEISUNG VOM 13.08.2026 ────────────────────────────────────────
--
-- Der Händler soll drucken können, bevor die TSE steht: mit einer deutlichen
-- Warnung, die von Beleg zu Beleg schärfer wird, und bei zehn Belegen ist
-- Schluss. Dazu die Anleitung, wie er die TSE anschliesst.
--
-- ── WAS VORHER WIRKLICH DER FALL WAR, GEMESSEN ─────────────────────────────
--
-- ⚠️ Gedruckt werden konnte IMMER. Der Druckknopf kennt genau zwei Sperren,
-- und keine davon ist fiskalisch: kein Drucker eingerichtet, und keine
-- USt-IdNr. hinterlegt. Ein Beleg ohne Signatur trägt schon heute fett
-- „TSE-Ausfall" und bekommt keinen QR-Code.
--
-- Gesperrt war der VERKAUF, nicht der Druck: `transactions-finalize.ts`,
-- `transactions-ankauf.ts` und `appraisals.ts` werfen 409, sobald
-- `system_settings['tse.tss_id']` leer ist. Ein Beleg, den es nie gab, lässt
-- sich auch nicht drucken. Die Erlaubnis gehört also an den Verkauf.
--
-- ── WAS DAS RECHTLICH IST, UNGESCHÖNT ──────────────────────────────────────
--
-- § 146a Abs. 1 Satz 5 AO: „Das elektronische Aufzeichnungssystem und die
-- digitalen Aufzeichnungen nach Satz 1 sind durch eine zertifizierte
-- technische Sicherheitseinrichtung zu schützen."
--
-- § 379 Abs. 1 Satz 1 AO in Verbindung mit Abs. 6: wer ein solches System
-- „nicht oder nicht richtig verwendet", begeht eine Ordnungswidrigkeit, die
-- mit einer Geldbusse bis zu 25.000 Euro geahndet werden kann.
--
-- Diese Wanderung hebt das nicht auf und kann es nicht aufheben. Sie sorgt
-- dafür, dass jeder einzelne dieser Belege AUFFINDBAR bleibt: nummeriert,
-- gezählt, im Prüferpaket als Ausfall ausgewiesen. Ein Händler, der die
-- Erlaubnis nutzt, soll nachher genau sagen können, welche zehn Belege es
-- waren, statt sie aus einem Wust herausklauben zu müssen.
--
-- ── WARUM EINE NUMMER UND KEIN ZÄHLER ──────────────────────────────────────
--
-- Ein Zähler in `system_settings` wäre eine Zahl, die jemand zurückstellen
-- kann, und dann wären es zwanzig Belege statt zehn, ohne dass irgendwo etwas
-- rot würde. Die Nummer steht deshalb AN DER ZEILE. Der Vorrat ist damit eine
-- MESSUNG über echte Zeilen, keine Behauptung: `count(*)`, nicht `value`.
--
-- ── WARUM DER EINDEUTIGE INDEX ─────────────────────────────────────────────
--
-- Zwei Kassen können gleichzeitig kassieren. Beide läsen dann „bisher 3" und
-- schrieben beide die 4. Zehn Belege würden elf, und die Nummer auf dem Papier
-- wäre gelogen. Der Index lässt das nicht zu: der zweite Schreiber bekommt
-- einen Fehler statt einer stillen Dublette.
--
-- Er ist NICHT DEFERRABLE, mit Absicht. Ein aufgeschobener Wächter schlägt
-- erst beim COMMIT zu, wenn die Route ihr `RETURNING id` längst gesehen hat
-- und den Beleg für geschrieben hält.
--
-- ── WARUM `NULL` UND KEINE 0 ───────────────────────────────────────────────
--
-- `NULL` heisst: dieser Beleg gehört nicht zu dieser Sonderlage. Das sind
-- ausser den zehn ALLE, auch jeder Beleg, der vor dieser Wanderung entstanden
-- ist. Eine 0 wäre eine Angabe; NULL ist die Abwesenheit einer, und genau das
-- ist hier wahr.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ohne_tse_nr integer;

COMMENT ON COLUMN transactions.ohne_tse_nr IS
  'Laufende Nummer eines Belegs, der ohne eingerichtete technische Sicherheitseinrichtung '
  'gebucht wurde (1 bis zum Vorrat). NULL bei jedem anderen Beleg. Die Zahl steht an der '
  'Zeile, damit der Vorrat eine Messung ueber Zeilen ist und kein zuruecksetzbarer Zaehler.';

-- Eine Nummer darf es genau einmal geben. Teilindex, weil NULL die Regel ist.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_ohne_tse_nr_einmalig
  ON transactions (ohne_tse_nr)
  WHERE ohne_tse_nr IS NOT NULL;

-- Die Nummer beginnt bei 1. Eine 0 oder eine negative Zahl waere keine
-- laufende Nummer, sondern ein Rechenfehler, der sich auf das Papier druckt.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_ohne_tse_nr_beginnt_bei_eins;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_ohne_tse_nr_beginnt_bei_eins
  CHECK (ohne_tse_nr IS NULL OR ohne_tse_nr >= 1);

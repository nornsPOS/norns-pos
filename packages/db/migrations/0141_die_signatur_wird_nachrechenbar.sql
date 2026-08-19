-- ═══════════════════════════════════════════════════════════════════════════
--  0141 — Die Signatur wird für einen Prüfer NACHRECHENBAR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
--
-- Der DSFinV-K-Auszug (2.4) hat in `tse.csv` zwei Spalten, die eine Signatur
-- erst überprüfbar machen:
--
--     TSE_SERIAL       die Seriennummer der Sicherungseinrichtung
--     TSE_PUBLIC_KEY   ihr öffentlicher Schlüssel
--
-- Beide standen in JEDEM gezogenen Prüferpaket leer. Der Erzeuger trug sie
-- sauber ein, nur bekam er nie einen Wert: `tse_signatures` hatte keine Spalte
-- dafür, also gab es keinen Ort, an dem der Wert geblieben wäre.
--
-- Was das für eine Kassennachschau heisst: der Prüfer sieht eine Signatur als
-- Zeichenkette und kann sie WEDER einer Sicherungseinrichtung zuordnen NOCH
-- nachrechnen. Der Auszug sah vollständig aus und trug an der Stelle nichts,
-- auf die es ankommt.
--
-- ── WARUM BEIDE SPALTEN NULL ZULASSEN ──────────────────────────────────────
--
-- Belege, die vor dieser Wanderung entstanden sind, haben die Werte nie
-- mitbekommen. Sie nachträglich abzuleiten oder mit der heute konfigurierten
-- Sicherungseinrichtung aufzufüllen wäre eine unrichtige Angabe nach § 146a AO
-- — und damit schlimmer als die Lücke, die sie schliessen soll. Der Export
-- weist eine fehlende Angabe deshalb leer aus.
--
-- ── WARUM TEXT UND NICHT UUID ──────────────────────────────────────────────
--
-- Dieselbe Begründung wie bei `fiskaly_tss_id` (Wanderung 0131): eine
-- Wolken-TSE vergibt UUIDs, ein Swissbit-Stecker trägt eine Seriennummer.
-- Der öffentliche Schlüssel kommt als Base64 und ist nicht in der Länge
-- gedeckelt, weil verschiedene Verfahren verschieden lange Schlüssel haben.

ALTER TABLE tse_signatures
  ADD COLUMN IF NOT EXISTS tss_serial_number    text,
  ADD COLUMN IF NOT EXISTS signature_public_key text;

COMMENT ON COLUMN tse_signatures.tss_serial_number IS
  'Seriennummer der Sicherungseinrichtung. Wird als TSE_SERIAL in die tse.csv des DSFinV-K-Auszugs geschrieben. NULL bei Belegen von vor Wanderung 0141 — eine fehlende Angabe wird NIE abgeleitet.';

COMMENT ON COLUMN tse_signatures.signature_public_key IS
  'Oeffentlicher Schluessel der Sicherungseinrichtung (Base64). Wird als TSE_PUBLIC_KEY in die tse.csv geschrieben. Ohne ihn ist eine Signatur fuer einen Pruefer nicht verifizierbar.';

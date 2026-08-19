-- ════════════════════════════════════════════════════════════════════════
--  0131 — Die Sicherungseinrichtung darf ein GERÄT sein
-- ════════════════════════════════════════════════════════════════════════
--
--  ── BASELS ANWEISUNG VOM 02.08.2026 ─────────────────────────────────────
--
--  Wörtlich: die Produktionsfassung läuft sehr wahrscheinlich auf einer
--  HARDWARE-TSE, dem bekannten Swissbit-Stecker, damit der vollständig
--  offline arbeitende Betrieb gesichert und nachweisbar ist. Nur Kurse,
--  Aktualisierungen und einige Dinge brauchen Netz; ist es da, arbeiten sie,
--  ist es weg, macht es nichts.
--
--  ── DIE WAND, DIE GEMESSEN WURDE ────────────────────────────────────────
--
--  ⚠️ `fiskaly_tss_id` und `fiskaly_client_id` sind UUID NOT NULL. Eine
--  Wolken-TSE vergibt UUIDs; ein Swissbit-Stecker trägt eine SERIENNUMMER,
--  eine Hexfolge wie `5E4B1C9A00000042`. Die ist keine UUID.
--
--  Damit könnte eine Kasse mit Hardware-TSE KEINEN EINZIGEN Beleg schreiben:
--  `transactions.device_id` hängt an dieser Kette, und ohne Signaturzeile
--  bleibt jeder Verkauf unsigniert. Nicht „eingeschränkt", sondern gar nicht.
--
--  ⚠️ UND DIE HALBHEIT WÄRE SCHLIMMER ALS DIE WAND. Nur die Leitung zu
--  weiten (das Prüfschema der Route) verwandelte eine ehrliche 400 in eine
--  500 aus der Tiefe der Datenbank: dieselbe Ablehnung, aber ohne Satz, der
--  sagt warum. Leitung und Datenbank fallen deshalb GEMEINSAM.
--
--  ── WARUM DER SPALTENNAME BLEIBT ────────────────────────────────────────
--
--  `fiskaly_…` ist für einen Swissbit-Stecker ein falscher Name, und das ist
--  eine Wunde. Sie zu heilen hiesse 30 Dateien anfassen, darunter den
--  DSFinV-K-Erzeuger und drei Kassenflächen, mitten in einer Woche, in der
--  die Steuerausfuhr gerade erst still steht. Der NAME ist ein Schönheits-
--  fehler; der TYP war die Wand. Die Wand fällt heute, der Name wandert in
--  einem eigenen Schritt, mit eigener Prüfung.
--
--  ── WAS DIESE WANDERUNG NICHT TUT ───────────────────────────────────────
--
--  Sie macht nichts weicher, was heute hält: NOT NULL bleibt NOT NULL, und
--  eine neue Prüfregel verbietet ausdrücklich den leeren Text. Ein leeres
--  Feld wäre schlimmer als eine falsche UUID: es sähe aus wie „signiert",
--  ohne dass irgendein Gerät je etwas signiert hätte.
--
--  Bestehende Werte überstehen den Umbau unverändert: PostgreSQL giesst UUID
--  nach TEXT in ihrer kanonischen Schreibweise, also bleibt jede bereits
--  geschriebene Wolken-Kennung Zeichen für Zeichen dieselbe.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── tse_signatures ──────────────────────────────────────────────────────
ALTER TABLE tse_signatures
  ALTER COLUMN fiskaly_tss_id         TYPE TEXT USING fiskaly_tss_id::text,
  ALTER COLUMN fiskaly_client_id      TYPE TEXT USING fiskaly_client_id::text,
  ALTER COLUMN fiskaly_transaction_id TYPE TEXT USING fiskaly_transaction_id::text;

ALTER TABLE tse_signatures
  DROP CONSTRAINT IF EXISTS tse_signatures_kennung_nicht_leer,
  ADD  CONSTRAINT tse_signatures_kennung_nicht_leer
       CHECK (length(btrim(fiskaly_tss_id)) > 0 AND length(btrim(fiskaly_client_id)) > 0);

-- ── tse_transactions ────────────────────────────────────────────────────
ALTER TABLE tse_transactions
  ALTER COLUMN fiskaly_tss_id         TYPE TEXT USING fiskaly_tss_id::text,
  ALTER COLUMN fiskaly_client_id      TYPE TEXT USING fiskaly_client_id::text,
  ALTER COLUMN fiskaly_transaction_id TYPE TEXT USING fiskaly_transaction_id::text;

ALTER TABLE tse_transactions
  DROP CONSTRAINT IF EXISTS tse_transactions_kennung_nicht_leer,
  ADD  CONSTRAINT tse_transactions_kennung_nicht_leer
       CHECK (length(btrim(fiskaly_tss_id)) > 0 AND length(btrim(fiskaly_client_id)) > 0);

COMMENT ON COLUMN tse_signatures.fiskaly_tss_id IS
  'Kennung der technischen Sicherungseinrichtung. Bei einer Wolken-TSE eine '
  'UUID, bei einem Hardware-Stecker (Swissbit) die Seriennummer des Geraets. '
  'Der Spaltenname stammt aus der Zeit, als es nur die Wolke gab.';
COMMENT ON COLUMN tse_transactions.fiskaly_tss_id IS
  'Kennung der technischen Sicherungseinrichtung. Bei einer Wolken-TSE eine '
  'UUID, bei einem Hardware-Stecker (Swissbit) die Seriennummer des Geraets.';

COMMIT;

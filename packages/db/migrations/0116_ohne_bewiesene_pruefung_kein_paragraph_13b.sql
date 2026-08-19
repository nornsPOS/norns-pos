-- ═══════════════════════════════════════════════════════════════════════════
--  OHNE BEWIESENE PRÜFUNG KEIN § 13b
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Am 26.07.2026 nachgesehen, und der Befund ist grösser als die Aufgabe war.
-- Die Aufgabe hiess „die Prüfstatus auf der Rechnung zeigen". Beim Nachsehen,
-- WO der Status entsteht, stellte sich heraus: es entsteht keiner.
--
-- ── 1. Der Aufrufer sagt einfach, dass keine Steuer anfällt ───────────────
--
-- `POST /api/transactions/finalize` nimmt `taxTreatmentCode` aus dem Rumpf und
-- schreibt ihn durch, bis in den Hauptbuch-Eintrag. Es gibt in der ganzen
-- Route keine Zeile, die bei `REVERSE_CHARGE_13B` prüft, ob der Kunde
-- überhaupt eine USt-IdNr. hat.
--
--   • Kassiererrecht genügt.
--   • Der Integrationstest, der das absegnet, benutzt `DE123456789` — die
--     erfundene Nummer aus der Vorlage. Er ist grün.
--
-- Wer `"taxTreatmentCode": "REVERSE_CHARGE_13B"` schickt, verkauft ohne
-- Umsatzsteuer. An 19 Prozent jedes Verkaufs.
--
-- ── 2. Das Ergebnis der VIES-Abfrage wird weggeworfen ─────────────────────
--
-- `GET /api/customers/verify-vat` fragt die EU wirklich (mit Zeitgrenze und
-- ordentlicher Fehlerbehandlung), gibt die Antwort an den Bildschirm zurück
-- und behält NICHTS. `customers` trägt genau eine Spalte dazu: `vat_id`, ein
-- freier Text.
--
-- ── Warum das teuer ist ──────────────────────────────────────────────────
--
-- § 18e UStG gibt dem Unternehmer die qualifizierte Bestätigungsabfrage.
-- § 6a Abs. 4 UStG schützt den guten Glauben NUR, wenn die Sorgfalt eines
-- ordentlichen Kaufmanns eingehalten und das auch belegt ist. Stellt sich die
-- USt-IdNr. später als ungültig heraus und liegt keine dokumentierte Abfrage
-- vor, schuldet der Verkäufer die Steuer selbst — aus einem Verkauf, bei dem
-- er sie nie eingenommen hat.
--
-- Bei Anlagegold und Münzen sind das vierstellige Beträge je Beleg.
--
-- ── Was diese Wanderung anlegt ────────────────────────────────────────────
--
-- Den Beleg der Abfrage, dort wo er hingehört: beim Kunden, mit Zeitpunkt,
-- Ergebnis und dem, was die EU zurückgemeldet hat. Der Riegel selbst sitzt in
-- der Route (`lib/reverse-charge.ts`), weil er den Vorgang mit einem lesbaren
-- Satz ablehnen muss statt mit einem Zwangsverstoss.

-- ── Das Ergebnis, mit dem „konnte nicht fragen" GETRENNT ──────────────────
--
-- ⚠️ Die Route gab bisher bei Zeitüberschreitung und bei Netzausfall
-- `valid: false` zurück, also GENAU DASSELBE wie bei einer wirklich ungültigen
-- Nummer. Ein Aufrufer, der nur dieses Feld liest, hält eine Störung bei der
-- EU für eine falsche USt-IdNr. und sagt das einem Geschäftskunden ins
-- Gesicht.
--
-- Deshalb sind es hier vier Werte und nicht zwei. `NICHT_ERREICHBAR` ist kein
-- Ergebnis, sondern das Eingeständnis, keines zu haben — und berechtigt darum
-- ebensowenig zu § 13b wie `UNGUELTIG`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vat_check_result') THEN
    CREATE TYPE vat_check_result AS ENUM (
      'GUELTIG',          -- die EU bestätigt die Nummer
      'UNGUELTIG',        -- die EU kennt sie nicht
      'NICHT_ERREICHBAR', -- Zeitüberschreitung oder Ausfall: wir wissen es nicht
      'FORMFEHLER'        -- gar nicht erst abgefragt, die Nummer ist keine
    );
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS vat_id_checked_at        timestamptz,
  ADD COLUMN IF NOT EXISTS vat_id_check_result      vat_check_result,
  -- Was die EU zur Nummer gemeldet hat. Bei DE und ES kommt oft nichts, dann
  -- steht hier NULL — das ist kein Mangel der Abfrage.
  ADD COLUMN IF NOT EXISTS vat_id_check_name        text,
  ADD COLUMN IF NOT EXISTS vat_id_check_address     text,
  -- Die Nummer, die WIRKLICH abgefragt wurde, normalisiert. Ändert jemand
  -- danach `vat_id`, passt sie nicht mehr, und der Riegel merkt es. Ohne diese
  -- Spalte könnte man eine geprüfte Nummer eintragen, die Prüfung erben lassen
  -- und die Nummer anschliessend austauschen.
  ADD COLUMN IF NOT EXISTS vat_id_checked_value     text;

COMMENT ON COLUMN customers.vat_id_checked_value IS
  'Die normalisierte USt-IdNr., die tatsächlich abgefragt wurde. Weicht sie von vat_id ab, gilt die Prüfung nicht mehr.';

-- Der übliche Weg: „zeig mir alle Kunden mit gültiger, frischer Prüfung".
CREATE INDEX IF NOT EXISTS customers_vat_check_idx
  ON customers (vat_id_check_result, vat_id_checked_at)
  WHERE vat_id IS NOT NULL;

-- ── Der Bestand ───────────────────────────────────────────────────────────
--
-- Kunden, die heute eine USt-IdNr. tragen, haben KEINE Prüfung. Sie bekommen
-- ausdrücklich auch keine unterstellt: die Spalten bleiben NULL, und NULL
-- heisst „nie gefragt". Ein Vorbelegen mit GUELTIG wäre genau die Erfindung,
-- gegen die diese Wanderung gebaut ist.
--
-- Folge, und sie ist beabsichtigt: bis jemand auf „Prüfen" drückt, ist für
-- diese Kunden kein § 13b möglich. Das ist der richtige Zustand — bisher war
-- er für ALLE möglich, ohne dass je jemand gefragt hätte.

-- ── Die Selbstprüfung ─────────────────────────────────────────────────────
--
-- Eine Wanderung, die stillschweigend nichts tut, sieht aus wie eine, die
-- funktioniert hat.
DO $$
DECLARE
  fehlend text;
  n int;
BEGIN
  SELECT string_agg(s, ', ') INTO fehlend
    FROM unnest(ARRAY['vat_id_checked_at','vat_id_check_result','vat_id_check_name',
                      'vat_id_check_address','vat_id_checked_value']) AS s
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_name = 'customers' AND column_name = s);
  IF fehlend IS NOT NULL THEN
    RAISE EXCEPTION 'Wanderung 0116 unvollstaendig, es fehlen: %', fehlend;
  END IF;

  -- ⚠️ Diese Prüfung hat hier schon zweimal live zugeschlagen: UPDATE wird in
  -- diesem Haus SPALTENWEISE erteilt, also ist jede NEUE Spalte für die
  -- Anwendungsrolle standardmässig gesperrt. Ohne die Rechte unten schriebe
  -- die Route ins Leere und meldete trotzdem Erfolg.
  FOR n IN
    SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_app'
  LOOP
    EXECUTE 'GRANT UPDATE (vat_id_checked_at, vat_id_check_result, vat_id_check_name,
                           vat_id_check_address, vat_id_checked_value)
             ON customers TO warehouse14_app';
    EXECUTE 'GRANT SELECT ON customers TO warehouse14_app';
  END LOOP;

  SELECT count(*) INTO n
    FROM information_schema.column_privileges
   WHERE table_name = 'customers' AND privilege_type = 'UPDATE'
     AND grantee = 'warehouse14_app'
     AND column_name IN ('vat_id_checked_at','vat_id_check_result','vat_id_check_name',
                         'vat_id_check_address','vat_id_checked_value');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_app') AND n <> 5 THEN
    RAISE EXCEPTION 'Wanderung 0116: nur % von 5 Spalten sind fuer warehouse14_app beschreibbar', n;
  END IF;
END $$;

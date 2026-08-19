-- 0108 — Der Laden bekommt sein EIGENES Stripe-Konto, und wir fassen sein Geld nie an.
--
-- ── Warum diese Tabelle die aufsichtsrechtliche Grenze zieht ────────────────
--
-- Bis hierher gab es genau einen Stripe-Zugang: den des Betreibers. Damit
-- konnte ein Laden kassieren, aber das Geld lief über EIN Konto. Sobald Norns
-- mehreren Händlern Kartenzahlung anbietet, ist genau das der Punkt, an dem
-- aus einem Softwarehaus ein Zahlungsdienst wird, und ein Zahlungsdienst
-- braucht in Deutschland eine Erlaubnis der BaFin nach dem ZAG.
--
-- Der Ausweg heisst Stripe Connect Standard mit Direktbelastung:
--
--   • Jeder Händler bekommt ein eigenes Stripe-Konto auf SEINEN Namen.
--   • Die Zahlung wird AUF diesem Konto eröffnet, nicht auf unserem.
--   • Stripe zahlt unmittelbar an den Händler aus.
--   • Wir entnehmen nur eine Vermittlungsgebühr (application_fee_amount).
--
-- Wir nehmen also zu keinem Zeitpunkt Geld der Endkunden entgegen, verwahren
-- es nicht und leiten es nicht weiter. Das ist kein Formulierungstrick,
-- sondern der tatsächliche Geldfluss, und nur deshalb bleibt Norns ausserhalb
-- des ZAG. Diese Tabelle hält fest, WELCHES fremde Konto das ist.
--
-- ── Was hier bewusst NICHT gespeichert wird ─────────────────────────────────
--
-- Kein Zugriffstoken, kein Geheimnis, keine Bankverbindung. Bei Standard-
-- Konten spricht die Plattform mit ihrem EIGENEN Geheimschlüssel und nennt
-- das fremde Konto nur in einer Kopfzeile (`Stripe-Account`). Es gibt hier
-- also nichts zu stehlen ausser einer Kontokennung, die ohnehin auf jedem
-- Beleg des Händlers steht.
--
-- ── charges_enabled ist die einzige Wahrheit ───────────────────────────────
--
-- Ein frisch angelegtes Konto kann noch NICHT kassieren. Stripe prüft
-- Identität, Gewerbe und Bankverbindung, und das dauert. `charges_enabled`
-- spiegelt, was Stripe zuletzt gemeldet hat. Die Kasse darf eine Zahlung nur
-- eröffnen, wenn dieses Feld wahr ist. Sonst entsteht ein Vorgang, den der
-- Händler nie ausgezahlt bekommt, und der Kunde steht mit einer Belastung da,
-- der keine Gutschrift folgt. Genau diese Prüfung fehlt in fast jeder
-- Erstintegration.
--
-- Das Feld wird NUR aus einer signierten `account.updated`-Meldung oder aus
-- einer aktiven Abfrage bei Stripe gesetzt, nie aus einer Nutzereingabe.

CREATE TABLE IF NOT EXISTS stripe_connected_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Die Kontokennung bei Stripe, `acct_…`. Eindeutig: ein Laden, ein Konto.
  stripe_account_id     text        NOT NULL UNIQUE,

  -- Land und Währung, wie Stripe sie führt. Eine Gebühr darf nur in der
  -- Währung der Zahlung entnommen werden, darum steht die Währung hier.
  country               text        NOT NULL DEFAULT 'DE',
  default_currency      text        NOT NULL DEFAULT 'eur',

  -- Was Stripe zuletzt über die Freischaltung gemeldet hat.
  charges_enabled       boolean     NOT NULL DEFAULT false,
  payouts_enabled       boolean     NOT NULL DEFAULT false,
  details_submitted     boolean     NOT NULL DEFAULT false,

  -- Die offenen Forderungen von Stripe, roh übernommen. Damit kann die
  -- Oberfläche dem Händler sagen, WAS noch fehlt, statt nur "nicht bereit".
  requirements          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Die Vermittlungsgebühr in Basispunkten (100 bp = 1,00 %). Pro Laden
  -- verhandelbar. NULL heisst: es gilt der Vorgabewert aus der Umgebung.
  application_fee_bps   integer,

  -- Wann Stripe zuletzt etwas über dieses Konto gesagt hat.
  last_synced_at        timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Eine Kontokennung von Stripe beginnt immer mit `acct_`. Ein Tippfehler
  -- oder eine versehentlich eingetragene Zahlungskennung (`pi_…`) fällt hier
  -- auf, bevor die erste Zahlung darauf eröffnet wird.
  CONSTRAINT stripe_connected_accounts_id_shape
    CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),

  -- Eine Gebühr über 10 % wäre kein Vermittlungsentgelt mehr. Die Schranke
  -- steht in der Datenbank, damit ein Tippfehler in der Verwaltung (5000
  -- statt 500) nicht erst am Kontoauszug des Händlers auffällt.
  CONSTRAINT stripe_connected_accounts_fee_sane
    CHECK (application_fee_bps IS NULL OR (application_fee_bps >= 0 AND application_fee_bps <= 1000)),

  -- Ein Konto, das auszahlen darf, aber angeblich nichts eingereicht hat,
  -- ist ein Zustand, den Stripe nicht kennt. Er entstünde nur durch einen
  -- Schreibfehler bei uns.
  CONSTRAINT stripe_connected_accounts_payouts_need_details
    CHECK (payouts_enabled = false OR details_submitted = true)
);

COMMENT ON TABLE stripe_connected_accounts IS
  'Das Stripe-Konto des Händlers (Connect Standard). Das Geld läuft direkt dorthin, nie über uns.';
COMMENT ON COLUMN stripe_connected_accounts.charges_enabled IS
  'Nur wenn wahr, darf eine Zahlung eröffnet werden. Wird ausschliesslich aus einer signierten Stripe-Meldung gesetzt.';
COMMENT ON COLUMN stripe_connected_accounts.application_fee_bps IS
  'Vermittlungsgebühr in Basispunkten. NULL = Vorgabe aus der Umgebung.';

CREATE INDEX IF NOT EXISTS stripe_connected_accounts_ready_idx
  ON stripe_connected_accounts (charges_enabled, updated_at DESC);

-- ── Die Zahlung muss wissen, AUF WELCHEM Konto sie lief ────────────────────
--
-- Ohne diese Spalte lässt sich eine Zahlung später nicht mehr bei Stripe
-- nachschlagen: eine Zahlungskennung eines fremden Kontos ist über den
-- Plattformzugang nur auffindbar, wenn man das Konto mitnennt. Für eine
-- Erstattung oder eine Klärung ist das die entscheidende Angabe.
--
-- NULL bleibt zulässig: Zahlungen, die vor dieser Wanderung entstanden sind,
-- liefen über den Plattformzugang selbst, und das war damals richtig.
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS stripe_account_id text;

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_account_shape;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_account_shape
  CHECK (stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9]+$');

-- Die entnommene Vermittlungsgebühr in ganzen Cent, so wie sie an Stripe
-- übergeben wurde. Sie steht hier und nicht nur bei Stripe, weil sie in die
-- eigene Buchführung gehört: es ist unser Ertrag, nicht der des Händlers.
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS application_fee_cents integer;

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_fee_nonneg;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_fee_nonneg
  CHECK (application_fee_cents IS NULL OR application_fee_cents >= 0);

-- ── Rechte ─────────────────────────────────────────────────────────────────
--
-- DIE SPALTENFALLE, zum dritten Mal, und diesmal an der Produktion gemessen
-- statt vermutet.
--
-- Der erste Entwurf dieser Wanderung behauptete hier, auf `payment_intents`
-- stehe das Recht auf Tabellenebene und neue Spalten seien darum ohne Zutun
-- beschreibbar. Die Abfrage gegen die laufende Datenbank widerlegt das:
--
--   SELECT privilege_type, string_agg(column_name, ', ')
--     FROM information_schema.column_privileges
--    WHERE table_name = 'payment_intents' AND grantee = 'warehouse14_app'
--    GROUP BY privilege_type;
--
--   INSERT | amount_eur, cart_id, client_secret, created_at, id, outcome,
--            provider, provider_intent_id, redirect_url, status, updated_at
--   SELECT | (dieselben elf)
--   UPDATE | client_secret, outcome, provider_intent_id, redirect_url,
--            status, updated_at
--
-- Auf Tabellenebene stehen nur INSERT und SELECT. Alles ist SPALTENWEISE
-- vergeben, und eine spaltenweise Vergabe kennt neue Spalten nicht. Ohne die
-- drei GRANTs unten wären `stripe_account_id` und `application_fee_cents` für
-- die Anwendung vollständig unsichtbar und unbeschreibbar: kein Fehler beim
-- Start, kein Fehler beim Typprüfen, kein Fehler im Test. Erst die erste
-- echte Kartenzahlung wäre an einer Rechteverweigerung gescheitert, und zwar
-- vor dem Kunden an der Kasse.
--
-- Merksatz für jede künftige Wanderung: NACHSEHEN, nicht annehmen.

-- Die beiden neuen Spalten von payment_intents, einzeln freigegeben.
-- SELECT und INSERT, damit die Zahlung überhaupt mit ihrer Kontokennung
-- angelegt und wiedergefunden wird. UPDATE nur auf die Gebühr: die
-- Kontokennung wird beim Anlegen gesetzt und danach nie geändert, denn eine
-- nachträglich umgebogene Kennung würde eine Erstattung an ein fremdes Konto
-- schicken.
GRANT SELECT (stripe_account_id, application_fee_cents) ON payment_intents TO warehouse14_app;
GRANT INSERT (stripe_account_id, application_fee_cents) ON payment_intents TO warehouse14_app;
GRANT UPDATE (application_fee_cents) ON payment_intents TO warehouse14_app;

ALTER TABLE stripe_connected_accounts OWNER TO warehouse14_migrator;
GRANT SELECT, INSERT ON stripe_connected_accounts TO warehouse14_app;
-- UPDATE bewusst spaltenweise: die Anwendung darf den Freischaltungsstand
-- fortschreiben, aber NIEMALS die Kontokennung ändern. Ein umgebogenes
-- `stripe_account_id` würde jede künftige Zahlung an ein fremdes Konto
-- leiten, und genau das ist der teuerste denkbare Fehler an dieser Stelle.
GRANT UPDATE (
  charges_enabled,
  payouts_enabled,
  details_submitted,
  requirements,
  application_fee_bps,
  last_synced_at,
  updated_at,
  default_currency,
  country
) ON stripe_connected_accounts TO warehouse14_app;

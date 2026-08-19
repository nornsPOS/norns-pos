-- 0103 — Eine Bestellung darf abgelehnt werden, und Geräte dürfen es erfahren.
--
-- Basels Befund am 23.07.2026, und er trifft zu: der Abholablauf existiert,
-- aber niemand erfährt, dass eine Bestellung eingetroffen ist, und niemand
-- kann eine ablehnen. Wer nicht zufällig nachsieht, sieht nichts.
--
-- Diese Migration legt drei Dinge an:
--   1. Storno mit Grund und Urheber auf `carts`
--   2. die Unterscheidung, WER eine Kundenlöschung veranlasst hat
--   3. Gerätemarken und einen Push-Ausgang, nach dem Muster von email_outbox

-- ── 1. Ablehnen ist ein Storno mit Grund, kein neuer Abholstand ────────────
--
-- Bewusst KEIN neuer Wert in `pickup_stage`. Eine abgelehnte Bestellung ist
-- beendet, nicht auf einer weiteren Stufe: die Stücke gehen zurück ins Regal
-- und der Beleg wird CANCELLED, ein Zustand, den der Kundenshop bereits kennt
-- und überall richtig anzeigt. Ein zusätzlicher Stand hätte jede Abfrage,
-- jeden Filter und jede CHECK-Bedingung angefasst, um dasselbe zu sagen.

ALTER TABLE carts
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason  text,
  ADD COLUMN IF NOT EXISTS cancelled_by_role    text;

COMMENT ON COLUMN carts.cancelled_by_role IS
  'CUSTOMER wenn die Kundschaft selbst storniert hat, STAFF wenn das Haus abgelehnt oder storniert hat. Wer es war, steht in cancelled_by_user_id; bei CUSTOMER bleibt der NULL, weil kein Mitarbeiter gehandelt hat.';

DO $c$ BEGIN
  ALTER TABLE carts ADD CONSTRAINT carts_cancellation_role_known
    CHECK (cancelled_by_role IS NULL OR cancelled_by_role IN ('CUSTOMER', 'STAFF'));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

-- Der Server schreibt diese Felder, also braucht die Anwendungsrolle sie.
-- Auf `carts` sind die Rechte SPALTENWEISE vergeben; ohne diese Zeile wäre
-- das Ablehnen still gesperrt und die Route antwortete mit 42501. Genau
-- dieser Fehler ist heute Morgen zweimal passiert.
GRANT UPDATE (
  cancelled_at,
  cancelled_by_user_id,
  cancellation_reason,
  cancelled_by_role
) ON carts TO warehouse14_app;

-- ── 2. Wer hat die Löschung veranlasst? ────────────────────────────────────
--
-- Bisher stand auf `customers` nur DASS gelöscht wurde. Für die Akte ist aber
-- der Unterschied wesentlich: ein Kunde, der sein Konto selbst gelöscht hat,
-- hat eine Entscheidung getroffen; ein von uns gelöschtes Konto ist unsere
-- Handlung und muss als solche nachweisbar sein (DSGVO Art. 5(2)).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS erasure_initiated_by text;

COMMENT ON COLUMN customers.erasure_initiated_by IS
  'CUSTOMER wenn die Person ihr Konto selbst gelöscht hat, STAFF wenn das Haus es getan hat. NULL solange nichts gelöscht wurde. Die Kundennummer und alle Vorgänge bleiben in jedem Fall.';

DO $e$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_erasure_origin_known
    CHECK (erasure_initiated_by IS NULL OR erasure_initiated_by IN ('CUSTOMER', 'STAFF'));
EXCEPTION WHEN duplicate_object THEN NULL; END $e$;

GRANT UPDATE (erasure_initiated_by) ON customers TO warehouse14_app;

-- ── 3. Gerätemarken ────────────────────────────────────────────────────────
--
-- Eine Marke gehört zu EINEM Menschen und EINEM Gerät. Meldet sich jemand
-- anders auf demselben Gerät an, wandert die Marke mit: der eindeutige Index
-- liegt auf der Marke allein, nicht auf dem Paar, sonst bekäme der vorige
-- Benutzer weiter die Benachrichtigungen des neuen.

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text NOT NULL,
  app           text NOT NULL,
  device_label  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT device_push_tokens_platform_known CHECK (platform IN ('ios', 'android')),
  CONSTRAINT device_push_tokens_app_known      CHECK (app IN ('owner', 'cashier'))
);

CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_token_key
  ON device_push_tokens (token);

CREATE INDEX IF NOT EXISTS device_push_tokens_live_idx
  ON device_push_tokens (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE device_push_tokens OWNER TO warehouse14_migrator;
GRANT SELECT, INSERT ON device_push_tokens TO warehouse14_app;
GRANT UPDATE (last_seen_at, revoked_at, user_id, platform, app, device_label)
  ON device_push_tokens TO warehouse14_app;
GRANT SELECT ON device_push_tokens TO warehouse14_worker;
GRANT UPDATE (revoked_at) ON device_push_tokens TO warehouse14_worker;

-- ── 4. Der Push-Ausgang ────────────────────────────────────────────────────
--
-- Dieselbe Gestalt wie email_outbox, und aus demselben Grund: eine
-- Benachrichtigung, die nicht hinausging, muss SICHTBAR liegenbleiben statt
-- im Nichts zu verschwinden. Ein Versand, der still scheitert, ist schlimmer
-- als gar keiner, weil niemand ihn vermisst.

CREATE TABLE IF NOT EXISTS push_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'PENDING',
  attempts      int  NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  CONSTRAINT push_outbox_status_known CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS push_outbox_pending_idx
  ON push_outbox (created_at)
  WHERE status = 'PENDING';

ALTER TABLE push_outbox OWNER TO warehouse14_migrator;
GRANT SELECT, INSERT ON push_outbox TO warehouse14_app;
GRANT SELECT, INSERT ON push_outbox TO warehouse14_worker;
GRANT UPDATE (status, attempts, last_error, sent_at) ON push_outbox TO warehouse14_worker;

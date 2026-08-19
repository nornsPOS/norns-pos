-- 0105 — Der Kunde kann jetzt auch erreicht werden.
--
-- Bis hierher konnte der Server nur PERSONAL benachrichtigen: device_push_tokens
-- hing an users(id), und app kannte nur 'owner' und 'cashier'. Der Kunde, der im
-- Shop die Erlaubnis erteilt, hatte kein Gegenstueck auf dem Server — seine Marke
-- starb auf dem Geraet. Basels Befund am 24.07.2026:
--
--   „هل كل شيء يعمل مثل ما خططنا بحيث الزبون يتلقى اشعارات من التطبيق"
--
-- Nein, tat es nicht. Diese Wanderung schliesst die Luecke und legt zugleich das
-- Fundament fuer den Benachrichtigungs- und Marketing-Versand an die Kundschaft.
--
-- DREI DINGE:
--   1. device_push_tokens bekommt eine Kundenspur (shopper_id) und den Kanal 'shop'.
--   2. carts bekommt eine HERKUNFT (App vs Webshop), damit der Tresen sieht, von
--      wo eine Bestellung kam.
--   3. Eine neue Tabelle customer_broadcasts haelt fest, WAS an die Kundschaft
--      gesendet wurde — ehrlich und nachlesbar, nicht in einem verschluckten Log.

-- ── 1. Kundengeraete duerfen Benachrichtigungen empfangen ────────────────────
--
-- Eine Marke gehoert entweder einem MITARBEITER (user_id) oder einem KUNDEN
-- (shopper_id), nie beiden und nie keinem. Der CHECK erzwingt genau das, damit
-- eine Kundenmarke niemals versehentlich als Personalgeraet eine fremde
-- Bestellung meldet und umgekehrt.

ALTER TABLE device_push_tokens ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE device_push_tokens
  ADD COLUMN IF NOT EXISTS shopper_id uuid REFERENCES shoppers(id) ON DELETE CASCADE;

-- Den alten Kanal-CHECK ('owner','cashier') um 'shop' erweitern.
ALTER TABLE device_push_tokens DROP CONSTRAINT IF EXISTS device_push_tokens_app_known;
ALTER TABLE device_push_tokens
  ADD CONSTRAINT device_push_tokens_app_known
  CHECK (app IN ('owner', 'cashier', 'shop'));

-- Genau EIN Besitzer, passend zum Kanal. 'shop' → shopper_id, sonst → user_id.
ALTER TABLE device_push_tokens DROP CONSTRAINT IF EXISTS device_push_tokens_owner_matches_app;
ALTER TABLE device_push_tokens
  ADD CONSTRAINT device_push_tokens_owner_matches_app
  CHECK (
    (app = 'shop'  AND shopper_id IS NOT NULL AND user_id IS NULL) OR
    (app IN ('owner','cashier') AND user_id IS NOT NULL AND shopper_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS device_push_tokens_shopper_live_idx
  ON device_push_tokens (shopper_id)
  WHERE revoked_at IS NULL AND shopper_id IS NOT NULL;

-- DER GRANT-FALLE ausweichen: auf device_push_tokens ist UPDATE spaltenweise
-- vergeben. Die neue Spalte shopper_id MUSS ausdruecklich mitfreigegeben werden,
-- sonst scheitert das ON CONFLICT DO UPDATE der Kundenanmeldung mit 42501.
GRANT UPDATE (shopper_id) ON device_push_tokens TO warehouse14_app;

-- ── 2. Woher kam die Bestellung? ─────────────────────────────────────────────
--
-- Jede Zeile in carts ist eine Online-Reservierung — aber der Kunde kann sie
-- ueber die HANDY-APP oder ueber den BROWSER aufgegeben haben. Der Tresen will
-- das sehen. Der Wert wird beim Reservieren aus einem Kopf des Clients gelesen
-- (x-w14-client). Fehlt er, ist WEBSHOP die ehrliche Annahme: ein Browser sendet
-- den App-Kopf nicht.

DO $e$ BEGIN
  CREATE TYPE order_origin AS ENUM ('WEBSHOP', 'APP');
EXCEPTION WHEN duplicate_object THEN NULL; END $e$;

ALTER TABLE carts
  ADD COLUMN IF NOT EXISTS order_origin order_origin NOT NULL DEFAULT 'WEBSHOP';

-- Auch hier gilt die Spalten-Regel: der Server (warehouse14_app) muss die neue
-- Spalte beim Reservieren SETZEN duerfen.
GRANT UPDATE (order_origin) ON carts TO warehouse14_app;

-- ── 3. Was ging an die Kundschaft hinaus? ────────────────────────────────────
--
-- Der Benachrichtigungs- und Marketing-Versand braucht ein GEDAECHTNIS: was
-- wurde gesendet, an wen, in welchem Kanal, an wie viele. Ohne diese Zeile
-- waere ein Rundschreiben ein Schuss ins Dunkle. Der Inhalt liegt als
-- Sprach-Karte (locale → {title, body}), damit derselbe Gruss jeden in seiner
-- Sprache erreicht; Deutsch ist immer dabei und die Rueckfallsprache.
--
-- Die Zahlen sind EHRLICH getrennt: wie viele je Kanal eingereiht wurden, und
-- wie viele uebersprungen wurden, weil keine Einwilligung vorlag. Eine
-- geschoente Gesamtzahl waere hier dieselbe Luege wie ein stiller Versand.

CREATE TABLE IF NOT EXISTS customer_broadcasts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Welche Kanaele bedient wurden.
  via_push            boolean NOT NULL DEFAULT false,
  via_email           boolean NOT NULL DEFAULT false,
  -- 'ALL'       — jeder auf dem Kanal erreichbare Mensch (nur fuer Push sinnvoll,
  --               denn die App-Erlaubnis IST die Zustimmung).
  -- 'MARKETING' — nur wer der Werbung ausdruecklich zugestimmt hat. E-Mail-
  --               Rundschreiben laufen IMMER hierueber (UWG).
  audience            text NOT NULL CHECK (audience IN ('ALL', 'MARKETING')),
  -- Sprach-Karte: { "de": {"title":..,"body":..}, "ar": {...}, ... }. 'de' Pflicht.
  content             jsonb NOT NULL,
  -- Wohin die App beim Antippen springt (z. B. '/sammlung'), oder NULL.
  deep_link           text,
  -- Ehrliche Zaehler, nach dem Einreihen gesetzt.
  queued_push         int NOT NULL DEFAULT 0,
  queued_email        int NOT NULL DEFAULT 0,
  skipped_no_consent  int NOT NULL DEFAULT 0,
  CONSTRAINT customer_broadcasts_has_channel CHECK (via_push OR via_email),
  CONSTRAINT customer_broadcasts_has_german  CHECK (content ? 'de')
);

CREATE INDEX IF NOT EXISTS customer_broadcasts_recent_idx
  ON customer_broadcasts (created_at DESC);

ALTER TABLE customer_broadcasts OWNER TO warehouse14_migrator;
GRANT SELECT, INSERT ON customer_broadcasts TO warehouse14_app;
GRANT UPDATE (queued_push, queued_email, skipped_no_consent) ON customer_broadcasts TO warehouse14_app;

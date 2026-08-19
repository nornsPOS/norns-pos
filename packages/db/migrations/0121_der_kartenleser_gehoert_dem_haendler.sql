-- ═══════════════════════════════════════════════════════════════════════════
--  0121 — DER KARTENLESER GEHOERT DEM HAENDLER, UND SEINE ZAHLUNG HAT
--         EIN GEDAECHTNIS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── WARUM (26.07.2026, Koordination §9, Gewerk 2) ──────────────────────────
--
-- Kartenzahlung im Laden lief bisher ausschliesslich ueber ZVT — daran
-- verdient Norns keine Vermittlungsgebuehr. Der neue Weg: Stripe Terminal
-- (Leser S700), SERVERGESTEUERT. Der Server eroeffnet den PaymentIntent auf
-- dem Konto des Haendlers (Kopfzeile `Stripe-Account`, wie im Web-Shop),
-- zeigt die echten Warenkorbzeilen auf dem Leser an und ruft
-- `process_payment_intent` auf. Das Ergebnis kommt als Webhook.
--
-- Dafuer braucht der Server zwei Dinge, die es bisher nirgends gab:
--
--   1. `kartenleser` — WELCHE Leser dieser Haendler registriert hat.
--      Leser-Kennungen (`tmr_…`) sind MANDANTENDATEN: sie kommen ueber die
--      API in die Datenbank des Haendlers, NIEMALS per Wanderung (§7).
--      Diese Wanderung legt NUR die leere Struktur an — dasselbe Muster wie
--      0119 (beleg_logo).
--
--   2. `leser_zahlungen` — der Stand JEDER angestossenen Leser-Zahlung.
--      `payment_intents` (0018) scheidet aus: die Tabelle haengt mit NOT
--      NULL am Web-Warenkorb (`cart_id`), eine Kassenzahlung hat keinen.
--
-- ── DER DOPPELBELASTUNGS-RIEGEL, UND WARUM ER HIER WOHNT ───────────────────
--
-- Eine girocard-Zahlung mit PIN erzeugt bei Stripe ZWEI Belastungen: erst
-- eine weich abgelehnte mit `online_or_offline_pin_required`, dann die
-- echte. Zaehlte das Kassenbuch beide, stuende der Tagesumsatz doppelt in
-- DSFinV-K. Der Riegel: `status` kennt genau einen Erfolgsuebergang, die
-- weiche Ablehnung wird NUR gezaehlt (`weiche_ablehnungen`), nie als
-- Fehlschlag gebucht, und `idempotenz_schluessel` ist UNIQUE, damit ein
-- zweiter Anstoss derselben Geste keine zweite Zahlung eroeffnet.
--
-- ── GELD ───────────────────────────────────────────────────────────────────
-- Ganze Cent als bigint (Hausregel). Stripe rechnet NICHTS: unsere
-- Cent-Betraege sind die einzige Wahrheit, auch auf dem Kundendisplay.
--
-- ── ZWEIMAL FAHRBAR ────────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS; GRANTs sind von Natur aus wiederholbar.
-- GRANT auf die GANZE Tabelle, ausdruecklich NICHT spaltenweise: die
-- Spaltenfalle (0099, dreimal live) entsteht nur dort, wo Rechte je Spalte
-- vergeben sind und eine neue Spalte still gesperrt startet.

BEGIN;

CREATE TABLE IF NOT EXISTS kartenleser (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Der Anbieter, absichtlich der bestehende Aufzaehlungstyp: die Tabelle
  -- ist anbieterneutral GEBAUT, auch wenn heute nur Stripe sie fuellt.
  provider payment_provider NOT NULL,

  -- Die Kennung beim Anbieter, bei Stripe `tmr_…`. Die Form ist die zweite
  -- Wand: eine vertauschte Kennung (etwa eine Konto- oder Intent-Kennung)
  -- faellt hier um, nicht erst beim Anbieter.
  provider_reader_id text NOT NULL UNIQUE
    CONSTRAINT kartenleser_kennung_form CHECK (provider_reader_id ~ '^tmr_[A-Za-z0-9]+$'),

  -- Der Name, unter dem die Kasse den Leser anbietet ("Tresen links").
  bezeichnung text NOT NULL
    CONSTRAINT kartenleser_bezeichnung_laenge CHECK (char_length(bezeichnung) BETWEEN 1 AND 100),

  -- Was Stripe ueber das Geraet sagt — reine Auskunft, keine Wahrheit.
  geraetetyp text,
  seriennummer text,

  -- Der Standort (`tml_…`) beim Anbieter, an dem der Leser registriert ist.
  provider_location_id text
    CONSTRAINT kartenleser_standort_form
    CHECK (provider_location_id IS NULL OR provider_location_id ~ '^tml_[A-Za-z0-9]+$'),

  -- Der zuletzt BEI STRIPE gesehene Stand ('online'/'offline'). Nur ein
  -- Zwischenstand fuer die Oberflaeche; entschieden wird je Zahlung frisch.
  zuletzt_gesehen_status text,

  registriert_am timestamptz NOT NULL DEFAULT now(),

  -- SET NULL statt RESTRICT: der Leser gehoert dem Laden, nicht dem Konto,
  -- das ihn eingetragen hat (dasselbe Argument wie beleg_logo, 0119).
  registriert_von uuid REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE kartenleser IS
  'Die beim Zahlungsanbieter registrierten Kartenleser des Haendlers (Mandantendaten, per API gefuellt — nie per Wanderung).';

CREATE TABLE IF NOT EXISTS leser_zahlungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL: ein entfernter Leser darf seine abgeschlossenen Zahlungen
  -- weder festhalten noch mitreissen. Die Kennung unten bleibt als
  -- Schnappschuss stehen, damit der Beweis vollstaendig bleibt.
  leser_id uuid REFERENCES kartenleser(id) ON DELETE SET NULL,
  provider_reader_id text NOT NULL,

  provider payment_provider NOT NULL,
  provider_intent_id text NOT NULL,

  -- Auf WESSEN Konto die Zahlung lief. Ohne dieses Feld ist die Zahlung
  -- spaeter nicht mehr auffindbar, was jede Erstattung blockiert (0108).
  stripe_account_id text NOT NULL
    CONSTRAINT leser_zahlungen_konto_form CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),

  -- Ganze Cent, bigint. Die Steuer ist Teil des Betrags (brutto), die
  -- Gebuehr ist Norns' Anteil und nie groesser als der Betrag selbst.
  betrag_cents bigint NOT NULL
    CONSTRAINT leser_zahlungen_betrag_positiv CHECK (betrag_cents > 0),
  steuer_cents bigint NOT NULL DEFAULT 0
    CONSTRAINT leser_zahlungen_steuer_im_betrag CHECK (steuer_cents >= 0 AND steuer_cents <= betrag_cents),
  gebuehr_cents bigint NOT NULL DEFAULT 0
    CONSTRAINT leser_zahlungen_gebuehr_im_betrag CHECK (gebuehr_cents >= 0 AND gebuehr_cents <= betrag_cents),

  -- Woher die Gebuehr kam (Basispunkte + Quelle aus resolveCommission) —
  -- die Antwort auf "warum steht auf meiner Abrechnung 1 %?" (0110).
  gebuehr_bps integer
    CONSTRAINT leser_zahlungen_gebuehr_bps_grenze CHECK (gebuehr_bps IS NULL OR (gebuehr_bps >= 0 AND gebuehr_bps <= 1000)),
  gebuehr_quelle text,

  -- Der Stand der Zahlung. SUCCEEDED ist endgueltig: kein Ereignis der Welt
  -- fuehrt wieder heraus (Doppelbelastungs-Riegel, Teil 1).
  status text NOT NULL DEFAULT 'PROCESSING'
    CONSTRAINT leser_zahlungen_status_erlaubt
    CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED')),

  -- Das Fehlerbild fuer die Kasse, klar getrennt statt eines Fehlertexts.
  fehlerbild text
    CONSTRAINT leser_zahlungen_fehlerbild_erlaubt
    CHECK (fehlerbild IS NULL OR fehlerbild IN
      ('LESER_OFFLINE', 'KARTE_ABGELEHNT', 'ZEITUEBERSCHREITUNG', 'ABBRUCH_AM_GERAET')),
  fehler_meldung text,

  -- Wie oft die weiche girocard-Ablehnung (`online_or_offline_pin_required`)
  -- gesehen wurde. Gezaehlt als Beweis, NIE als Fehlschlag gebucht —
  -- Doppelbelastungs-Riegel, Teil 2.
  weiche_ablehnungen integer NOT NULL DEFAULT 0
    CONSTRAINT leser_zahlungen_weiche_nicht_negativ CHECK (weiche_ablehnungen >= 0),

  -- Die ECHTEN Warenkorbzeilen, wie sie auf dem Kundendisplay standen
  -- (Bezeichnung, Menge, Betrag in Cent). Beweis dessen, was der Kunde sah.
  positionen jsonb NOT NULL
    CONSTRAINT leser_zahlungen_positionen_liste CHECK (jsonb_typeof(positionen) = 'array'),

  -- Ein zweiter Anstoss derselben Geste eroeffnet KEINE zweite Zahlung
  -- (Doppelbelastungs-Riegel, Teil 3).
  idempotenz_schluessel uuid NOT NULL UNIQUE,

  angelegt_von uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leser_zahlungen_intent_je_anbieter UNIQUE (provider, provider_intent_id)
);

COMMENT ON TABLE leser_zahlungen IS
  'Der Stand jeder servergesteuerten Leser-Zahlung (Stripe Terminal). SUCCEEDED ist endgueltig; die weiche girocard-Ablehnung wird gezaehlt, nie gebucht.';

-- Die Kasse fragt den Stand offener Zahlungen ab; der Aufraeumer von morgen
-- will alte PROCESSING-Zeilen finden.
CREATE INDEX IF NOT EXISTS leser_zahlungen_status_idx
  ON leser_zahlungen (status, created_at DESC);

-- GANZE Tabelle, absichtlich nicht spaltenweise (Spaltenfalle 0099).
GRANT SELECT, INSERT, UPDATE, DELETE ON kartenleser TO warehouse14_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leser_zahlungen TO warehouse14_app;

COMMIT;

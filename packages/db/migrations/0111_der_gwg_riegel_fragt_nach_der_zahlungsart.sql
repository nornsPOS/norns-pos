-- Der GwG-Riegel fragt endlich nach der Zahlungsart.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  BIS HIERHER WAR JEDER NETZVERKAUF ÜBER 2.000 EURO UNMÖGLICH.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gemessen am 26.07.2026 gegen das echte Stripe im Testmodus, mit einem Stück
-- zu 2.500 Euro, per Karte bezahlt:
--
--   Webhook-Antwort : 403 KYC_REQUIRED
--   Warenkorb       : bleibt CHECKOUT
--   Stück           : bleibt RESERVED
--   Transaktion     : keine
--
-- Und das ist der teure Teil: dieser Riegel schlägt zu, NACHDEM der Kunde
-- bezahlt hat. Stripe wiederholt die Zustellung, bekommt immer dieselbe 403,
-- und nach Ablauf der Reservierungsfrist gibt der Aufräumer das Stück frei.
-- Geld genommen, Ware wieder im Regal, kein Beleg.
--
-- Aufgefallen ist es nie, weil `STRIPE_SECRET_KEY` in der Produktion leer ist
-- und dieser Weg noch nie eine echte Zahlung gesehen hat.
--
-- ── Was das Gesetz wirklich sagt ──────────────────────────────────────────
--
-- Die 2.000 Euro sind eine BARZAHLUNGS-Schwelle, keine Betragsschwelle:
--
--   • Bar, Edelmetall:  ab  2.000 EUR  (§ 10 Abs. 6a Nr. 1 Buchst. b GwG)
--   • Unbar:            ab 15.000 EUR  (§ 10 Abs. 3 GwG)
--
-- Der Grund ist einleuchtend: wer mit Karte oder Überweisung zahlt, ist über
-- seine Bank ohnehin identifiziert. Die niedrige Schwelle zielt auf das
-- Tafelgeschäft mit Bargeld.
--
-- ── Warum der Kanal und nicht die Zahlungsart selbst ──────────────────────
--
-- Der Riegel läuft VOR dem Einfügen in `transactions`. Die Zahlungsarten
-- stehen aber in `transaction_payments` und werden erst DANACH geschrieben.
-- Zu diesem Zeitpunkt gibt es also gar keine Zahlungsart, die man fragen
-- könnte.
--
-- Was es gibt, ist `sales_channel`. Und für WEB und EBAY gilt eine Tatsache,
-- die keine Auslegung braucht: **über das Netz kann man nicht bar bezahlen.**
-- Nur dort wird gelockert. POS und PHONE behalten die 2.000 Euro unverändert,
-- denn an der Theke kann sehr wohl Bargeld liegen.
--
-- Damit ist diese Wanderung für das Ladengeschäft KEINE Lockerung. Was der
-- Steuerberater abgezeichnet hat, gilt an der Theke weiter, Wort für Wort.
--
-- ── Und zwei Stellen, an denen der Riegel STRENGER wird ───────────────────
--
-- 1. Ein zweiter Wächter auf `transaction_payments`: taucht auf einem Verkauf
--    ab der Barschwelle eine BAR-Zahlung auf, wird sie abgewiesen, wenn der
--    Käufer nicht ausweisgeprüft ist. Das schliesst jeden Weg, auf dem Bargeld
--    an der Kanalprüfung vorbei in einen Vorgang gerät, auch einen, den es
--    heute noch gar nicht gibt.
--
-- 2. Ein als geldwäscheverdächtig markierter Vorgang verlangt eine Ausweisung
--    ab dem ersten Cent, ohne jede Schwelle. Das steht so im Gesetz und stand
--    bisher nirgends im Code.
--
-- Unter dem Strich: der Netzverkauf wird möglich, das Bargeschäft wird nicht
-- schwächer, und bei Verdacht wird alles strenger.

BEGIN;

-- ── Die beiden Schwellen als Daten, nicht als Beton ───────────────────────
--
-- Der bisherige Schlüssel `gwg.verkauf_identity_threshold_eur` bleibt gültig
-- und ist ab jetzt ausdrücklich die BAR-Schwelle. Wer ihn in der Produktion
-- verstellt hat, behält seine Einstellung; sie wird nicht überschrieben.
INSERT INTO system_settings (key, value)
VALUES ('gwg.verkauf_identity_threshold_unbar_eur', '"15000.00"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION transactions_validate_kyc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_kyc_verified_at timestamptz;
  verkauf_threshold numeric;
  ist_unbarer_kanal boolean;
BEGIN
  -- Stornos reverse an already-validated transaction — never re-block a reversal.
  IF NEW.storno_of_transaction_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── ANKAUF: ID ALWAYS required, from EUR 0.01 (hard §259 StGB) ──
  IF NEW.direction = 'ANKAUF' THEN
    SELECT kyc_verified_at INTO c_kyc_verified_at
      FROM customers WHERE id = NEW.customer_id;
    IF c_kyc_verified_at IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Ankauf): seller % is not ID-verified; every Ankauf requires identification (§ 259 StGB)', NEW.customer_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.direction = 'VERKAUF' THEN

    -- ── NEU: Verdacht sticht jede Schwelle ────────────────────────────────
    --
    -- Wer einen Vorgang als geldwäscheverdächtig markiert, darf ihn nicht
    -- gleichzeitig anonym abschliessen. Das gilt ab dem ersten Cent und ohne
    -- Rücksicht auf Kanal oder Zahlungsart.
    IF COALESCE(NEW.suspicious_aml_flag, false) THEN
      IF NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): als geldwaescheverdaechtig markierter Verkauf erfordert einen ausweisgeprueften Kaeufer, unabhaengig vom Betrag (§ 10 GwG); kein Kunde hinterlegt'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT kyc_verified_at INTO c_kyc_verified_at
        FROM customers WHERE id = NEW.customer_id;
      IF c_kyc_verified_at IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): Kaeufer % ist nicht ausweisgeprueft, und der Vorgang ist als geldwaescheverdaechtig markiert (§ 10 GwG)', NEW.customer_id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;

    -- ── Welche Schwelle gilt? ─────────────────────────────────────────────
    --
    -- Über das Netz kann niemand bar bezahlen. Nur deshalb, und nur dort,
    -- gilt die unbare Schwelle. An der Theke bleibt alles wie bisher.
    ist_unbarer_kanal := NEW.sales_channel IN ('WEB', 'EBAY');

    IF ist_unbarer_kanal THEN
      SELECT COALESCE((value #>> '{}')::numeric, 15000.00)
        INTO verkauf_threshold
        FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_unbar_eur';
      verkauf_threshold := COALESCE(verkauf_threshold, 15000.00);
    ELSE
      SELECT COALESCE((value #>> '{}')::numeric, 2000.00)
        INTO verkauf_threshold
        FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur';
      verkauf_threshold := COALESCE(verkauf_threshold, 2000.00);
    END IF;

    IF NEW.total_eur >= verkauf_threshold THEN
      IF NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): sale total % >= % (Kanal %) requires an ID-verified buyer (§ 10 GwG); no customer attached', NEW.total_eur, verkauf_threshold, NEW.sales_channel
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT kyc_verified_at INTO c_kyc_verified_at
        FROM customers WHERE id = NEW.customer_id;
      IF c_kyc_verified_at IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): buyer % is not ID-verified; a sale total % >= % (Kanal %) requires identification (§ 10 GwG)', NEW.customer_id, NEW.total_eur, verkauf_threshold, NEW.sales_channel
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_kyc() OWNER TO warehouse14_security;

-- ── Der zweite Wächter: dort, wo das Bargeld wirklich auftaucht ───────────
--
-- Die Kanalprüfung oben ist eine Annahme über die Wirklichkeit ("im Netz gibt
-- es kein Bargeld"). Sie stimmt, aber sie ist eine Annahme. Dieser Wächter
-- braucht keine: er sieht die Zahlungsart selbst.
--
-- Damit ist der Weg auch dann dicht, wenn jemand später einen Vorgang baut,
-- den es heute nicht gibt, etwa eine Netzbestellung, die im Laden bar bezahlt
-- wird. Dann liegt hier eine BAR-Zeile, und sie wird geprüft.
CREATE OR REPLACE FUNCTION transaction_payments_validate_cash_kyc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t_direction       text;
  t_total           numeric;
  t_customer_id     uuid;
  t_storno_of       uuid;
  c_kyc_verified_at timestamptz;
  bar_threshold     numeric;
BEGIN
  IF NEW.payment_method <> 'CASH' THEN
    RETURN NEW;
  END IF;

  SELECT direction::text, total_eur, customer_id, storno_of_transaction_id
    INTO t_direction, t_total, t_customer_id, t_storno_of
    FROM transactions WHERE id = NEW.transaction_id;

  -- Ein Storno kehrt einen bereits geprüften Vorgang um.
  IF t_storno_of IS NOT NULL OR t_direction <> 'VERKAUF' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric, 2000.00)
    INTO bar_threshold
    FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur';
  bar_threshold := COALESCE(bar_threshold, 2000.00);

  -- Gemessen wird am GESAMTBETRAG des Verkaufs, nicht am bar gezahlten Teil.
  -- Sonst liesse sich die Schwelle durch Stückelung umgehen: 1.900 Euro bar
  -- plus Rest per Karte wäre sonst prüfungsfrei, und genau diese Stückelung
  -- ist der Vorgang, den das Gesetz treffen will.
  IF t_total >= bar_threshold THEN
    IF t_customer_id IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Barzahlung): Verkauf ueber % >= % mit Bargeld erfordert einen ausweisgeprueften Kaeufer (§ 10 Abs. 6a GwG); kein Kunde hinterlegt', t_total, bar_threshold
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT kyc_verified_at INTO c_kyc_verified_at
      FROM customers WHERE id = t_customer_id;
    IF c_kyc_verified_at IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Barzahlung): Kaeufer % ist nicht ausweisgeprueft; ein Verkauf ueber % >= % mit Bargeld erfordert Identifizierung (§ 10 Abs. 6a GwG)', t_customer_id, t_total, bar_threshold
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transaction_payments_validate_cash_kyc() OWNER TO warehouse14_security;

-- Der Wächter liest quer. Enge Rechte, wie beim ersten.
GRANT SELECT (id, direction, total_eur, customer_id, storno_of_transaction_id)
  ON transactions TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transaction_payments_validate_cash_kyc ON transaction_payments;
CREATE TRIGGER trg_transaction_payments_validate_cash_kyc
  BEFORE INSERT ON transaction_payments
  FOR EACH ROW EXECUTE FUNCTION transaction_payments_validate_cash_kyc();

COMMIT;

-- ── Zur Prüfung nach dem Einspielen ───────────────────────────────────────
--
--   SELECT key, value FROM system_settings WHERE key LIKE 'gwg%';
--   -- erwartet: die Bar-Schwelle unveraendert, die unbare mit 15000.00 dabei

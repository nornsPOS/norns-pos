-- Die Vermittlungsgebühr zieht bei Stripe aus.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  DER ANBIETER IST AUSTAUSCHBAR. DAS PROVISIONSMODELL IST ES NICHT.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bis hierher stand die Gebühr als EINE Zahl auf dem Stripe-Konto des
-- Händlers: `stripe_connected_accounts.application_fee_bps`. Zwei Folgen,
-- die beide erst wehtun, wenn Geld fliesst:
--
--   1. Ein Verkauf über den Marktplatz von Norns konnte keine andere Gebühr
--      tragen als ein Verkauf im eigenen Shop desselben Händlers. Damit wäre
--      der Marktplatz kein eigenes Geschäft, sondern eine Werbefläche.
--   2. Ein Anbieterwechsel hätte die Gebührenregel mitgerissen, obwohl sie
--      mit dem Anbieter nichts zu tun hat. Die Gebühr ist eine Abmachung
--      zwischen Norns und dem Händler, kein Merkmal von Stripe.
--
-- Diese Tabelle nennt deshalb nirgends einen Anbieternamen in ihrem eigenen
-- Namen und in keiner Spaltenbezeichnung. `provider` ist eine Angabe, kein
-- Bauteil. Ein Wechsel schreibt Zeilen um, er schreibt keinen Code um.
--
-- ── Die Rangfolge ─────────────────────────────────────────────────────────
--
-- NULL heisst in BEIDEN Bezugsspalten "gilt für alle". Vier Stufen, die erste
-- passende gewinnt:
--
--   1. dieses Konto, dieser Kanal    ← die Einzelabrede, sie schlägt alles
--   2. dieses Konto, alle Kanäle     ← was mit diesem Händler vereinbart ist
--   3. alle Konten, dieser Kanal     ← der Listenpreis des Kanals
--   4. alle Konten, alle Kanäle      ← der Hauspreis
--
-- Die Auswahl passiert BEWUSST NICHT hier in SQL, sondern in
-- `apps/api-cloud/src/lib/commission.ts`, geprüft von 15 Tests ohne
-- Datenbank. Eine Rangfolge über vier Stufen mit NULL-Bedeutung liesse sich
-- als Abfrage schreiben, aber nicht ohne laufende Datenbank prüfen, und genau
-- das ist die Fehlerklasse, die in diesem Muster schon live aufgeschlagen
-- ist: rohes SQL, das kein Typprüfer und kein Test je ansieht.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_commission_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Derselbe Typ wie in `payment_intents`. Er trägt heute STRIPE, PAYPAL und
  -- MOLLIE; ein vierter Anbieter ist ein Wert, kein Umbau.
  provider      payment_provider NOT NULL,

  -- Der Kontobezug BEIM ANBIETER. Bei Stripe `acct_…`, bei einem anderen
  -- Anbieter dessen eigene Form. Deshalb steht hier KEINE Formprüfung: eine
  -- auf `acct_` festgenagelte Bedingung wäre genau die Fessel, die diese
  -- Wanderung löst. NULL heisst: gilt für jedes Konto dieses Anbieters.
  account_ref   text,

  -- Wo das Geschäft zustande kam, aus Sicht des GELDES. Bewusst nicht
  -- `sales_channel` und nicht `reservation_channel`: die beiden beschreiben
  -- den Warenweg. Eine Abholung im Laden, die im Netz bezahlt wurde, ist hier
  -- WEB und dort POS. NULL heisst: gilt für jeden Kanal.
  --
  -- MARKETPLACE steht schon hier, obwohl der Marktplatz noch nicht gebaut
  -- ist. Ein vorgesehener Wert kostet heute nichts und erspart später eine
  -- Wanderung an einer Stelle, an der bereits Geld fliesst.
  channel       text,

  fee_bps       integer NOT NULL,

  -- Wozu diese Zeile gehört. Bei einem Streit über eine Rechnung ist genau
  -- das die Frage, und sie muss ohne Nachfrage beantwortbar sein.
  note          text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Dieselbe Schranke wie in 0108 und im Norns-Register: die Gebühr ist ein
  -- Vermittlungsentgelt, kein Gewinnanteil. Über 10 % wäre sie das Zweite,
  -- und das hätte Folgen, die weit über die Technik hinausgehen.
  CONSTRAINT payment_commission_rates_fee_sane
    CHECK (fee_bps > 0 AND fee_bps <= 1000),

  -- Ein Wertebereich, kein Zustandsfilter. Der Unterschied ist wichtig: eine
  -- Weissliste über ZUSTÄNDE ohne Sonst-Zweig lässt beim nächsten neuen Wert
  -- jede Zeile scheitern (siehe `products_reservation_ttl_per_channel`). Hier
  -- prüft die Bedingung nur, ob ein eingetragener Kanal einer der bekannten
  -- ist. Ein neuer Kanal ist ein ALTER an EINER Stelle, und bis dahin kann
  -- niemand versehentlich 'MARKTPLATZ' oder 'web' eintragen.
  CONSTRAINT payment_commission_rates_channel_known
    CHECK (channel IS NULL OR channel IN ('POS','WEB','MARKETPLACE','EBAY')),

  CONSTRAINT payment_commission_rates_account_ref_nonempty
    CHECK (account_ref IS NULL OR length(btrim(account_ref)) > 0)
);

COMMENT ON TABLE payment_commission_rates IS
  'Die Vermittlungsgebuehr von Norns, je Anbieter, Konto und Kanal. NULL heisst "gilt fuer alle". Die Rangfolge steht in apps/api-cloud/src/lib/commission.ts, nicht hier.';

-- NULLS NOT DISTINCT ist der Kern dieses Index, nicht ein Feinschliff.
-- Nach der Vorgabe von Postgres sind zwei NULL verschieden, und dann liessen
-- sich BELIEBIG VIELE Hauspreis-Zeilen (NULL, NULL) anlegen. Welche davon
-- gewinnt, hinge an der Reihenfolge der Zeilen, also am Zufall. Eine Gebühr,
-- die vom Zufall abhängt, ist ein Streit mit offenem Ausgang.
CREATE UNIQUE INDEX IF NOT EXISTS payment_commission_rates_scope_uq
  ON payment_commission_rates (provider, account_ref, channel)
  NULLS NOT DISTINCT;

-- Der Lesepfad ist immer derselbe: alle Zeilen EINES Anbieters, die für EIN
-- Konto in Frage kommen. Der Index bedient genau das.
CREATE INDEX IF NOT EXISTS payment_commission_rates_lookup_idx
  ON payment_commission_rates (provider, account_ref);

-- ⚠️ Diese Wanderung prüft sich selbst nach.
--
-- Grund: die Drizzle-Fassung 0.36.4 kann NULLS NOT DISTINCT nicht ausdrücken,
-- die Erklärung in `paymentCommissionRates.ts` bleibt also zwangsläufig hinter
-- der Datenbank zurück. Genau solche stillen Abweichungen halten sich lange:
-- der Typ `reservation_channel` kennt seit 0086 den Wert `WEB_RESERVATION`
-- nicht, den die Anwendung längst benutzt, und niemand hat es bemerkt.
--
-- Wer diesen Index je ohne NULLS NOT DISTINCT neu anlegt, bekommt hier einen
-- Abbruch statt einer Datenbank, in der zwei Hauspreise nebeneinander stehen
-- und der Zufall entscheidet, welcher gilt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'payment_commission_rates_scope_uq'
       AND indexdef ILIKE '%NULLS NOT DISTINCT%'
  ) THEN
    RAISE EXCEPTION
      'payment_commission_rates_scope_uq fehlt NULLS NOT DISTINCT. Ohne das sind mehrere Zeilen mit (NULL, NULL) moeglich und die geltende Gebuehr haengt von der Zeilenreihenfolge ab.';
  END IF;
END
$$;

-- ── Was bisher galt, gilt weiter ──────────────────────────────────────────
--
-- Jede bestehende Gebühr eines verbundenen Kontos wandert als
-- Konto-Vorgabe (alle Kanäle) herüber. Damit rechnet nach dieser Wanderung
-- JEDE Zahlung genau so wie vorher. Eine Wanderung, die nebenbei Preise
-- ändert, ist eine Wanderung, die niemand zurücknehmen kann, ohne Rechnungen
-- zu korrigieren.
INSERT INTO payment_commission_rates (provider, account_ref, channel, fee_bps, note)
SELECT 'STRIPE'::payment_provider,
       s.stripe_account_id,
       NULL,
       s.application_fee_bps,
       'uebernommen aus stripe_connected_accounts.application_fee_bps (0110)'
  FROM stripe_connected_accounts s
 WHERE s.application_fee_bps IS NOT NULL
   AND s.application_fee_bps > 0
   AND s.application_fee_bps <= 1000
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN stripe_connected_accounts.application_fee_bps IS
  'ABGELOEST durch payment_commission_rates (0110). Wird nicht mehr gelesen. Spalte bleibt stehen, damit ein Ruecksetzen auf das vorige Abbild ohne Datenverlust moeglich ist.';

-- ── Die Rechte, und der Grund für jede einzelne Zeile ─────────────────────
--
-- ⚠️ In diesem Muster sind Rechte SPALTENWEISE vergeben, und eine
-- spaltenweise Vergabe kennt neue Spalten nicht. Dieselbe Falle hat hier
-- schon dreimal zugeschlagen. Bei einer NEUEN Tabelle ist sie noch strenger:
-- ohne die Zeilen unten wäre die Tabelle für die Anwendung nicht etwa
-- eingeschränkt, sondern vollständig unsichtbar. Kein Fehler beim Start, kein
-- Fehler beim Typprüfen, kein Fehler im Test. Erst die erste echte
-- Kartenzahlung wäre gescheitert, vor dem Kunden an der Kasse.
ALTER TABLE payment_commission_rates OWNER TO warehouse14_migrator;

-- Die Anwendung darf LESEN und sonst nichts.
--
-- Kein INSERT, kein UPDATE, kein DELETE, und das ist Absicht: was ein Händler
-- an Norns zahlt, ist eine kaufmännische Abmachung. Ein Fehler in irgendeiner
-- Route darf sie nicht verändern können, in keine Richtung. Gesetzt werden
-- Zeilen bis auf Weiteres durch eine Wanderung. Sollte je eine Oberfläche
-- dafür entstehen, ist das EINE zusätzliche GRANT-Zeile, und sie gehört dann
-- an eine eigene, eng geführte Rolle, nicht an die Anwendung.
GRANT SELECT ON payment_commission_rates TO warehouse14_app;

-- Der Worker rechnet Auszahlungen und Berichte nach und muss dieselbe Wahrheit
-- sehen wie die Anwendung. Sonst weicht ein Monatsbericht von den Belegen ab,
-- und niemand weiss, welcher der beiden recht hat.
GRANT SELECT ON payment_commission_rates TO warehouse14_worker;

COMMIT;

-- ── Zur Prüfung nach dem Einspielen, ohne jede Nebenwirkung ───────────────
--
--   SELECT has_table_privilege('warehouse14_app', 'payment_commission_rates', 'SELECT')  AS darf_lesen,
--          has_table_privilege('warehouse14_app', 'payment_commission_rates', 'INSERT')  AS darf_schreiben;
--   -- erwartet: darf_lesen = true, darf_schreiben = false
--
-- `has_table_privilege` fragt die Datenbank selbst und braucht weder eine
-- Testeinrichtung noch eine einzige geschriebene Zeile.

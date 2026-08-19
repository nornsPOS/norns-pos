-- ═══════════════════════════════════════════════════════════════════════════
--  0118 — DER VERKAUF GEHOERT IN SEINEN EIGENEN TAG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND (26.07.2026, gemessen) ─────────────────────────────────────
--
-- `transactions_finalize.ts` schrieb die Kopfzeile OHNE `finalized_at`. Die
-- Spalte fiel auf `DEFAULT now()` (0009_transactions.sql:105). Der
-- Anfragerumpf trug ueberhaupt keinen Zeitstempel. Damit galt: die Zeit des
-- Vorgangs war die Zeit, zu der der Server ihn ENTGEGENNAHM.
--
-- Fuer ein Geraet, das die Nacht ueber in der Theke steht, ist das der
-- Normalfall, nicht der Sonderfall. Ein Verkauf um 17:50 Uhr ohne Netz, der
-- am naechsten Morgen abfliesst, erschien im Z-Bon des NAECHSTEN Tages —
-- weil der Tagesabschluss auf `berlin_business_day(t.finalized_at)`
-- aggregiert (`closings-finalize.ts:246`).
--
-- Und der Waechter aus 0013_security_hardening.sql:141 schwieg dazu: er
-- verglich `dc.business_day = berlin_business_day(NEW.finalized_at)` — also
-- den NACHSPIELTAG. Er blockte nicht, weil er den falschen Tag ansah.
--
-- ── WAS DIESE WANDERUNG TUT ───────────────────────────────────────────────
--
-- (1) `erfasst_am`   — die vom GERAET erfasste Vorgangszeit. Nach § 146a AO
--     und der DSFinV-K ist die Kasse die Quelle fuer Vorgangsbeginn und
--     Vorgangsende, nicht der Server.
--
-- (2) `eingegangen_am` — die Eingangszeit des SERVERS, getrennt daneben.
--     Ohne sie waere die Verschiebung zwischen Kassieren und Ankommen nach
--     dem Schreiben nicht mehr feststellbar; mit ihr ist sie pruefbar. Das
--     ist der Kern von § 146 Abs. 4 AO: eine Aufzeichnung darf nicht so
--     veraendert werden, dass der urspruengliche Inhalt nicht mehr
--     feststellbar ist.
--
-- (3) `nachtrag_bezugstag` — gesetzt NUR, wenn der Vorgang eintrifft,
--     nachdem sein eigener Kassentag bereits ABGESCHLOSSEN wurde. Dann
--     bleibt der abgeschlossene Tag unberuehrt (§ 146 Abs. 4 AO), der
--     Vorgang wird auf dem laufenden Tag gebucht (§ 146 Abs. 1 Satz 2 AO:
--     Kasseneinnahmen sind taeglich festzuhalten — der frueheste zulaessige
--     Tag ist also HEUTE), und diese Spalte traegt den Tag, zu dem er
--     wirklich gehoert. Still verschwinden darf er nicht, und genau das tat
--     er bisher.
--
-- (4) Der Waechter prueft ab jetzt BEIDE Tage. Ein Rumpf, der `erfasst_am`
--     rueckdatiert, ohne den Nachtrag auszuweisen, wird abgewiesen — sonst
--     waere die Rueckdatierung der bequemere Weg an der Sichtbarkeit vorbei.
--
-- (5) Der Hauptbuch-Eintrag traegt die drei Angaben mit, damit sie im
--     Tagebuch stehen und nicht nur in einer Spalte, die niemand ansieht.
--
-- ⚠️ ALLE DREI SPALTEN SIND NACHTRAGBAR OHNE UMSCHREIBEN: `erfasst_am` und
-- `nachtrag_bezugstag` sind NULL-bar (aeltere Kassen senden nichts),
-- `eingegangen_am` faellt auf `now()`. Bestandszeilen bleiben unangetastet.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Die drei Spalten
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS erfasst_am         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eingegangen_am     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS nachtrag_bezugstag DATE;

COMMENT ON COLUMN transactions.erfasst_am IS
  'Die vom Kassengeraet erfasste Vorgangszeit (§ 146a AO / DSFinV-K: die Kasse ist die Quelle). '
  'NULL fuer aeltere Kassen und fuer nicht-POS-Erzeuger (Webhooks, Arbeiter).';

COMMENT ON COLUMN transactions.eingegangen_am IS
  'Die Eingangszeit des Servers. Getrennt von finalized_at, damit die Verschiebung zwischen '
  'Kassieren und Ankommen nachtraeglich feststellbar bleibt (§ 146 Abs. 4 AO).';

COMMENT ON COLUMN transactions.nachtrag_bezugstag IS
  'Gesetzt NUR bei einem nachtraeglichen Eingang: der Kassentag, zu dem der Vorgang wirklich '
  'gehoert, dessen Abschluss aber schon FINALIZED war. Der Vorgang selbst ist auf dem laufenden '
  'Tag gebucht; diese Spalte macht den Nachtrag sichtbar und auffindbar.';

-- Ein Nachtrag darf nur behauptet werden, wenn er zur Erfassungszeit passt.
-- Sonst waere die Spalte eine freie Behauptung statt einer Tatsache.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_nachtrag_passt_zur_erfassung;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_nachtrag_passt_zur_erfassung
  CHECK (
    nachtrag_bezugstag IS NULL
    OR (erfasst_am IS NOT NULL AND nachtrag_bezugstag = berlin_business_day(erfasst_am))
  );

-- Die Nachtraege eines Zeitraums muessen in einem Griff auffindbar sein —
-- der Inhaber und die Pruefung fragen genau danach.
CREATE INDEX IF NOT EXISTS transactions_nachtrag_idx
  ON transactions (nachtrag_bezugstag)
  WHERE nachtrag_bezugstag IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Der Waechter prueft ab jetzt den RICHTIGEN Tag — und beide
--
-- Ersetzt transactions_validate_closing_day() aus 0013:132. Der erste Arm
-- ist unveraendert (finalized_at darf nie auf einem abgeschlossenen Tag
-- liegen). Der ZWEITE Arm ist neu: wenn die Erfassungszeit auf einem
-- abgeschlossenen Tag liegt, MUSS der Nachtrag ausgewiesen sein. Ohne den
-- zweiten Arm koennte ein Rumpf einfach `erfasst_am` zurueckdatieren und
-- damit still an der Sichtbarkeit vorbeischreiben.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION transactions_validate_closing_day() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  buchungstag    DATE;
  erfassungstag  DATE;
BEGIN
  buchungstag := berlin_business_day(NEW.finalized_at);

  -- Arm 1 (unveraendert seit 0013 C-3): der Buchungstag selbst darf nicht
  -- abgeschlossen sein. ADR-0008 + KassenSichV: der Z-Bon ist fest.
  IF EXISTS (
    SELECT 1 FROM daily_closings dc
     WHERE dc.business_day = buchungstag
       AND dc.shop_id IS NOT DISTINCT FROM NEW.shop_id
       AND dc.state = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION
      'Closing-day guard: business day % is FINALIZED (shop %); cannot insert transaction (ADR-0008 + KassenSichV)',
      buchungstag, COALESCE(NEW.shop_id::text, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Arm 2 (neu, 0118): die ERFASSUNGSZEIT liegt auf einem abgeschlossenen
  -- Tag. Das ist erlaubt — aber nur als ausgewiesener Nachtrag.
  IF NEW.erfasst_am IS NOT NULL THEN
    erfassungstag := berlin_business_day(NEW.erfasst_am);

    IF erfassungstag <> buchungstag
       AND EXISTS (
         SELECT 1 FROM daily_closings dc
          WHERE dc.business_day = erfassungstag
            AND dc.shop_id IS NOT DISTINCT FROM NEW.shop_id
            AND dc.state = 'FINALIZED'
       )
       AND NEW.nachtrag_bezugstag IS DISTINCT FROM erfassungstag
    THEN
      RAISE EXCEPTION
        'Nachtrag-Wächter: Erfassungstag % ist bereits abgeschlossen (shop %); ein solcher Vorgang muss als Nachtrag ausgewiesen werden (nachtrag_bezugstag)',
        erfassungstag, COALESCE(NEW.shop_id::text, 'NULL')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_closing_day() OWNER TO warehouse14_security;

COMMENT ON FUNCTION transactions_validate_closing_day() IS
  'Red Team Audit C-3 + Wanderung 0118: refuse any transaction whose BOOKING day is FINALIZED, '
  'and refuse a transaction whose CAPTURE day is FINALIZED unless it is declared as a Nachtrag '
  '(nachtrag_bezugstag). SECURITY DEFINER, owned by warehouse14_security.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Der Hauptbuch-Eintrag traegt die drei Angaben mit
--
-- Ersetzt on_transaction_finalized() aus 0009:319. Teil (a) ist woertlich
-- unveraendert; nur die Nutzlast in (b) waechst um drei Felder. Damit steht
-- der Nachtrag im Tagebuch und nicht nur in einer Spalte.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION on_transaction_finalized() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  -- (a) Update customer cumulative spend / Ankauf.
  --     For storno, NEW.total_eur is negative → uniform `+= NEW.total_eur` subtracts.
  IF NEW.customer_id IS NOT NULL THEN
    IF NEW.direction = 'VERKAUF' THEN
      UPDATE customers
         SET cumulative_spend_eur = cumulative_spend_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    ELSIF NEW.direction = 'ANKAUF' THEN
      UPDATE customers
         SET cumulative_ankauf_eur = cumulative_ankauf_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    END IF;
  END IF;

  -- (b) Emit ledger_events. The hash-chain trigger from migration 0008 fires
  --     for this INSERT and extends the chain.
  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    CASE
      WHEN NEW.storno_of_transaction_id IS NULL THEN 'transaction.finalized'
      ELSE                                            'transaction.stornoed'
    END,
    'transactions',
    NEW.id,
    NEW.cashier_user_id,
    NEW.device_id,
    jsonb_build_object(
      'direction',          NEW.direction,
      'total_eur',          NEW.total_eur::text,
      'subtotal_eur',       NEW.subtotal_eur::text,
      'vat_eur',            NEW.vat_eur::text,
      'tax_treatment_code', NEW.tax_treatment_code,
      'customer_id',        NEW.customer_id,
      'receipt_locator',    NEW.receipt_locator,
      'storno_of',          NEW.storno_of_transaction_id,
      'finalized_at',       to_char(NEW.finalized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      -- 0118: die drei neuen Angaben. `erfasst_am` ist die Kassenzeit,
      -- `eingegangen_am` die Serverzeit, und `nachtrag_bezugstag` steht nur
      -- dann drin, wenn der Vorgang nach dem Abschluss seines Tages eintraf.
      'erfasst_am',         CASE WHEN NEW.erfasst_am IS NULL THEN NULL
                                 ELSE to_char(NEW.erfasst_am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
      'eingegangen_am',     to_char(NEW.eingegangen_am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'nachtrag_bezugstag', NEW.nachtrag_bezugstag
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_transaction_finalized() OWNER TO warehouse14_security;

COMMENT ON FUNCTION on_transaction_finalized() IS
  'AFTER INSERT trigger on transactions. Updates customer cumulative_*_eur + emits ledger event. '
  'Wanderung 0118: die Nutzlast traegt erfasst_am, eingegangen_am und nachtrag_bezugstag mit.';

COMMIT;

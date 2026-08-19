-- ═════════════════════════════════════════════════════════════════════════
-- 0098 — der Versand, die fehlende Hälfte des Ladens.
-- ═════════════════════════════════════════════════════════════════════════
--
-- Der Kundenshop verspricht seit jeher Versand: „Lieferung in 1 bis 2
-- Werktagen", „Versichert", „zzgl. Versandkosten", und im Warenkorb sogar
-- „Versandkostenfrei". Dahinter lag NICHTS. Keine Versandtabelle, keine
-- Kosten, kein Ziel, kein Ausdruck, kein Zustand nach der Zahlung. Die
-- Zahlungsseite war gebaut (`payment_intents` mit Anbieter, Zuständen und
-- Client-Secret, `transactions.shipping_address_encrypted`, ein Checkout, der
-- Liefer- und Rechnungsadresse annimmt); die Versandseite nie.
--
-- Der Laden verschickt nach Deutschland und in jedes Land, das DHL bedient.
-- Diese Migration legt dafür die Knochen, ohne einen einzigen fremden Dienst
-- vorauszusetzen: Zonen, Preise, Sendungen, Zustände. Der DHL-Zugang und die
-- Zahlungsschlüssel werden später NUR noch eingesteckt.
--
-- ── Zwei Entscheidungen, die hier festgeschrieben werden ─────────────────
--
-- 1. ABHOLUNG BLEIBT. Das Reservieren für die Nachbarschaft ist kein
--    Übergangsmodell, das der Versand ablöst, sondern der zweite Weg. Deshalb
--    trägt jeder Warenkorb ausdrücklich, WELCHER der beiden er ist, und der
--    Vorgabewert ist ABHOLUNG: jede heute bestehende Bestellung IST eine
--    Abholung, und die Spalte darf das nicht nachträglich umdeuten.
--
-- 2. DIE SENDUNG KOPIERT DIE ADRESSE NICHT. Sie zeigt auf den Beleg, auf dem
--    die Adresse ohnehin verschlüsselt liegt. Eine zweite Kopie wäre ein
--    zweites Versteck für Personendaten, und genau so ein Versteck war der
--    Grund für 0096: `email_outbox` trug eine Empfängeradresse, die
--    `erase_customer()` nicht erreichen konnte, und ein gelöschter Kunde
--    bekam trotzdem Post. `erase_customer()` setzt
--    `transactions.shipping_address_encrypted` bereits auf NULL, und die
--    Etiketten hängen als `document_attachments`, die ebenfalls geräumt
--    werden. Damit ist der Versand vom ersten Tag an löschbar, ohne dass die
--    Löschfunktion angefasst werden muss.
--
-- Das LAND steht bewusst im Klartext neben der verschlüsselten Adresse. Es
-- entscheidet über Zone, Preis und Umsatzsteuer und muss dafür abfragbar
-- sein; ein Länderkürzel allein identifiziert niemanden.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Abholung oder Versand ─────────────────────────────────────────────
CREATE TYPE fulfilment_method AS ENUM ('PICKUP', 'SHIPPING');

-- ── 2. Wo eine Bestellung nach der Zahlung steht ─────────────────────────
--
-- NOT_REQUIRED ist der ehrliche Zustand einer Abholung: es gibt nichts zu
-- packen und nichts zu verschicken. Ohne diesen Wert stünde jede Abholung in
-- einem Versandzustand, den sie nie erreichen kann.
CREATE TYPE fulfilment_status AS ENUM (
  'NOT_REQUIRED',
  'AWAITING_PAYMENT',
  'READY_TO_PACK',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'RETURNED'
);

-- ── 3. Der Lebensweg einer Sendung ───────────────────────────────────────
--
-- DRAFT trennt „wir wollen verschicken" von „das Etikett ist gekauft". Ein
-- gekauftes Etikett kostet Geld und trägt eine Sendungsnummer; ein Entwurf
-- nicht. Ohne die Trennung wäre nach einem abgebrochenen Etikettenkauf nicht
-- feststellbar, ob DHL bereits belastet hat.
CREATE TYPE shipment_status AS ENUM (
  'DRAFT',
  'LABEL_PURCHASED',
  'HANDED_OVER',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'FAILED'
);

-- ── 4. Versandzonen ──────────────────────────────────────────────────────
--
-- Eine Zone ist eine benannte Ländergruppe. Die Liste steht als Array in der
-- Zeile und nicht als eigene Tabelle, weil sie gelesen und selten geändert
-- wird und weil eine Zone ohne ihre Länder sinnlos ist.
CREATE TABLE shipping_zones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name_de        text NOT NULL,
  -- ISO 3166-1 alpha-2, immer Großbuchstaben.
  country_codes  char(2)[] NOT NULL DEFAULT '{}',
  -- Die Auffangzone gilt für jedes Land, das keine eigene Zone hat. Genau
  -- eine Zone darf das sein, sonst wäre die Zuordnung mehrdeutig.
  is_catch_all   boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT shipping_zones_catch_all_has_no_list
    CHECK (NOT is_catch_all OR cardinality(country_codes) = 0)
);

CREATE UNIQUE INDEX shipping_zones_one_catch_all
  ON shipping_zones ((true)) WHERE is_catch_all;

-- ── 5. Preise ────────────────────────────────────────────────────────────
--
-- Eine Zeile ist ein Preis für eine Zone in einem Gewichtsband. Ein einziges
-- Band von 0 bis unendlich IST der Pauschalpreis; mehrere Bänder ergeben die
-- Staffel nach Gewicht. Beide Modelle passen damit in dieselbe Tabelle, ohne
-- dass eine Entscheidung darüber jetzt schon fallen muss. Holt der Server
-- später Live-Preise bei DHL, umgeht er diese Tabelle einfach.
CREATE TABLE shipping_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id             uuid NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  -- Der Produktschlüssel des Versanddienstes, etwa das DHL-Produkt.
  service_code        text NOT NULL,
  name_de             text NOT NULL,
  min_weight_g        integer NOT NULL DEFAULT 0,
  -- NULL heißt „nach oben offen". Kein Zahlenwert kann das ehrlich sagen.
  max_weight_g        integer,
  price_eur           numeric(18,2) NOT NULL,
  -- Wie hoch DHL diese Sendung ohne Zuschlag versichert. Für einen Laden, der
  -- Goldmünzen verschickt, ist das keine Nebensache.
  insured_up_to_eur   numeric(18,2),
  -- Ab diesem Warenwert kostet der Versand nichts. NULL heißt: nie.
  free_above_eur      numeric(18,2),
  active              boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_rates_price_nonneg     CHECK (price_eur >= 0),
  CONSTRAINT shipping_rates_weight_band_sane CHECK (min_weight_g >= 0),
  CONSTRAINT shipping_rates_weight_band_order
    CHECK (max_weight_g IS NULL OR max_weight_g > min_weight_g)
);

CREATE INDEX shipping_rates_zone_idx ON shipping_rates (zone_id, sort_order) WHERE active;

-- ── 6. Die Sendung ───────────────────────────────────────────────────────
--
-- Sie hängt am Warenkorb (der Bestellung) und, sobald der Verkauf fiskalisch
-- entstanden ist, zusätzlich am Beleg. Beides ist absichtlich optional: eine
-- Sendung kann vorbereitet sein, bevor der Beleg existiert.
--
-- KEINE ADRESSE. Siehe Kopf: sie liegt verschlüsselt am Beleg, wird dort
-- gelöscht, und eine zweite Kopie hier wäre ein Leck.
CREATE TABLE shipments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id             uuid REFERENCES carts(id) ON DELETE SET NULL,
  transaction_id      uuid REFERENCES transactions(id) ON DELETE SET NULL,
  carrier             text NOT NULL DEFAULT 'DHL',
  service_code        text NOT NULL,
  status              shipment_status NOT NULL DEFAULT 'DRAFT',
  -- Die Nummer, die der Kunde in die Sendungsverfolgung tippt.
  tracking_number     text,
  tracking_url        text,
  -- Das Etikett hängt als Dokument, damit es der GoBD-Ablage folgt und von
  -- der Löschung miterfasst wird, statt als loses Byte-Feld zu leben. Die
  -- Ablage heißt `document_attachments`; eine Tabelle `documents` gibt es in
  -- diesem Schema nicht.
  label_attachment_id uuid REFERENCES document_attachments(id) ON DELETE SET NULL,
  weight_g            integer,
  insured_value_eur   numeric(18,2),
  -- Was der Kunde für den Versand bezahlt hat, brutto. Der Steueranteil steht
  -- getrennt, weil Versandkosten das Steuerschicksal der Ware teilen und ein
  -- gemischter Warenkorb sie aufteilen muss.
  shipping_cost_eur   numeric(18,2),
  shipping_vat_eur    numeric(18,2),
  -- Klartext, weil Zone, Preis und Umsatzsteuer danach entschieden werden.
  destination_country char(2),
  dispatched_at       timestamptz,
  delivered_at        timestamptz,
  -- Was der Versanddienst zuletzt gesagt hat, wenn etwas schiefging. Eine
  -- gescheiterte Etikettenbuchung muss nachlesbar sein.
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_cost_nonneg   CHECK (shipping_cost_eur IS NULL OR shipping_cost_eur >= 0),
  CONSTRAINT shipments_weight_pos    CHECK (weight_g IS NULL OR weight_g > 0),
  -- Eine Sendung mit Nummer ist keine Entwurfssendung mehr. Andersherum darf
  -- ein Entwurf keine Nummer tragen, sonst wäre unklar, ob DHL belastet hat.
  CONSTRAINT shipments_tracking_needs_label
    CHECK (tracking_number IS NULL OR status <> 'DRAFT')
);

CREATE INDEX shipments_cart_idx        ON shipments (cart_id)        WHERE cart_id IS NOT NULL;
CREATE INDEX shipments_transaction_idx ON shipments (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX shipments_open_idx        ON shipments (status, created_at)
  WHERE status IN ('DRAFT', 'LABEL_PURCHASED', 'HANDED_OVER', 'IN_TRANSIT');
CREATE UNIQUE INDEX shipments_tracking_uq
  ON shipments (carrier, tracking_number) WHERE tracking_number IS NOT NULL;

-- ── 7. Der Warenkorb lernt den Versand ───────────────────────────────────
--
-- Bis hierher hatte er kein Feld für das, was der Kunde im Checkout tippt:
-- der Vertrag nahm eine Lieferadresse an, und sie fiel auf den Boden.
ALTER TABLE carts
  ADD COLUMN fulfilment_method     fulfilment_method NOT NULL DEFAULT 'PICKUP',
  ADD COLUMN fulfilment_status     fulfilment_status NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN shipping_address_encrypted bytea,
  ADD COLUMN shipping_country      char(2),
  ADD COLUMN shipping_rate_id      uuid REFERENCES shipping_rates(id) ON DELETE SET NULL,
  ADD COLUMN shipping_cost_eur     numeric(18,2),
  ADD COLUMN shipping_vat_eur      numeric(18,2);

-- Eine Versandbestellung ohne Zieladresse ist keine Bestellung. Der Zustand
-- wird erst ab CHECKOUT verlangt, damit ein Warenkorb im Aufbau nicht schon
-- eine Adresse tragen muss.
ALTER TABLE carts
  ADD CONSTRAINT carts_shipping_needs_destination
    CHECK (
      fulfilment_method <> 'SHIPPING'
      OR status IN ('ACTIVE', 'ABANDONED', 'CANCELLED')
      OR (shipping_address_encrypted IS NOT NULL AND shipping_country IS NOT NULL)
    );

-- Eine Abholung hat keinen Versandzustand, und eine Versandbestellung ist
-- nicht „nicht erforderlich". Ohne das driften die beiden Wege auseinander.
ALTER TABLE carts
  ADD CONSTRAINT carts_fulfilment_pair_sane
    CHECK (
      (fulfilment_method = 'PICKUP'   AND fulfilment_status = 'NOT_REQUIRED')
      OR (fulfilment_method = 'SHIPPING' AND fulfilment_status <> 'NOT_REQUIRED')
    );

CREATE INDEX carts_awaiting_fulfilment_idx
  ON carts (fulfilment_status, reserved_at)
  WHERE fulfilment_method = 'SHIPPING'
    AND fulfilment_status IN ('READY_TO_PACK', 'PACKED');

-- ── 8. Startzonen ────────────────────────────────────────────────────────
--
-- Drei Zonen, weil die Umsatzsteuer genau diese drei Fälle kennt: Inland,
-- übriges Gemeinschaftsgebiet, Drittland. Die Preise bleiben leer, bis der
-- Inhaber sie setzt; ein erfundener Startpreis wäre eine Zahl, die niemand
-- entschieden hat, und der Kunde bekäme sie zu sehen.
INSERT INTO shipping_zones (code, name_de, country_codes, is_catch_all, sort_order) VALUES
  ('DE', 'Deutschland', ARRAY['DE']::char(2)[], false, 10),
  ('EU', 'Europäische Union',
     ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','GR','HU','IE','IT',
           'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']::char(2)[],
     false, 20),
  ('WORLD', 'Übrige Welt', '{}'::char(2)[], true, 30);

-- ── 9. Eigentum und Rechte ───────────────────────────────────────────────
--
-- Jede Tabelle dieses Schemas gehört dem Migrator und wird ausdrücklich
-- freigegeben. 0097 hat gezeigt, was passiert, wenn das vergessen wird:
-- `erase_customer()` starb an „permission denied", und App und Worker waren
-- genauso ausgesperrt.
ALTER TABLE shipping_zones OWNER TO warehouse14_migrator;
ALTER TABLE shipping_rates OWNER TO warehouse14_migrator;
ALTER TABLE shipments      OWNER TO warehouse14_migrator;

-- Zonen und Preise setzt der Inhaber über die Einstellungen; die App muss sie
-- schreiben können. Lesen müssen beide, denn der Preis wird im Checkout
-- berechnet und der Worker prüft Sendungen nach.
GRANT SELECT, INSERT, UPDATE, DELETE ON shipping_zones TO warehouse14_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shipping_rates TO warehouse14_app;
GRANT SELECT                          ON shipping_zones TO warehouse14_worker;
GRANT SELECT                          ON shipping_rates TO warehouse14_worker;

-- Eine Sendung entsteht in der App und wird vom Worker fortgeschrieben, wenn
-- die Sendungsverfolgung antwortet. Gelöscht wird sie von niemandem: eine
-- versandte Sendung ist ein Geschäftsvorfall.
GRANT SELECT, INSERT, UPDATE ON shipments TO warehouse14_app, warehouse14_worker;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
--  0143 — Das Stück trägt seine Seriennummer und seine Gravur
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── BASELS ANWEISUNG VOM 19.08.2026 ──────────────────────────────────────
--
-- Bei Uhren und gravierten Stücken wird die Seriennummer bei der BEWERTUNG
-- abgelesen und wandert von dort jeden Schritt mit: Bewertung → Lager →
-- Ankaufbeleg → DSFinV-K. Eine Erfassung, ein Pfad, kein Flickwerk.
--
-- ── WAS DAS RECHTLICH IST ────────────────────────────────────────────────
--
-- §§ 8, 10 GwG: der Verpflichtete zeichnet den Gegenstand des Geschäfts so
-- auf, dass er später einem Vorfall zugeordnet werden kann. Bei einer Uhr
-- IST die Seriennummer diese Zuordnung — eine polizeiliche Anfrage nennt
-- die Nummer, nicht die Beschreibung. Die Gravur ist Beschreibung und
-- Wiedererkennung (Widmungen), keine Identität; sie bleibt deshalb auf
-- Beleg und Lagerzeile und geht NICHT in die DSFinV-K-Ausfuhr.
--
-- ── WO DIE SPALTEN WOHNEN, UND WO ABSICHTLICH NICHT ──────────────────────
--
-- GENAU ZWEI Tabellen: appraisal_items (der Erfassungsort) und products
-- (die Lagerzeile). Die Transaktionszeilen brauchen KEINE Kopie: Beleg und
-- DSFinV-K lesen die Produktzeile über transaction_items.product_id, genau
-- wie heute den Namen (gemessen in lib/dsfinvk-tag.ts).
--
-- NULL heisst: dieses Stück trägt keine. Das ist die Regel (Barren, Münzen,
-- glatter Schmuck) und die Wahrheit — dieselbe Begründung wie bei
-- ohne_tse_nr in 0142. KEINE UNIQUE-Sperre auf der Nummer: sie ist Beweis,
-- kein Schlüssel; zwei Uhren desselben Modells mit Werksdoppel dürfen die
-- Kasse nicht anhalten.

ALTER TABLE appraisal_items
  ADD COLUMN IF NOT EXISTS seriennummer text,
  ADD COLUMN IF NOT EXISTS gravur text;

COMMENT ON COLUMN appraisal_items.seriennummer IS
  'Seriennummer des Stuecks (Uhr: Gehaeuse oder Werk), bei der Bewertung abgelesen. '
  'NULL: das Stueck traegt keine. GwG-Zuordnung, kein Schluessel.';
COMMENT ON COLUMN appraisal_items.gravur IS
  'Gravur woertlich (Widmung, Initialen). NULL: keine. Beschreibung, keine Identitaet.';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS seriennummer text,
  ADD COLUMN IF NOT EXISTS gravur text;

COMMENT ON COLUMN products.seriennummer IS
  'Seriennummer des Stuecks, vom Bewertungs- oder Ankaufsschritt uebernommen, am '
  'Lagerblatt korrigierbar (oft erst am geoeffneten Gehaeuse lesbar). Die Fassung des '
  'Ankauftags steht unveraenderlich auf dem gedruckten Beleg.';
COMMENT ON COLUMN products.gravur IS
  'Gravur woertlich. Steht auf Beleg und Lagerblatt, nicht in der DSFinV-K-Ausfuhr.';

-- Suche nach einer Nummer (polizeiliche Anfrage) ohne Vollscan. Teilindex,
-- weil NULL die Regel ist.
CREATE INDEX IF NOT EXISTS products_seriennummer_idx
  ON products (seriennummer)
  WHERE seriennummer IS NOT NULL;

-- Spaltenscharfe Schreibrechte nach dem Muster von 0063:97: die Kasse darf
-- GENAU diese Felder nachtragen, sonst nichts Neues.
GRANT UPDATE (seriennummer, gravur) ON products TO warehouse14_app;
GRANT UPDATE (seriennummer, gravur) ON appraisal_items TO warehouse14_app;

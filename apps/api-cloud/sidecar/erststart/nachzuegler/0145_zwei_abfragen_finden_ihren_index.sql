-- ═══════════════════════════════════════════════════════════════════════════
--  0145 — ZWEI ABFRAGEN FINDEN IHREN INDEX (19.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Beide Befunde sind GEMESSEN, nicht vermutet: die Abfrage wurde gegen die
-- vollständige Indexliste aller Wanderungen gehalten.
--
-- ── 1. Die Kundenliste sortiert ohne Index ─────────────────────────────────
--
-- `customers-list.ts` schliesst mit `ORDER BY created_at DESC LIMIT n`. Auf
-- `customers` gibt es Indizes für Kundennummer, Blindindizes, KYC-Fristen,
-- Sanktionen, Schulden und mehr — aber KEINEN auf `created_at`. Jede Suche
-- im Spotlight und jeder Kundenwähler im Ankauf sortiert deshalb die ganze
-- Trefferliste, und die Treffer entstehen ihrerseits über `decrypt_pii` je
-- Zeile. Der Laden spürt das als Stocken beim Tippen, und es wächst mit
-- jedem Monat Kundschaft.
--
-- Teilindex ohne die weich Gelöschten: genau die Menge, die die Liste zeigt.
--
-- ── 2. Das Journal filtert roh, der Index rechnet Berlin ───────────────────
--
-- `ledger.ts` filtert `created_at >= … AND created_at < …` — ROHE Zeitstempel.
-- Der einzige Datumsindex auf `ledger_events` (Wanderung 0008) liegt aber auf
-- `berlin_business_day(created_at)`, einem AUSDRUCK. Ein Ausdrucksindex
-- bedient keinen Rohvergleich: die Abfrage liest jede Zeile, die das Haus je
-- geschrieben hat, und `ledger_events` ist die am schnellsten wachsende
-- Tabelle im System. Hausklasse „Ausdruck im Index, Rohwert in der Abfrage"
-- — dieselbe Falle hat 0144 schon für `transactions` geschlossen.

CREATE INDEX IF NOT EXISTS customers_created_at_idx
  ON customers (created_at DESC)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ledger_events_created_at_idx
  ON ledger_events (created_at);

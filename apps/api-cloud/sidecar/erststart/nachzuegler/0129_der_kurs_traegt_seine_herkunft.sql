-- ═══════════════════════════════════════════════════════════════════════════
-- 0129: Der Kurs trägt seine Herkunft
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Basels Chefsache vom 31.07.2026, nach zwei gemessenen Befunden (Sitzung B):
--
--   1. Der Wechselkurs kam von open.er-api.com (Mitternachtsstand, nicht
--      amtlich). Gegen den EZB-Referenzkurs nachgerechnet: 253,50 EUR
--      Unterschied je Kilogramm Feingold, bei jedem Ankauf, immer in
--      dieselbe Richtung gegen den Händler.
--   2. Die allererste Goldzeile jeder frischen Datenbank behauptete die
--      Herkunft 'LBMA' — eine lizenzpflichtige Quelle (IBA-Lizenz für
--      "pricing and valuation activities and in transactions"), die nie
--      benutzt wurde. In einem fiskalisch relevanten Datensatz.
--
-- Ohne die fünf Spalten unten ist KEINE Kurszeile nachrechenbar: wer den
-- Gramm-Preis prüfen will, braucht den Unzenpreis in USD, den benutzten
-- Wechselkurs, dessen Datum und Quelle, und den Stand der Metallquelle.
--
-- 'SPOT_VENDOR' ist die ehrliche Herkunft für Anbieter-Spotkurse; 'LBMA'
-- bleibt im Typ für den Tag, an dem eine echte Lizenz existiert, und wird
-- vom Code nie mehr ohne sie vergeben.
--
-- Wiederholbar: IF NOT EXISTS überall.

ALTER TYPE metal_price_source ADD VALUE IF NOT EXISTS 'SPOT_VENDOR';

ALTER TABLE metal_prices
  ADD COLUMN IF NOT EXISTS price_usd_per_ounce numeric(15, 4),
  ADD COLUMN IF NOT EXISTS fx_rate_used numeric(18, 8),
  ADD COLUMN IF NOT EXISTS fx_rate_date date,
  ADD COLUMN IF NOT EXISTS fx_source text,
  ADD COLUMN IF NOT EXISTS source_asof timestamptz;

COMMENT ON COLUMN metal_prices.price_usd_per_ounce IS
  'Rohpreis des Anbieters in USD je Feinunze, VOR der Umrechnung.';
COMMENT ON COLUMN metal_prices.fx_rate_used IS
  'Benutzter Umrechnungskurs EUR je 1 USD, exakt wie angewandt.';
COMMENT ON COLUMN metal_prices.fx_rate_date IS
  'Datum des Wechselkurses (EZB-Referenzkurse gelten je Handelstag).';
COMMENT ON COLUMN metal_prices.fx_source IS
  'Quelle des Wechselkurses, z. B. ''EZB eurofxref-daily''.';
COMMENT ON COLUMN metal_prices.source_asof IS
  'Stand der Metallquelle selbst (updatedAt des Anbieters).';

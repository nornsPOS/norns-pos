-- ───────────────────────────────────────────────────────────────────────────
-- 0123 — die erfundene USt-IdNr. verlässt die Saat (27.07.2026)
--
-- Wanderung 0044 säte `DE123456789` als „PROVISIONAL" in shop.vat_id und eine
-- genullte Telefonnummer in shop.phone. Auf Romans Produktion wurden beide
-- längst von Hand durch die echten Werte ersetzt — die SAAT aber blieb, und
-- jeder KÜNFTIGE Mandant erbt sie beim Anlegen seiner Datenbank: sein erster
-- Beleg und sein erster Geschäftsbrief trügen eine ERFUNDENE Steuerkennung.
-- Das ist die Fehlerklasse „Erfinden statt Sperren" (memory: DHL erfand
-- Sendenummern) und zugleich ein Verstoss gegen die Mandantenneutralität
-- (KOORDINATION §7): kein Händlerwert, erst recht kein falscher, gehört in
-- die Bausubstanz.
--
-- Die Kasse ist auf LEER gebaut: ohne Kennung SPERRT der Beleg mit ehrlicher
-- Begründung (isReceiptShopValid) statt zu erfinden. Leer ist also der
-- richtige Grundzustand.
--
-- Der WHERE-Vergleich trifft ausschliesslich die wörtliche Saat: eine echte,
-- von Hand gepflegte Kennung (Produktion) wird nie berührt. Auf Ständen, die
-- die Saat schon ersetzt haben, ändert diese Wanderung GAR NICHTS.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE system_settings
   SET value = '""'::jsonb
 WHERE key = 'shop.vat_id'
   AND value = '"DE123456789"'::jsonb;

UPDATE system_settings
   SET value = '""'::jsonb
 WHERE key = 'shop.phone'
   AND value = '"+49 7181 0000000"'::jsonb;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0130: Die Woche darf ersetzt werden
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gemessen am 02.08.2026 gegen eine echte Datenbank, als die Anwendungsrolle:
--
--   DELETE FROM staff_working_hours WHERE user_id = ...
--   → 42501: permission denied for table staff_working_hours
--
-- Rechte der Rolle auf dieser Tabelle bis hierher: INSERT, SELECT. Wanderung
-- 0012 sagt in Zeile 573 ausdrücklich „All new tables: SELECT + INSERT
-- default; UPDATE granted narrowly; NO DELETE", und keine spätere Wanderung
-- hat DELETE nachgereicht.
--
-- ── WARUM DER SCHREIBWEG LÖSCHEN MUSS ──────────────────────────────────────
--
-- `available_slots()` (Wanderung 0012) baut die Kapazität mit einem CROSS JOIN
-- auf dieser Tabelle. Ein CROSS JOIN MULTIPLIZIERT. Wer beim zweiten Speichern
-- Zeilen anhäuft statt sie zu ersetzen, bekommt doppelte Plätze zur selben
-- Stunde, und die Kasse verspricht zwei Kunden denselben Termin. Deshalb
-- ersetzt `PUT /api/arbeitszeiten` die Woche eines Menschen als GANZES.
--
-- ⚠️ Der naheliegende Ausweg, die alten Zeilen nur mit `effective_until`
-- stillzulegen statt sie zu löschen, ist still kaputt: die Bedingung
-- `staff_working_hours_effective_range` verlangt `effective_until >=
-- effective_from`, und `effective_from` steht bei einer heute angelegten Zeile
-- auf HEUTE. Beim zweiten Speichern am selben Tag liesse sich die alte Zeile
-- also frühestens auf heute setzen, und `available_slots()` zählt wegen
-- `effective_until >= d.d` genau diesen Tag noch mit. Ergebnis wären doppelte
-- Plätze, also exakt der Schaden, den das Ersetzen verhindern soll.
--
-- ── WARUM DAS KEINE AUFZEICHNUNG ZERSTÖRT ──────────────────────────────────
--
-- `staff_working_hours` ist Einrichtung, kein Beleg. Sie trägt keine
-- fiskalische oder handelsrechtliche Aufzeichnung: bereits angelegte Termine
-- stehen als eigene Zeilen in `appointments` und bleiben unberührt. Die
-- Hausordnung erteilt DELETE dort, wo Löschen die richtige Handlung ist
-- (`categories` in 0025, `cart_items` in 0018, `appraisal_items` in 0020) und
-- verweigert es dort, wo eine Aufzeichnung entsteht (`ledger_events` in 0008,
-- „NO GRANT UPDATE, NO GRANT DELETE. Ever.").
--
-- Wiederholbar: GRANT ist von sich aus wiederholbar.

GRANT DELETE ON staff_working_hours TO warehouse14_app;

COMMENT ON TABLE staff_working_hours IS
  'Wochenplan je Mitarbeiter. Quelle der Kapazität in available_slots() über '
  'einen CROSS JOIN, der MULTIPLIZIERT: der Schreibweg ersetzt die Woche eines '
  'Menschen als Ganzes (DELETE + INSERT), statt Zeilen anzuhäufen. Deshalb hat '
  'die Anwendungsrolle hier DELETE, siehe Wanderung 0130.';

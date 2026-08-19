-- 0100 — Die Abhol-Spalten aus 0099 dem Anwendungsrollen-Konto freigeben.
--
-- WAS SCHIEFGING
-- 0099 hat die Abholstände auf `carts` gelegt (pickup_stage und die fünf
-- Zeitstempel), aber KEINE Rechte vergeben. Auf `carts` sind die Schreibrechte
-- der Rolle `warehouse14_app` absichtlich SPALTENWEISE vergeben, nicht auf der
-- ganzen Tabelle. Eine neue Spalte ist damit standardmäßig gesperrt.
--
-- Folge auf der Produktion, live gemessen am 23.07.2026:
--   • POST /api/orders/:nr/approve|prepare|ready  → 500, PostgresError 42501
--     „permission denied for table carts"
--   • Die Übergabe in transactions-finalize (webOrderNumber) hätte denselben
--     Fehler geworfen.
--   • SCHWERWIEGEND: storefront-reserve setzt beim Reservieren
--     `pickup_stage = 'OFFEN'`. Dieser Schreibvorgang ist NICHT abgesichert,
--     also konnte der Kundenshop überhaupt keine neue Reservierung mehr
--     annehmen. Das ist die Kernfunktion des Geschäfts.
--
-- DIE REGEL, DIE HIER GALT UND ÜBERSEHEN WURDE
-- Migration 0067 hat für genau eine Spalte (`reserved_at`) genau diese Vergabe
-- geschrieben. Jede neue Spalte auf `carts`, die der Server schreibt, braucht
-- ihre eigene GRANT-Zeile. Ein Test in api-cloud liest ab jetzt die Quelltexte
-- und bricht, wenn eine geschriebene Spalte keine Vergabe hat.
--
-- UMFANG: nur die Spalten, die der Server tatsächlich schreibt.
--   pickup_stage             storefront-reserve, orders, transactions-finalize
--   approved_at              orders /approve
--   approved_by_user_id      orders /approve
--   preparation_started_at   orders /prepare
--   ready_at                 orders /ready
--   collected_at             transactions-finalize (Übergabe)
--   collected_by_user_id     transactions-finalize (Übergabe)
--
-- NICHT vergeben, mit Absicht:
--   anonymized_at, shipping_address_encrypted — beide werden ausschließlich in
--   `erase_customer` geschrieben, und diese Funktion läuft als SECURITY DEFINER
--   mit den Rechten des Eigentümers. Sie braucht die Vergabe nicht, und ohne
--   sie kann kein Anwendungspfad diese Felder von Hand verändern.
--   Die Rolle `warehouse14_worker` bleibt ebenfalls unverändert: sie schreibt
--   auf `carts` nur `status` und `updated_at`, und beides hat sie bereits.

GRANT UPDATE (
  pickup_stage,
  approved_at,
  approved_by_user_id,
  preparation_started_at,
  ready_at,
  collected_at,
  collected_by_user_id
) ON carts TO warehouse14_app;

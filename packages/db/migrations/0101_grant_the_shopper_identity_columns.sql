-- 0101 — Die Kundenidentität dem Anwendungsrollen-Konto freigeben.
--
-- GEFUNDEN AM 23.07.2026 durch den neuen Test
-- `column-grants-cover-writes.test.ts`, unmittelbar nachdem derselbe Fehler auf
-- `carts` die Reservierung lahmgelegt hatte. Auch auf `shoppers` sind die
-- Schreibrechte spaltenweise vergeben, und sieben Spalten, die der Server
-- schreibt, waren nie dabei. Gegenprobe auf der Produktion, mit
-- `SET LOCAL ROLE warehouse14_app` und anschließendem Rollback:
--   schreibbar : google_sub, updated_at
--   gesperrt   : last_seen_at, given_name_encrypted, family_name_encrypted,
--                picture_url_encrypted, email_encrypted, email_blind_index,
--                is_guest
--
-- ZWEI GESCHÄFTSVORGÄNGE STANDEN DAMIT STILL
--
-- 1. Anmeldung mit Google (storefront-auth-google.ts). Nach jeder erfolgreichen
--    Anmeldung gleicht der Server das Profil ab — Vorname, Nachname, Bild,
--    zuletzt gesehen. Der Schreibvorgang liegt IN der Transaktion, die
--    anschließend die Sitzung anlegt, und ist NICHT abgesichert. Postgres warf
--    42501, die Transaktion brach ab, es entstand keine Sitzung: die Anmeldung
--    mit Google konnte gar nicht gelingen.
--
-- 2. Aus einem Gast wird ein Konto (storefront-auth.ts). Die Registrierung
--    schreibt die echte Kennung auf die bestehende Gastzeile
--    (`email_encrypted`, `email_blind_index`, `is_guest = FALSE`) und behält
--    damit den Warenkorb des Gastes. Auch das war gesperrt.
--
-- Beides ist älter als der Abholablauf; es wurde nur nie bemerkt, weil kein
-- Test die Vergaben gegen die Schreibvorgänge hielt. Genau diesen Test gibt es
-- jetzt, und er hat diese Lücke selbst gefunden.
--
-- UMFANG: nur die sieben belegten Spalten. `soft_deleted_at` und
-- `anonymized_at` sind bereits vergeben, alles Übrige bleibt unangetastet.

GRANT UPDATE (
  given_name_encrypted,
  family_name_encrypted,
  picture_url_encrypted,
  last_seen_at,
  email_encrypted,
  email_blind_index,
  is_guest
) ON shoppers TO warehouse14_app;

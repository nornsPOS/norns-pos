-- ═══════════════════════════════════════════════════════════════════════════
--  0151 — Der Notfallschlüssel bekommt seinen Platz (21.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND ─────────────────────────────────────────────────────────────
--
-- Der Weg zurück in eine verschlossene Kasse gab es nur für MITARBEITER:
--
--     POST /api/admin/staff/:id/kassencode-loeschen   →   requireOwner(req)
--
-- Der Inhaber müsste sich anmelden, um sich selbst zurückzusetzen. Vergisst
-- er seinen Kassencode, kommt NIEMAND mehr in die Kasse — auch kein zweiter
-- Verwalter. Der Weg zurück führte über die Datenbank, also über einen
-- Techniker, an einem Samstagvormittag mit Kunden im Laden.
--
-- ── WARUM VIER SPALTEN UND NICHT ZWEI ──────────────────────────────────────
--
-- Der Schlüssel bekommt eine EIGENE Fehlerzählung, getrennt von der des
-- Kassencodes. Das ist keine Doppelung, sondern der Kern der Sache: liefe
-- er auf denselben Zähler, könnte jemand mit zehn falschen Schlüsseln die
-- KASSE sperren — er hätte aus dem Notausgang eine Waffe gemacht. Getrennte
-- Zähler heissen: wer den Schlüssel angreift, sperrt den Schlüssel; der
-- Verkauf am Tresen läuft weiter.
--
-- ⚠️ `gebraucht_am` ist KEIN Schloss, sondern eine Spur. Der Schlüssel gilt
-- einmal; nach Gebrauch gibt die Kasse einen neuen aus, und der neue setzt
-- `hash` und `gesetzt_am` neu. `gebraucht_am` bleibt als Datum des letzten
-- Einlösens stehen — für den Blick der Aufsicht, nicht für die Prüfung.
--
-- ⚠️ MANDANTENNEUTRAL: keine Zeile trägt Daten eines Händlers. Die Spalten
-- kommen leer; wer schon eine Kasse hat, bekommt seinen Schlüssel beim
-- nächsten Öffnen der Kassenverwaltung angeboten, nicht hier zugeteilt.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notfallschluessel_hash          text,
  ADD COLUMN IF NOT EXISTS notfallschluessel_gesetzt_am    timestamptz,
  ADD COLUMN IF NOT EXISTS notfallschluessel_gebraucht_am  timestamptz,
  ADD COLUMN IF NOT EXISTS notfallschluessel_fehlversuche  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notfallschluessel_gesperrt_bis  timestamptz;

-- Ein Abdruck ohne Datum wäre ein Schlüssel, von dem niemand weiss, wann er
-- entstand — im Zweifel bei einer Prüfung genau die Frage, die man nicht
-- beantworten kann.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notfallschluessel_datiert_chk;
ALTER TABLE users
  ADD CONSTRAINT users_notfallschluessel_datiert_chk
  CHECK (notfallschluessel_hash IS NULL OR notfallschluessel_gesetzt_am IS NOT NULL);

-- ── DIE RECHTE, OHNE DIE DIESE SPALTEN TOT WÄREN ───────────────────────────
--
-- ⛔ GEMESSEN am 21.08.2026, an echtem Postgres: ohne diesen Block antwortet
-- der Weg mit „permission denied for table users". Die Kassenrolle hat auf
-- `users` KEIN allgemeines Schreibrecht, sondern nur auf namentlich genannte
-- Spalten (Wanderungen 0004, 0014, 0042). Das ist Absicht — `is_owner` etwa
-- darf sie NIE ändern — und heisst: jede neue Spalte, die die Kasse schreibt,
-- braucht ihre eigene Zeile hier. Meine Proben sind daran zwölfmal rot
-- gelaufen, bevor ich es begriffen hatte.
GRANT UPDATE (
  notfallschluessel_hash,
  notfallschluessel_gesetzt_am,
  notfallschluessel_gebraucht_am,
  notfallschluessel_fehlversuche,
  notfallschluessel_gesperrt_bis
) ON users TO warehouse14_app;

COMMENT ON COLUMN users.notfallschluessel_hash IS
  'argon2id-Abdruck des gültigen Notfallschlüssels. Der Klartext wird NIE gespeichert — er steht genau einmal auf dem Bildschirm.';
COMMENT ON COLUMN users.notfallschluessel_gebraucht_am IS
  'Wann zuletzt ein Schlüssel eingelöst wurde. Spur für die Aufsicht, kein Schloss.';

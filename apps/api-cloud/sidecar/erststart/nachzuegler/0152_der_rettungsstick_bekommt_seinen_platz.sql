-- ═══════════════════════════════════════════════════════════════════════════
--  0152 — Der Rettungsstick bekommt seinen Platz (21.08.2026, Basels Auftrag)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Der Notfallschlüssel (0151) ist ein Zettel. Basel: manche Händler verwahren
-- lieber ein DING — ein gewöhnlicher USB-Stick wird beschrieben und öffnet
-- später den Weg zu einem neuen Kassencode. Auf dem Stick liegt das
-- Geheimnis; hier liegt NUR sein argon2id-Abdruck.
--
-- ⚠️ EIGENE Fehlerzählung, getrennt vom Kassencode UND vom Notfallschlüssel:
-- wer mit einem falschen Stick hantiert, sperrt den Stick-Weg — nicht den
-- Verkauf und nicht den Zettel-Weg. Drei Türen, drei Zähler.
--
-- ⚠️ MANDANTENNEUTRAL: die Spalten kommen leer. Ein Stick wird erst
-- beschrieben, wenn der Inhaber es in der Kassenverwaltung tut.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rettungsstick_hash          text,
  ADD COLUMN IF NOT EXISTS rettungsstick_gesetzt_am    timestamptz,
  ADD COLUMN IF NOT EXISTS rettungsstick_gebraucht_am  timestamptz,
  ADD COLUMN IF NOT EXISTS rettungsstick_fehlversuche  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rettungsstick_gesperrt_bis  timestamptz;

-- Ein Abdruck ohne Datum wäre ein Stick, von dem niemand weiss, wann er
-- entstand — bei einer Prüfung genau die Frage, die man beantworten muss.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rettungsstick_datiert_chk;
ALTER TABLE users
  ADD CONSTRAINT users_rettungsstick_datiert_chk
  CHECK (rettungsstick_hash IS NULL OR rettungsstick_gesetzt_am IS NOT NULL);

-- ── DIE RECHTE, OHNE DIE DIESE SPALTEN TOT WÄREN ───────────────────────────
--
-- ⛔ Die Lehre aus 0151, am echten Postgres gemessen: die Kassenrolle hat auf
-- `users` KEIN allgemeines Schreibrecht, nur namentlich vergebene Spalten.
-- Ohne diesen Block antwortet der Motor mit „permission denied for table
-- users" — als 500, erst an der laufenden Kasse sichtbar.
GRANT UPDATE (
  rettungsstick_hash,
  rettungsstick_gesetzt_am,
  rettungsstick_gebraucht_am,
  rettungsstick_fehlversuche,
  rettungsstick_gesperrt_bis
) ON users TO warehouse14_app;

COMMENT ON COLUMN users.rettungsstick_hash IS
  'argon2id-Abdruck des Stick-Geheimnisses. Der Klartext liegt NUR auf dem Stick des Händlers.';
COMMENT ON COLUMN users.rettungsstick_gebraucht_am IS
  'Wann zuletzt eingelöst. Spur für die Aufsicht, kein Schloss — der Stick lädt sich nach.';

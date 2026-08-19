-- 0107 — Briefe warten ihre Zeit ab und bleiben in EINEM Gespräch.
--
-- Zwei Mängel des Postausgangs, die beide erst im echten Postfach sichtbar
-- werden und die kein Test bisher berühren konnte.
--
-- ── 1. Der Stau am Kopf der Schlange (next_attempt_at) ──────────────────────
--
-- Der Absender holte je Takt die zehn ÄLTESTEN PENDING-Zeilen. Ein
-- vorübergehend gescheiterter Brief bleibt PENDING und behält sein
-- created_at — er wird also in der NÄCHSTEN Minute wieder als einer der
-- ältesten gezogen, und in der übernächsten wieder. Zehn solche Briefe
-- besetzen die ganze Auswahl, und jeder frisch eingereihte Brief dahinter
-- wartet, bis einer der zehn sich löst oder nach zwanzig Versuchen begraben
-- wird. Eine Reservierungsbestätigung hinter zwei alten Ladenhütern hätte
-- zwanzig Minuten gebraucht, ohne dass irgendwo ein Fehler zu sehen gewesen
-- wäre.
--
-- Ausserdem klopfte die Wiederholung im STARREN Minutentakt an. Bei einem
-- Google-Ratenlimit ist genau das die falsche Antwort: das Limit verlängert
-- sich, je öfter man dagegenläuft.
--
-- `next_attempt_at` behebt beides. Der Absender nimmt nur noch, was FÄLLIG
-- ist, und setzt nach einem Fehlversuch eine wachsende Pause. Vorgabe `now()`,
-- damit jede bestehende Zeile ab sofort fällig ist und der Rückstand in
-- derselben Minute weiterläuft wie vorher.
--
-- ── 2. Fünf Briefe, fünf Gespräche (thread_key) ─────────────────────────────
--
-- Zu EINER Bestellung schreibt das Haus bis zu fünf Mal: bestätigt,
-- angenommen, abholbereit, Frist läuft, abgesagt. Im Postfach des Kunden
-- landeten das fünf getrennte Gespräche, weil jeder Brief eine zufällige
-- Message-ID trug und keinen Bezug. Wer nachsehen will, was eigentlich
-- vereinbart war, sucht sich die Teile einzeln zusammen.
--
-- `thread_key` ist die Bestellnummer (oder die Ticketnummer). Der Absender
-- baut daraus einen festen Wurzel-Bezug (`References`), sodass jeder Klient
-- die Briefe EINER Bestellung untereinander hängt — dasselbe Verfahren, mit
-- dem GitHub alle Meldungen zu einem Vorgang zusammenhält.
--
-- GRANT-PRÜFUNG (die Spaltenfalle): auf email_outbox stehen INSERT/UPDATE für
-- warehouse14_worker und INSERT für warehouse14_app als TABELLEN-Rechte, nicht
-- spaltenweise. Neue Spalten sind damit automatisch mitgedeckt; hier ist kein
-- zusätzliches GRANT nötig. Geprüft an der Produktion am 25.07.2026.

ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS thread_key text;

-- Ein Bezug, der als Message-ID taugen muss: keine spitzen Klammern, kein
-- Leerraum, keine Länge, die einen Kopf sprengt.
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_thread_key_sane;
ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_thread_key_sane
  CHECK (thread_key IS NULL OR thread_key ~ '^[A-Za-z0-9._-]{1,120}$');

-- Der Absender fragt jetzt „was ist FÄLLIG", nicht „was ist ALT". Der alte
-- Index auf created_at beantwortet diese Frage nicht mehr.
DROP INDEX IF EXISTS email_outbox_pending_idx;
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox (next_attempt_at)
  WHERE status = 'PENDING';

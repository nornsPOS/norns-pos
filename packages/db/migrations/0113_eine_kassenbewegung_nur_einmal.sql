-- Eine Kassenbewegung darf nur EINMAL im Kassenbuch stehen.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  DER ABLAUF, DER EINE DIFFERENZ ERZEUGT, DIE NIEMAND VERURSACHT HAT
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. Die Kassiererin trägt eine Einlage ein. Das Netz ist weg.
--   2. Die Zwischenschicht reiht den Vorgang SICHER in den Ausgangskorb ein
--      und wirft `ApiOfflineQueuedError`. Das ist ein Erfolg.
--   3. Die Maske behandelt ihn als Fehler und schreibt „Verbindung gestört.
--      Netzwerk prüfen." Die Kassiererin liest das und drückt folgerichtig
--      noch einmal.
--   4. Weil diese Maske keinen eigenen Idempotenzschlüssel mitgibt, erzeugt
--      die Zwischenschicht bei JEDEM Druck einen neuen.
--   5. Beim Nachspielen laufen alle Zeilen mit 200 durch.
--
-- Ergebnis: die Einlage steht mehrfach im Kassenbuch, und der Blindsturz weist
-- eine Differenz aus, die niemand verursacht hat. Für die Kassiererin sieht es
-- aus, als fehle Geld.
--
-- Und `cash_movements` ist bewusst fortschreibend: eine Phantomzeile lässt
-- sich weder löschen noch berichtigen, nur gegenbuchen. Der Fehler bleibt also
-- für immer im Buch stehen, samt Gegenbuchung, und muss jedem Prüfer erklärt
-- werden.
--
-- Reicht auch nur die ANTWORT verloren zu gehen, genügt ein einziger Druck für
-- die Doppelbuchung.
--
-- ── Warum die Wand hier unten steht und nicht nur in der Anwendung ────────
--
-- Auf drei Ebenen fehlte jeder Schutz: kein eindeutiger Index, kein Handler
-- las einen Idempotenzschlüssel, keine Prüfung in der Maske. Alle drei werden
-- geschlossen, aber DIESE Ebene ist die einzige, die auch dann trägt, wenn
-- jemand später eine zweite Oberfläche baut und den Schlüssel vergisst.
--
-- Die Spalte `external_ref` gibt es bereits und ist ungenutzt (auf der
-- Produktion: 0 von 0 Bewegungen). Sie ist der richtige Träger; eine neue
-- Spalte wäre die schlechtere Wahl, weil spaltenweise vergebene Rechte sie
-- nicht kennen würden.

BEGIN;

COMMENT ON COLUMN cash_movements.external_ref IS
  'Der Idempotenzschluessel des Aufrufers. Ein zweiter Aufruf mit demselben Wert erzeugt KEINE zweite Zeile, sondern liefert die bestehende zurueck. NULL ist erlaubt (Altbestand und Wege ohne Schluessel).';

-- Der Index ist TEILWEISE: NULL bleibt erlaubt, damit Zeilen ohne Schlüssel
-- weiterhin entstehen können. Ohne `WHERE ... IS NOT NULL` wäre auch nur EINE
-- Zeile ohne Schlüssel möglich, denn dieser Index gilt mit
-- `NULLS NOT DISTINCT` nicht, aber die Absicht wäre unklar. So steht sie da.
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_external_ref_uq
  ON cash_movements (external_ref)
  WHERE external_ref IS NOT NULL;

COMMIT;

-- ── Zur Prüfung nach dem Einspielen, ohne Nebenwirkung ────────────────────
--
--   SELECT indexdef FROM pg_indexes
--    WHERE tablename = 'cash_movements' AND indexname = 'cash_movements_external_ref_uq';
--
-- Und der Wirksamkeitsbeweis gehört in eine Wegwerf-Datenbank, nicht hierher:
-- zweimal dieselbe `external_ref` einfuegen muss beim zweiten Mal scheitern.

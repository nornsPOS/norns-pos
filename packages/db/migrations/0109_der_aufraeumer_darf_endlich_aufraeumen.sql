-- 0109 — Der Aufräumer darf endlich aufräumen.
--
-- ── Ein Job, der seit zehn Nächten scheitert, und niemand hat es gemerkt ───
--
-- `worker_job_runs` ist das Betriebsprotokoll des Arbeiters, rund 8.600 Zeilen
-- am Tag. Es trägt KEINE steuerliche Aufbewahrungspflicht, es ist Telemetrie
-- und kein Beleg. Für genau diesen Zweck gibt es seit längerem den Job
-- `worker_job_runs_retention`: Erfolge 30 Tage, Fehlschläge 180 Tage.
--
-- Der Job existiert, ist registriert, ist nächtlich um 03:30 geplant, und
-- er LÄUFT auch. Er scheitert nur jedes Mal. An der Produktion gemessen am
-- 26.07.2026, in seinem eigenen Protokoll nachgelesen:
--
--   2026-07-25 03:30  FAILED  update or delete on table "worker_job_runs"
--                             violates foreign key constraint
--   2026-07-24 03:30  FAILED  (dieselbe Meldung)
--   ... zehn Läufe, zehn Fehlschläge, keiner gemeldet.
--
-- Folge: 447.573 Zeilen, 216 von 257 MB der ganzen Datenbank, also 84 Prozent.
-- Die älteste Zeile stammt vom 3. Juni, obwohl 30 Tage gelten sollten.
--
-- ── Warum er scheitert ────────────────────────────────────────────────────
--
-- Zwei Fremdschlüssel zeigen auf `worker_job_runs`, beide mit NO ACTION,
-- beide blockieren also jedes Löschen:
--
--   1. `worker_job_dlq.last_run_id`          — 419 alte Läufe betroffen
--   2. `metal_prices.fetched_by_job_run_id`  — 29.537 Preiszeilen
--
-- Der zweite ist der eigentliche Grund, warum "die blockierten einfach
-- auslassen" keine Lösung wäre: die Metallpreise sind Geschäftsdaten und
-- bleiben. Jeder neue Preis erzeugt einen neuen geschützten Lauf. Der
-- geschützte Rest würde also täglich WACHSEN, und das Protokoll bliebe für
-- immer unaufräumbar, nur langsamer.
--
-- ── Die Lösung, und warum sie nichts wegwirft, was zählt ──────────────────
--
-- Beide Zeiger werden auf ON DELETE SET NULL gestellt. Was dabei erhalten
-- bleibt, ist alles Fachliche:
--
--   • Die Fehlerzeile im Totbriefkasten behält Jobname, Fehlertext, Nutzlast
--     und Zeitpunkt. Nur der Verweis auf den Protokolleintrag wird leer.
--   • Der Metallpreis behält Metall, Kurs, Zeitpunkt und Quelle. Nur die
--     Angabe, WELCHER Lauf ihn geholt hat, wird leer, und zwar erst, wenn
--     dieser Lauf ohnehin älter als 30 Tage und gelöscht ist.
--
-- Beide Spalten erlauben bereits NULL, geprüft. Es ist also keine
-- Lockerung einer Zusicherung, sondern nur eine Aufräumregel.
--
-- Die Alternative CASCADE wäre falsch und gefährlich: sie würde beim Löschen
-- eines Protokolleintrags den METALLPREIS mitlöschen. Ein Aufräumjob, der
-- Geschäftsdaten mitnimmt, ist schlimmer als gar keiner.

BEGIN;

-- ── 1. Der Totbriefkasten ──────────────────────────────────────────────────
ALTER TABLE worker_job_dlq
  DROP CONSTRAINT IF EXISTS worker_job_dlq_last_run_id_fkey;
ALTER TABLE worker_job_dlq
  ADD CONSTRAINT worker_job_dlq_last_run_id_fkey
  FOREIGN KEY (last_run_id) REFERENCES worker_job_runs(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN worker_job_dlq.last_run_id IS
  'Verweis auf den Protokolleintrag des letzten Versuchs. Wird leer, sobald das Protokoll turnusmässig aufgeräumt wird; Jobname, Fehlertext und Nutzlast bleiben in dieser Zeile erhalten.';

-- ── 2. Die Metallpreise ────────────────────────────────────────────────────
ALTER TABLE metal_prices
  DROP CONSTRAINT IF EXISTS metal_prices_fetched_by_job_run_id_fkey;
ALTER TABLE metal_prices
  ADD CONSTRAINT metal_prices_fetched_by_job_run_id_fkey
  FOREIGN KEY (fetched_by_job_run_id) REFERENCES worker_job_runs(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN metal_prices.fetched_by_job_run_id IS
  'Herkunftsangabe: welcher Abruf diesen Kurs geholt hat. Wird leer, sobald das Betriebsprotokoll turnusmässig aufgeräumt wird. Der Kurs selbst bleibt unberührt.';

-- ── 3. DER ZWEITE FEHLER, DER UNTER DEM ERSTEN LAG ─────────────────────────
--
-- Der blockierende Fremdschlüssel war nur die halbe Wahrheit. Beide
-- verweisenden Spalten hatten KEINEN INDEX, gemessen am 26.07.2026.
--
-- Postgres legt für einen Fremdschlüssel automatisch einen Index auf der
-- ELTERNSEITE an (dort steht ohnehin der Primärschlüssel), aber NIE auf der
-- KINDSEITE. Ohne diesen Index muss die Datenbank bei jedem gelöschten
-- Elternsatz die ganze Kindtabelle durchsuchen, um Verweise zu finden.
--
-- Was das hier bedeutet: 180.000 zu löschende Protokollzeilen mal 29.537
-- Preiszeilen sind über fünf Milliarden Vergleiche. Ein Probelauf gegen eine
-- Kopie des echten Bestands lief nach zehn Minuten noch. Der Job hat aber
-- `timeoutMs: 120_000`, also zwei Minuten.
--
-- Ohne diese beiden Zeilen hätte die Wanderung also die Sperre gelöst und der
-- Job wäre trotzdem gescheitert, nur mit einer anderen Fehlermeldung. Genau
-- so entstehen Reparaturen, die nichts reparieren.
CREATE INDEX IF NOT EXISTS metal_prices_fetched_by_job_run_id_idx
  ON metal_prices (fetched_by_job_run_id)
  WHERE fetched_by_job_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS worker_job_dlq_last_run_id_idx
  ON worker_job_dlq (last_run_id)
  WHERE last_run_id IS NOT NULL;

-- Teilindizes (`WHERE ... IS NOT NULL`), weil nach dem ersten Aufräumen die
-- Mehrzahl dieser Spalten leer ist. Ein Index über lauter NULL-Werte kostet
-- Platz und Schreibaufwand, ohne je etwas zu finden.

-- Und der Index, den der Aufräumer selbst braucht: er sucht nach Status und
-- Startzeit. Ohne ihn liest er die ganze Tabelle, um zu entscheiden, WAS
-- gelöscht werden soll, bevor er überhaupt löscht.
CREATE INDEX IF NOT EXISTS worker_job_runs_retention_idx
  ON worker_job_runs (status, started_at);

COMMIT;

-- ── Rechte ─────────────────────────────────────────────────────────────────
--
-- DIE SPALTENFALLE, wie in 0108 gemessen statt vermutet: SET NULL bedeutet,
-- dass die DATENBANK selbst diese Spalten schreibt, wenn ein Elternsatz
-- verschwindet. Das ist eine Wirkung des Fremdschlüssels und braucht KEIN
-- UPDATE-Recht für die löschende Rolle. Nachgesehen wurde trotzdem:
--
--   SELECT privilege_type, column_name FROM information_schema.column_privileges
--    WHERE table_name IN ('worker_job_dlq','metal_prices') AND grantee='warehouse14_worker';
--
-- Kein zusätzliches GRANT nötig. `warehouse14_worker` hat DELETE auf
-- `worker_job_runs` bereits aus Wanderung 0081, geprüft mit
-- has_table_privilege: true.

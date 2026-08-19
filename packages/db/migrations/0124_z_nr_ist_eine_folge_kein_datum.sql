-- ───────────────────────────────────────────────────────────────────────────
-- 0124 — Z_NR ist eine FOLGE, kein Datum (27.07.2026)
--
-- `dsfinvk-export.ts` trug wörtlich:
--
--     function zNr(businessDay: string): string {
--       return businessDay; // surrogate; one closing per business day.
--     }
--
-- Der Kommentar nennt es ehrlich einen Platzhalter. Nur ist Z_NR in der
-- DSFinV-K kein freies Feld: es ist die FORTLAUFENDE Nummer des
-- Kassenabschlusses je Kasse, und jede andere Datei des Pakets zeigt darauf.
-- Eine Zeichenkette „2026-06-08" ist keine Folge. Ein Prüfer kann daran weder
-- ablesen, ob ein Abschluss FEHLT, noch in welcher Reihenfolge sie stehen.
--
-- Genau das ist der Zweck der Nummer: eine Lücke zwischen 41 und 43 ist ein
-- fehlender Abschluss und muss auffallen. Bei Datumsschlüsseln fällt gar
-- nichts auf — ein nie abgeschlossener Tag hinterlässt einfach keine Zeile.
--
-- ── Gemessen, bevor diese Wanderung geschrieben wurde ────────────────────
--
--     daily_closings          1 Zeile, Zustand COUNTING
--     davon festgeschrieben   0
--     Verkaufstage ohne festgeschriebenen Abschluss   10
--
-- Es ist also NICHTS nachzunummerieren. Die Folge beginnt bei 1, und der
-- erste je festgeschriebene Abschluss bekommt sie. Ein Nachtragen alter
-- Nummern wäre auch gar nicht zulässig gewesen.
--
-- ── Warum keine SEQUENCE ─────────────────────────────────────────────────
--
-- Eine Postgres-Sequenz reisst Lücken: sie zieht auch dann hoch, wenn die
-- Transaktion zurückgerollt wird. Für eine Zählnummer ist das richtig, für
-- eine FISKALISCHE Folge ist es falsch — die Lücke wäre nicht mehr von einem
-- fehlenden Abschluss zu unterscheiden, und dann trägt die Nummer keine
-- Aussage mehr. Die Nummer wird deshalb in derselben Transaktion aus
-- `max(z_nr)+1` gebildet, und der eindeutige Index unten ist der Riegel, der
-- ein Doppelvergeben scheitern lässt, statt es zuzulassen.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS z_nr BIGINT;

COMMENT ON COLUMN daily_closings.z_nr IS
  'DSFinV-K Z_NR: fortlaufende Nummer des Kassenabschlusses je Kasse, ab 1. '
  'NULL solange der Abschluss nicht festgeschrieben ist. Wird in derselben '
  'Transaktion wie finalized_at aus max(z_nr)+1 gebildet, nie aus einer '
  'SEQUENCE — die risse bei einem Rollback eine Lücke, und eine Lücke muss '
  'einen FEHLENDEN Abschluss bedeuten.';

-- Der Riegel: dieselbe Nummer nie zweimal je Kasse.
--
-- Zwei Indizes, weil `shop_id` in V1 NULL ist und NULL in einem gewöhnlichen
-- UNIQUE nicht mit sich selbst kollidiert — dieselbe Bauart, die schon bei
-- `business_day` gewählt wurde (0079).
CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_z_nr_shop_uq
  ON daily_closings (shop_id, z_nr)
  WHERE shop_id IS NOT NULL AND z_nr IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_z_nr_null_shop_uq
  ON daily_closings (z_nr)
  WHERE shop_id IS NULL AND z_nr IS NOT NULL;

-- Ein festgeschriebener Abschluss OHNE Nummer wäre ein Paket ohne gültigen
-- Schlüssel. Als NOT VALID angelegt: bestehende Zeilen (es gibt keine
-- festgeschriebene) werden nicht geprüft, jede neue schon.
ALTER TABLE daily_closings
  DROP CONSTRAINT IF EXISTS daily_closings_festgeschrieben_hat_z_nr;

ALTER TABLE daily_closings
  ADD CONSTRAINT daily_closings_festgeschrieben_hat_z_nr
  CHECK (finalized_at IS NULL OR z_nr IS NOT NULL) NOT VALID;

-- ── Die Spaltenrechte-Falle, zum dritten Mal in diesem Haus ──────────────
--
-- UPDATE ist hier je SPALTE vergeben. Eine neue Spalte ist damit per Vorgabe
-- GESPERRT, und der Abschluss schlüge live fehl, während lokal alles grün
-- ist. Deshalb wird das Recht hier ausdrücklich mitgegeben — und unten
-- nachgemessen, statt es zu glauben.
DO $$
DECLARE
  r TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.column_privileges
     WHERE table_name = 'daily_closings' AND privilege_type = 'UPDATE'
       AND grantee NOT IN ('PUBLIC')
  LOOP
    EXECUTE format('GRANT INSERT (z_nr), UPDATE (z_nr) ON daily_closings TO %I', r);
  END LOOP;
END $$;

-- ── Die Selbstprüfung ────────────────────────────────────────────────────
--
-- Eine Wanderung, die still das Falsche tut, ist schlimmer als eine, die
-- abbricht. Diese hier misst nach, was sie behauptet.
DO $$
DECLARE
  fehlt INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'daily_closings' AND column_name = 'z_nr'
  ) THEN
    RAISE EXCEPTION '0124: die Spalte z_nr wurde nicht angelegt';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'daily_closings' AND indexname = 'daily_closings_z_nr_null_shop_uq'
  ) THEN
    RAISE EXCEPTION '0124: der eindeutige Index auf z_nr fehlt';
  END IF;

  -- Und das Schreibrecht, das die Falle schon dreimal live gesperrt hat.
  SELECT count(*) INTO fehlt
    FROM (
      SELECT DISTINCT grantee FROM information_schema.column_privileges
       WHERE table_name = 'daily_closings' AND privilege_type = 'UPDATE'
         AND grantee NOT IN ('PUBLIC')
    ) g
   WHERE NOT has_column_privilege(g.grantee, 'daily_closings', 'z_nr', 'INSERT');

  IF fehlt > 0 THEN
    RAISE EXCEPTION '0124: % Rolle(n) dürfen z_nr nicht schreiben — der Abschluss '
      'schlüge live fehl, während lokal alles grün ist', fehlt;
  END IF;
END $$;

COMMIT;

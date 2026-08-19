-- ───────────────────────────────────────────────────────────────────────────
-- 0125 — ein Tag INNERHALB einer langen Schicht ist abschliessbar (28.07.2026)
--
-- `closings-finalize.ts:304` zählte den Kassensturz so:
--
--     FROM shifts
--    WHERE status = 'CLOSED' AND berlin_business_day(closed_at) = <Tag>
--
-- Also: „gab es an DIESEM Tag einen Schichtschluss?" Und wenn nicht, sperrte
-- der Riegel darunter den ganzen Tag:
--
--     if (txTotal > 0 && closedShifts === 0) throw ClosingConflictError
--
-- Eine Schicht, die über mehrere Tage läuft, wird damit AUSSCHLIESSLICH ihrem
-- Schliesstag gutgeschrieben. Jeder Tag dazwischen hat Belege, aber keinen
-- Kassensturz — und ist dauerhaft unabschliessbar. Es gibt keinen Rettungsweg:
-- `POST /api/shifts/:id/close` nimmt nur `blindCountEur` und `notes`, der
-- Schliesszeitpunkt ist Serverzeit und nicht rückdatierbar.
--
-- ── Auf Romans Produktion gemessen (28.07.2026) ──────────────────────────
--
--     Schicht 21779cb1  04.06. bis 16.06.   12 Tage
--     Schicht 5126deae  16.06. bis 19.07.   33 Tage
--
--     Tag          Belege   Betrag        Wächter    Ergebnis
--     2026-06-08     33     12.523,32        0       GESPERRT
--     2026-06-09      2         98,26        0       GESPERRT
--     2026-06-10      4      1.524,75        0       GESPERRT
--     2026-06-12      2        456,20        0       GESPERRT
--     2026-06-13      1      1.212,00        0       GESPERRT
--     2026-06-15      6          9,85        0       GESPERRT
--     2026-06-16      3         21,24        1       geht
--     2026-07-24      4        449,99        1       geht
--     2026-07-25      9     34.508,16        0       GESPERRT
--     2026-07-26      1         10,00        0       GESPERRT
--
-- **8 von 10 Tagen, 58 von 65 Belegen, 50.342,54 von 50.813,77 EUR.**
--
-- ── Was hier NICHT gemacht wird ──────────────────────────────────────────
--
-- Der bequeme Weg wäre, den Riegel zu lockern und für die Zwischentage den
-- Kassenbestand der ganzen Schicht einzutragen, oder den erwarteten Betrag als
-- gezählten auszugeben. Beides wäre ein ERFUNDENER Kassensturz in einer
-- fortschreibungsgeschützten Aufzeichnung — genau die Fehlerklasse, gegen die
-- dieses Haus sonst überall Riegel baut.
--
-- An einem Zwischentag wurde die Kasse NICHT gezählt. Das ist eine Tatsache,
-- und sie gehört so aufgezeichnet: `cash_drawer_counted_eur` bleibt NULL, und
-- die Zeile sagt AUSDRÜCKLICH, warum und welche Schicht den Sturz trägt.
--
-- Ein Prüfer sieht dann: der Tag ist vollständig aufgezeichnet (§ 146 Abs. 1
-- Satz 2 AO: Einnahmen täglich festgehalten), die Kassensturzfähigkeit hing
-- aber an der Schicht, nicht am Kalendertag. Das ist prüfbar und erklärbar.
-- Eine erfundene Zahl wäre es nicht.
--
-- ⚠️ Die eigentliche Abhilfe ist organisatorisch: die Kasse gehört TÄGLICH
-- gezählt. Diese Wanderung macht die Aufzeichnung ehrlich; sie macht eine
-- 33-Tage-Schicht nicht richtig.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Woher der Kassensturz dieses Tages stammt ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kassensturz_quelle') THEN
    CREATE TYPE kassensturz_quelle AS ENUM (
      -- An diesem Tag wurde eine Schicht geschlossen und die Kasse gezählt.
      'EIGENER_STURZ',
      -- Der Tag liegt INNERHALB einer Schicht, die an einem anderen Tag
      -- geschlossen und gezählt wurde. Kein eigener Sturz.
      'SCHICHT_SPANNT_TAGE',
      -- Umsatzloser Tag: nichts zu zählen.
      'KEIN_UMSATZ'
    );
  END IF;
END $$;

ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS kassensturz_quelle kassensturz_quelle,
  ADD COLUMN IF NOT EXISTS kassensturz_schicht_id UUID;

COMMENT ON COLUMN daily_closings.kassensturz_quelle IS
  'Woher der Kassenbestand dieses Tages stammt. SCHICHT_SPANNT_TAGE heisst: an '
  'diesem Tag wurde NICHT gezählt, der Sturz gehört zur Schicht in '
  'kassensturz_schicht_id. cash_drawer_counted_eur ist dann NULL — eine Zahl '
  'stünde dort erfunden.';

COMMENT ON COLUMN daily_closings.kassensturz_schicht_id IS
  'Die Schicht, deren Kassensturz diesen Tag abdeckt. Pflicht bei '
  'SCHICHT_SPANNT_TAGE, damit ein Prüfer den Sturz FINDET.';

-- ── Der alte Nachweis-Riegel wird ERSETZT, nicht gelockert ───────────────
--
-- Er verlangte `cash_drawer_counted_eur IS NOT NULL` bedingungslos. Alles
-- andere daran bleibt Wort für Wort stehen; nur der Kassenbestand bekommt
-- seine Fallunterscheidung.
ALTER TABLE daily_closings
  DROP CONSTRAINT IF EXISTS daily_closings_finalized_has_evidence;

ALTER TABLE daily_closings
  ADD CONSTRAINT daily_closings_finalized_has_evidence
  CHECK (
    state <> 'FINALIZED'::closing_state
    OR (
      finalized_by_user_id IS NOT NULL
      AND finalized_at IS NOT NULL
      AND counted_by_user_id IS NOT NULL
      AND counted_at IS NOT NULL
      AND cash_drawer_expected_eur IS NOT NULL
      AND ledger_anchor_id IS NOT NULL
      AND ledger_anchor_hash IS NOT NULL
      AND octet_length(ledger_anchor_hash) = 32
      -- Die Herkunft des Kassenbestands ist ab jetzt Pflichtangabe.
      AND kassensturz_quelle IS NOT NULL
    )
  );

-- ── Und der neue Riegel: eine fehlende Zahl braucht einen GRUND ──────────
ALTER TABLE daily_closings
  DROP CONSTRAINT IF EXISTS daily_closings_kassensturz_ist_belegt;

ALTER TABLE daily_closings
  ADD CONSTRAINT daily_closings_kassensturz_ist_belegt
  CHECK (
    kassensturz_quelle IS NULL
    OR (
      -- Eigener Sturz: die Zahlen MÜSSEN da sein.
      (kassensturz_quelle = 'EIGENER_STURZ'
        AND cash_drawer_counted_eur IS NOT NULL
        AND cash_drawer_variance_eur IS NOT NULL)
      -- Übergreifende Schicht: KEINE Zahl, dafür die Schicht, die sie trägt.
      OR (kassensturz_quelle = 'SCHICHT_SPANNT_TAGE'
        AND cash_drawer_counted_eur IS NULL
        AND cash_drawer_variance_eur IS NULL
        AND kassensturz_schicht_id IS NOT NULL)
      -- Umsatzloser Tag: nichts zu zählen, nichts zu belegen.
      OR (kassensturz_quelle = 'KEIN_UMSATZ'
        AND kassensturz_schicht_id IS NULL)
    )
  );

-- ── Die Spaltenrechte-Falle, zum vierten Mal ─────────────────────────────
DO $$
DECLARE r TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.column_privileges
     WHERE table_name = 'daily_closings' AND privilege_type = 'UPDATE'
       AND grantee NOT IN ('PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT INSERT (kassensturz_quelle, kassensturz_schicht_id), '
      'UPDATE (kassensturz_quelle, kassensturz_schicht_id) ON daily_closings TO %I', r);
  END LOOP;
END $$;

-- ── Die Selbstprüfung ────────────────────────────────────────────────────
DO $$
DECLARE fehlt INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='daily_closings' AND column_name='kassensturz_quelle') THEN
    RAISE EXCEPTION '0125: kassensturz_quelle fehlt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='daily_closings_kassensturz_ist_belegt') THEN
    RAISE EXCEPTION '0125: der Beleg-Riegel fehlt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='daily_closings_finalized_has_evidence') THEN
    RAISE EXCEPTION '0125: der Nachweis-Riegel wurde geloescht statt ersetzt';
  END IF;

  SELECT count(*) INTO fehlt
    FROM (SELECT DISTINCT grantee FROM information_schema.column_privileges
           WHERE table_name='daily_closings' AND privilege_type='UPDATE'
             AND grantee NOT IN ('PUBLIC')) g
   WHERE NOT has_column_privilege(g.grantee,'daily_closings','kassensturz_quelle','INSERT');
  IF fehlt > 0 THEN
    RAISE EXCEPTION '0125: % Rolle(n) duerfen kassensturz_quelle nicht schreiben', fehlt;
  END IF;
END $$;

COMMIT;

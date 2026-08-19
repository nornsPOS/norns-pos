-- ═══════════════════════════════════════════════════════════════════════════
-- 0128: Das Siegel hält auch künftige Spalten
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEFUND (Audit 30.07.2026, empirisch bestätigt: volle Migrationskette in
-- einem Wegwerf-Postgres, UPDATE als warehouse14_app gegen eine FINALIZED-
-- Zeile): Der Wächter aus 0011 zählt die gesperrten Spalten AUF. Jede
-- Spalte, die JÜNGER ist als 0011, fehlt in der Liste — z_nr,
-- umsatz_by_treatment, storno_verkauf_eur, storno_ankauf_eur,
-- kassensturz_quelle, kassensturz_schicht_id waren auf einem
-- festgeschriebenen Z-Bon per UPDATE veränderbar. Die Kontrolle zuerst:
-- gross_verkauf_eur wurde korrekt abgewiesen; die sechs Nachzügler gingen
-- durch.
--
-- Das ist dieselbe Fehlerklasse wie die spaltenweisen GRANTs: eine
-- AUFZÄHLUNG altert in dem Moment, in dem jemand eine Spalte ergänzt und
-- die Liste nicht kennt. Deshalb kehrt dieser Wächter die Logik um: statt
-- der gesperrten Spalten werden die ERLAUBTEN benannt (notes, updated_at),
-- alles andere ist versiegelt — auch jede Spalte, die es heute noch nicht
-- gibt.
--
-- Wiederholbar: CREATE OR REPLACE plus DROP/CREATE TRIGGER.

CREATE OR REPLACE FUNCTION daily_closings_validate_state() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Once FINALIZED → the row is sealed. Only `notes` (and `updated_at` via
  -- trigger) may change. Allowlist, not blocklist: columns added by future
  -- migrations are sealed by default instead of silently escaping.
  IF OLD.state = 'FINALIZED' THEN
    IF NEW.state <> 'FINALIZED' THEN
      RAISE EXCEPTION 'Cannot transition out of FINALIZED closing (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF (to_jsonb(NEW) - 'notes' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'notes' - 'updated_at')
    THEN
      RAISE EXCEPTION 'Cannot modify FINALIZED closing (row %) — only notes is mutable after finalization', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Valid state transitions: COUNTING → FINALIZED only.
  IF NEW.state <> OLD.state THEN
    IF NOT (OLD.state = 'COUNTING' AND NEW.state = 'FINALIZED') THEN
      RAISE EXCEPTION 'Invalid closing state transition: % → % (row %)', OLD.state, NEW.state, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_closings_validate_state ON daily_closings;
CREATE TRIGGER trg_daily_closings_validate_state
  BEFORE UPDATE ON daily_closings
  FOR EACH ROW EXECUTE FUNCTION daily_closings_validate_state();

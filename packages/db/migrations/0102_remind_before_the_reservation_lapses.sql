-- 0102 — Die Erinnerung vor Fristablauf, und das Recht sie zu vermerken.
--
-- WAS FEHLTE
-- Eine Web-Reservierung hält die Ware drei Tage. Läuft die Frist ab, gibt der
-- Kehrer das Stück frei und der Beleg wird ABANDONED. Bis heute geschah das
-- OHNE EIN WORT an die Kundschaft: der Mensch glaubte, er habe noch Zeit, und
-- fand sein Stück beim nächsten Besuch im Regal. Bis Migration 0100 zählte die
-- Vertrauensstufe genau das als Nichtabholung und sperrte ihn dafür.
--
-- Der Brief war lange nicht baubar: der Verfasser lag in api-cloud, der
-- Versender im worker, und der worker kann api-cloud nicht einbinden. Gelöst
-- durch das gemeinsame Paket `@warehouse14/email`, aus dem jetzt beide Seiten
-- denselben Brief schreiben. Diese Migration liefert den Datenbank-Teil.
--
-- `expiry_reminder_sent_at` ist der Merker, der aus einem Brief keine tägliche
-- Belästigung macht: geschrieben heisst geschrieben, ein zweites Mal nie.

ALTER TABLE carts
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at timestamptz;

COMMENT ON COLUMN carts.expiry_reminder_sent_at IS
  'Wann die Erinnerung vor Fristablauf hinausging. NULL heisst: noch nicht erinnert. Verhindert einen zweiten Brief.';

-- Der Teilindex trägt genau die Abfrage des Kehrers: laufende Abholungen, die
-- noch keine Erinnerung haben. Er bleibt winzig, weil er alles Erledigte
-- ausschliesst.
CREATE INDEX IF NOT EXISTS carts_pending_expiry_reminder_idx
  ON carts (reserved_at)
  WHERE status = 'RESERVED'
    AND fulfilment_method = 'PICKUP'
    AND expiry_reminder_sent_at IS NULL;

-- DIE VERGABE, DIE AM 23.07.2026 ZWEIMAL VERGESSEN WURDE.
--
-- Auf `carts` sind die Schreibrechte SPALTENWEISE vergeben. Eine neue Spalte
-- ist ohne diese Zeile still gesperrt, und der Kehrer würde bei jedem Lauf mit
-- 42501 abbrechen, ohne dass ein Test es je bemerkt. Der worker schreibt nur
-- diesen einen Merker; alles Übrige bleibt ihm verwehrt.
GRANT UPDATE (expiry_reminder_sent_at) ON carts TO warehouse14_worker;

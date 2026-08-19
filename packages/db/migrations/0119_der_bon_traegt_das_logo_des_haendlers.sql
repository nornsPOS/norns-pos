-- ═══════════════════════════════════════════════════════════════════════════
--  0119 — DER BON TRAEGT DAS LOGO DES HAENDLERS, NICHT UNSERES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND (26.07.2026, Basels Dekret zum letzten Schreibtisch-Update) ─
--
-- Der Thermobeleg traegt heute ein EINGEBRANNTES Warehouse-14-Logo: eine
-- eingecheckte 384-Punkt-Rasterdatei, bedingungslos in jeden Bytestrom
-- eingefuegt (apps/tauri-pos/src-tauri, thermal.rs:364). Das ist Mandanten-
-- daten in der Bausubstanz — derselbe Fehler wie die Beraternummer in 0115,
-- nur als Bild. Der zweite Haendler wuerde mit dem Logo des ersten drucken.
--
-- Ab jetzt: der Haendler laedt sein eigenes Logo in den Beleg-Einstellungen
-- hoch, und es liegt HIER, als Mandantendatum in seiner eigenen Datenbank.
--
-- ── WARUM EINE EIGENE TABELLE UND NICHT system_settings ────────────────────
--
-- `system_settings` ist ein kuratiertes jsonb-TEXT-Muster: der Schreibweg
-- (PATCH /api/settings/:key) deckelt jeden Wert auf 200 Zeichen und jede
-- Erlaubnisliste beschreibt Textfelder. Ein 256-KB-Binaerbild passt dort
-- weder ins Schema noch in die Grenzen. Das Foto-Lager (PHOTOS_DIR) schiede
-- ebenfalls aus: das Logo muss die taegliche Datenbanksicherung MITFAHREN
-- (die Rueckspielung ist bewiesen, die Platte des API-Servers ist es nicht).
-- Also: eine einzeilige Tabelle, die Bytes in der Datenbank, kein
-- Platte-DB-Drift moeglich. Ein Mandant hat genau eine Datenbank, darum
-- genuegt genau EINE Zeile — erzwungen durch den Primaerschluessel id = 1.
--
-- ── WAS GESPEICHERT WIRD ──────────────────────────────────────────────────
--
-- Das BEREINIGTE Original (SVG nach der Schadcode-Waesche des Servers, PNG/
-- JPEG nach Format- und Kantenpruefung), dazu Format und Hochladedatum.
-- Die Bereinigung passiert VOR dem Schreiben im Server (routes/beleg-logo.ts);
-- der octet_length-Riegel hier ist die zweite Wand gegen einen Weg, der die
-- Route umgeht.
--
-- MANDANTENNEUTRAL (Doktrin vom 26.07.): diese Wanderung legt NUR die leere
-- Struktur an. Kein INSERT, kein Vorgabewert, kein Logo irgendeines Haendlers.
-- Ohne Zeile druckt der Beleg die dezente norns.de-Systemzeile — das regelt
-- die Kasse, nicht die Datenbank.
--
-- ── ZWEIMAL FAHRBAR ───────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS; GRANTs sind von Natur aus wiederholbar.

BEGIN;

CREATE TABLE IF NOT EXISTS beleg_logo (
  -- Genau eine Zeile je Mandant: jeder Schreibweg ist ein UPSERT auf id = 1.
  id smallint PRIMARY KEY DEFAULT 1 CONSTRAINT beleg_logo_nur_eine_zeile CHECK (id = 1),

  -- 'svg' (die praeziseste Form), 'png' oder 'jpeg'. Kein anderes Format.
  format text NOT NULL CONSTRAINT beleg_logo_format CHECK (format IN ('svg', 'png', 'jpeg')),

  -- Das bereinigte Original. Hoechstens 256 KB — dieselbe Grenze wie im
  -- Hochladeweg, hier als zweite Wand.
  daten bytea NOT NULL
    CONSTRAINT beleg_logo_groesse CHECK (octet_length(daten) BETWEEN 1 AND 262144),

  hochgeladen_am timestamptz NOT NULL DEFAULT now(),

  -- Wer es hochgeladen hat. SET NULL statt RESTRICT: das Logo gehoert dem
  -- Laden, nicht dem Konto — ein geloeschtes Inhaberkonto darf das Logo
  -- nicht festhalten (und nicht mitreissen).
  hochgeladen_von uuid REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE beleg_logo IS
  'Das Beleg-Logo des Haendlers (Mandantendatum, eine Zeile). Bereinigtes Original; ohne Zeile druckt der Bon die norns.de-Systemzeile.';

-- Die Anwendungsrolle darf die eine Zeile lesen, anlegen, ersetzen, loeschen.
-- GANZE Tabelle, absichtlich NICHT spaltenweise: die Spaltenfalle (0099,
-- dreimal live zugeschlagen) entsteht nur dort, wo Rechte je Spalte vergeben
-- sind und eine neue Spalte still gesperrt startet.
GRANT SELECT, INSERT, UPDATE, DELETE ON beleg_logo TO warehouse14_app;

COMMIT;

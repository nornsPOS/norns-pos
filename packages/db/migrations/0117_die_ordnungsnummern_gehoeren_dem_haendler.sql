-- ═══════════════════════════════════════════════════════════════════════════
--  0117 — DIE ORDNUNGSNUMMERN GEHOEREN DEM HAENDLER, NICHT DEM PRODUKT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND (26.07.2026, am selben Tag wie 0115) ────────────────────────
--
-- Wanderung 0115 legte sechs DATEV-Angaben als Vorgabewerte an. Zwei davon
-- gehoeren keinem Produkt, sondern EINEM Haendler:
--
--     datev.beraternummer    1001
--     datev.mandantennummer  1
--
-- Das ist keine Voreinstellung, das ist die Anschrift EINES Steuerbueros,
-- eingebacken in eine Bausubstanz, die bei JEDEM kuenftigen Kunden mitlaeuft.
-- Norns ist ein Softwarehaus; Warehouse14 ist der ERSTE Kunde, nicht der
-- einzige. Der zweite Laden hat einen anderen Steuerberater, eine andere
-- Beraternummer und eine andere Mandantennummer — und startete mit 0115 mit
-- den Ordnungszahlen eines Bueros, das er nicht kennt.
--
-- Eine falsche Mandantennummer ist dabei kein Schoenheitsfehler: sie laedt
-- die Buchungen STILL in den Bestand eines fremden Betriebs. Auffallen wuerde
-- das beim Jahresabschluss, nicht beim Export.
--
-- ── WAS DIESE WANDERUNG TUT ───────────────────────────────────────────────
--
-- Sie nimmt die beiden Zeilen wieder heraus — aber NUR, solange sie noch
-- unbestaetigt sind, also in `datev.platzhalter` stehen. Hat ein Haendler
-- seine echten Zahlen bereits eingetragen (der Aenderungsweg
-- `PATCH /api/settings/datev/:key` nimmt den Schluessel dann aus der Liste),
-- bleiben sie unangetastet. Und sie streicht beide Schluessel aus der
-- Platzhalterliste, damit kein Rest zurueckbleibt, der spaeter etwas
-- Falsches behauptet.
--
-- Danach verweigert `ladeDatevMandant` den Export, bis der Haendler die zwei
-- Zahlen einmal selbst eintraegt. Das ist ab jetzt der HAUPTWEG, nicht der
-- Ausnahmefall: gefragt wird beim ersten Export, an Ort und Stelle. Wer DATEV
-- nie benutzt, wird nie gefragt.
--
-- Auch der Platzhalter des ersten Kunden faellt. Er traegt seine echten
-- Zahlen einmal ein wie jeder andere — damit ist der Weg am ersten Kunden
-- erprobt, statt fuer ihn umgangen zu werden.
--
-- ── DIE VIER, DIE BLEIBEN, UND WARUM DAS KEIN WIDERSPRUCH IST ─────────────
--
-- Unberuehrt bleiben:
--
--     datev.sachkontenrahmen        SKR03
--     datev.sachkontenlaenge        4
--     datev.festschreibung          false
--     datev.wirtschaftsjahr_beginn  1. Januar des laufenden Jahres
--
-- Diese vier sind MANDANTENNEUTRAL. Sie beschreiben keinen bestimmten
-- Haendler und keine bestimmte Kanzlei, sondern den deutschen Regelfall:
-- jeder deutsche Haendler faengt sinnvoll dort an, und jeder kann sie
-- aendern. Sie stehen weiterhin in `datev.platzhalter` und werden dem
-- Inhaber deshalb weiterhin als UNBESTAETIGT angezeigt.
--
-- ⚠️ DIE UNTERSCHEIDUNG, die niemand spaeter einebnen darf:
--     mandantenspezifisch = beschreibt EINEN Betrieb oder EINE Kanzlei
--         (Beraternummer, Mandantennummer, Steuernummer, USt-IdNr.,
--          Firmenname, Anschrift). Gehoert NIE in eine Wanderung.
--     mandantenneutral    = beschreibt den deutschen Regelfall
--         (Kontenrahmen, Stellenzahl, Festschreibung, Kalenderjahr).
--         Darf als Vorgabewert in einer Wanderung stehen.
--   Der Waechter `wanderungen-ohne-mandantendaten.test.ts` haelt diese Grenze
--   ab sofort fuer alle kuenftigen Wanderungen.
--
-- ── ZWEIMAL FAHRBAR ──────────────────────────────────────────────────────
--
-- Beim zweiten Lauf findet die Loeschung nichts mehr (die Zeilen sind fort
-- oder nicht mehr als Platzhalter gekennzeichnet), und die Streichung aus der
-- Liste ruehrt keine Zeile mehr an, weil ihre Bedingung die beiden Schluessel
-- in der Liste verlangt. Kein Fehler, keine Nebenwirkung.

BEGIN;

-- ── 1. Die beiden Platzhalterzeilen loeschen, NUR solange unbestaetigt ─────
-- Die Bedingung liest `datev.platzhalter`: was dort steht, hat niemand
-- bestaetigt. Ein Haendler, der seine echte Beraternummer schon gespeichert
-- hat, steht nicht in der Liste — und behaelt seine Zahl.
DELETE FROM system_settings s
 WHERE s.key IN ('datev.beraternummer', 'datev.mandantennummer')
   AND EXISTS (
     SELECT 1
       FROM system_settings p
      WHERE p.key = 'datev.platzhalter'
        AND jsonb_typeof(p.value) = 'array'
        AND p.value @> jsonb_build_array(s.key)
   );

-- ── 2. Beide Schluessel aus der Platzhalterliste streichen ────────────────
-- `jsonb_agg` ueber eine leere Auswahl liefert NULL, deshalb COALESCE: sonst
-- stuende dort `null` statt einer leeren Liste, und der Leser hielte alle
-- Angaben wieder fuer unbestaetigt (dieselbe Falle wie im Aenderungsweg).
UPDATE system_settings
   SET value = (
         SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
           FROM jsonb_array_elements(value) AS e
          WHERE e <> to_jsonb('datev.beraternummer'::text)
            AND e <> to_jsonb('datev.mandantennummer'::text)
       ),
       updated_at = now()
 WHERE key = 'datev.platzhalter'
   AND jsonb_typeof(value) = 'array'
   AND (
        value @> jsonb_build_array('datev.beraternummer'::text)
     OR value @> jsonb_build_array('datev.mandantennummer'::text)
   );

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- 0140 — der Belegkopf trägt keinen fremden Betrieb mehr (11.08.2026)
--
-- ── DER BEFUND (P0) ──────────────────────────────────────────────────────
--
-- Ein Behälter im Zustand GENAU nach den Wanderungen, danach der
-- Einrichtungsassistent vollständig über die echten HTTP-Wege ausgefüllt.
-- Der Händler trug ein: Goldhaus Neustadt e. K., Marktplatz 3, 90402
-- Nürnberg. Gelesen wurde danach:
--
--     GET /api/shop-info -> 200
--       name         = "WAREHOUSE 14"
--       tagline      = "Antiquitäten · Briefmarken · Münzen"
--       addressLine1 = "Schornbacher Weg 66"
--       addressLine2 = "73614 Schorndorf"
--       taxNumber    = "241/123/45678"      <- seine eigene
--
-- Der erste Kunde bekommt einen Bon mit dem Namen und der Anschrift eines
-- ANDEREN Unternehmens und der Steuernummer des Händlers darunter.
-- § 14 Abs. 4 Nr. 1 UStG verlangt den vollständigen Namen und die Anschrift
-- des LEISTENDEN Unternehmers. Derselbe Wert wandert in den Kassenbericht
-- und in den DSFinV-K-Kopf.
--
-- Herkunft: Wanderung 0044 säte diese vier Werte als "Shop identity". Der
-- Rückfall in lib/beleg-identitaet.ts greift deshalb NIE — er greift nur bei
-- LEEREM Belegfeld, und leer war keines der vier. Der Händler hat auch
-- keinen Anlass nachzusehen: der Assistent meldet fertig, und die Startliste
-- zeigt den Punkt "Name auf dem Beleg" nur, wenn shop.name leer ist.
--
-- Das ist dieselbe Klasse wie die erfundene USt-IdNr. aus 0123 und derselbe
-- Verstoss gegen die Mandantenneutralität (KOORDINATION §7): kein
-- Händlerwert gehört in die Bausubstanz.
--
-- ── WARUM NICHT IM QUELLTEXT REPARIEREN ─────────────────────────────────
--
-- Naheliegend wäre, belegIdentitaet die vier Saatwerte als "nicht gesetzt"
-- zu behandeln. Das trifft aber auch eine Kasse, auf der genau diese Werte
-- die WAHRHEIT sind, und nimmt ihr die Ortszeile vom Beleg. Wanderung 0126
-- hat am 28.07.2026 auf Romans Produktion gemessen:
--
--     shop.name          ""                  <- NICHT die Saat
--     shop.address_line1 "Rosenstrasse 40"   <- NICHT die Saat
--     shop.address_line2 "73614 Schorndorf"  <- gleicht der Saat, ist aber
--                                               seine echte Ortszeile
--     shop.postal_code   ""   shop.city  ""  <- der Rückfall hätte NICHTS
--
-- Ein Räumen einzelner Felder nach Wortlaut hätte ihm also genau die
-- Ortszeile vom Beleg genommen und nichts an ihre Stelle gesetzt.
--
-- ── DIE BEDINGUNG, DIE HIER ÜBER ALLEM STEHT ────────────────────────────
--
-- Geräumt wird NUR, wenn ALLE VIER Felder noch Byte für Byte die
-- Auslieferung sind. Dann hat den Belegkopf nachweislich kein Mensch
-- angefasst, und keiner dieser Werte kann jemandem gehören. Sobald an EINEM
-- Feld etwas geändert wurde — wie auf Romans Produktion — rührt diese
-- Wanderung GAR NICHTS an. Sie ist damit auf jedem bestehenden Stand ein
-- Nichttun und lässt sich beliebig oft einspielen.
--
-- Danach ist der Belegkopf leer und SICHTBAR leer: der Punkt "Name auf dem
-- Beleg" erscheint in der Startliste, und sobald der Händler seinen
-- Firmennamen und seine Anschrift einträgt, erbt der Beleg sie über den
-- Rückfall in lib/beleg-identitaet.ts. Erfunden wird nichts.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  unberuehrt INT;
  geraeumt   INT;
BEGIN
  -- Wie viele der vier Felder tragen noch WÖRTLICH die Saat aus 0044?
  SELECT count(*) INTO unberuehrt
    FROM system_settings
   WHERE (key = 'shop.name'          AND value = '"WAREHOUSE 14"'::jsonb)
      OR (key = 'shop.tagline'       AND value = '"Antiquitäten · Briefmarken · Münzen"'::jsonb)
      OR (key = 'shop.address_line1' AND value = '"Schornbacher Weg 66"'::jsonb)
      OR (key = 'shop.address_line2' AND value = '"73614 Schorndorf"'::jsonb);

  IF unberuehrt = 4 THEN
    UPDATE system_settings
       SET value = '""'::jsonb,
           description = 'Belegkopf. LEER ausgeliefert: er gehoert dem Haendler '
                         '(0140). Leer erbt ueber beleg-identitaet.ts die '
                         'rechtliche Anschrift; erfunden wird nichts.'
     WHERE key IN ('shop.name', 'shop.tagline', 'shop.address_line1', 'shop.address_line2');
    GET DIAGNOSTICS geraeumt = ROW_COUNT;
    RAISE NOTICE '0140: Belegkopf geraeumt, % Felder auf LEER gesetzt', geraeumt;
  ELSE
    -- Der häufige und richtige Ausgang auf einem bestehenden Stand.
    RAISE NOTICE '0140: Belegkopf wurde bereits angefasst (% von 4 unberuehrt) — nichts getan', unberuehrt;
  END IF;
END $$;

-- ── Die Selbstprüfung, nach dem Muster von 0126 und 0134 ─────────────────
DO $$
DECLARE
  fremd TEXT;
BEGIN
  -- Nach dieser Wanderung darf KEIN Feld des Belegkopfs mehr einen
  -- vollständigen Satz der Auslieferungssaat tragen. Bleibt er stehen, weil
  -- ein Feld schon von Hand geändert wurde, ist das in Ordnung — dann ist
  -- der Satz nicht mehr vollständig, und genau das prüft dieser Block.
  SELECT string_agg(key, ', ') INTO fremd
    FROM system_settings
   WHERE (key = 'shop.name'          AND value = '"WAREHOUSE 14"'::jsonb)
      OR (key = 'shop.tagline'       AND value = '"Antiquitäten · Briefmarken · Münzen"'::jsonb)
      OR (key = 'shop.address_line1' AND value = '"Schornbacher Weg 66"'::jsonb)
      OR (key = 'shop.address_line2' AND value = '"73614 Schorndorf"'::jsonb)
  HAVING count(*) = 4;

  IF fremd IS NOT NULL THEN
    RAISE EXCEPTION '0140: der Belegkopf traegt weiter die vollstaendige Fremdsaat: %', fremd;
  END IF;
END $$;

COMMIT;

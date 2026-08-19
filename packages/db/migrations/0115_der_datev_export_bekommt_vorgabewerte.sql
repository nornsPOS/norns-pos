-- 0115 — Der DATEV-Export bekommt Vorgabewerte, und sagt dazu, dass sie
--        Vorgabewerte sind.
--
-- ── DER BEFUND (26.07.2026) ────────────────────────────────────────────────
--
-- `ladeDatevMandant` verweigert die Datei, solange eine der sechs
-- Mandantenangaben fehlt. Das ist richtig so: ein Buchungsstapel mit leeren
-- Ordnungsbegriffen sieht aus wie ein Export und ist keiner.
--
-- Auf der Produktion sind ALLE SECHS leer. Gemessen:
--
--     SELECT count(*) FROM system_settings WHERE key LIKE 'datev.%';   -->  0
--
-- Der DATEV-Export ist damit nicht „noch nicht eingerichtet", er ist
-- BLOCKIERT — jeder Versuch endet mit 409 und einer Liste von sechs Fragen an
-- den Steuerberater. Der Inhaber kann davon fünf selbst beantworten, hat aber
-- keine Stelle, an der er sie einträgt.
--
-- ── WAS DIESE WANDERUNG TUT ───────────────────────────────────────────────
--
-- Sie legt die sechs Zeilen an, FALLS sie fehlen. `ON CONFLICT DO NOTHING`
-- heisst: was gespeichert ist, bleibt unangetastet. Diese Wanderung kann also
-- keinen bestätigten Wert überschreiben, auch nicht bei erneutem Einspielen.
--
-- ── DIE ZWEI ZAHLEN, DIE NUR DER STEUERBERATER KENNT ──────────────────────
--
-- Beraternummer und Mandantennummer sind KEINE Sache, die dieses Haus wissen
-- kann. Die Beraternummer vergibt DATEV an die Kanzlei, die Mandantennummer
-- die Kanzlei an den Laden. Eine erfundene Nummer wäre der gefährlichste Wert
-- dieser ganzen Wanderung: der Stapel liefe in den Bestand eines FREMDEN
-- Beraters oder auf einen fremden Mandanten.
--
-- Deshalb steht hier der KLEINSTE formal gültige Wert, und er ist als
-- Platzhalter gekennzeichnet:
--
--     datev.beraternummer    1001   (DATEV: vier bis sieben Ziffern, ab 1001)
--     datev.mandantennummer  1      (DATEV: eine bis fünf Ziffern, ab 1)
--
-- Beide Grenzen prüft `baueKopfzeile` in `datev-format.ts` (`nurZiffern`, 4
-- bis 7 beziehungsweise 1 bis 5 Stellen). Der Wert ist also formal gültig und
-- fachlich mit Sicherheit falsch. Genau das muss die Oberfläche sagen können.
--
-- ── DIE LISTE `datev.platzhalter`, und warum es sie braucht ───────────────
--
-- Bei den KONTEN reicht das Vorhandensein einer Zeile als Merkmal: keine
-- Zeile heisst Vorlage, also VORSCHLAG; eine Zeile heisst, der Inhaber hat
-- gespeichert, also BESTÄTIGT. Hier geht das nicht, weil diese Wanderung ja
-- gerade Zeilen anlegt. Eine vorhandene Zeile wäre sonst ein Beweis für etwas,
-- das nie geprüft wurde.
--
-- `datev.platzhalter` hält deshalb die Liste der Schlüssel, die DIESE
-- Wanderung angelegt hat. Was darin steht, weist die Oberfläche als
-- UNBESTÄTIGT aus. Sobald der Inhaber einen Wert speichert, nimmt der Weg
-- `PATCH /api/settings/datev/:key` den Schlüssel aus der Liste — bestätigt
-- ist, was ein Mensch angefasst hat.
--
-- Die Liste wird aus dem `RETURNING` der Einfügung gebaut, nicht von Hand
-- geschrieben. Steht eine der sechs Zeilen bereits (ein Inhaber, der sie schon
-- gepflegt hat), erscheint sie gar nicht erst in der Liste. Eine von Hand
-- geschriebene Liste hätte einen echten Wert als Platzhalter gebrandmarkt.
--
-- ── DIE VIER ÜBRIGEN WERTE, mit Begründung ────────────────────────────────
--
--   datev.sachkontenrahmen     SKR03
--       Der Rahmen, in dem dieses Haus bis heute gebucht hat. Alle Konten im
--       Quelltext waren SKR03; ein anderer Vorgabewert würde die laufende
--       Buchführung still umstellen. SKR04 ist ab sofort wählbar, aber nicht
--       vorgegeben.
--
--   datev.sachkontenlaenge     4
--       SKR03 und SKR04 sind vierstellige Sachkontenrahmen, und alle Konten
--       dieses Hauses sind vierstellig (1000, 3200, 8400 …). Führt der
--       Berater den Bestand fünfstellig, ändert der Inhaber den Wert; die
--       Prüfung „vier bis acht" bleibt bestehen.
--
--   datev.festschreibung       false
--       Ausdrücklich `false`, nicht leer und nicht `true`. Ein Stapel OHNE
--       Kennzeichen wird von DATEV automatisch festgeschrieben, lässt sich
--       dann nicht mehr entsperren und auch nicht mehr an einen bestehenden
--       Stapel anhängen (siehe die Begründung in `datev-format.ts` zu
--       Kopf-Feld 21). Beim ERSTEN Export eines Ladens ist das die falsche
--       Richtung: der Berater soll den Stapel noch korrigieren können. Wer
--       festschreiben will, stellt es um.
--
--   datev.wirtschaftsjahr_beginn   1. Januar des laufenden Jahres
--       Der Regelfall ist das Kalenderjahr. Der Wert wird gerechnet, nicht
--       hingeschrieben, damit hier kein Jahr einbetoniert wird.
--
--       ⚠️ HINWEIS, der nicht in diese Wanderung gehört, aber festgehalten
--       werden muss: Kopf-Feld 13 bestimmt das Jahr ALLER Belegdaten der
--       Datei, weil das Belegdatum nur vierstellig `TTMM` ist. Ein im Januar
--       2027 gezogener Export eines Tages aus 2026 braucht deshalb den
--       Wirtschaftsjahresbeginn 2026, nicht 2027. Dass dieser Wert eine feste
--       Einstellung ist und nicht aus dem Belegdatum folgt, ist ein
--       eigenständiger offener Punkt.

BEGIN;

WITH eingefuegt AS (
  INSERT INTO system_settings (key, value, description) VALUES
    ('datev.sachkontenrahmen',
     to_jsonb('SKR03'::text),
     'DATEV-Kontenrahmen: SKR03 oder SKR04. Vorgabewert der Wanderung 0115 — der Rahmen, in dem dieses Haus bisher gebucht hat.'),
    ('datev.sachkontenlaenge',
     to_jsonb(4),
     'Stellenzahl der Sachkonten, vier bis acht. Vorgabewert 4: SKR03 und SKR04 sind vierstellig. Muss zum Bestand des Steuerberaters passen.'),
    ('datev.festschreibung',
     to_jsonb(false),
     'Kopf-Feld 21 und Satz-Feld 114. Vorgabewert false, damit der Steuerberater den ersten Stapel noch korrigieren und anhängen kann.'),
    ('datev.wirtschaftsjahr_beginn',
     to_jsonb(to_char(date_trunc('year', now() AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD')),
     'Beginn des Wirtschaftsjahres, JJJJ-MM-TT. Vorgabewert: 1. Januar des laufenden Jahres (Regelfall Kalenderjahr). Bestimmt das Jahr ALLER Belegdaten der Datei.'),
    ('datev.beraternummer',
     to_jsonb(1001),
     'PLATZHALTER. Die Beraternummer vergibt DATEV an die Kanzlei; dieses Haus kann sie nicht kennen. 1001 ist der kleinste formal gueltige Wert (vier bis sieben Ziffern). Muss vom Steuerberater kommen.'),
    ('datev.mandantennummer',
     to_jsonb(1),
     'PLATZHALTER. Die Mandantennummer vergibt die Kanzlei an diesen Laden; dieses Haus kann sie nicht kennen. 1 ist der kleinste formal gueltige Wert (eine bis fuenf Ziffern). Muss vom Steuerberater kommen.')
  ON CONFLICT (key) DO NOTHING
  RETURNING key
)
INSERT INTO system_settings (key, value, description)
SELECT
  'datev.platzhalter',
  COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb),
  'Die DATEV-Schluessel, deren Wert aus einem Vorgabewert stammt und den NIEMAND bestaetigt hat. Die Oberflaeche weist sie als UNBESTAETIGT aus. Wird ein Schluessel gespeichert, nimmt der Server ihn aus dieser Liste.'
FROM eingefuegt
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  0150 — Die Steuerausfuhr läuft ab Werk (20.08.2026, Basels Anweisung)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── DER BEFUND ─────────────────────────────────────────────────────────────
--
-- Der DATEV-Buchungsstapel trägt in seiner Kopfzeile sechs Ordnungsbegriffe.
-- Vier davon hatten längst Vorgabewerte (Rahmen SKR03, Sachkontenlänge 4,
-- Festschreibung aus, Wirtschaftsjahr ab 1. Januar) und sind über
-- `datev.platzhalter` sauber als UNBESTÄTIGT ausgewiesen.
--
-- Zwei waren LEER: die Beraternummer und die Mandantennummer. Und weil der
-- Export jede leere Pflichtangabe abweist, hiess das: eine frische Kasse
-- konnte KEINEN Steuerexport erzeugen, bevor der Händler seinen
-- Steuerberater angerufen und zwei Zahlen erfragt hatte.
--
-- Basel, wörtlich: „ارقام حسابات داتيف محد يعرفها اصلاً ولا مهتمين هم اصلا
-- شي راجع للمحاسب" — die kennt keiner, und keiner fragt seinen Berater
-- vorher. Er hat recht: eine Kasse, die am ersten Tag keinen Export kann,
-- ist am ersten Tag nicht fertig.
--
-- ── DIE RECHERCHE, AUF DIE SICH DIE VORGABEN STÜTZEN ───────────────────────
--
-- Nachgelesen am 20.08.2026 (Quellen im Commit): in der Praxis wird ein
-- Buchungsstapel mit Platzhaltern erzeugt und beim Import in DATEV auf den
-- richtigen Mandanten umgebogen — die Stapelverarbeitung kennt dafür eigens
-- eine Zusatzfunktion. Als Platzhalter sind 1001 (Berater) und 99999
-- (Mandant) die verbreiteten Werte; sie liegen in den gültigen Bereichen und
-- kollidieren nicht mit einer echten Kanzleinummer.
--
-- ── DIE HALTUNG BLEIBT: EIN PLATZHALTER SAGT, DASS ER EINER IST ────────────
--
-- Beide Zahlen wandern in `datev.platzhalter`. Die Oberfläche weist sie damit
-- weiterhin als UNBESTÄTIGT aus, und die Ausfuhrfläche bittet in einem Satz
-- darum, sie einmal mit dem Steuerberater abzugleichen. Der Unterschied zu
-- vorher ist nicht die Ehrlichkeit — die war schon da —, sondern dass die
-- Kasse jetzt trotzdem arbeitet.
--
-- ⚠️ NICHT geändert wird das Verhalten bei einem LEER GESETZTEN Wert: wer die
-- Zahl bewusst leert, bekommt weiterhin die klare Fehlermeldung statt einer
-- Datei mit erfundener Kennung.

-- Die zwei Zahlen bekommen ihren Platzhalter — aber NUR, wenn sie leer sind.
-- Eine Kasse, auf der der Händler seine echten Zahlen längst eingetragen hat,
-- bleibt unberührt.
UPDATE system_settings
   SET value = '"1001"'::jsonb,
       description = 'Beraternummer der Kanzlei (Kopf-Feld 4). Vorgabewert 1001 als Platzhalter: '
                     || 'der Steuerberater biegt den Stapel beim Import auf seinen Bestand um '
                     || '(Stapelverarbeitung, Zusatzfunktionen). Steht in datev.platzhalter und '
                     || 'wird als UNBESTAETIGT ausgewiesen, bis er bestaetigt ist.',
       updated_at = now()
 WHERE key = 'datev.beraternummer'
   AND (value IS NULL OR value::text IN ('""', 'null'));

UPDATE system_settings
   SET value = '"99999"'::jsonb,
       description = 'Mandantennummer dieses Ladens im Bestand der Kanzlei (Kopf-Feld 5). '
                     || 'Vorgabewert 99999 als Platzhalter, siehe datev.beraternummer.',
       updated_at = now()
 WHERE key = 'datev.mandantennummer'
   AND (value IS NULL OR value::text IN ('""', 'null'));

-- Und sie sagen, dass sie Platzhalter sind. Die Liste wird als Menge geführt,
-- damit ein zweiter Lauf nichts doppelt einträgt.
UPDATE system_settings
   SET value = (
         SELECT jsonb_agg(DISTINCT k ORDER BY k)
           FROM jsonb_array_elements_text(
                  value || '["datev.beraternummer","datev.mandantennummer"]'::jsonb
                ) AS t(k)
       ),
       updated_at = now()
 WHERE key = 'datev.platzhalter'
   AND jsonb_typeof(value) = 'array';

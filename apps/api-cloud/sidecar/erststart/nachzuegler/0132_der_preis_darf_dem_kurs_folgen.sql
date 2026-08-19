-- ════════════════════════════════════════════════════════════════════════
--  0132 — Der Preis darf dem KURS folgen
-- ════════════════════════════════════════════════════════════════════════
--
--  ── BASELS FRAGE VOM 05.08.2026 ─────────────────────────────────────────
--
--  Wörtlich: „اذا شترييت قرام ذهب بسعر معين وبعد يومين ارتفع سعر الذهب هل
--  سعر المنتج يرتفع كونه ذهب؟" — wenn ich ein Gramm Gold kaufe und der
--  Goldkurs zwei Tage später steigt, steigt dann der Preis des Stücks mit?
--
--  Die gemessene Antwort war NEIN. Ein `grep` nach
--  `spotPrice|repricing|preisNachfuehr|neuberechn` über `apps/api-cloud/src`
--  fand NICHTS. Jeder Preis blieb für immer so, wie er einmal eingetippt
--  wurde. Bei hundert einzelnen Goldstücken sind das hundert Änderungen von
--  Hand bei jeder Kursbewegung. Basel: „دمار اخسر مع الوقت".
--
--  Seine Entscheidung: der Verkaufspreis eines Edelmetallstücks wird
--  GERECHNET — Feingewicht × Tageskurs + Aufschlag.
--
--  ── WAS DIESE WANDERUNG TUT ─────────────────────────────────────────────
--
--  Sie fügt EINE Spalte hinzu: die Entscheidung je Stück, ob es dem Kurs
--  folgt oder einen festen Preis behält.
--
--  Eine Uhr, eine Antiquität, ein Sammlerstück mit Liebhaberwert hängt
--  nicht am Materialwert. Für die muss der Händler „fest" sagen können,
--  ohne das Metall aus dem Stück zu löschen — das Metall gehört zur
--  Beschreibung und zum Ankaufbeleg, auch wenn der Preis ihm nicht folgt.
--
--  ── ⚠️ DIE ROTE LINIE ───────────────────────────────────────────────────
--
--  Diese Spalte steht auf `products`, also am LAGERSTÜCK. Sie fasst
--  `transactions` und `transaction_items` NICHT an und darf es nie.
--  Was verkauft ist, trägt für immer die gebuchte Zahl; ein rückwirkend
--  veränderter Beleg wäre ein GoBD-Bruch und vor der Prüfung schlimmer als
--  jeder Preisverlust.
--
--  ── DIE VORGABE, UND WARUM SIE SO HERUM IST ─────────────────────────────
--
--  `false` — der Preis folgt dem Kurs. Bestehende Stücke ändern damit ihr
--  Verhalten, und das ist der Sinn der Sache: Basel WILL, dass sein Bestand
--  mitgeht. Wer einzelne Stücke festhalten möchte, setzt sie einzeln auf
--  `true`; das ist der seltene Fall.
--
--  Stücke ohne Metall, ohne Gewicht oder ohne Feingehalt bekommen ohnehin
--  keinen gerechneten Preis (`kurspreisFuerStueck` gibt dort einen GRUND
--  zurück, nie eine erfundene Zahl). Für sie ändert sich nichts.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fester_preis boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.fester_preis IS
  'Wenn wahr, folgt dieses Stueck dem Metall-Tageskurs NICHT und behaelt '
  'list_price_eur als festen Preis. Fuer Uhren, Antiquitaeten und '
  'Sammlerstuecke, deren Wert nicht am Materialwert haengt. '
  'Vorgabe false: der Bestand geht mit dem Kurs mit (Basels Entscheidung '
  '05.08.2026). Gilt NUR fuer Lagerware; abgeschlossene Belege behalten '
  'ihre gebuchte Zahl fuer immer.';

-- Der Verkaufsaufschlag, den die Rechnung braucht. Er wohnt bei den
-- Systemeinstellungen, direkt neben der Ankaufmarge, die es seit jeher gibt.
--
-- ⚠️ ANTEIL, NICHT PROZENT. 0.10 heisst zehn Prozent, genau wie
-- `pricing.ankauf_safety_margin_pct` daneben. Zwei Einheiten im selben
-- System wären ein Preisfehler um den Faktor hundert, und zwar still. Der
-- Leser (`verkaufsaufschlag.ts`) verwirft deshalb jeden Wert über 1.
--
-- Die Vorgabe ist NULL, kein erfundener Händlerzuschlag: ein zu niedriger
-- Preis fällt beim ersten Blick auf, ein erfundener nicht.
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'pricing.verkauf_aufschlag_pct',
  '0',
  'Verkaufsaufschlag auf den Materialwert, als ANTEIL in [0, 1]. 0.10 sind zehn Prozent. Je Metall ueberschreibbar mit pricing.verkauf_aufschlag_pct.gold usw. Vorgabe 0: lieber der nackte Materialwert als ein erfundener Zuschlag.'
)
ON CONFLICT (key) DO NOTHING;

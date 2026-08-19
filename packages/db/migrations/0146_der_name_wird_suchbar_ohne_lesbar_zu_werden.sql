-- ═══════════════════════════════════════════════════════════════════════════
--  0146 — DER NAME WIRD SUCHBAR, OHNE LESBAR ZU WERDEN (19.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GEMESSEN an 2.000 Kunden: die Namenssuche der Kasse braucht 262 ms JE
-- TASTENDRUCK. Der Grund steht seit Wanderung 0007 fest: der Name liegt
-- verschluesselt (richtig so — die Datenbankdatei selbst ist unverschluesselt
-- auf der Ladenplatte), also muss `decrypt_pii` fuer JEDE Zeile laufen, je
-- Anschlag, PARALLEL UNSAFE. Das waechst linear: bei 10.000 Kunden steht die
-- Kassiererin ueber eine Sekunde pro Buchstabe.
--
-- Der naive Ausweg — eine Klartext-Suchspalte — wuerde genau die Entscheidung
-- rueckgaengig machen, derentwegen verschluesselt wird.
--
-- ── DER WEG: GEBLENDETE DREIERGRUPPEN ──────────────────────────────────────
--
-- Dasselbe Prinzip wie der bestehende `blind_index` (HMAC statt Klartext),
-- nur fuer TEILtreffer: der Name wird in Dreiergruppen zerlegt (wie pg_trgm
-- es taete), und JEDE Gruppe wird einzeln mit dem Sitzungsschluessel
-- ge-HMAC-t und gekuerzt abgelegt. Gesucht wird mit den Dreiergruppen des
-- Suchworts, gleich geblendet: Arrayeinschluss (@>) auf einem GIN-Index.
--
--     Ablage  „Anna Meier" → Gruppen von '  anna ' und '  meier '
--               → HMAC je Gruppe → {9f3a…, 02c1…, …}
--     Anfrage „eier"        → eie, ier → HMAC → beide im Array? → Treffer.
--
-- Kein Klartext beruehrt die Platte. Ohne den Sitzungsschluessel sind die
-- Tokens Rauschen; mit ihm sind sie nur je-Gruppe-Gleichheit.
--
-- ── WAS DAS PREISGIBT, EHRLICH ─────────────────────────────────────────────
--
--  • Haeufigkeitsstatistik der Gruppen (wieviele Namen 'sch' enthalten) —
--    ein Angreifer MIT Plattenzugriff, aber OHNE Schluessel, kann Namen
--    nach Sprachstatistik zu erraten versuchen. Gegenueber heute (derselbe
--    Angreifer sieht NICHTS, die Kasse dafuer 262 ms je Anschlag) ist das
--    der dokumentierte Handel. Die Kuerzung auf 8 Byte je Token nimmt dem
--    Material zusaetzlich Eindeutigkeit.
--  • KEINE Wortnachbarschaft: „na me" traefe per ILIKE ueber die Wortgrenze,
--    per Gruppen nicht. Fuer eine Namenssuche ist das verschmerzbar.
--  • Anfragen unter drei Zeichen bilden keine Gruppe — die Route faellt
--    dann auf den alten (teuren) Weg zurueck, der bleibt.
--
-- ── WARUM DIE RUECKFUELLUNG NICHT HIER STEHT ───────────────────────────────
--
-- Diese Wanderung laeuft als Migrator OHNE den PII-Schluessel — sie KANN
-- nicht entschluesseln, und sie soll es auch nicht koennen. Die Rueckfuellung
-- der Bestandskunden macht der Sidecar beim Start (er haelt den Schluessel),
-- mit `WHERE name_such_tokens IS NULL`: einmal echte Arbeit, danach 0 Zeilen.

-- ── 1. Zerlegung und Blendung ───────────────────────────────────────────────
--
-- ⚠️ hmac verlangt (bytea, bytea, text) — der Schluessel MUSS durch
-- convert_to. Die Quelle von 0007 zeigt noch die (bytea, text, …)-Fassung;
-- die LEBENDE blind_index wurde spaeter genau darauf berichtigt. Wer hier
-- den convert_to um den Schluessel entfernt, bekommt „function hmac(bytea,
-- text, unknown) does not exist" — beim ERSTEN Aufruf, nicht beim Anlegen.

-- Klein, nur Buchstaben und Ziffern (Umlaute bleiben), alles andere wird Raum.
CREATE OR REPLACE FUNCTION pii_such_normal(t TEXT) RETURNS TEXT
  LANGUAGE SQL IMMUTABLE
  AS $$ SELECT regexp_replace(lower(coalesce(t, '')), '[^a-z0-9äöüß]+', ' ', 'g') $$;

COMMENT ON FUNCTION pii_such_normal(TEXT) IS
  'Normalform fuer den geblendeten Suchindex: klein, Nichtwortzeichen zu Raum. '
  'Ablage- und Anfrageseite MUESSEN durch dieselbe Normalform gehen.';

-- ABLAGE: je Wort gepolsterte Dreiergruppen (zwei Raeume vorn, einer hinten —
-- die pg_trgm-Polsterung), jede Gruppe HMAC-SHA256 mit dem Sitzungsschluessel,
-- auf 8 Byte gekuerzt, hex. STABLE, nicht IMMUTABLE: der Schluessel kommt aus
-- der Sitzung.
CREATE OR REPLACE FUNCTION pii_such_tokens_ablage(t TEXT) RETURNS TEXT[]
  LANGUAGE SQL STABLE PARALLEL UNSAFE
  AS $$
    WITH woerter AS (
      SELECT w FROM unnest(string_to_array(trim(pii_such_normal(t)), ' ')) AS w
       WHERE length(w) >= 2
    ),
    gruppen AS (
      SELECT DISTINCT substr('  ' || w || ' ', i, 3) AS g
        FROM woerter, generate_series(1, length(w) + 1) AS i
    )
    SELECT coalesce(
      array_agg(encode(
        substring(hmac(convert_to(g, 'UTF8'),
                       convert_to(current_setting('warehouse14.pii_key'), 'UTF8'),
                       'sha256')
                  from 1 for 8), 'hex')),
      '{}'::text[])
      FROM gruppen;
  $$;

COMMENT ON FUNCTION pii_such_tokens_ablage(TEXT) IS
  'Geblendete Dreiergruppen eines Namens fuer die Teiltreffer-Suche ohne '
  'Entschluesselung. Gegenstueck: pii_such_tokens_anfrage. Wer die eine '
  'Funktion aendert, aendert die andere und fuellt ALLE Bestandszeilen neu.';

-- ANFRAGE: dieselbe Normalform, aber UNgepolstert — der Suchbegriff darf
-- mitten im Wort beginnen. Woerter unter drei Zeichen fallen weg; ist danach
-- nichts uebrig, gibt die Funktion NULL zurueck, und der Aufrufer weiss:
-- dieser Weg traegt nicht, nimm den alten.
CREATE OR REPLACE FUNCTION pii_such_tokens_anfrage(t TEXT) RETURNS TEXT[]
  LANGUAGE SQL STABLE PARALLEL UNSAFE
  AS $$
    WITH woerter AS (
      SELECT w FROM unnest(string_to_array(trim(pii_such_normal(t)), ' ')) AS w
       WHERE length(w) >= 3
    ),
    gruppen AS (
      SELECT DISTINCT substr(w, i, 3) AS g
        FROM woerter, generate_series(1, length(w) - 2) AS i
    )
    SELECT array_agg(encode(
      substring(hmac(convert_to(g, 'UTF8'),
                     convert_to(current_setting('warehouse14.pii_key'), 'UTF8'),
                     'sha256')
                from 1 for 8), 'hex'))
      FROM gruppen;
  $$;

COMMENT ON FUNCTION pii_such_tokens_anfrage(TEXT) IS
  'Geblendete Dreiergruppen eines SUCHBEGRIFFS — ungepolstert, weil der '
  'Begriff mitten im Wort beginnen darf. NULL heisst: kein Wort lang genug, '
  'der Aufrufer nimmt den alten Weg.';

-- ── 2. Spalte und Index ─────────────────────────────────────────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS name_such_tokens TEXT[];

COMMENT ON COLUMN customers.name_such_tokens IS
  'Geblendete Dreiergruppen von full_name (pii_such_tokens_ablage). Wird bei '
  'jedem Schreiben des Namens mitgeschrieben; Bestand fuellt der Sidecar beim '
  'Start nach. NULL = noch nicht gefuellt (Suche faellt auf decrypt zurueck).';

CREATE INDEX IF NOT EXISTS customers_name_such_tokens_idx
  ON customers USING GIN (name_such_tokens);

-- ── 3. Die Loeschung nimmt die Tokens mit ───────────────────────────────────
--
-- `erase_customer` (0078) ersetzt den Namen durch das Merkzeichen. Die Tokens
-- des ECHTEN Namens duerfen das nicht ueberleben — sonst bliebe der geloeschte
-- Name teiltreffbar. Hier wird nur der eine SET-Block ergaenzt; alles andere
-- ist Wort fuer Wort der Stand aus 0078.
DO $$
DECLARE quelle TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO quelle
    FROM pg_proc WHERE proname = 'erase_customer';
  IF quelle IS NULL THEN
    RAISE EXCEPTION '0146: erase_customer fehlt — 0078 muss zuerst laufen';
  END IF;
  IF quelle NOT LIKE '%name_such_tokens%' THEN
    quelle := replace(
      quelle,
      'SET full_name_encrypted   = encrypt_pii(''GELOESCHT''),',
      'SET full_name_encrypted   = encrypt_pii(''GELOESCHT''), name_such_tokens = NULL,');
    IF quelle NOT LIKE '%name_such_tokens = NULL%' THEN
      RAISE EXCEPTION '0146: der SET-Block von erase_customer hat sich veraendert — Ergaenzung von Hand pruefen';
    END IF;
    EXECUTE quelle;
  END IF;
END $$;

-- ── 4. Die Namensliste der Rechte kennt die neue Spalte ─────────────────────
--
-- INSERT und UPDATE auf customers sind fuer die App-Rolle SPALTENWEISE
-- vergeben (0007, 0024 — Audit A-2, kleinste Rechte). Eine neue Spalte ist
-- fuer diese Listen unsichtbar: das Anlegen eines Kunden fiel mit
-- „permission denied for table customers" um, GENAU WEIL die Rechteliste ein
-- Waechter mit Namensliste ist. Hausklasse; die Spalte wird nachgetragen.
GRANT INSERT (name_such_tokens), UPDATE (name_such_tokens) ON customers TO warehouse14_app;

-- 52 von 83 Tabellen waren in einer FRISCHEN Datenbank unsichtbar.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  VORGABERECHTE HÄNGEN AN DER ERZEUGENDEN ROLLE, NICHT AN DER MITGLIEDSCHAFT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Wanderung 0003 setzt:
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
--       GRANT SELECT, INSERT ON TABLES TO warehouse14_app;
--
-- Das wirkt AUSSCHLIESSLICH für Tabellen, die `warehouse14_migrator` SELBST
-- anlegt. Seit der Mandantentrennung wandert die Produktion aber als
-- `t001_migrator`, und Mitgliedschaft zählt hier NICHT: eine von der
-- Mitgliedsrolle erzeugte Tabelle bekommt eine leere Rechteliste.
--
-- ── Der Befund, gemessen und nicht vermutet ───────────────────────────────
--
-- Frische Datenbank, alle 113 Wanderungen als Superuser eingespielt:
--
--     52 von 83 Tabellen sind für `warehouse14_app` UNSICHTBAR
--
-- Darunter `customers`, `carts`, `cart_items`, `appointments`, `audit_log`,
-- `cash_movements`, `belegtext_templates`. Also nicht Randfälle, sondern der
-- Kern des Ladens.
--
-- Die laufende Produktion merkt davon nichts: dort sind die Tabellen zu einer
-- Zeit entstanden, als noch der Eigentümer wanderte, und die damals erteilten
-- Rechte stehen weiterhin an den Zeilen. **Der Fehler trifft ausschliesslich
-- NEUE Datenbanken**, also genau den Produktivstart und jeden zweiten
-- Mandanten. Ein Laden, der so aufgesetzt wird, kann keinen Kunden anzeigen.
--
-- Und er ist still: das Einspielen läuft grün durch, jeder Test ist grün, und
-- erst die erste echte Abfrage sagt `permission denied`.
--
-- ── Was diese Wanderung tut, und warum in dieser Reihenfolge ──────────────
--
-- 1. Die Vorgabe zusätzlich für die MANDANTENROLLEN setzen. `ALTER DEFAULT
--    PRIVILEGES FOR ROLE x` verlangt, dass die ausführende Rolle Mitglied von
--    x ist oder Superuser; beim Wandern als `t001_migrator` ist genau das der
--    Fall.
-- 2. Den Rückstand nachholen: alles, was schon da ist, ausdrücklich freigeben.
--    Ohne diesen Schritt bliebe der gemessene Zustand bestehen, denn eine
--    Vorgabe wirkt nur nach vorn.
--
-- ⚠️ Der Nachhol-Schritt gewährt bewusst NUR `SELECT, INSERT`, genau wie die
-- Vorgabe in 0003. Er darf NICHT `ALL` gewähren: mehrere Tabellen haben
-- absichtlich engere Rechte (`ledger_events` nur SELECT+INSERT,
-- `payment_commission_rates` nur SELECT, `worker_job_runs` DELETE nur für den
-- Worker). Ein pauschales `GRANT ALL` würde die Arbeit mehrerer Wanderungen
-- stillschweigend zunichtemachen. Deshalb wird nur gewährt, was ohnehin die
-- Vorgabe wäre, und nur dort, wo noch gar nichts steht.

BEGIN;

-- ── 1. Die Vorgabe gilt künftig auch für die Mandantenrollen ──────────────
--
-- `t001_migrator` ist der heutige Fall. Weitere Mandanten bekommen ihre Zeile
-- vom Bausatz `infrastructure/norns/mandant-anlegen.sh`; diese Wanderung kann
-- Rollen, die es noch nicht gibt, nicht kennen.
DO $$
DECLARE r text;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles
     WHERE rolname ~ '^t[0-9]{3,}_migrator$'
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO warehouse14_app', r);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE ON SEQUENCES TO warehouse14_app', r);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO warehouse14_app', r);
    RAISE NOTICE 'Vorgaberechte gesetzt fuer %', r;
  END LOOP;
END
$$;

-- ── 2. Den Rückstand nachholen ────────────────────────────────────────────
--
-- ⚠️ DIE BEDINGUNG IST „KEIN SELECT", NICHT „GAR KEIN RECHT".
--
-- Der erste Entwurf prüfte auf „gar kein Recht" und liess acht Tabellen
-- zurück, darunter `products`, `cart_items`, `sessions` und
-- `shopper_sessions`. Sie hatten aus einer späteren Wanderung ein UPDATE oder
-- DELETE und fielen deshalb durch die Bedingung, obwohl ihnen SELECT und
-- INSERT fehlten. Eine Anwendung, die Produkte LÖSCHEN darf, sie aber nicht
-- LESEN kann, ist nicht eingeschränkt, sondern kaputt.
--
-- Gegen die laufende Produktion abgeglichen, und das ist hier die Wahrheit:
--
--   • SELECT hat die Anwendung dort auf JEDER Tabelle. Ausnahmslos.
--   • INSERT fehlt ihr auf genau sieben, und zwar mit Absicht:
--     tax_treatment_codes, karat_grades, hallmarks, ledger_events,
--     product_translations, category_translations, payment_commission_rates.
--
-- Alle sieben HABEN SELECT. Sie fallen also nicht unter diese Bedingung, und
-- ihre bewusste Enge bleibt unberührt. Wer hier „kein SELECT" liest, liest
-- „die Vorgabe hat nicht gegriffen", und die Vorgabe war SELECT + INSERT.
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> '_w14_schema_migrations'
       AND NOT has_table_privilege('warehouse14_app', c.oid, 'SELECT')
  LOOP
    -- NUR SELECT. Siehe die Begründung unter dem zweiten Block: ein
    -- pauschales INSERT hätte `ledger_events` geöffnet, und das ist die
    -- Hash-Kette.
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO warehouse14_app', t.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Rechte nachgeholt fuer % Tabellen', n;
END
$$;

-- ── 2b. INSERT: überall, AUSSER auf sieben Tabellen ──────────────────────
--
-- ⚠️ Diese Liste ist eine VERBOTSliste, und das ist hier ausnahmsweise richtig
-- herum. Zwei Entwürfe davor lagen daneben, beide gegen die Produktion
-- gemessen:
--
--   1. `SELECT, INSERT` pauschal im Block oben. Das hätte `ledger_events`
--      geöffnet, also die Hash-Kette, die ausschliesslich ein
--      SECURITY-DEFINER-Auslöser schreiben darf.
--   2. Eine Erlaubnisliste mit neun Namen. Der Abgleich zeigte 44 fehlende
--      Tabellen: die Produktion hat INSERT auf fast allem.
--
-- Die Wirklichkeit ist einfach, wenn man sie misst: die Anwendung darf überall
-- schreiben, AUSSER auf sieben Tabellen. Vier davon sind Stammdaten, zwei sind
-- maschinell erzeugte Übersetzungen, eine ist die Kette.
--
-- Eine Verbotsliste ist hier verantwortbar, weil sie klein, begründet und
-- nachprüfbar ist; eine Erlaubnisliste mit achtzig Namen wäre es nicht.
DO $$
DECLARE t record; n int := 0;
  verboten text[] := ARRAY[
    -- Stammdaten: die Anwendung liest sie, geschrieben werden sie durch
    -- Wanderungen.
    'tax_treatment_codes', 'karat_grades', 'hallmarks',
    -- Maschinell erzeugte Übersetzungen: der Worker schreibt, nicht die API.
    'product_translations', 'category_translations',
    -- DIE KETTE. Nur der SECURITY-DEFINER-Auslöser schreibt hier. Ein INSERT
    -- für die Anwendung wäre ein Weg, an der Kette vorbei zu schreiben.
    'ledger_events',
    -- Was ein Händler an Norns zahlt, ist eine kaufmännische Abmachung (0110).
    'payment_commission_rates'
  ];
BEGIN
  FOR t IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> '_w14_schema_migrations'
       AND NOT (c.relname = ANY(verboten))
  LOOP
    IF NOT has_table_privilege('warehouse14_app', t.oid, 'INSERT') THEN
      EXECUTE format('GRANT INSERT ON TABLE public.%I TO warehouse14_app', t.relname);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'INSERT nachgeholt fuer % Tabellen', n;
END
$$;

-- Dasselbe für Folgen. Der Prüfbericht hielt fest, dass nur 14 von 112
-- Wanderungen sie ausdrücklich gewähren; sie hingen also fast vollständig an
-- der Vorgabe und sind damit dieselbe Falle, nur unauffälliger.
DO $$
DECLARE s record; n int := 0;
BEGIN
  -- ⚠️ Die Rechteprüfung steht IM Schleifenkörper, nicht in der Bedingung.
  --
  -- Steht sie in der WHERE-Klausel, darf der Planer sie VOR dem Filter auf
  -- `relkind` auswerten, und dann trifft `has_sequence_privilege` auf eine
  -- TOAST-Beziehung: „pg_toast_83909 is not a sequence". Genau daran ist der
  -- erste Lauf dieser Wanderung gescheitert.
  FOR s IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'S'
  LOOP
    IF NOT has_sequence_privilege('warehouse14_app', s.oid, 'USAGE') THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE public.%I TO warehouse14_app', s.relname);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Folgen nachgeholt: %', n;
END
$$;

-- ── 3. Und der Wächter, damit es nicht wiederkommt ────────────────────────
--
-- Eine Wanderung, die eine Tabelle anlegt und die Freigabe vergisst, ist in
-- einer NEUEN Datenbank tot und in der alten unauffällig. Diese Prüfung bricht
-- das Einspielen ab, statt es grün durchlaufen zu lassen.
--
-- Ausgenommen ist nur das Wanderungsbuch selbst: es gehört dem Migrator und
-- die Anwendung hat dort nichts zu suchen.
DO $$
DECLARE fehlend text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO fehlend
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> '_w14_schema_migrations'
     AND NOT has_table_privilege('warehouse14_app', c.oid, 'SELECT');
  IF fehlend IS NOT NULL THEN
    RAISE EXCEPTION
      'Die Anwendungsrolle kann diese Tabellen nicht LESEN: %. In einer frischen Datenbank waeren sie unsichtbar, waehrend die laufende Produktion sie sehr wohl liest. Die Wanderung, die sie anlegt, muss SELECT ausdruecklich gewaehren.', fehlend;
  END IF;
END
$$;

COMMIT;

-- ── Zur Prüfung nach dem Einspielen ───────────────────────────────────────
--
--   SELECT count(*) FILTER (WHERE NOT has_table_privilege('warehouse14_app', c.oid, 'SELECT'))
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r';
--   -- erwartet: nur die Tabellen, denen eine Wanderung SELECT bewusst entzogen hat

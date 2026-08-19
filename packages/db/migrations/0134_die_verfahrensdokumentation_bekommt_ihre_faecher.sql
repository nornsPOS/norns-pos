-- ───────────────────────────────────────────────────────────────────────────
-- 0134 — die Verfahrensdokumentation bekommt ihre eigenen Fächer (08.08.2026)
--
-- Rz. 151 GoBD verlangt vom Steuerpflichtigen eine Verfahrensdokumentation,
-- und Rz. 154 verlangt, dass sie dem TATSÄCHLICH eingesetzten Verfahren voll
-- entspricht. Bis heute lieferte diese Kasse dem Prüfer eine ins Programm
-- gebackene Textdatei.
--
-- ── Gemessen am 08.08.2026 ───────────────────────────────────────────────
--
--     docs/Verfahrensdokumentation.md
--       „warehouse14"   11 Treffer      ← ein FREMDES Erzeugnis
--       „Norns"          0 Treffer
--       Stand            08.06.2026     ← fest eingetippt
--       Fassung          v0.4.0         ← tauri.conf.json sagt 0.1.0
--       Migrationsstand  0057 und 0106  ← widersprechen sich, beide falsch
--       Abschnitt 3.1    Docker, Oracle Cloud, Redis, Cloudflare R2
--                        ← diese Kasse ist voll offline
--
-- Ein Prüfer, der dieses Blatt aufschlägt, liest den Namen einer fremden
-- Firma und die Beschreibung einer Anlage, die es hier nicht gibt.
--
-- ── Was diese Wanderung tut ──────────────────────────────────────────────
--
-- Fast alles, was eine Verfahrensdokumentation über den Steuerpflichtigen
-- sagen muss, steht schon einzeln in `system_settings` (Wanderung 0126). Es
-- fehlen genau vier Angaben, die NUR dieses Dokument braucht und die kein
-- Export bisher verlangt hat. Sie werden hier angelegt — LEER.
--
-- ⚠️ Kein Wert. Wanderung 0123 musste eine erfundene USt-IdNr. wieder
-- ausbauen, die auf Produktion gedruckt hatte. Ein Platzhalter erzeugt ein
-- Dokument, das VOLLSTÄNDIG AUSSIEHT und den falschen Menschen benennt.
-- Ein leeres Feld erscheint im PDF sichtbar als offene Angabe.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO system_settings (key, value) VALUES
  -- ── Wer die Aufzeichnungen verantwortet ────────────────────────────────
  -- Rz. 21 GoBD: die Verantwortung für die Ordnungsmässigkeit bleibt beim
  -- Steuerpflichtigen, auch wenn er Aufgaben auslagert. Das Dokument muss
  -- den Menschen benennen, nicht die Rolle.
  ('betrieb.verantwortlich_aufzeichnungen', '""'::jsonb),

  -- ── Wer nach § 7 GwG bestellt ist ──────────────────────────────────────
  -- Der Edelmetallhandel fällt unter § 2 Abs. 1 Nr. 16 GwG. Wer keinen
  -- Beauftragten bestellt hat, lässt das Feld leer — das ist eine ehrliche
  -- Aussage und keine Lücke im Dokument.
  ('betrieb.geldwaeschebeauftragter', '""'::jsonb),

  -- ── Seit wann diese Kasse im Einsatz ist ───────────────────────────────
  -- Bei einer Kassennachschau nach § 146b AO eine der ersten Fragen. Als
  -- Datum im Format JJJJ-MM-TT.
  ('betrieb.inbetriebnahme_am', '""'::jsonb),

  -- ── Wo die Sicherungen liegen ──────────────────────────────────────────
  -- § 147 Abs. 1 AO verlangt zehn Jahre Aufbewahrung, Rz. 103 ff. GoBD
  -- verlangt die Beschreibung des Sicherungsverfahrens. Die Kasse kennt
  -- ihren eigenen Sicherungslauf, aber nicht, wohin der Inhaber die Kopien
  -- trägt. Das weiss nur er.
  ('betrieb.sicherungsort', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Die Selbstprüfung, nach dem Muster von 0126 ──────────────────────────
DO $$
DECLARE
  fehlend TEXT;
  gefuellt INT;
BEGIN
  SELECT string_agg(k, ', ') INTO fehlend
    FROM unnest(ARRAY[
      'betrieb.verantwortlich_aufzeichnungen',
      'betrieb.geldwaeschebeauftragter',
      'betrieb.inbetriebnahme_am',
      'betrieb.sicherungsort'
    ]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM system_settings s WHERE s.key = k);

  IF fehlend IS NOT NULL THEN
    RAISE EXCEPTION '0134: diese Schluessel wurden nicht angelegt: %', fehlend;
  END IF;

  -- ⚠️ Die Gegenprobe zur eigenen Absicht: kein neu angelegter Schlüssel
  -- darf einen Wert tragen. Der Wächter, der die Doktrin überlebt.
  SELECT count(*) INTO gefuellt
    FROM system_settings
   WHERE key IN ('betrieb.verantwortlich_aufzeichnungen',
                 'betrieb.geldwaeschebeauftragter',
                 'betrieb.inbetriebnahme_am',
                 'betrieb.sicherungsort')
     AND value <> '""'::jsonb
     -- Ein Stand, auf dem der Inhaber sie schon eingetragen hat, ist in
     -- Ordnung: ON CONFLICT DO NOTHING hat ihn nicht angefasst.
     AND created_at >= now() - interval '1 minute';

  IF gefuellt > 0 THEN
    RAISE EXCEPTION '0134: % neu angelegte Schluessel tragen einen Wert — '
      'eine Wanderung darf keine Haendlerdaten saeen', gefuellt;
  END IF;
END $$;

COMMIT;

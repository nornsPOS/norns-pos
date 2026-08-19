-- ───────────────────────────────────────────────────────────────────────────
-- 0126 — die Stammdaten des Händlers bekommen eigene Felder (28.07.2026)
--
-- Die DSFinV-K verlangt in `cashpointclosing.csv` die Angaben zum
-- Steuerpflichtigen EINZELN: Firmenname, Strasse, Postleitzahl, Ort,
-- Länderkennzeichen und Steuernummer beziehungsweise USt-IdNr. Ein Prüfer
-- ordnet das Paket sonst keinem Steuerpflichtigen zu.
--
-- ── Auf Romans Produktion gemessen (28.07.2026) ──────────────────────────
--
--     shop.name           ""                       ← LEER
--     shop.address_line1  "Rosenstraße 40"
--     shop.address_line2  "73614 Schorndorf"       ← PLZ und Ort in EINEM Feld
--     shop.vat_id         "DE343451090"
--     shop.tax_number     — gibt es nicht —
--     Postleitzahl, Ort, Land, Land-Kennzeichen — gibt es nicht —
--     datev.beraternummer, datev.mandantennummer  — gibt es nicht —
--
-- Die letzten beiden sind der Grund, warum bis heute NULL Buchungsstapel
-- erzeugt wurden: ohne sie sperrt der Export, und zwar zu Recht.
--
-- ── Was diese Wanderung ausdrücklich NICHT tut ───────────────────────────
--
-- Sie trägt KEINEN Wert ein. Nicht Romans Namen, nicht seine Anschrift, und
-- schon gar keine erfundene Steuernummer.
--
-- Zwei Gründe, und beide sind hier schon einmal teuer geworden:
--
--   1. Mandantenneutralität (KOORDINATION §7). Die Bausubstanz gehört keinem
--      Händler. Wanderung 0044 säte einmal `DE123456789` als „PROVISIONAL",
--      und jeder künftige Mandant hätte eine ERFUNDENE Steuerkennung auf
--      seinem ersten Beleg getragen. 0123 hat das wieder ausgebaut.
--   2. Erfinden statt Sperren. Ein leeres Feld sperrt den Export mit einer
--      ehrlichen Meldung. Ein gefülltes Feld mit einem Platzhalter erzeugt
--      ein Paket, das VOLLSTÄNDIG AUSSIEHT und falsch ist.
--
-- Die Werte trägt der Inhaber ein. Diese Wanderung legt nur die Fächer an.
--
-- ── Und warum die Anschrift nicht automatisch geteilt wird ───────────────
--
-- „73614 Schorndorf" liesse sich mit einem Muster in Postleitzahl und Ort
-- zerlegen. Bei „Rosenstraße 40" ginge es auch noch. Bei „Am Alten Markt 3a,
-- Hinterhaus" nicht mehr, und bei einer österreichischen oder Schweizer
-- Anschrift erst recht nicht.
--
-- Eine Zerlegung, die in neun von zehn Fällen stimmt, ist für eine
-- Steuererklärung wertlos: der zehnte Fall fällt niemandem auf, bis ein
-- Prüfer danach fragt. Der Inhaber tippt die Felder EINMAL, und dann stimmen
-- sie.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- Die Fächer, alle LEER. `''::jsonb` ist der leere String, nicht NULL —
-- damit ein Leser den Unterschied zwischen „nie angelegt" und „bewusst leer"
-- gar nicht erst braucht: leer ist leer, und leer sperrt.
INSERT INTO system_settings (key, value) VALUES
  -- ── Der Steuerpflichtige, wie ihn die DSFinV-K in cashpointclosing will ──
  ('shop.legal_name',   '""'::jsonb),   -- Firmenname, vollständig und rechtlich
  ('shop.street',       '""'::jsonb),   -- Strasse und Hausnummer
  ('shop.postal_code',  '""'::jsonb),   -- Postleitzahl, getrennt
  ('shop.city',         '""'::jsonb),   -- Ort, getrennt
  ('shop.country_code', '""'::jsonb),   -- ISO 3166-1 alpha-3, z. B. DEU
  ('shop.tax_number',   '""'::jsonb),   -- Steuernummer (§ 14 Abs. 4 Nr. 2 UStG)
  -- ── Die zwei Ordnungsnummern des Steuerberaters ────────────────────────
  -- Ohne sie erzeugt der DATEV-Export nichts. Das ist ABSICHT: sie erzwingen
  -- das Gespräch mit dem Menschen, der die Buchführung verantwortet.
  ('datev.beraternummer',    '""'::jsonb),
  ('datev.mandantennummer',  '""'::jsonb),
  -- ── Die Kasse selbst, für cashregister.csv ─────────────────────────────
  -- Marke und Modell sind Erzeugnisangaben und stehen im Code. Die
  -- Seriennummer gehört dem Gerät und damit dem Händler.
  ('kasse.seriennummer', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE system_settings IS
  'Einstellungen je Mandant. ⚠️ Wanderungen legen hier SCHLÜSSEL an, niemals '
  'WERTE eines einzelnen Händlers — siehe 0123 und 0126. Ein leeres Feld '
  'sperrt den zugehörigen Export mit ehrlicher Meldung; ein Platzhalter '
  'erzeugte ein Paket, das vollständig aussieht und falsch ist.';

-- ── Die Selbstprüfung ────────────────────────────────────────────────────
DO $$
DECLARE
  fehlend TEXT;
  gefuellt INT;
BEGIN
  SELECT string_agg(k, ', ') INTO fehlend
    FROM unnest(ARRAY[
      'shop.legal_name','shop.street','shop.postal_code','shop.city',
      'shop.country_code','shop.tax_number','datev.beraternummer',
      'datev.mandantennummer','kasse.seriennummer'
    ]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM system_settings s WHERE s.key = k);

  IF fehlend IS NOT NULL THEN
    RAISE EXCEPTION '0126: diese Schluessel wurden nicht angelegt: %', fehlend;
  END IF;

  -- ⚠️ Und die Gegenprobe zur eigenen Absicht: KEINER der neuen Schlüssel
  -- darf einen Wert tragen. Eine Wanderung, die still einen Händlerwert
  -- einträgt, ist genau der Fehler, den 0123 ausbauen musste.
  SELECT count(*) INTO gefuellt
    FROM system_settings
   WHERE key IN ('shop.legal_name','shop.street','shop.postal_code','shop.city',
                 'shop.country_code','shop.tax_number','datev.beraternummer',
                 'datev.mandantennummer','kasse.seriennummer')
     AND value <> '""'::jsonb
     -- Ein Stand, auf dem der Inhaber sie SCHON eingetragen hat, ist in
     -- Ordnung: ON CONFLICT DO NOTHING hat ihn nicht angefasst.
     AND created_at >= now() - interval '1 minute';

  IF gefuellt > 0 THEN
    RAISE EXCEPTION '0126: % neu angelegte Schluessel tragen einen Wert — '
      'eine Wanderung darf keine Haendlerdaten saeen', gefuellt;
  END IF;
END $$;

COMMIT;

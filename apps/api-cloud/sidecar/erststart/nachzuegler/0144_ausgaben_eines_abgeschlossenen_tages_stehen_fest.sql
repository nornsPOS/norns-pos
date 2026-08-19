-- ═════════════════════════════════════════════════════════════════════════
--  0144 — Betriebsausgaben eines FESTGESCHRIEBENEN Tages stehen fest
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── DER FUND DER BOESWILLIGEN PRUEFUNG (19.08.2026) ──────────────────────
--
-- `operating_expenses` liess sich frei auf einen laengst abgeschlossenen
-- Geschaeftstag buchen — und eine bestehende Zeile liess sich in Betrag,
-- Datum und Zahlweg nachtraeglich aendern. Weder Trigger noch Route hielt
-- das an.
--
-- Die Folge trifft zwei Papiere, die ein Pruefer als unveraenderlich
-- ansieht: der KASSENBERICHT des Tages rechnet die BAR bezahlten Ausgaben
-- mit (sie bewegen die Lade), und der DATEV-Stapel desselben Tages bucht
-- sie. Beide aendern sich damit RUECKWIRKEND, nachdem der Z-Bon gesetzt
-- und womoeglich exportiert war. Genau das verbietet § 146 Abs. 4 AO:
-- eine Aufzeichnung darf nicht so veraendert werden, dass der urspruengliche
-- Inhalt nicht mehr feststellbar ist.
--
-- ── DIE MECHANIK IST NICHT NEU ───────────────────────────────────────────
--
-- Fuer `transactions` steht dieser Waechter seit 0013 (Arm 1) und wurde in
-- 0118 verfeinert. Hier ist dasselbe fuer die Ausgaben: gleiche Bauart,
-- gleicher Fehlercode, gleiche Sprache.
--
-- ── WAS DER HAENDLER STATTDESSEN TUT ─────────────────────────────────────
--
-- Eine Korrektur laeuft als GEGENZEILE auf den offenen Tag. Das ist kein
-- Umweg, sondern die Buchhaltung selbst: was einmal im Abschluss stand,
-- bleibt dort, und die Berichtigung ist sichtbar. Der Dateikopf von
-- `routes/expenses.ts` nennt dieses Muster schon („keine DELETE-Route:
-- Korrekturen sind ein UPDATE oder eine neue Gegenzeile").
--
-- ⚠️ Der Waechter prueft bei einer AENDERUNG BEIDE Tage: den alten und den
-- neuen. Sonst liesse sich eine Zeile von einem offenen Tag auf einen
-- abgeschlossenen schieben — oder aus einem abgeschlossenen heraus, was den
-- Bericht dieses Tages genauso veraendert.

CREATE OR REPLACE FUNCTION ausgabe_gehoert_in_einen_offenen_tag()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  tag DATE;
BEGIN
  -- Der Tag, auf den geschrieben werden soll.
  tag := NEW.business_day;
  IF EXISTS (
    SELECT 1 FROM daily_closings dc
     WHERE dc.business_day = tag
       AND dc.state = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION
      'Abschluss-Waechter: der Geschaeftstag % ist festgeschrieben; eine Betriebsausgabe kann dort nicht mehr gebucht oder geaendert werden (§ 146 Abs. 4 AO). Bitte als Gegenzeile auf den offenen Tag buchen.',
      tag
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bei einer Aenderung zaehlt auch der Tag, VON dem die Zeile wegwandert:
  -- sein Bericht wuerde sich sonst ebenso nachtraeglich aendern.
  IF TG_OP = 'UPDATE' AND OLD.business_day IS DISTINCT FROM NEW.business_day THEN
    IF EXISTS (
      SELECT 1 FROM daily_closings dc
       WHERE dc.business_day = OLD.business_day
         AND dc.state = 'FINALIZED'
    ) THEN
      RAISE EXCEPTION
        'Abschluss-Waechter: der Geschaeftstag % ist festgeschrieben; eine dort gebuchte Betriebsausgabe kann nicht mehr wegbewegt werden (§ 146 Abs. 4 AO).',
        OLD.business_day
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ausgabe_offener_tag ON operating_expenses;
CREATE TRIGGER trg_ausgabe_offener_tag
  BEFORE INSERT OR UPDATE ON operating_expenses
  FOR EACH ROW
  EXECUTE FUNCTION ausgabe_gehoert_in_einen_offenen_tag();

COMMENT ON FUNCTION ausgabe_gehoert_in_einen_offenen_tag() IS
  'Haelt Betriebsausgaben aus festgeschriebenen Geschaeftstagen heraus (Kassenbericht und '
  'DATEV-Stapel des Tages wuerden sich sonst rueckwirkend aendern). Gleiche Bauart wie der '
  'Transaktions-Waechter aus 0013/0118. Fund der boeswilligen Pruefung vom 19.08.2026.';

-- ═════════════════════════════════════════════════════════════════════════
--  Und zwei Indexe, die dieselbe Pruefung gefunden hat
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── DIE STORNO-AUSWAHL LAS DIE GANZE TABELLE ─────────────────────────────
--
-- „Beleg nachtraeglich stornieren" fragt: alle VERKAEUFE der letzten 24
-- Stunden, neueste zuerst, dreissig Stueck. Alle vorhandenen Indexe auf
-- `transactions` liegen aber ueber `berlin_business_day(finalized_at)` —
-- eine FUNKTION. Eine Bedingung auf dem ROHEN `finalized_at` kann sie nicht
-- benutzen: Postgres las die groesste Fiskaltabelle des Hauses von vorn bis
-- hinten, bei jedem Oeffnen der Flaeche. Auf einer jungen Kasse faellt das
-- nicht auf; nach zwei Jahren Belegen steht die Kassiererin davor.
--
-- Der Index deckt Bedingung UND Sortierung ab, damit die dreissig Zeilen ein
-- Randgriff werden statt eines Scans.

CREATE INDEX IF NOT EXISTS transactions_direction_finalized_at_idx
  ON transactions (direction, finalized_at DESC);

COMMENT ON INDEX transactions_direction_finalized_at_idx IS
  'Fuer die Storno-Auswahl (Richtung + 24-Stunden-Fenster auf dem ROHEN finalized_at, '
  'absteigend). Die funktionalen Indexe ueber berlin_business_day() greifen dort nicht. '
  'Fund der boeswilligen Pruefung vom 19.08.2026.';

-- ── UND DIE AUSGABEN NACH TAG UND ZAHLWEG ────────────────────────────────
--
-- Beide Exportwege fragen `operating_expenses` nach Tag und Zahlweg (der
-- Tagesstapel nach BAR, der Fremdbeleg-Export nach BANK und KARTE). Der
-- vorhandene Index traegt nur den Tag; der Zahlweg fiel als Nachfilter an.
-- Bei einer Kasse mit Jahren an Ausgaben ist das der Unterschied zwischen
-- einem Griff und einem Durchgang.

CREATE INDEX IF NOT EXISTS operating_expenses_tag_zahlweg_idx
  ON operating_expenses (business_day, zahlweg);

COMMENT ON INDEX operating_expenses_tag_zahlweg_idx IS
  'Deckt beide Exportfragen ab: Tagesstapel (BAR) und Fremdbelege (BANK, KARTE).';

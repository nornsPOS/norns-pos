-- ════════════════════════════════════════════════════════════════════════
--  0133 — Eine Ausgabe weiss, WOMIT sie bezahlt wurde
-- ════════════════════════════════════════════════════════════════════════
--
--  ── DER BEFUND VOM 06.08.2026 ───────────────────────────────────────────
--
--  Die Tiefenprüfung der Steuer-Ausfuhr meldete, Bar-Betriebsausgaben
--  erreichten keine der drei Ausfuhren. Beim Nachmessen zeigte sich etwas
--  anderes und Schlimmeres: `operating_expenses` hat GAR KEINE Zahlungsart.
--
--  Eine Betriebsausgabe fehlt also nicht im Kassenbuch — sie KANN nicht
--  hinein, weil niemand festhält, dass sie bar bezahlt wurde. Wer Porto aus
--  der Lade zahlt, hat eine Ausgabe in der Liste und einen Fehlbetrag in der
--  Schublade, und nichts verbindet die beiden.
--
--  Basel am 06.08.2026 auf die Frage, ob das Feld kommen soll: „نعم".
--
--  ── ⚠️ DIE ENTSCHEIDUNG, DIE DIESE WANDERUNG TRÄGT ──────────────────────
--
--  Bestehende Zeilen bekommen `UNBEKANNT`, NICHT `BAR`.
--
--  Sie wurden erfasst, bevor jemand nach der Zahlart gefragt hat. Sie
--  nachträglich als bar zu buchen hiesse, aus jeder alten Ausgabe eine
--  Entnahme aus der Lade zu machen — und damit jeden alten Kassenbericht
--  rückwirkend um Beträge zu ändern, die niemand so gemeint hat. Das wäre
--  eine erfundene Zahl in einem festgeschriebenen Zeitraum.
--
--  Die Kassenrechnung zählt deshalb NUR `BAR`. `UNBEKANNT` bleibt sichtbar
--  und unbeziffert, bis der Händler es selbst nachträgt.
--
--  ── WARUM EIN EIGENES VOKABULAR ─────────────────────────────────────────
--
--  `payment_method` ist die Zahlart einer EINNAHME und trägt Werte wie
--  `TRADE_IN`, `DEBT`, `EBAY`, `VOUCHER`. Keiner davon ergibt für eine
--  Ausgabe einen Sinn. Ein geteiltes Vokabular hätte eine Auswahlliste
--  erzeugt, in der die Hälfte Unsinn ist, und früher oder später hätte jemand
--  eine Ausgabe als „Gutschein" gebucht.

CREATE TYPE public.ausgabe_zahlweg AS ENUM (
    -- Aus der Lade. NUR dieser Wert bewegt den Kassenbestand.
    'BAR',
    -- Überweisung, Lastschrift, Dauerauftrag.
    'BANK',
    -- Firmenkarte.
    'KARTE',
    -- Vor dem 06.08.2026 erfasst, also nie gefragt. Kein Rateweg.
    'UNBEKANNT'
);

ALTER TABLE public.operating_expenses
  ADD COLUMN IF NOT EXISTS zahlweg public.ausgabe_zahlweg NOT NULL DEFAULT 'UNBEKANNT';

COMMENT ON COLUMN public.operating_expenses.zahlweg IS
  'Womit die Ausgabe bezahlt wurde. NUR BAR bewegt den Kassenbestand und '
  'erscheint in der Kassenbericht-Rechnung. UNBEKANNT sind Zeilen aus der '
  'Zeit vor dem 06.08.2026, in der die Frage nicht gestellt wurde; sie werden '
  'ausdruecklich NICHT als bar geraten.';

-- Der Kassenbericht liest je Geschäftstag und Zahlweg. Ohne diesen Griff
-- läuft er bei jedem Abruf über die ganze Tabelle.
CREATE INDEX IF NOT EXISTS operating_expenses_tag_zahlweg_idx
  ON public.operating_expenses (business_day, zahlweg);

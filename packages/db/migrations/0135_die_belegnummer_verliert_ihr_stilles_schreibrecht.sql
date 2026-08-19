-- ════════════════════════════════════════════════════════════════════════
--  0135 — Die Belegnummer verliert ihr stilles Schreibrecht
-- ════════════════════════════════════════════════════════════════════════
--
--  ── DER BEFUND VOM 11.08.2026 (Befund 10, nachgemessen) ─────────────────
--
--  Wanderung 0009 vergab der Anwendungsrolle `warehouse14_app` ein
--  spaltenweises UPDATE auf `transactions.receipt_locator`, kommentiert mit
--  „TSE may rewrite if Fiskaly assigns". Dieser Umschreiber wurde nie
--  gebaut: KEIN Aufrufer im Haus schreibt die Spalte (gemessen ueber
--  `apps/api-cloud/src` und `apps/worker/src`; `shipping.ts` schreibt
--  andere Spalten). Die fiskaly-Kennungen leben laengst in
--  `tse_signatures`, nicht im Belegkopf.
--
--  Damit war die Belegnummer die EINZIGE fiskalisch tragende Spalte mit
--  einem stehenden Schreibrecht — `total_eur`, `finalized_at` und die
--  uebrigen tragen nur INSERT und SELECT. Kein Ausloeser zeichnet eine
--  Aenderung an ihr auf. Nach § 146 Abs. 4 AO muss eine Aenderung
--  feststellbar bleiben: ein Recht ohne Spur ist kein Riegel, sondern eine
--  Beobachtung, die darauf wartet, dass jemand sie benutzt.
--
--  ── ⚠️ WARUM DER NAHELIEGENDE WEG FALSCH WAERE ──────────────────────────
--
--  Ein `REVOKE UPDATE ON transactions` auf TABELLENEBENE risse die
--  spaltenweisen Vergaben aus 0009, 0018 und 0019 mit (printed_at,
--  Versandspalten, GwG-Markierungen, shift_id): die Kasse koennte keinen
--  Beleg mehr als gedruckt markieren und kein Paket mehr versenden. Das
--  ist die bekannte Spaltenrechte-Falle des Hauses, nur andersherum.
--  Entzogen wird deshalb GENAU EINE Spalte, und der Block darunter beweist
--  beim Einspielen, dass die Nachbarn ihre Rechte behalten haben.
--
--  Die Vergabe BEIM ANLEGEN bleibt unberuehrt: INSERT auf `transactions`
--  deckt weiterhin alle Spalten, und `receipt_locator_seq` bleibt nutzbar.
--  Eine von aussen vergebene Kennung gehoert an den Beleg beim Anlegen,
--  nicht per Umschreiben danach.
--
--  ── WAS DER WAECHTER MISST ──────────────────────────────────────────────
--
--  `apps/api-cloud/tests/integration/belegnummer-schreibrecht-ist-entzogen`
--  klopft nach dem Einspielen ALLER Wanderungen als die Anwendungsrolle
--  selbst an: der Umschreibeversuch faellt mit 42501, jede Nachbarspalte
--  bleibt schreibbar, und ein vollstaendiger Beleg (mit und ohne
--  ausdrueckliche Belegnummer) entsteht weiter. Der Einheitswaechter
--  `column-grants-cover-writes` liest seit heute auch REVOKE und pinnt
--  den Zustand nach dieser Wanderung fest.

BEGIN;

REVOKE UPDATE (receipt_locator) ON public.transactions FROM warehouse14_app;

-- ── Der Beweis beim Einspielen: eine Spalte entzogen, keine mitgerissen ──
DO $$
DECLARE
  verlorene text;
BEGIN
  IF has_column_privilege('warehouse14_app', 'public.transactions',
                          'receipt_locator', 'UPDATE') THEN
    RAISE EXCEPTION
      'transactions.receipt_locator traegt weiterhin ein UPDATE-Recht fuer '
      'warehouse14_app. Der Entzug hat nicht gegriffen — vermutlich haelt '
      'eine spaetere Vergabe oder eine Tabellenvergabe das Recht offen.';
  END IF;

  -- Die Nachbarn aus 0009, 0018 und 0019 muessen ihre Rechte BEHALTEN.
  SELECT string_agg(s.spalte, ', ' ORDER BY s.spalte) INTO verlorene
    FROM unnest(ARRAY[
      'printed_at', 'notes_internal', 'updated_at',
      'shipping_status', 'shipping_carrier', 'tracking_number',
      'suspicious_aml_flag', 'suspicious_aml_reason',
      'suspicious_flagged_by_user_id',
      'receipt_declined_at', 'receipt_emailed_at',
      'returned_at', 'shift_id'
    ]) AS s(spalte)
   WHERE NOT has_column_privilege('warehouse14_app', 'public.transactions',
                                  s.spalte, 'UPDATE');
  IF verlorene IS NOT NULL THEN
    RAISE EXCEPTION
      'Der Entzug der Belegnummer hat Nachbarspalten mitgerissen: %. '
      'Die Kasse koennte diese Spalten nicht mehr schreiben — Abbruch.',
      verlorene;
  END IF;

  -- Und das ANLEGEN darf nicht sterben: INSERT deckt die Spalte weiter,
  -- die Folge fuer die Vorgabe-Nummer bleibt nutzbar.
  IF NOT has_column_privilege('warehouse14_app', 'public.transactions',
                              'receipt_locator', 'INSERT') THEN
    RAISE EXCEPTION
      'transactions.receipt_locator ist fuer warehouse14_app nicht mehr '
      'einfuegbar — die Vergabe beim Anlegen waere tot. Abbruch.';
  END IF;
  IF NOT has_sequence_privilege('warehouse14_app',
                                'public.receipt_locator_seq', 'USAGE') THEN
    RAISE EXCEPTION
      'receipt_locator_seq ist fuer warehouse14_app nicht mehr nutzbar — '
      'die Vorgabe-Belegnummer waere tot. Abbruch.';
  END IF;
END
$$;

COMMIT;

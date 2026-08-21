/**
 * DayControl — die Leiste der Werkstatt zur laufenden SCHICHT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ DIESE LEISTE SCHALTET DIE SCHICHT — NICHT DEN KASSENTAG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER NACHGEMESSENE BEFUND VOM 13.08.2026 ────────────────────────────────
 *
 * Hier stand bei offener Schicht der Knopf „Tag abschließen". Er führt nach
 * `/kasse`, und dort wartet der SCHICHTSCHLUSS (`shiftsApi.close`,
 * `screens/kasse/ZBonDialog.tsx:124`) — die Blindzählung der Lade.
 *
 * Der Abschluss des Kassentags ist ein anderer Vorgang: `closingsApi.finalize`
 * (`screens/kasse/TagesabschlussDialog.tsx:148`). Erst er schreibt die Zeile in
 * `daily_closings`, aus der Kassenbericht, DATEV und DSFinV-K entstehen
 * (§ 146 Abs. 1 Satz 2 AO).
 *
 * Genau diese Verwechslung liess den Händler abends mit einem NICHT
 * abgeschlossenen Kassentag nach Hause gehen. Sie an der Kasse zu richten und
 * hier stehen zu lassen, hätte die Lüge nur verschoben.
 *
 * Deshalb spricht diese Leiste jetzt durchgängig von der SCHICHT, und die
 * offene Schicht sagt ausdrücklich, dass der Tagesabschluss danach noch
 * aussteht. Der Wächter `screens/kasse/schichtschluss-ist-kein-tagesabschluss`
 * misst alle Flächen und lässt „Tag abschließen" nur dort zu, wo der Kassentag
 * wirklich gebucht wird.
 */

import { useNavigate } from 'react-router-dom';

import { Button } from '@norns/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';

export function DayControl(): JSX.Element | null {
  const navigate = useNavigate();
  const { data: shift, isLoading, isError, refetch, isFetching } = useCurrentShift();

  // The shift could not be fetched — DO NOT fall through to "Tag noch nicht
  // eröffnet" (a shift may well be open; we just can't see it). Say so honestly.
  if (isError && shift === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
        <span style={{ color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-text)' }}>
          Schichtstatus nicht abrufbar.
        </span>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Lädt…' : 'Erneut versuchen'}
        </Button>
      </div>
    );
  }

  // First load — stay invisible rather than flash a wrong state.
  if (isLoading && shift === undefined) return null;

  const open = shift !== null && shift !== undefined;
  const since = open
    ? new Date(shift.openedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;

  /*
   * ── EIN KNOPF, KEINE KISTE (21.08.2026, Basels Anweisung) ────────────────
   *
   * Hier stand eine Karte mit Seitenstreifen, einem grünen Leuchtpunkt, zwei
   * Textzeilen UND dem Knopf — „صندوق داخل مستطيل"، wörtlich. Der Zustand der
   * Schicht steht ohnehin dauerhaft in der Fusszeile (WerkstattFooter); diese
   * Stelle ist die HANDLUNG, nicht die Anzeige. Also genau ein Knopf, und bei
   * offener Schicht eine leise Zeile mit dem, was der Knopf NICHT tut
   * (der Tagesabschluss ist ein anderer Vorgang, siehe Kopf dieser Datei).
   */
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--w14-abstand-12)',
        flexWrap: 'wrap',
      }}
    >
      <Button variant="primary" size="md" onClick={() => navigate('/kasse')}>
        {open ? 'Schicht abschließen' : 'Schicht öffnen'}
      </Button>
      {open && (
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
          Offen seit {since} Uhr. Der Tagesabschluss folgt in der Tageskasse.
        </span>
      )}
    </div>
  );
}

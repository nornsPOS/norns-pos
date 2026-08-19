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

import { Button, ParchmentCard } from '@norns/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';

export function DayControl(): JSX.Element | null {
  const navigate = useNavigate();
  const { data: shift, isLoading, isError, refetch, isFetching } = useCurrentShift();

  // The shift could not be fetched — DO NOT fall through to "Tag noch nicht
  // eröffnet" (a shift may well be open; we just can't see it). Say so honestly.
  if (isError && shift === undefined) {
    return (
      <ParchmentCard
        tone="parchment"
        padding="md"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          borderLeft: '3px solid var(--w14-wax-red)',
        }}
      >
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-grund)' }}>
          Schichtstatus nicht abrufbar. Verbindung prüfen.
        </span>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Lädt…' : 'Erneut versuchen'}
        </Button>
      </ParchmentCard>
    );
  }

  // First load — stay invisible rather than flash a wrong state.
  if (isLoading && shift === undefined) return null;

  const open = shift !== null && shift !== undefined;
  const since = open
    ? new Date(shift.openedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <ParchmentCard
      tone="parchment"
      padding="md"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        borderLeft: `3px solid ${open ? 'var(--w14-verdigris)' : 'var(--w14-gold)'}`,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: open ? 'var(--w14-verdigris)' : 'var(--w14-gold)',
          }}
        />
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-lead)' }}>
          {open ? 'Schicht läuft' : 'Keine Schicht offen'}
        </span>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
          {open
            ? `seit ${since} Uhr · Der Tagesabschluss folgt danach in der Tageskasse.`
            : 'Schicht öffnen, um Verkauf und Ankauf zu starten.'}
        </span>
      </div>
      <Button variant="primary" size="md" onClick={() => navigate('/kasse')}>
        {open ? 'Schicht abschließen' : 'Schicht öffnen'}
      </Button>
    </ParchmentCard>
  );
}

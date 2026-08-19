/**
 * Persistent footer — the salon counter readout.
 *
 *   N° XLVII · Heute · Schicht offen · €4.231,42
 *
 * Always reads from the dashboard summary (so it stays consistent with
 * the tiles above). Shift status renders as ink-aged when closed,
 * gold when open, wax-red when missing.
 */

import { MoneyAmount, RomanIndex } from '@norns/ui-kit';

export interface WerkstattFooterProps {
  currentShiftId: string | null;
  revenueEur: string;
  /** Monotonic counter — the daily transaction tally, lifted from useDashboardSummary. */
  counterValue: number;
}

export function WerkstattFooter({
  currentShiftId,
  revenueEur,
  counterValue,
}: WerkstattFooterProps): JSX.Element {
  // ── DEUTSCH, AUCH IN DER FUSSZEILE (26.07.2026) ─────────────────────────
  // Hier stand „Shift OPEN" beziehungsweise „Shift -". Beim ersten Blick auf
  // die laufende Kasse war es die einzige englische Stelle des Bildschirms,
  // und sie steht in der Zeile, die den ganzen Tag sichtbar bleibt.
  // Der Bindestrich sagte ausserdem nichts: er ist kein Zustand, sondern eine
  // Auslassung. Der Kassierer soll lesen, ob seine Schicht offen ist.
  const shiftLabel = currentShiftId ? 'Schicht offen' : 'Keine Schicht';
  const shiftColor = currentShiftId ? 'var(--w14-gold)' : 'var(--w14-ink-faded)';

  return (
    <footer
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--w14-parchment-2)',
        borderTop: '1px solid var(--w14-rule)',
        padding: 'var(--space-3) var(--space-7)',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        fontFamily: 'var(--w14-font-display)',
        fontSize: 'var(--w14-schrift-betont)',
        color: 'var(--w14-ink-aged)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <RomanIndex value={counterValue || 1} tone="ink" />
        <span style={{ color: 'var(--w14-ink-faded)' }}>Heute</span>
      </div>
      <div
        style={{
          color: shiftColor,
          fontVariant: 'all-small-caps',
          letterSpacing: '0.12em',
        }}
      >
        {shiftLabel}
      </div>
      <div style={{ justifySelf: 'end' }}>
        <MoneyAmount valueEur={revenueEur} emphasis />
      </div>
    </footer>
  );
}

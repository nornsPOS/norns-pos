/**
 * Übersicht panel — the 6-tile dashboard cluster on the Werkstatt left column.
 *
 * Each tile is a self-contained presentational element. The PARENT
 * (`UebersichtPanel`) holds the dashboard summary; the tiles never read
 * from the store directly. This keeps re-render scopes tight: when the
 * summary refreshes, only the tile whose value actually changed is touched
 * — React's reconciliation sees identical props on the others.
 *
 * Attention rules (memory.md §10):
 *   • `tasksOverdue > 0`         → red dot + caption "Überfällig"
 *   • `workerDlqUnacked > 0`     → not its own tile (too rare), shown in worker strip
 *   • Everything else 0          → grey-out the value, no dot
 */

import { Button, Zwischentitel, ParchmentCard, StatTile } from '@norns/ui-kit';

import type { DashboardSummary } from '@norns/api-client';

import { EinrichtungCard } from './EinrichtungCard.js';

export interface UebersichtPanelProps {
  data: DashboardSummary | undefined;
  isLoading: boolean;
  /** The summary request failed and we have no cached data to fall back on. */
  isError?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  /** Thin-rail mode: tighter 2-column tile grid for the Werkstatt left column. */
  compact?: boolean;
}

export function UebersichtPanel({
  data,
  isLoading,
  isError = false,
  onRetry,
  retrying = false,
  compact = false,
}: UebersichtPanelProps): JSX.Element {
  const placeholder = isLoading || data === undefined;
  const columns = compact ? 2 : 3;

  // Honest failure: don't sit on "Lädt…" forever or render zeros as if the day
  // were quiet — say the figures aren't retrievable and offer a retry.
  if (isError) {
    return (
      <section aria-label="Übersicht">
        <PanelHeading label="Übersicht" sublabel="Nicht abrufbar" />
        <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
          <p
            style={{
              margin: '0 0 var(--space-3)',
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-display)',
            }}
          >
            Kennzahlen sind derzeit nicht abrufbar. Verbindung prüfen.
          </p>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? 'Lädt…' : 'Erneut versuchen'}
            </Button>
          )}
        </ParchmentCard>
      </section>
    );
  }

  return (
    <section aria-label="Übersicht">
      {/* ⚠️ VOR den Kennzahlen. Solange die Kasse nicht verkaufen kann, ist
          jede Zahl darunter eine Null, die nichts bedeutet — und der Grund
          dafür soll nicht erst beim Bezahlen auffallen. Die Karte verschwindet
          von selbst, sobald nichts mehr offen ist. */}
      <EinrichtungCard />
      <PanelHeading label="Übersicht" sublabel={placeholder ? 'Lädt…' : 'Heute · Stand jetzt'} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: compact ? 'var(--space-2)' : 'var(--space-4)',
        }}
      >
        <StatTile
          index={1}
          value={placeholder ? '-' : data!.openTasksMine}
          label="Meine Aufgaben"
        />
        <StatTile
          index={2}
          value={placeholder ? '-' : data!.tasksDueToday}
          label="Heute fällig"
          attention={!placeholder && data!.tasksDueToday > 0}
          attentionCaption="Heute erledigen."
        />
        <StatTile
          index={3}
          value={placeholder ? '-' : data!.tasksOverdue}
          label="Überfällig"
          attention={!placeholder && data!.tasksOverdue > 0}
          attentionCaption="Sofortige Beachtung."
        />
        <StatTile
          index={4}
          value={placeholder ? '-' : data!.pendingAppraisals}
          label="Offene Bewertungen"
        />
        {/* 14.08.2026: hier standen zwei eBay-Kacheln (Pipeline, Konflikte).
            Der eBay-Ausbau (0.4.0) hat jeden Schreiber entfernt — die Kacheln
            zeigten Dauernullen ueber einer Welt, die es nicht mehr gibt. */}
      </div>
    </section>
  );
}

function PanelHeading({ label, sublabel }: { label: string; sublabel: string }): JSX.Element {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <Zwischentitel label={label} />
      <p
        style={{
          margin: '-8px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-text)',
          textAlign: 'center',
        }}
      >
        {sublabel}
      </p>
    </div>
  );
}

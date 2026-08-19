/**
 * Werkstatt — the home screen the operator sees on every successful login.
 *
 * Aufbau: Tagessteuerung in der Leiste, die Zahlen des Tages und das
 * lebende Tagebuch auf der Hauptfläche.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Header (Seal · Werkstatt · SSE status)                │
 *   │  ◆ — diamond rule —                                    │
 *   ├──────────┬─────────────────────────────────────────────┤
 *   │ ◆ Tag    │                                             │
 *   │ ◆ Über-  │           ◆ Tageszahlen + Tagebuch          │
 *   │   sicht  │     (MAIN — full height & width,            │
 *   │ ◆ Tage-  │      month/week reads in FULL)              │
 *   │   buch   │                                             │
 *   │ (rail,   │                                             │
 *   │  ~300px) │                                             │
 *   ├──────────┴─────────────────────────────────────────────┤
 *   │ Footer (N° · Heute · Shift OPEN · €4.231,42)            │
 *   └────────────────────────────────────────────────────────┘
 *
 * The display panels (DayControl · Übersicht · Tagebuch) are display-only,
 * so they collapse into a THIN scannable rail on the LEFT; the calendar gets
 * every remaining pixel.
 *
 * Data ownership:
 *   • Dashboard summary  → TanStack Query (useDashboardSummary)
 *   • Live ledger feed   → Zustand (useLedgerFeed) populated by useLedgerStream
 *   • SSE status         → returned by useLedgerStream
 *
 * The two are STAPLED together via the SSE hook's debounced invalidation
 * of the dashboard query — see useLedgerStream.ts.
 */


import { useDashboardSummary } from '../../hooks/useDashboardSummary.js';
import { useLedgerStream } from '../../hooks/useLedgerStream.js';
import { useSessionStore } from '../../state/session-store.js';

import { DayControl } from './DayControl.js';
import { TagebuchFeed } from './TagebuchFeed.js';
import { UebersichtPanel } from './UebersichtPanel.js';
import { WerkstattFooter } from './WerkstattFooter.js';
import { WerkstattHeader } from './WerkstattHeader.js';

export function Werkstatt(): JSX.Element {
  const actor = useSessionStore((s) => s.actor);

  // ⚠️ 01.08.2026 — DIE GOOGLE-KALENDERKARTE IST RAUS.
  //
  // Hier stand eine Bühnen-Zustandsmaschine: fragte der Server „Kalender
  // eingerichtet?" mit ja, bekam eine Google-Kalenderkarte die ganze
  // Hauptfläche; mit nein tauschten Bühne und Leiste.
  //
  // Norns POS läuft ohne Netz. Eine Google-Kalenderkarte kann hier NIE
  // eingerichtet sein, die Bühne gehörte also für immer dem Ersatzzweig —
  // und die Karte stand als Tür ins Leere daneben. Dazu war sie doppelt:
  // diese Kasse hat unter /termine eine eigene, bessere Terminverwaltung
  // (FullCalendar, Umbuchen per Zug, Heute-Leiste, Detailauszug).
  //
  // Geblieben ist genau der Aufbau, den der Ersatzzweig schon hatte und der
  // seit dem 27.07.2026 in Gebrauch war: Tagessteuerung in der Leiste, die
  // Tageszahlen in voller Breite, darunter das lebende Tagebuch.

  // SSE: open on mount; cleanup on unmount (sign-out flips the parent gate).
  const { status: sseStatus } = useLedgerStream(true);

  // Dashboard data: TanStack Query, 15s stale / 60s background refresh /
  // SSE-debounce-invalidation.
  const { data, isLoading, isError, refetch, isFetching } = useDashboardSummary();

  const todayLabel = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className="w14-paper-noise"
      style={{
        // Fill the bounded <main> exactly (like Verkauf/Lager/Einstellungen). Using
        // min-height:100dvh here would exceed <main> by the header+ticker height and
        // force a permanent redundant scrollbar on the home surface.
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
      }}
    >
      <WerkstattHeader
        operatorName={
          actor === null
            ? 'Unbekannt'
            : actor.isOwner
              ? 'Inhaber'
              : actor.role === 'ADMIN'
                ? 'Admin'
                : actor.role === 'CASHIER'
                  ? 'Kasse'
                  : 'Beobachter'
        }
        sseStatus={sseStatus}
        todayLabel={todayLabel}
      />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          // Calendar-first: a thin scannable display rail on the LEFT,
          // the calendar claiming every remaining pixel on the RIGHT.
          gridTemplateColumns: 'clamp(280px, 22vw, 320px) minmax(0, 1fr)',
          gap: 'var(--space-6)',
          padding: 'var(--space-3) var(--space-7) var(--space-6)',
        }}
      >
        {/* Left rail — display-only summaries, compact & stacked. */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {/* A4: guided start/end of day — one clear control. */}
          <DayControl />

        </aside>

        {/* HAUPTFLÄCHE — die Tageszahlen in voller Breite (drei Spalten)
            und darunter das lebende Tagebuch. Beides gehört dieser Kasse. */}
        <div
          style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            overflowY: 'auto',
          }}
        >
          <UebersichtPanel
            data={data}
            isLoading={isLoading}
            isError={isError && data === undefined}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
          <div style={{ flex: 1, minHeight: 240, display: 'flex', flexDirection: 'column' }}>
            <TagebuchFeed />
          </div>
        </div>
      </main>

      <WerkstattFooter
        currentShiftId={data?.currentShiftId ?? null}
        revenueEur={data?.currentShiftRevenueEur ?? '0'}
        counterValue={Math.max(1, (data?.openTasksMine ?? 0) + (data?.tasksDueToday ?? 0))}
      />
    </div>
  );
}

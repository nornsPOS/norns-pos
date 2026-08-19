/**
 * HeuteRail — the right-hand "Heute" column of the Termine cockpit: today's
 * next appointments with a ONE-TAP primary action (Bestätigen / Einchecken /
 * Beginnen / Abschließen). The tap reflects optimistically in <400 ms
 * (Doherty) via `useOptimisticStatus`; a failure rolls back and toasts.
 */

import type { AppointmentListItem } from '@norns/api-client';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '@norns/api-client';
import { Button } from '@norns/ui-kit';

import { useToastStore } from '../../state/toast-store.js';
import {
  APPOINTMENT_TYPE_COLORS,
  TRANSITION_ACTION_LABELS,
  berlinTime,
  nextActionFor,
  todaysUpcoming,
} from './appointment-display.js';
import { useOptimisticStatus } from './useTermineMutations.js';

interface HeuteRailProps {
  appointments: readonly AppointmentListItem[];
  now: Date;
  onOpenDetail: (id: string) => void;
}

export function HeuteRail({ appointments, now, onOpenDetail }: HeuteRailProps): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  const setStatus = useOptimisticStatus();
  const rows = todaysUpcoming(appointments, now);

  const tap = (appt: AppointmentListItem): void => {
    const next = nextActionFor(appt.status);
    if (!next) return;
    setStatus.mutate(
      { id: appt.id, status: next },
      {
        onError: () =>
          addToast({
            tone: 'alert',
            title: 'Statuswechsel fehlgeschlagen',
            body: 'Der Termin wurde zurückgesetzt. Bitte erneut versuchen.',
          }),
      },
    );
  };

  return (
    <section
      aria-label="Heutige Termine"
      style={{ display: 'grid', gap: 'var(--w14-abstand-8)', alignContent: 'start' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--w14-schrift-betont)', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Heute
        </h3>
        <span
          className="w14-tabular"
          style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}
        >
          {rows.length === 1 ? '1 Termin' : `${rows.length} Termine`}
        </span>
      </header>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
          Keine weiteren Termine heute.
        </p>
      ) : (
        rows.map((appt) => {
          const color = APPOINTMENT_TYPE_COLORS[appt.appointment_type];
          const next = nextActionFor(appt.status);
          return (
            <article
              key={appt.id}
              style={{
                display: 'grid',
                gap: 'var(--w14-abstand-6)',
                padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                background: 'var(--w14-parchment-2)',
                border: '1px solid var(--w14-rule)',
                borderLeft: `4px solid ${color.bg}`,
                borderRadius: 'var(--w14-radius-card)',
              }}
            >
              <button
                type="button"
                onClick={() => onOpenDetail(appt.id)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 'var(--w14-abstand-2)',
                }}
                aria-label={`Termin ${berlinTime(appt.starts_at)} Uhr öffnen`}
              >
                <span
                  className="w14-tabular"
                  style={{ fontSize: 'var(--w14-schrift-betont)', fontWeight: 600, color: 'var(--w14-ink)' }}
                >
                  {berlinTime(appt.starts_at)} bis {berlinTime(appt.ends_at)} Uhr
                </span>
                <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
                  {APPOINTMENT_TYPE_LABELS[appt.appointment_type]} ·{' '}
                  {APPOINTMENT_STATUS_LABELS[appt.status]}
                </span>
              </button>
              {next ? (
                <div>
                  <Button
                    variant={next === 'CONFIRMED' || next === 'CHECKED_IN' ? 'primary' : 'ghost'}
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() => tap(appt)}
                  >
                    {TRANSITION_ACTION_LABELS[next]}
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })
      )}
    </section>
  );
}

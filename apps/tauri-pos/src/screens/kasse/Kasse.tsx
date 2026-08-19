/**
 * Kasse — Tier-1 surface #4 (memory.md §11.3).
 *
 * Four sub-views driven by `useCurrentShift`:
 *   • loading              → minimal Splash
 *   • read failed          → <KasseReadError/>      (we do NOT know the state)
 *   • shift === null       → <ShiftOpenPanel/>      (Schicht öffnen + der
 *                                                    Tagesabschluss, der genau
 *                                                    hier möglich ist)
 *   • shift.status==='OPEN'→ <KassenbuchPanel/>     (laufende Kasse +
 *                                                    Schichtschluss)
 *
 * The read-failure branch is not cosmetic. `data === undefined` means the call
 * did not answer; it does NOT mean "no shift is open". Treating the two alike
 * invited the operator to open a SECOND shift over a live one, which splits the
 * day's cash across two Kassenbücher. On a failed read we say so and offer a
 * retry, and we never render the open-a-shift panel.
 *
 * Per §10/§11 the chrome (Karteikasten + sub-breadcrumb if applicable) is
 * owned by AppShell; this file owns ONLY the surface body.
 *
 * Toasts:
 *   • shift opened          → success
 *   • Einlage logged        → success
 *   • Entnahme logged       → info
 *   • Schichtschluss mit Differenz → wax-red alert
 *   • Schichtschluss ohne Differenz → success
 *   • Tagesabschluss gebucht → success
 */

import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';

import { KassePurposeBanner } from './KassePurposeBanner.js';
import { KassenbuchPanel } from './KassenbuchPanel.js';
import { ShiftOpenPanel } from './ShiftOpenPanel.js';

export function Kasse(): JSX.Element {
  const { data, isLoading, isError, error, isFetching, refetch } = useCurrentShift();

  if (isLoading && data === undefined) return <KasseLoadingSplash />;

  // An unanswered read is not an empty till. Say what we know, and no more.
  if (data === undefined) {
    return (
      <KasseReadError
        detail={isError && error instanceof ApiError ? describeError(error) : null}
        busy={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }

  // The purpose banner sits above BOTH sub-views — the owner has to meet the
  // "Tageskasse ≠ checkout" concept no matter which state the day is in.
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-5) var(--space-7) 0' }}>
        <KassePurposeBanner />
      </div>
      {data === null ? <ShiftOpenPanel /> : <KassenbuchPanel shift={data} />}
    </div>
  );
}

/**
 * The honest unknown. We deliberately offer no "Kasse öffnen" here: opening a
 * shift while a live one is unreadable would split the day's cash in two.
 */
function KasseReadError({
  detail,
  busy,
  onRetry,
}: {
  detail: string | null;
  busy: boolean;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--space-7)' }}>
      <ParchmentCard
        padding="lg"
        style={{
          width: 'min(460px, 100%)',
          textAlign: 'center',
          border: '1px solid var(--w14-wax-red)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Kassenzustand unbekannt
        </h2>
        <Zwischentitel />
        <p
          role="alert"
          style={{
            margin: 'var(--space-3) 0 0',
            fontSize: 'var(--w14-schrift-text)',
            lineHeight: 1.6,
            color: 'var(--w14-ink-aged)',
          }}
        >
          {detail ?? 'Die Kasse konnte nicht gelesen werden.'} Ob eine Schicht offen ist, lässt sich
          gerade nicht sagen. Bitte nicht neu öffnen, sondern erneut laden.
        </p>
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Button variant="primary" onClick={onRetry} disabled={busy}>
            {busy ? 'Wird geladen…' : 'Erneut laden'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

function KasseLoadingSplash(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-7)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Kasse wird geprüft…
        </h2>
        <Zwischentitel />
      </ParchmentCard>
    </div>
  );
}

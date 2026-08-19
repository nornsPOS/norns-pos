/**
 * Konfliktpostfach (Compliance Inbox, Phase 6.1) — the review surface for
 * offline mutations that DIVERGED from the server.
 *
 * The offline outbox drains in strict FIFO order (a fiscal ledger must not apply
 * mutation N+1 before N reconciles). When a replayed mutation hits a
 * non-transient divergence, `drainOutbox` marks it `conflict` and HALTS — the
 * whole queue stops behind it until a human resolves it here. Two actions:
 *   • Erneut senden — re-queue for another drain pass (transient / since-fixed).
 *   • Verwerfen      — terminally close it (the divergence is accepted).
 *
 * HealthDot navigates here on a conflict. Reads the local outbox SQLite directly
 * (no network); both resolve actions are scoped to `status='conflict'` in the
 * store, so they can never touch a pending / in-flight / succeeded row.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { InfoPunkt, Button, Zwischentitel, ParchmentCard, ZustandFehler } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { outboxStore } from '../../lib/api-context.js';
import type { ConflictRecord } from '../../lib/outbox-store.js';
import { useSyncStore } from '../../state/sync-store.js';
import { useToastStore } from '../../state/toast-store.js';

const CONFLICTS_KEY = ['outbox', 'conflicts'] as const;

/**
 * Map a sealed outbox path to a German operation name. Covers every queueable
 * fiscal + non-fiscal route; anything not yet mapped falls back to the neutral
 * German "Vorgang" — the raw English path must NEVER reach the operator.
 */
function operationLabel(path: string): string {
  if (/\/storno\b/.test(path)) return 'Storno';
  if (path.includes('/transactions/ankauf')) return 'Ankauf';
  // 15.08.2026: die Retoure-Route ist geloescht (toter WEB-Weg), also kann
  // in der Warteschlange kein solcher Eintrag mehr liegen.
  if (path.includes('/transactions/finalize')) return 'Verkauf abschließen';
  if (path.includes('/closings/finalize')) return 'Tagesabschluss';
  if (path.includes('/shifts/open')) return 'Kasse öffnen';
  if (path.includes('/shifts/close')) return 'Kasse abschließen';
  if (path.includes('/cash-movement')) return 'Kassenbewegung';
  if (path.includes('/appraisals')) return 'Bewertung';
  if (path.includes('/kyc')) return 'Ausweisprüfung';
  if (path.includes('/customers')) return 'Kundendaten';
  if (path.includes('/products') || path.includes('/inventory')) return 'Lagerbestand';
  return 'Vorgang';
}

/**
 * A short, honest German label for the server divergence code. The raw
 * SCREAMING-token `ApiErrorCode` (or a Postgres constraint token) must never
 * reach the operator; anything unmapped falls back to the neutral "Abweichung".
 */
const CONFLICT_CODE_LABEL: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: 'Ungültige Daten',
  NOT_FOUND: 'Nicht gefunden',
  UNAUTHORIZED: 'Nicht angemeldet',
  FORBIDDEN: 'Keine Berechtigung',
  STEP_UP_REQUIRED: 'PIN erforderlich',
  PIN_LOCKED: 'PIN gesperrt',
  CONFLICT: 'Datenkonflikt',
  SANCTIONS_BLOCK: 'Sanktionsprüfung',
  KYC_REQUIRED: 'Ausweis erforderlich',
  CLOSING_DAY_FINALIZED: 'Tag bereits abgeschlossen',
  STORNO_OF_STORNO: 'Storno nicht möglich',
  PRODUCT_NOT_RESERVABLE: 'Artikel nicht verfügbar',
  DEVICE_NOT_AUTHORIZED: 'Gerät nicht gekoppelt',
  RATE_LIMITED: 'Zu viele Anfragen',
  EXTERNAL_SERVICE_FAILED: 'Dienst nicht erreichbar',
  INTERNAL_ERROR: 'Serverfehler',
};

function conflictCodeLabel(code: string): string {
  return CONFLICT_CODE_LABEL[code] ?? 'Abweichung';
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('de-DE');
}

export function Konfliktpostfach(): JSX.Element {
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const refreshStats = useSyncStore((s) => s.refreshStats);

  const q = useQuery({
    queryKey: CONFLICTS_KEY,
    queryFn: () => outboxStore.listConflicts(),
    staleTime: 5_000,
    retry: false, // outside Tauri the SQL plugin rejects — don't hammer it
  });

  const afterResolve = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: CONFLICTS_KEY });
    void refreshStats();
  };

  const discard = useMutation({
    mutationFn: (key: string) => outboxStore.discardConflict(key),
    onSuccess: async () => {
      addToast({ tone: 'info', title: 'Vorgang verworfen', body: 'Der Konflikt wurde geschlossen.' });
      await afterResolve();
    },
    onError: () =>
      addToast({ tone: 'alert', title: 'Aktion fehlgeschlagen', body: 'Bitte erneut versuchen.' }),
  });

  const retry = useMutation({
    mutationFn: async (key: string) => {
      await outboxStore.retryConflict(key);
      // Nudge the replay controller (it drains on the `online` event) so the
      // re-queued row is attempted now, not only on the next connectivity change.
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('online'));
    },
    onSuccess: async () => {
      addToast({
        tone: 'info',
        title: 'Erneut in die Warteschlange',
        body: 'Der Vorgang wird beim nächsten Abgleich erneut gesendet.',
      });
      await afterResolve();
    },
    onError: () =>
      addToast({ tone: 'alert', title: 'Aktion fehlgeschlagen', body: 'Bitte erneut versuchen.' }),
  });

  const conflicts = q.data ?? [];
  const busy = discard.isPending || retry.isPending;

  return (
    <section
      aria-label="Konfliktpostfach"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        padding: 'var(--space-5)',
        maxWidth: 760,
        margin: '0 auto',
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kachel)',
          }}
        >
          Konfliktpostfach
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)', marginTop: 4 }}>
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
            Prüfen, dann erneut senden oder verwerfen.
          </span>
          <InfoPunkt
            ariaLabel="Was liegt hier?"
            text="Offline erfasste Vorgänge, die vom Server abweichen. Bis zur Klärung ruht die Synchronisierung."
          />
        </div>
      </div>
      <Zwischentitel />

      {q.isLoading ? (
        <ParchmentCard padding="md">
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt…</p>
        </ParchmentCard>
      ) : q.isError ? (
        // FUND: der schwerste der neun. `conflicts` ist `q.data ?? []`, und die
        // Abfrage läuft mit `retry: false`, weil das SQL-Plugin ausserhalb von
        // Tauri sofort ablehnt. Schlug die Leseabfrage also fehl, stand hier das
        // Siegel und darunter „Keine Konflikte. Die Synchronisierung läuft."
        // Genau umgekehrt: die Warteschlange hält womöglich seit Stunden hinter
        // einem Konflikt an, den niemand sehen kann — und die Fläche, die eigens
        // dafür gebaut wurde, meldete Ruhe. Diese Liste darf leer aussehen,
        // wenn sie leer IST; nicht, wenn sie nicht gelesen werden konnte.
        <ZustandFehler
          satz={describeError(q.error)}
          folge="Ob Vorgänge in der Warteschlange hängen, lässt sich jetzt nicht sagen. Ein leerer Bildschirm ist hier keine Entwarnung."
          onErneut={() => void q.refetch()}
        />
      ) : conflicts.length === 0 ? (
        <ParchmentCard padding="lg" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
          </div>
          <p
            style={{
              margin: '12px 0 0',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
            }}
          >
            Keine Konflikte. Die Synchronisierung läuft.
          </p>
        </ParchmentCard>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {conflicts.map((c) => (
            <li key={c.idempotencyKey}>
              <ConflictCard
                conflict={c}
                disabled={busy}
                onDiscard={() => discard.mutate(c.idempotencyKey)}
                onRetry={() => retry.mutate(c.idempotencyKey)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConflictCard({
  conflict,
  disabled,
  onDiscard,
  onRetry,
}: {
  conflict: ConflictRecord;
  disabled: boolean;
  onDiscard: () => void;
  onRetry: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{ border: '1px solid var(--w14-wax-red)', display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--w14-abstand-12)' }}>
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-grund)' }}>
          {operationLabel(conflict.path)}
        </span>
        {conflict.gobdRelevant && (
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-gold)', fontSize: 'var(--w14-schrift-kuerzel)', letterSpacing: '0.08em' }}
          >
            GoBD-relevant
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-10)', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-wax-red)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-fein)',
            padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
          }}
        >
          {conflictCodeLabel(conflict.serverCode)}
        </span>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
          erfasst {formatWhen(conflict.enqueuedAt)} · {conflict.attemptCount} Versuch
          {conflict.attemptCount === 1 ? '' : 'e'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end', marginTop: 4 }}>
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={disabled}>
          Verwerfen
        </Button>
        <Button variant="primary" size="sm" onClick={onRetry} disabled={disabled}>
          Erneut senden
        </Button>
      </div>
    </ParchmentCard>
  );
}

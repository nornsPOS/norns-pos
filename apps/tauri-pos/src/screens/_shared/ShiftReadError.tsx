/**
 * ShiftReadError — was eine Fläche zeigt, wenn der Schicht-Lesevorgang KEINE
 * Antwort gab.
 *
 * WARUM ES DAS GIBT. Eine nicht beantwortete Abfrage ist keine geschlossene
 * Kasse. Verkauf und Ankauf lasen nur `data` und `isLoading`, und nach einem
 * fehlgeschlagenen Versuch war `data === undefined`. Beide zeigten daraufhin
 * „Keine offene Schicht" und schickten die Kassiererin zur Kasse, mitten im
 * Kundengespräch, obwohl die Schicht in Wirklichkeit offen war. Ein blockierter
 * Verkauf, und eine Behauptung über einen Zustand, den die App nie geprüft hat.
 *
 * Die Kasse hatte diesen Fehler und bekam die Korrektur, die anderen beiden
 * nicht. Deshalb liegt sie jetzt hier: eine Stelle, drei Flächen.
 *
 * Der Text sagt ausdrücklich „nicht neu öffnen". Wer bei unbekanntem Zustand
 * eine zweite Schicht eröffnet, zerlegt den Kassensturz des Tages.
 */

import type { JSX } from 'react';

import { Button, Zwischentitel, ParchmentCard, Seal } from '@norns/ui-kit';

export interface ShiftReadErrorProps {
  /** Die Ziffer der Fläche, wie sie auch der ShiftGuard trägt. */
  digitLabel: string;
  /** Die humanisierte Fehlerursache, wenn eine bekannt ist. */
  detail: string | null;
  /** Läuft gerade ein erneuter Versuch. */
  busy: boolean;
  onRetry: () => void;
}

export function ShiftReadError({
  digitLabel,
  detail,
  busy,
  onRetry,
}: ShiftReadErrorProps): JSX.Element {
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
        <Seal size="md" tone="faded" label={digitLabel} />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Schichtzustand unbekannt
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

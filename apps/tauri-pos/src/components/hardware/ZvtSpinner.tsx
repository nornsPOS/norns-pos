/**
 * ZvtSpinner — full-screen modal that locks the UI during a card
 * authorisation. The cardholder is interacting with the physical
 * terminal; any click in the POS during that window would only confuse
 * the operator. The spinner also surfaces a helpful "Warten auf
 * Kartenleser…" message + the amount so the operator can talk the
 * customer through it.
 */

import { useEffect } from 'react';

import { Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

export interface ZvtSpinnerProps {
  /** Amount that's being authorised — shown in the centre. */
  amountEur: string;
  /** Optional title override; default "Kartenzahlung…". */
  title?: string;
  /** Optional hint shown beneath the amount; default German guidance. */
  hint?: string;
}

export function ZvtSpinner({
  amountEur,
  title = 'Kartenzahlung läuft',
  hint = 'Bitte am Terminal bestätigen. Karte einstecken / auflegen.',
}: ZvtSpinnerProps): JSX.Element {
  // Block the Esc / Enter shortcuts globally for the duration — we never
  // want a keystroke to dismiss the spinner mid-auth.
  useEffect(() => {
    const stop = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' || ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    window.addEventListener('keydown', stop, true);
    return () => window.removeEventListener('keydown', stop, true);
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--w14-z-vorhang)',
        backgroundColor: 'var(--w14-overlay)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard
        padding="lg"
        style={{
          width: 'min(440px, 100%)',
          textAlign: 'center',
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          {title}
        </h2>

        <Zwischentitel />

        <div style={{ display: 'grid', placeItems: 'center', gap: 'var(--w14-abstand-16)', padding: 'var(--w14-abstand-8) 0' }}>
          {/* Pulsing dot — single CSS animation, no library */}
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: 'var(--w14-radius-pille)',
              backgroundColor: 'var(--w14-gold)',
              animation: 'w14-pulse 1.2s ease-in-out infinite',
            }}
          />
          <MoneyAmount valueEur={amountEur} emphasis />
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-betont)',
              maxWidth: 320,
            }}
          >
            {hint}
          </p>
        </div>

        <Zwischentitel />

        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-zeile)',
          }}
        >
          Vorgang nicht abbrechen. Das Terminal sendet das Ergebnis.
        </p>
      </ParchmentCard>

      {/* Local keyframes — keeps the component self-contained. */}
      <style>{`@keyframes w14-pulse {
        0%, 100% { transform: scale(1); opacity: 0.85; }
        50%      { transform: scale(1.35); opacity: 1; }
      }`}</style>
    </div>
  );
}

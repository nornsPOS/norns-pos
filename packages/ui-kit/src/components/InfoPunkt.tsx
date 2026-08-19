/**
 * InfoPunkt — das kleine Fragezeichen, das einen Absatz ersetzt.
 *
 * ── WOZU (27.07.2026, Basels Befund am lebenden Bild) ───────────────────────
 * „Die Kasse liest sich wie eine Zeitung": fast jede Fläche trug erklärende
 * Absätze, die nach dem ersten Tag niemand mehr liest — aber jeden Tag Platz
 * und Blick kosten. Die Regel jetzt: das ZEICHEN spricht für sich, und wer
 * die Erklärung will, holt sie sich mit EINEM Tipp hier ab. Kurz, direkt,
 * ein bis zwei Sätze — kein zweiter Absatzstapel in einer Blase.
 *
 * ── VERHALTEN ───────────────────────────────────────────────────────────────
 * Ein 24-Punkt-Ziel (das Zeichen selbst 15 px), öffnet eine kleine Karte
 * unterhalb; schliesst bei Aussenklick, Escape oder erneutem Tipp. Kein
 * Portal: `position: absolute` am Auslöser, `z-index` über die Fenster-Marke,
 * damit die Blase auch in Kopfzeilen über den Inhalt zeichnet. Flächen mit
 * `overflow: hidden` am direkten Vorfahren müssen das wissen — dort die Blase
 * nicht am letzten Rand platzieren.
 *
 * A11y: `aria-expanded`, `aria-label` aus dem Pflichttext, die Blase ist
 * `role="note"`. Der Auslöser bleibt ein echter Button (Tastatur inklusive).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { CircleHelp } from 'lucide-react';

import { Icon } from './Icon.js';

export interface InfoPunktProps {
  /** Die Erklärung — ein bis zwei kurze Sätze. Pflicht. */
  text: string;
  /** Wohin die Blase öffnet. Vorgabe: rechts unter dem Zeichen. */
  richtung?: 'rechts' | 'links';
  /** Zugänglicher Name des Auslösers. Vorgabe: „Erklärung". */
  ariaLabel?: string;
}

export function InfoPunkt({
  text,
  richtung = 'rechts',
  ariaLabel = 'Erklärung',
}: InfoPunktProps): JSX.Element {
  const [offen, setOffen] = useState<boolean>(false);
  const wurzelRef = useRef<HTMLSpanElement>(null);
  const blaseId = useId();

  const schliessen = useCallback((): void => setOffen(false), []);

  // Aussenklick + Escape — nur solange die Blase offen ist.
  useEffect(() => {
    if (!offen) return;
    const aufKlick = (ev: MouseEvent): void => {
      if (wurzelRef.current && !wurzelRef.current.contains(ev.target as Node)) schliessen();
    };
    const aufTaste = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') schliessen();
    };
    document.addEventListener('mousedown', aufKlick);
    document.addEventListener('keydown', aufTaste);
    return () => {
      document.removeEventListener('mousedown', aufKlick);
      document.removeEventListener('keydown', aufTaste);
    };
  }, [offen, schliessen]);

  return (
    <span ref={wurzelRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-expanded={offen}
        aria-controls={offen ? blaseId : undefined}
        aria-label={ariaLabel}
        title={offen ? undefined : ariaLabel}
        onClick={() => setOffen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: 'transparent',
          color: offen ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          cursor: 'pointer',
        }}
      >
        <Icon icon={CircleHelp} size={15} />
      </button>
      {offen && (
        <span
          id={blaseId}
          role="note"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--w14-abstand-4))',
            ...(richtung === 'rechts' ? { left: 0 } : { right: 0 }),
            zIndex: 'var(--w14-z-fenster)',
            width: 'max-content',
            maxWidth: 320,
            padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            boxShadow: 'var(--w14-shadow-modal)',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-text)',
            lineHeight: 1.5,
            textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * SanfteMomente — die drei kleinen Bauteile der ruhigen Verbindung:
 *
 *   • `SkelettBalken` — der eine Baustein, aus dem jede Fläche ihr Lade-Skelett
 *     in der Geometrie ihrer ECHTEN Zeilen zusammensetzt (kein Springen, wenn
 *     der Inhalt eintrifft). Fläche und Schimmer kommen aus der Haus-Klasse
 *     `w14-skelett` des Fundaments — hier entsteht keine weitere Kopie des
 *     sechsfach duplizierten `w14-skel`.
 *
 *   • `Eintreffen` — eine kurze Deckkraft-Blende, wenn Inhalt zum ersten Mal
 *     erscheint. Sie läuft beim EINHÄNGEN des Inhalts (Skelett → Zeilen);
 *     Nachladen mit festgehaltenem alten Inhalt bleibt völlig ruhig, weil der
 *     Rahmen dann gar nicht neu eingehängt wird.
 *
 *   • `Geldschimmer` — ein Gold-Aufblenden von ~180 ms, wenn sich ein Betrag
 *     ändert, damit das Auge die Änderung findet. Nur Farbe bewegt sich.
 *
 * WARUM die Bewegungsvorliebe in JS gelesen wird: die globale reduced-motion-
 * Regel in tokens.css nullt nur die DAUER, nicht die Verzögerung — der sichere
 * Weg ist der von `lib/motion.tsx`: die Vorliebe selbst lesen und die Animation
 * GANZ fallen lassen. Ohne Animation ist der Inhalt sofort sichtbar, denn die
 * Keyframes definieren nur den Startzustand (`from`), nie den Endzustand —
 * die Vorgabe ist sichtbar, die Animation veredelt nur.
 *
 * WARUM die Keyframes in den Dokumentkopf gelegt werden statt als <style> je
 * Bauteil: dieselbe Fläche trägt oft mehrere dieser Bauteile, und genau so sind
 * die sechs Kopien von `w14-skel` entstanden. Einmal je Dokument genügt.
 */
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '../../lib/motion.js';

const STIL_ID = 'w14-sanfte-momente-keyframes';

const KEYFRAMES = `
@keyframes w14-eintreffen {
  from { opacity: 0; }
}
@keyframes w14-geldwechsel {
  0%  { color: var(--w14-gold); }
  55% { color: var(--w14-gold); }
}
`;

/** Legt die Keyframes genau einmal in den Dokumentkopf. Mehrfachaufruf ist frei. */
function stelleKeyframesSicher(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STIL_ID)) return;
  const el = document.createElement('style');
  el.id = STIL_ID;
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

// Beim Laden des Moduls, nicht erst im Effekt: die Animation läuft schon beim
// ersten Malen des Bauteils, da müssen die Keyframes bereits stehen.
stelleKeyframesSicher();

// ────────────────────────────────────────────────────────────────────────
// SkelettBalken
// ────────────────────────────────────────────────────────────────────────

export interface SkelettBalkenProps {
  /** Breite des Balkens — Zahl (px) oder Prozentangabe. */
  breite: number | string;
  hoehe?: number;
  radius?: string;
  style?: CSSProperties;
}

/**
 * Ein ruhiger Platzhalterbalken auf Pergamentton. Die Fläche setzt daraus die
 * Geometrie ihrer echten Zeilen zusammen und staffelt die Deckkraft nach unten
 * hin ab (wie die Skelettzeilen im Lager, das Vorbild).
 *
 * Fläche und Schimmer kommen aus der Haus-Klasse `w14-skelett` (tokens.css):
 * EIN Keyframe für das ganze Haus, reduced motion stellt den Schimmer dort
 * still — hier wird bewusst nichts davon dupliziert.
 */
export function SkelettBalken({
  breite,
  hoehe = 12,
  radius = 'var(--w14-radius-button)',
  style,
}: SkelettBalkenProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="w14-skelett"
      style={{
        width: breite,
        height: hoehe,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// Eintreffen
// ────────────────────────────────────────────────────────────────────────

export interface EintreffenProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Blendet eintreffenden Inhalt kurz auf (Deckkraft, 180 ms, Kuratorenkurve)
 * statt ihn ploppen zu lassen. Unter reduced motion: Sofortwechsel, keine
 * Animation. Der Rahmen übernimmt Layout-Stile der Fläche über `style`, damit
 * er in Flex- und Grid-Spalten an die Stelle des bisherigen Behälters treten
 * kann, ohne Abstände zu brechen.
 */
export function Eintreffen({ children, className, style }: EintreffenProps): JSX.Element {
  const reduziert = useReducedMotion();
  const bewegung: CSSProperties = reduziert
    ? {}
    : {
        animationName: 'w14-eintreffen',
        animationDuration: 'var(--w14-dur-fast)',
        animationTimingFunction: 'var(--w14-ease-curator)',
      };
  return (
    <div className={className} style={{ ...bewegung, ...style }}>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Geldschimmer
// ────────────────────────────────────────────────────────────────────────

export interface GeldschimmerProps {
  /** Der beobachtete Betrag (EUR-Dezimalzeichenkette, wie MoneyAmount ihn trägt). */
  wert: string;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Lässt den umschlossenen Betrag beim WECHSEL kurz golden aufleuchten, damit
 * das Auge die Änderung im Korb findet. Der erste gemalte Wert schimmert
 * nicht — nur eine echte Änderung. Unter reduced motion: aus.
 *
 * Der Neustart der Animation läuft über `key`: jeder Wertwechsel hängt den
 * Rahmen neu ein, die Animation beginnt von vorn. Nur die Schriftfarbe bewegt
 * sich (von Gold zurück zur eigenen Farbe des Betrags), nie Layout.
 */
export function Geldschimmer({ wert, children, style }: GeldschimmerProps): JSX.Element {
  const reduziert = useReducedMotion();
  const vorher = useRef<string>(wert);
  const [takt, setTakt] = useState<number>(0);
  useEffect(() => {
    if (vorher.current !== wert) {
      vorher.current = wert;
      setTakt((t) => t + 1);
    }
  }, [wert]);

  const schimmert = takt > 0 && !reduziert;
  return (
    <span
      key={takt}
      style={{
        ...(schimmert
          ? {
              animationName: 'w14-geldwechsel',
              animationDuration: 'var(--w14-dur-fast)',
              animationTimingFunction: 'var(--w14-ease-out)',
            }
          : {}),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

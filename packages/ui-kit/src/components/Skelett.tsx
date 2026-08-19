/**
 * Skelett — der EINE ruhige Ladeplatzhalter des Hauses.
 *
 * ── WARUM ES DIESES BAUTEIL GIBT ─────────────────────────────────────────
 * Gezählt am 26.07.2026: VIER verschiedene Ladesprachen für denselben
 * Zustand (echte Skelettzeilen, ein schimmerndes `w14-skel`, ein
 * Pergament-Aufflackern, ein nacktes kursives „Lädt…"), und der Keyframe
 * `w14-skel` stand SECHSMAL einzeln in Flächen der Kasse — in zwei
 * verschiedenen Laufrichtungen. Im Baukasten gab es KEIN Skelett-Bauteil,
 * also erfand jede Fläche ihr eigenes.
 *
 * Dieses Bauteil ersetzt sie alle: Pergamentgrund (`parchment-3`), ein
 * leiser Gilt-Schimmer, der über das Papier wandert — kein grelles
 * Pulsieren, keine kalten Grautöne. Der Schimmer ist reiner `transform`
 * und steht bei `prefers-reduced-motion` STILL (Regel in tokens.css bei
 * `.w14-skelett`, dort ist auch das WARUM des Stillstands notiert).
 *
 * Gebrauch:
 *   <Skelett width={180} />                        eine Zeile
 *   <Skelett width="100%" height={96} radius="card" />   eine Kachel
 *   <SkelettZeilen zeilen={5} />                   eine Liste
 *
 * Ein Skelett ist stumm (`aria-hidden`): die Fläche, die lädt, sagt ihren
 * Zustand selbst an (etwa über aria-busy auf der Liste) — zwölf plappernde
 * Platzhalter wären für den Leser Lärm, keine Auskunft.
 */

import type { CSSProperties } from 'react';

export interface SkelettProps {
  /** CSS-Breite; Zahl = Pixel. Vorgabe: volle Breite der Umgebung. */
  width?: number | string;
  /** CSS-Höhe; Zahl = Pixel. Vorgabe: eine Textzeile (14). */
  height?: number | string;
  /** Eckenform aus der Radien-Leiter — `kreis` für Siegel- und Bildrunde. */
  radius?: 'button' | 'card' | 'kreis';
  className?: string;
  style?: CSSProperties;
}

const RADIUS: Record<NonNullable<SkelettProps['radius']>, string> = {
  button: 'var(--w14-radius-button)',
  card: 'var(--w14-radius-card)',
  kreis: '50%',
};

export function Skelett({
  width = '100%',
  height = 14,
  radius = 'button',
  className,
  style,
}: SkelettProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={['w14-skelett', className].filter(Boolean).join(' ')}
      style={{
        display: 'block',
        width,
        height,
        borderRadius: RADIUS[radius],
        ...style,
      }}
    />
  );
}

export interface SkelettZeilenProps {
  /** Wie viele Zeilen der erwarteten Liste angedeutet werden. */
  zeilen?: number;
  /** Höhe einer Zeile; Zahl = Pixel. */
  hoehe?: number | string;
  /** Lücke zwischen den Zeilen in Pixeln. */
  abstand?: number;
  style?: CSSProperties;
}

/**
 * Eine Handvoll Zeilen mit abnehmender Deckkraft — das Muster der besten
 * bestehenden Stelle (LagerTable), jetzt für alle: das Auge liest „hier
 * kommt eine Liste", ohne dass zwölf gleich laute Balken schreien.
 */
export function SkelettZeilen({
  zeilen = 4,
  hoehe = 40,
  abstand = 10,
  style,
}: SkelettZeilenProps): JSX.Element {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: abstand, ...style }}>
      {Array.from({ length: zeilen }, (_, i) => (
        <Skelett
          // Die Liste ist statisch (kein Umsortieren) — der Index IST die Identität.
          key={i}
          height={hoehe}
          style={{ opacity: Math.max(0.35, 1 - i * 0.18) }}
        />
      ))}
    </div>
  );
}

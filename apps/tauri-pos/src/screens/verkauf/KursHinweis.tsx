/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KursHinweis — „diese Preise kommen vom laufenden Kurs, und wie lange"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WOZU (20.08.2026) ──────────────────────────────────────────────────────
 *
 * Seit heute rechnet der Korb die Preise der kursgebundenen Stücke aus dem
 * LAUFENDEN Metallkurs. Das ist richtig — und es wäre unheimlich, wenn die
 * Kasse es nicht sagte: eine Zahl, die sich unter der Hand ändert, ohne dass
 * jemand erklärt warum, ist am Tresen schlimmer als eine veraltete.
 *
 * Diese Zeile sagt deshalb zwei Dinge, und nur diese zwei:
 *
 *   1. WIE VIELE Zeilen aus dem Kurs kommen (die anderen tragen ihren
 *      festen Preis, und das bleibt so).
 *   2. WIE LANGE der gezeigte Preis noch gilt — der Motor holt im
 *      Fünf-Minuten-Takt, also läuft die Zahl sichtbar ab.
 *
 * ── WARUM EIN EIGENES BAUTEIL ──────────────────────────────────────────────
 *
 * Weil es eine eigene Sache ist: ein Zustand mit einer eigenen Uhr. Im Fuss
 * des Korbs eingebettet wäre es eine weitere `useEffect`-Uhr in einer Datei,
 * die ohnehin zu viel trägt. Hier steht sie allein, prüfbar, und der Korb
 * ruft eine Zeile.
 */

import { useEffect, useState } from 'react';

import { KURSTAKT_SEKUNDEN, sekundenBisZumNaechstenKurs } from '../../lib/korbpreis.js';

export interface KursHinweisProps {
  /** Wie viele Korbzeilen ihren Preis aus dem Kurs beziehen. */
  anzahl: number;
  /** Wann der Motor die Kurse zuletzt geholt hat (ISO), oder `null`. */
  geholtAm: string | null;
}

/** „2:41" — Minuten und Sekunden, wie eine Uhr sie zeigt. */
function alsUhr(sekunden: number): string {
  const m = Math.floor(sekunden / 60);
  const s = sekunden % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function KursHinweis({ anzahl, geholtAm }: KursHinweisProps): JSX.Element {
  // Die eigene Sekunde. Sie tickt NUR, solange dieses Bauteil steht — ein
  // leerer Korb hat keine laufende Uhr.
  const [jetzt, setJetzt] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(new Date()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const rest = sekundenBisZumNaechstenKurs(geholtAm, jetzt);
  const anteil = rest === null ? 0 : rest / KURSTAKT_SEKUNDEN;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--w14-abstand-10)',
        padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
        marginBottom: 'var(--w14-abstand-10)',
        borderRadius: 'var(--w14-radius-button)',
        background: 'rgb(var(--w14-gilt-rgb) / 0.10)',
      }}
    >
      {/* Der Balken läuft ab wie der Kurs — ruhig, ohne das Auge am Tresen
          zu ziehen.

          ⚠️ Gestaucht wird mit `transform: scaleX`, NICHT mit `width`. Eine
          laufende Breite rechnet der Browser jede Sekunde neu durch das
          Layout des ganzen Korbfusses; `scaleX` bleibt beim Compositor. Der
          Bewegungs-Wächter misst genau das. */}
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 36,
          height: 4,
          borderRadius: 'var(--w14-radius-pille)',
          background: 'rgb(var(--w14-gilt-rgb) / 0.30)',
          overflow: 'hidden',
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--w14-gilt-deep)',
            transformOrigin: 'left center',
            transform: `scaleX(${anteil.toFixed(3)})`,
            transition: 'transform 1s linear',
          }}
        />
      </span>
      <span
        style={{
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-ink-aged)',
          lineHeight: 1.45,
          textWrap: 'pretty',
        }}
      >
        {anzahl === 1 ? 'Ein Stück folgt' : `${anzahl} Stücke folgen`} dem Tageskurs.{' '}
        {rest === null ? (
          // Kein Kurs, kein Countdown — und das wird gesagt, nicht verschwiegen.
          <span style={{ color: 'var(--w14-wax-red)' }}>
            Es liegt gerade kein Kurs vor; es gilt der gespeicherte Preis.
          </span>
        ) : rest === 0 ? (
          'Der nächste Kurs wird gerade geholt.'
        ) : (
          <>
            Dieser Preis gilt noch{' '}
            <strong className="w14-tabular" style={{ color: 'var(--w14-ink)' }}>
              {alsUhr(rest)}
            </strong>
            .
          </>
        )}
      </span>
    </div>
  );
}

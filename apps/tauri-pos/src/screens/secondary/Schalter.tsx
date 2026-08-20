/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Schalter — ein Ja/Nein in den Einstellungen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ER EIN EIGENES STÜCK IST (20.08.2026) ────────────────────────────
 *
 * Er wohnte als private Funktion `Toggle` mitten in `Einstellungen.tsx`, einer
 * Datei mit über neunhundert Zeilen. Als der Kursstreifen-Schalter zu den
 * Metallkursen zog, brauchten ihn zwei Bereiche — und ein zweites Mal
 * dasselbe zu bauen wäre der Anfang von zwei Schaltern, die sich langsam
 * auseinanderentwickeln.
 *
 * ── ZWEI FEHLER, DIE BEIM UMZUG AUFFIELEN ──────────────────────────────────
 *
 *   1. Der Knopf sagte nicht, ob er AN ist. Er trug kein `aria-pressed`, und
 *      der Schieber daneben war `aria-hidden`. Wer die Fläche vorgelesen
 *      bekommt, hörte „Metallkurse im Kopf anzeigen, Schaltfläche" — und
 *      hatte keine Möglichkeit zu erfahren, wie sie steht.
 *   2. Der Schieber bewegte sich über `left`. Das ist eine Layout-Grösse:
 *      der Browser rechnet bei jedem Bild die Fläche neu durch. `transform`
 *      bleibt beim Compositor und sieht genauso aus.
 */

import { useKursstreifenStore } from '../../state/kursstreifen-store.js';

export interface SchalterProps {
  /** Steht er auf AN? */
  on: boolean;
  onChange: (v: boolean) => void;
  /** Die Zeile, die der Mensch liest. */
  title: string;
  /** Der Satz darunter: was passiert, wenn er umlegt. */
  desc: string;
}

/** Wie weit der Schieber wandert (Bahn 42, Schieber 18, Rand 3). */
const WEG = 42 - 18 - 3 * 2;

export function Schalter({ on, onChange, title, desc }: SchalterProps): JSX.Element {
  return (
    <button
      type="button"
      // ⚠️ Ohne das ist der Stand des Schalters für eine Vorlesefläche
      // unsichtbar — der Schieber daneben ist bewusst `aria-hidden`.
      aria-pressed={on}
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--w14-abstand-14)',
        width: '100%',
        padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        background: 'var(--w14-parchment)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
        <span style={{ fontSize: 'var(--w14-schrift-betont)', color: 'var(--w14-ink)' }}>
          {title}
        </span>
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          {desc}
        </span>
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 42,
          height: 24,
          flex: '0 0 auto',
          borderRadius: 'var(--w14-radius-pille)',
          background: on ? 'var(--w14-accent)' : 'var(--w14-rule)',
          position: 'relative',
          transition: 'background var(--w14-dur-exit) var(--w14-ease-hover)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            // 19.08.2026: reines Weiss (Hausverbot) und 1,24:1 auf der Aus-Schiene.
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-feldlinie)',
            transform: on ? `translateX(${WEG}px)` : 'none',
            transition: 'transform var(--w14-dur-exit) var(--w14-ease-hover)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        />
      </span>
    </button>
  );
}

/**
 * Der Kursstreifen im Kopf — an oder aus.
 *
 * Eine Sache DIESES Geräts, nicht des Hauses: er wohnt im örtlichen Halt und
 * geht nie an den Server. Die Zweitkasse am anderen Tresen entscheidet für
 * sich.
 *
 * ⚠️ Basels Anweisung vom 05.08.2026 gilt unverändert: der Schalter gehört in
 * die Einstellungen, NICHT in die Kopfleiste neben den dunklen Modus. Die
 * Kopfleiste ist der Arbeitsplatz, kein Schaltpult.
 */
export function KursstreifenSchalter(): JSX.Element {
  const sichtbar = useKursstreifenStore((s) => s.sichtbar);
  const setzen = useKursstreifenStore((s) => s.setzen);
  return (
    <Schalter
      on={sichtbar}
      onChange={setzen}
      title="Kursstreifen im Kopf anzeigen"
      desc="Der Streifen unter der Kopfleiste. Wer nicht täglich ankauft, blendet ihn aus. Gilt nur auf diesem Gerät."
    />
  );
}

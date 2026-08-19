/**
 * Toast — brand-themed dismissable notification.
 *
 * Vier Töne:
 *   • info      → ink rule on parchment-2 (default), löst sich auf
 *   • success   → gold rule, gold seal icon, löst sich auf
 *   • warn      → terracotta rule — „ist schiefgegangen, aber nichts ist
 *                 kaputt". Löst sich auf, bleibt aber länger stehen als eine
 *                 Quittung, weil man sie wirklich lesen soll.
 *   • alert     → wax-red rule, bleibt bis zum Wegklicken
 *
 * Never used directly — the consumer calls `useToast().addToast(...)` and the
 * `<ToastContainer/>` renders the active list. This file just exports the
 * presentational atom.
 *
 * ─── FUND 2026-07-26: eine Gerätekennung sprengte die Blase ──────────────
 * Die Blase stand auf `maxWidth: 380`, ihr Textfeld war aber die mittlere
 * Spalte eines Rasters, und eine Rasterzelle hat von Haus aus die
 * Mindestbreite ihres Inhalts. Eine ungebrochene Kette — die Kennung eines
 * Zahlungsterminals, ein Druckerpfad, eine Kennnummer aus einer
 * Fehlerantwort — hat damit die Spalte breiter gemacht als die Blase selbst.
 * Am Tresen stand die Meldung dann halb über dem Rand der Blase und ihr Ende
 * lag ausserhalb des Schirms: genau der Teil, den man abschreiben will, um
 * das Gerät zu finden. Zwei Ursachen zugleich, jede für sich schon genug:
 * die fehlende Mindestbreite null und ein Umbruch, den nur der äussere Kasten
 * gesetzt hatte, nicht die Blase selbst.
 * Dazu fehlte JEDE Höhengrenze. Eine Antwort mit zwanzig Zeilen wuchs die
 * Blase über den halben Schirm und deckte den Bezahldialog zu.
 * Behoben durch: `minWidth: 0` auf der Textspalte, `overflowWrap: anywhere`
 * in der Blase selbst (nicht nur geerbt) und einen eigenen Rollbereich mit
 * fester Höhengrenze für Titel und Text.
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warn' | 'alert';

export interface ToastShape {
  id: string;
  tone: ToastTone;
  title: string;
  body?: ReactNode;
  /** Milliseconds before auto-dismiss. `null` = sticky (alerts default to sticky). */
  autoDismissMs: number | null;
  /**
   * Wie oft dieselbe Meldung zusammengefasst wurde. Fehlt oder 1 = einmal,
   * dann steht kein Zähler in der Blase.
   */
  count?: number;
}

const TONE_BORDER: Record<ToastTone, string> = {
  info: 'var(--w14-rule)',
  success: 'var(--w14-verdigris)',
  warn: 'var(--w14-terra)',
  alert: 'var(--w14-wax-red)',
};

const TONE_GLYPH: Record<ToastTone, string> = {
  // 19.08.2026: info trug eine Raute — Basels Anweisung verbannt die Raute
  // aus dem ganzen Programm. Der gefüllte Punkt spricht dieselbe stille Sprache
  // wie das gestempelte Siegel daneben.
  info: '●',
  success: '◉', // a stamped seal
  warn: '▲',
  alert: '✕',
};

const TONE_COLOR: Record<ToastTone, string> = {
  info: 'var(--w14-ink-aged)',
  success: 'var(--w14-verdigris)',
  warn: 'var(--w14-terra)',
  alert: 'var(--w14-wax-red)',
};

/**
 * Höhengrenze für Titel und Text zusammen. Etwa sechs Zeilen — darüber rollt
 * der Inhalt in seinem eigenen Bereich. Ein einziger Rollbereich für beide,
 * damit nicht zwei Rollbalken übereinanderstehen, und bewusst KEIN Abschneiden
 * mit drei Punkten: was das Gerät gemeldet hat, muss vollständig lesbar
 * bleiben, es soll nur nicht den Schirm füllen.
 */
const TEXT_MAX_HOEHE = 132;

export interface ToastProps {
  toast: ToastShape;
  onDismiss: () => void;
  onClick?: () => void;
}

export function Toast({ toast, onDismiss, onClick }: ToastProps): JSX.Element {
  const style: CSSProperties = {
    minWidth: 280,
    maxWidth: 380,
    backgroundColor: 'var(--w14-parchment-2)',
    color: 'var(--w14-ink)',
    border: `1px solid ${TONE_BORDER[toast.tone]}`,
    borderLeftWidth: 4,
    borderRadius: 'var(--w14-radius-card)',
    boxShadow: 'var(--w14-shadow-modal)',
    padding: '12px 14px 12px 16px',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    columnGap: 12,
    // Zeichen und Schliesskreuz bleiben oben stehen, auch wenn der Text rollt.
    alignItems: 'start',
    // Der Umbruch steht hier in der Blase selbst und nicht nur im umgebenden
    // Kasten: die Blase wird auch einzeln verwendet (Storybook, Prüfungen) und
    // muss dann genauso dicht sein. `anywhere` und nicht `break-word`, weil nur
    // `anywhere` auch die Mindestbreite des Inhalts senkt.
    overflowWrap: 'anywhere',
    cursor: onClick ? 'pointer' : 'default',
  };

  const handleKeyDown = onClick
    ? (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }
    : undefined;

  const anzahl = toast.count ?? 1;

  return (
    <div
      role={toast.tone === 'alert' ? 'alert' : 'status'}
      aria-live={toast.tone === 'alert' ? 'assertive' : 'polite'}
      style={style}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
    >
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--w14-font-display)',
          color: TONE_COLOR[toast.tone],
          fontSize: '1.2rem',
          lineHeight: 1,
        }}
      >
        {TONE_GLYPH[toast.tone]}
      </span>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          // Ohne die Mindestbreite null nimmt eine Rasterzelle die Breite ihres
          // längsten ungebrochenen Wortes an — das war der Fund oben.
          minWidth: 0,
          maxHeight: TEXT_MAX_HOEHE,
          overflowY: 'auto',
          // Ist der Text zu Ende gerollt, darf das Rollen nicht auf die Fläche
          // dahinter überspringen — sonst scrollt der Bezahldialog weg.
          overscrollBehavior: 'contain',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '0.96rem',
              color: 'var(--w14-ink)',
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {toast.title}
          </span>
          {anzahl > 1 && (
            <span
              title={`${anzahl} mal aufgetreten`}
              style={{
                flexShrink: 0,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.72rem',
                color: 'var(--w14-ink-faded)',
                border: '1px solid var(--w14-rule)',
                borderRadius: 'var(--w14-radius-button)',
                padding: '0 6px',
                lineHeight: 1.6,
              }}
            >
              {anzahl} ×
            </span>
          )}
        </div>
        {toast.body !== undefined && (
          <span
            style={{
              fontSize: '0.82rem',
              color: 'var(--w14-ink-faded)',
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {toast.body}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Schließen"
        onClick={(ev) => {
          ev.stopPropagation();
          onDismiss();
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--w14-ink-faded)',
          // Am Tresen wird mit dem Finger weggewischt. Vier Pixel Polsterung
          // ergaben ein Ziel von etwa 16 Pixeln — daneben zu treffen heisst,
          // die Blase anzutippen und damit auf eine andere Fläche zu springen.
          // 44 ist das Mindestmass für eine Fingerfläche, siehe die Marke
          // --w14-touch-min.
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.9rem',
        }}
      >
        ×
      </button>
    </div>
  );
}

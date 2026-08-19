/**
 * PinPad — the brand 4-digit numeric keypad.
 *
 * Used by PinLogin (the first authenticated screen) AND by the global
 * StepUpModal (memory.md #76). Pure presentation: the parent owns the
 * PIN state + submission. Physical keyboard handling is OPT-IN — pass
 * `bindKeyboard` when the pad is the only focusable surface.
 *
 *   <PinPad
 *     value={pin}
 *     onChange={setPin}
 *     onSubmit={runSubmit}
 *     disabled={lockoutActive}
 *     bindKeyboard
 *   />
 *
 * The pad shows dotted underline slots above a 3×4 keypad with a Backspace
 * `⌫` and a plain OK button. The OK button carries NO glyph: a magnifier means
 * „search" and sat here for a while on the control that submits a login, under
 * a wordmark from another house. See the note at the button itself.
 */

import { type CSSProperties, useEffect, useRef } from 'react';

import { Button } from './Button.js';

export interface PinPadProps {
  /** Current PIN (0..PIN_LENGTH digits). */
  value: string;
  /** Called with the new value when a digit / backspace is pressed. */
  onChange: (next: string) => void;
  /**
   * Called when the operator confirms — either by pressing OK explicitly,
   * by pressing Enter (when `bindKeyboard` is true), or implicitly once
   * the last digit lands (when `submitOnComplete` is true).
   */
  onSubmit: () => void;
  /** Greys out the pad — used during submit + during lockout countdowns. */
  disabled?: boolean;
  /**
   * Höchstlänge des Codes, und zugleich die Zahl der gezeichneten Felder.
   * Vorgabe 4 — das ist die alte Schnellsperre, nicht der Kassencode.
   */
  pinLength?: number;
  /**
   * Mindestlänge, ab der abgeschickt werden darf. Ohne Angabe gilt die
   * Höchstlänge, das Feld verhält sich dann wie früher.
   *
   * ⚠️ 31.07.2026, WARUM ES DAS GIBT: der Kassencode ist eine SPANNE, sechs
   * bis zwölf Ziffern (`packages/auth-pin/src/index.ts:106`). Diese Tastatur
   * kannte nur eine feste Länge und stand auf 4. Basel tippte sechs Ziffern,
   * angekommen sind vier, und danach nahm das Feld nichts mehr an — ohne
   * Meldung, ohne einen einzigen Netzruf. Er kam in seine eigene Kasse nicht
   * hinein.
   */
  minLength?: number;
  /**
   * When true, the pad listens to window-level keydown events for digits +
   * Backspace + Enter. Use ONLY when this pad is the only interactive
   * element on the page (login screen, step-up modal).
   */
  bindKeyboard?: boolean;
  /** Auto-fire `onSubmit` when the operator types the final digit. Default true. */
  submitOnComplete?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  pinLength = 4,
  minLength,
  bindKeyboard = false,
  submitOnComplete = true,
  className,
  style,
}: PinPadProps): JSX.Element {
  const mindestens = minLength ?? pinLength;
  const canSubmit = !disabled && value.length >= mindestens && value.length <= pinLength;

  // Von selbst abschicken nur bei FESTER Länge. Bei einer Spanne wäre es ein
  // Fehler: wer zwölf Ziffern will, käme über die sechste nie hinaus.
  const festeLaenge = mindestens === pinLength;
  useEffect(() => {
    if (submitOnComplete && festeLaenge && value.length === pinLength) {
      onSubmit();
    }
  }, [value.length, pinLength, festeLaenge, submitOnComplete, onSubmit, value]);

  /*
   * ── WARUM HIER EIN ZEIGER STEHT UND NICHT NUR `value` ─────────────────────
   *
   * `value` kommt von aussen und ist der Stand des LETZTEN Zeichnens. Landen
   * zwei Druecke im SELBEN Takt, rechnen beide mit demselben alten Wert, und
   * der zweite ueberschreibt den ersten. Gemessen am 04.08.2026: sechs Druecke
   * in einem Buendel ergaben genau eine Ziffer, „6".
   *
   * ⚠️ EHRLICH DAZU: dieser Weg ist heute fuer einen MENSCHEN nicht erreichbar.
   * React behandelt einen Klick als unterbrechungsfreies Ereignis und leert den
   * Zustand sofort; zwei echte Tipper sind zwei Takte. Die Messung oben kam
   * durch sechs `click()`-Aufrufe in EINER Schleife zustande, also durch das
   * Pruefwerkzeug, nicht durch eine Hand. Das ist keine Fehlerbehebung.
   *
   * Es schliesst eine Tuer. Der Zeiger macht die Tafel unabhaengig davon,
   * WOHER die Druecke kommen: aus einem Finger, aus einem Fremdgeraet an der
   * Tastaturleitung, aus kuenftigem Quelltext, der `onDigit` selbst ruft. An
   * der Tuer der Kasse ist ein verschluckter Anschlag teuer: der Code ist
   * falsch, der Zaehler steigt, und nach fuenf davon steht der Laden.
   */
  const letzterWert = useRef(value);
  // Der Zeiger folgt IMMER dem, was von aussen kommt: haelt der Rahmen den
  // Wert an oder setzt er ihn zurueck, gilt sein Wort, nicht der Zeiger.
  if (letzterWert.current !== value) letzterWert.current = value;

  const onDigit = (d: string): void => {
    if (disabled) return;
    if (letzterWert.current.length >= pinLength) return;
    letzterWert.current += d;
    onChange(letzterWert.current);
  };
  const onBackspace = (): void => {
    if (disabled) return;
    letzterWert.current = letzterWert.current.slice(0, -1);
    onChange(letzterWert.current);
  };

  /*
   * ── DIE TASTATUR GEHT DENSELBEN WEG WIE DER FINGER ────────────────────────
   *
   * ⚠️ Hier stand die Rechnung ein ZWEITES Mal:
   *
   *     if (/^[0-9]$/.test(ev.key)) { if (value.length < pinLength) … }
   *     else if (ev.key === 'Backspace') onChange(value.slice(0, -1));
   *
   * Zwei Listen, die dasselbe tun, driften. Diese hier drifteten schon: die
   * Finger-Fassung bekam oben den Zeiger, die Tastatur-Fassung haette weiter
   * mit dem alten `value` gerechnet. Wer den Kassencode tippt statt tippt, waere
   * auf der schlechteren Haelfte gelandet, und niemand haette es gemerkt.
   *
   * Es gibt jetzt EINEN Weg. Was hier steht, ist nur noch die Zuordnung
   * Taste → Handgriff.
   */
  const zifferRef = useRef(onDigit);
  const loeschRef = useRef(onBackspace);
  /*
   * ⚠️ HIER STAND BEIM ZUSAMMENFUEHREN EIN NEUER FEHLER, VON MIR.
   *
   * Der alte Tastaturweg begann mit `if (disabled) return;` und deckte damit
   * ALLE drei Tasten ab, auch Enter. Als ich Ziffer und Loeschen auf die
   * gemeinsamen Handgriffe legte, wanderte die Sperrpruefung dorthin mit — nur
   * Enter blieb ohne. Wer nach fuenf Fehlversuchen gesperrt ist und Enter
   * drueckt, haette abgeschickt.
   *
   * Deshalb geht auch das Absenden ueber ein Tor, und das Tor ist genau das,
   * das der OK-Knopf benutzt: `canSubmit`. EIN Urteil, zwei Wege.
   */
  const sendeRef = useRef<() => void>(() => {});
  zifferRef.current = onDigit;
  loeschRef.current = onBackspace;
  sendeRef.current = () => {
    if (canSubmit) onSubmit();
  };

  useEffect(() => {
    if (!bindKeyboard) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (/^[0-9]$/.test(ev.key)) zifferRef.current(ev.key);
      else if (ev.key === 'Backspace') loeschRef.current();
      else if (ev.key === 'Enter') sendeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindKeyboard]);

  return (
    <div className={className} style={style}>
      <div
        aria-label="PIN"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {Array.from({
          // Bei fester Laenge alle Felder. Bei einer Spanne: die Mindestzahl,
          // und waehrend des Tippens waechst sie mit, bis zur Hoechstzahl.
          length: festeLaenge
            ? pinLength
            : Math.min(pinLength, Math.max(mindestens, value.length + 1)),
        }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 48,
              height: 56,
              /*
               * ⚠️ HIER STAND `--w14-rule`, UND DAS FELD WAR UNSICHTBAR.
               *
               * Am 04.08.2026 auf dem Schirm gemessen: die Kante lag bei
               * `rgb(233,231,225)` auf einem Karton von `rgb(242,236,225)`.
               * Das sind 1,05 zu 1. WCAG 1.4.11 verlangt 3 zu 1 fuer ein
               * Bedienelement. Der Haendler richtet den Schnellcode ein,
               * tippt vier Ziffern und sieht KEIN Feld, in das er tippt.
               *
               * Genau Basels Wort: manche Felder sind weggewischt.
               *
               * Die Marke sagt es an ihrer eigenen Stelle: `--w14-feldlinie`
               * ist „der Unterstrich von Eingabefeldern, nie die Zierlinie".
               * `--w14-rule` ist die Zierlinie. Hier stand die falsche, und
               * sie stand an der einzigen Stelle im ganzen Haus, an der ein
               * EINGABEFELD sie benutzte.
               */
              /* 19.08.2026: ein GEFUELLTES Feld zieht seinen Unterstrich auf
                 Tinte — die Zeile antwortet dem Tippen, statt stumm zu bleiben. */
              borderBottom: `2px solid ${value[i] ? 'var(--w14-ink)' : 'var(--w14-feldlinie)'}`,
              transition: 'border-color var(--w14-dur-fast) var(--w14-ease-hover)',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.6rem',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--w14-ink)',
            }}
          >
            {value[i] ? (
              /* Der Punkt waechst kurz aus der Mitte (w14-punkt-auf) — er
                 erscheint nur beim LANDEN der Ziffer neu im Baum, deshalb
                 laeuft die Bewegung genau einmal je Eingabe. */
              <span
                aria-hidden
                style={{ animation: 'w14-punkt-auf var(--w14-dur-fast) var(--w14-ease-curator)' }}
              >
                ●
              </span>
            ) : (
              ''
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            variant="primary"
            size="lg"
            onClick={() => onDigit(d)}
            disabled={disabled}
            style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '1.4rem' }}
          >
            {d}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="lg"
          onClick={onBackspace}
          disabled={disabled || value.length === 0}
          aria-label="Zurück"
        >
          ⌫
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => onDigit('0')}
          disabled={disabled}
          style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '1.4rem' }}
        >
          0
        </Button>
        {/*
          ⚠️ 31.07.2026, auf dem Schirm gesehen: hier trug der Bestätigen-Knopf
          eine LUPE. Zwei Fehler in einem Bild.

          Erstens die Bedeutung: eine Lupe heißt „suchen". Sie steht in dieser
          Kasse an fünf Suchfeldern, und dort gehört sie hin. Auf dem Knopf, der
          eine Anmeldung ABSCHICKT, sagt sie dem Händler das Gegenteil dessen,
          was der Knopf tut.

          Zweitens die Marke: `MagnifierIcon` ist laut seinem eigenen Kopf „aus
          dem warehouse-14-logo herausgeschnitten". Auf der Anmeldung von Norns
          war damit ein fremdes Wappen das Erste, was der Händler sah — direkt
          unter dem Norns-Schriftzug.

          Der Knopf trägt jetzt nur sein Wort. Das trifft alle vier Flächen auf
          einmal, die diesen Block benutzen: Anmeldung, Gerätesperre,
          Stufenabfrage und die Sperre der Inhaber-App.
        */}
        {/*
          ⚠️ 04.08.2026, am laufenden Bild gemessen: dieser Knopf war „ghost"
          und stand zwischen ZEHN tintengefüllten Zifferntasten. Der eine
          Griff, der die Kasse aufschliesst, war der leiseste auf der Fläche.

          Das ist Basels Befund („man erkennt nicht, ob es ein Knopf ist") an
          der empfindlichsten Stelle des Programms: der Kassierer steht morgens
          davor, hat den Code getippt und sucht, womit er ihn abschickt.

          Der Akzent des Hauses steht dafür bereit, und sein Paar mit
          `--w14-accent-ink` ist im Kontrastwächter in BEIDEN Themen auf 4,5:1
          festgenagelt. Deshalb hier keine neue Farbe, sondern die, die es
          schon gibt und die schon bewacht wird.
        */}
        <Button
          variant="akzent"
          size="lg"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Anmelden"
        >
          OK
        </Button>
      </div>
    </div>
  );
}

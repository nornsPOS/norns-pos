/**
 * ZustandFehler — die Fläche für „der Server hat nicht geantwortet".
 *
 * ── DER FUND ────────────────────────────────────────────────────────────────
 * „Keine Daten" und „nicht erreichbar" wurden auf dieselbe leere Liste
 * abgebildet — und diese leere Liste dann als Tatsache formuliert. Der
 * teuerste Fall war die Kundensuche: bei einem Serverfehler stand „Kein
 * Treffer" auf dem Schirm, daneben der Knopf, einen neuen Kunden anzulegen,
 * und der Käufer war in Wahrheit GESPERRT. Wer am Tresen der Anzeige glaubte,
 * legte eine zweite, blanke Akte an; die Sperre der ersten galt damit nicht
 * mehr, und die Identifizierung nach §10 GwG war formal erfüllt und
 * tatsächlich ausgehebelt.
 *
 * Dort ist es behoben, aber nur dort. Neun weitere Flächen haben einen
 * Ladezustand und KEINEN Fehlerzweig — sie erzählen denselben Trugschluss
 * weiter. Dieses Bauteil ist die eine Fläche, auf der ein Fehlschlag wie ein
 * Fehlschlag aussieht: nicht wie Leere, und niemals wie ein Befund.
 *
 * ── DER SATZ KOMMT VON AUSSEN ───────────────────────────────────────────────
 * `satz` ist eine Zeichenkette, KEIN Fehlerobjekt — mit Absicht. Der Aufrufer
 * hat `describeError`; dürfte dieses Bauteil selbst übersetzen, gäbe es zwei
 * Sätze über denselben Fehler und irgendwann zwei verschiedene. Zwei
 * Wahrheiten über einen Fehler sind eine zu viel. Die Bauform verhindert das:
 * es gibt gar keinen Weg, hier ein Fehlerobjekt hineinzureichen.
 *
 * Die Namen `satz` und `onErneut` sind nicht frei gewählt: sieben Flächen der
 * Kasse (Leitstand, Risikoanalyse, Schaufenster, Zielkarte, Team, Kurse) rufen
 * dieses Bauteil bereits so auf. Alles Weitere ist zusätzlich und freiwillig,
 * damit diese Aufrufe unverändert weiter übersetzen.
 *
 * ── WARUM `role="alert"` UND NICHT `role="status"` ──────────────────────────
 * Eine Meldung, die nur höflich in die Warteschlange geht, kommt genau dann zu
 * spät, wenn sie zählt: Der Bildschirm zeigt sonst eine leere Liste, und wer
 * ihr glaubt, handelt bereits falsch, bevor der Vorleser fertig ist. Der Satz
 * widerspricht dem, was die Fläche sonst behauptet, und er erscheint
 * ungefragt — das sind genau die zwei Merkmale, für die `alert` gedacht ist.
 * `ZustandLeer` dagegen ist ein Befund, keine Störung, und bleibt `status`.
 *
 * Der Bereich mit `role="alert"` umschliesst NUR den Text. Der Knopf steht
 * ausserhalb: sonst liest der Vorleser bei jedem Einblenden auch die
 * Knopfbeschriftung vor, und der Kern der Meldung geht darin unter.
 */

import type { CSSProperties, ReactNode } from 'react';

import { TriangleAlert } from 'lucide-react';

import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { ParchmentCard } from './ParchmentCard.js';

export interface ZustandFehlerProps {
  /**
   * Der EINE Satz zum Fehler, fertig übersetzt vom Aufrufer (`describeError`).
   * Bewusst `string` und nicht `unknown`/`Error`: dieses Bauteil übersetzt
   * nichts und soll es auch nicht können.
   */
  satz: string;
  /** Überschrift. Rein strukturell — die Begründung steht in `satz`. */
  titel?: string;
  /**
   * Was jetzt NICHT gesagt werden kann. Der Satz, der die falsche Handlung
   * verhindert („Ob dieser Käufer gesperrt ist, lässt sich jetzt nicht sagen").
   */
  folge?: string;
  /** Fehlt der Rückruf, erscheint kein Knopf — dann gibt es hier nichts zu holen. */
  onErneut?: () => void;
  /** Ein Versuch läuft gerade: der Knopf ist gesperrt und sagt das auch. */
  laeuft?: boolean;
  /**
   * Es steht ein älterer Stand auf dem Schirm (etwa aus `useCachedQuery`).
   * Ohne diesen Hinweis hält jemand alte Zahlen für aktuelle.
   */
  zeigtAeltereDaten?: boolean;
  /** Platz für die Standmarke (etwa `StaleBadge`) neben dem Hinweis. */
  standNotiz?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Umbruchregeln für JEDEN Textabsatz hier.
 *
 * Basels Klage „der Text bricht mittendrin ab" kam von Kästen, die ihren
 * Inhalt abgeschnitten haben. Deshalb: kein `nowrap`, kein `textOverflow`,
 * keine feste Höhe. `overflowWrap: 'anywhere'` bricht nicht nur den langen
 * Wortwurm um, es senkt auch die Mindestbreite des Absatzes — ohne das
 * drückt eine lange Fehlerkennung den ganzen Kasten breiter als seine Spalte.
 * `minWidth: 0` ist der zweite Teil desselben Fundes: ein Flex-Kind weigert
 * sich sonst, unter seine Inhaltsbreite zu schrumpfen.
 */
const FLIESSTEXT: CSSProperties = {
  margin: 0,
  minWidth: 0,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  hyphens: 'auto',
  lineHeight: 'var(--w14-leading-body)',
};

export function ZustandFehler({
  satz,
  titel = 'Nicht geladen',
  folge,
  onErneut,
  laeuft = false,
  zeigtAeltereDaten = false,
  standNotiz,
  className,
  style,
}: ZustandFehlerProps): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      className={className}
      data-testid="w14-zustand-fehler"
      style={{
        border: '1px solid var(--w14-wax-red)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-space-2)',
        alignItems: 'flex-start',
        minWidth: 0,
        ...style,
      }}
    >
      <div
        role="alert"
        aria-busy={laeuft || undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-space-1)',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--w14-space-1)',
            minWidth: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{ flex: '0 0 auto', color: 'var(--w14-wax-red)', lineHeight: 1 }}
          >
            <Icon icon={TriangleAlert} size={20} />
          </span>
          <p
            style={{
              ...FLIESSTEXT,
              color: 'var(--w14-wax-red)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-step-1)',
              fontWeight: 600,
              lineHeight: 'var(--w14-leading-snug)',
            }}
          >
            {titel}
          </p>
        </div>

        <p
          style={{
            ...FLIESSTEXT,
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-step-0)',
          }}
        >
          {satz}
        </p>

        {folge ? (
          <p
            style={{
              ...FLIESSTEXT,
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-step--1)',
            }}
          >
            {folge}
          </p>
        ) : null}

        {zeigtAeltereDaten ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--w14-space-1)',
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            <p
              style={{
                ...FLIESSTEXT,
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-step--1)',
                fontStyle: 'italic',
              }}
            >
              Angezeigt wird der zuletzt bekannte Stand. Die Zahlen können veraltet sein.
            </p>
            {standNotiz}
          </div>
        ) : null}
      </div>

      {onErneut ? (
        <Button
          variant="primary"
          size="md"
          onClick={onErneut}
          disabled={laeuft}
        >
          {laeuft ? 'Versucht…' : 'Erneut versuchen'}
        </Button>
      ) : null}
    </ParchmentCard>
  );
}

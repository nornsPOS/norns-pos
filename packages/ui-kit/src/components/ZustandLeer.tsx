/**
 * ZustandLeer — die Fläche für „hier ist wirklich nichts".
 *
 * ── WARUM ES DIESES BAUTEIL GIBT ────────────────────────────────────────────
 * Es ist die Zwillingsfläche zu `ZustandFehler`. Solange „keine Daten" und
 * „nicht erreichbar" dieselbe leere Liste ergaben, konnte man beide nicht
 * auseinanderhalten — und die Kasse hat den einen Fall im Zweifel als den
 * anderen ausgegeben, samt Einladung zur falschen Handlung. Zwei getrennte
 * Bauteile machen die Unterscheidung sichtbar und erzwingen sie beim
 * Schreiben: wer `ZustandLeer` wählt, behauptet, dass eine Antwort da war und
 * leer ausfiel. Wer sich nicht sicher ist, nimmt `ZustandFehler`.
 *
 * ── KEINE SACKGASSE ─────────────────────────────────────────────────────────
 * Ein leerer Zustand ohne Ausweg lässt jemanden am Tresen stehen, der gerade
 * einen Kunden vor sich hat. Zu jeder Leere gehört deshalb die NÄCHSTE
 * HANDLUNG: ein Knopf (`handlung`) oder wenigstens ein Satz, der sie nennt
 * (`wegweiser`).
 *
 * Beides ist trotzdem optional, und das ist eine Entscheidung, keine
 * Nachlässigkeit. Es gibt echte Leeren, deren Ausweg gar nicht auf dieser
 * Fläche liegt: „heute noch kein Beleg" wird durch einen Verkauf behoben,
 * nicht durch einen Knopf in der Belegliste. Ein Typ, der dort einen Ausweg
 * erzwingt, produziert erfundene Knöpfe — und ein erfundener Knopf ist
 * schlimmer als keiner.
 *
 * ── WARUM `role="status"` UND NICHT `alert` ─────────────────────────────────
 * Leere ist ein Befund, keine Störung. Der Vorleser soll ihn nennen, wenn er
 * an der Reihe ist, und nicht unterbrechen, was gerade gelesen wird.
 * Umgekehrt bei `ZustandFehler`: dort widerspricht der Satz dem, was die
 * Fläche sonst behauptet, und muss deshalb dazwischenreden.
 *
 * Die Namen `satz` und `handlung` sind an die vorhandene Aufrufstelle in der
 * Kasse gebunden (die Belegliste) — und `satz` heisst hier absichtlich genauso
 * wie in `ZustandFehler`: in beiden Fällen ist es der eine tragende Satz.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Button } from './Button.js';
import { ParchmentCard } from './ParchmentCard.js';

export interface ZustandHandlung {
  /** Knopfbeschriftung — ein Verb, keine Beschreibung („Suche zurücksetzen"). */
  text: string;
  onTun: () => void;
  /** Der Ausweg ist gerade gesperrt (fehlende Berechtigung, laufender Vorgang). */
  gesperrt?: boolean;
  /** Warum gesperrt — steht unter dem Knopf, damit niemand raten muss. */
  gesperrtGrund?: string;
}

export interface ZustandLeerProps {
  /** Was fehlt, in einem Satz: „Noch kein Beleg an diesem Tag." */
  satz: string;
  /** Warum es leer ist, wenn das nicht auf der Hand liegt. */
  hinweis?: string;
  /**
   * Die nächste Handlung als Satz, wenn sie sich nicht auf einen Knopf
   * verkürzen lässt („Namen kürzen oder nach der Telefonnummer suchen").
   */
  wegweiser?: string;
  /** Die nächste Handlung als Knopf. */
  handlung?: ZustandHandlung;
  className?: string;
  style?: CSSProperties;
}

/**
 * Dieselben Umbruchregeln wie in `ZustandFehler`: kein `nowrap`, kein
 * `textOverflow`, keine feste Höhe. Ein Kundenname oder eine Suchanfrage ohne
 * Leerzeichen darf den Kasten weder sprengen noch abgeschnitten werden.
 * `overflowWrap: 'anywhere'` senkt zusätzlich die Mindestbreite des Absatzes,
 * und `minWidth: 0` nimmt dem Flex-Kind die Weigerung, darunter zu schrumpfen.
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

export function ZustandLeer({
  satz,
  hinweis,
  wegweiser,
  handlung,
  className,
  style,
}: ZustandLeerProps): JSX.Element {
  let ausweg: ReactNode = null;
  if (handlung) {
    ausweg = (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-space-1)',
          alignItems: 'flex-start',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <Button variant="primary" size="md" onClick={handlung.onTun} disabled={handlung.gesperrt}>
          {handlung.text}
        </Button>
        {handlung.gesperrt && handlung.gesperrtGrund ? (
          <p
            style={{
              ...FLIESSTEXT,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-step--1)',
            }}
          >
            {handlung.gesperrtGrund}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ParchmentCard
      padding="md"
      className={className}
      data-testid="w14-zustand-leer"
      style={{
        border: '1px solid var(--w14-rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-space-2)',
        alignItems: 'flex-start',
        minWidth: 0,
        ...style,
      }}
    >
      <div
        role="status"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-space-1)',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <p
          style={{
            ...FLIESSTEXT,
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-display)',
            fontSize: 'var(--w14-step-1)',
            fontWeight: 600,
            lineHeight: 'var(--w14-leading-snug)',
          }}
        >
          {satz}
        </p>

        {hinweis ? (
          <p
            style={{
              ...FLIESSTEXT,
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-step-0)',
            }}
          >
            {hinweis}
          </p>
        ) : null}

        {wegweiser ? (
          <p
            style={{
              ...FLIESSTEXT,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-step--1)',
              fontStyle: 'italic',
            }}
          >
            {wegweiser}
          </p>
        ) : null}
      </div>

      {ausweg}
    </ParchmentCard>
  );
}

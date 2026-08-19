/**
 * Zielkarte — the owner's live "treasure board" of goals (Tier-2 surface).
 *
 * A deliberate dark instrument panel over the same live sources the Werkstatt
 * dashboard reads (bridge · finance · inventory · metals · fixed costs), folded
 * into vector gauges. Every value is a real endpoint number; an unreadable
 * source draws a calm locked instrument, never a fabricated figure.
 *
 * Ported into tauri-pos as a pure ADDITION (nothing removed). The data layer +
 * instruments are self-contained under ./; this screen only lays them out.
 */

import { useSyncExternalStore } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { InfoPunkt, Zwischentitel, ZustandFehler } from '@norns/ui-kit';

import { C, GoalTile, GoalsScroll, TreasureMapPanel } from './instruments.js';
import { useZielkarteBoard } from './zielkarte-data.js';

/**
 * Hat eine der sieben Quellen der Tafel zuletzt einen Fehler zurückgegeben?
 *
 * Die Tafel selbst reicht nur `available` je Instrument durch, nicht den Grund.
 * Statt die sieben Abfragen hier ein zweites Mal zu stellen — das wäre eine
 * zweite Wahrheit und doppelte Last — wird dieselbe Ablage mitgelesen, die die
 * Tafel ohnehin füllt. Kein zusätzlicher Abruf, nur ein Blick darauf.
 *
 * Die Momentaufnahme gibt bewusst einen Wahrheitswert und keine Liste zurück:
 * ein bei jedem Aufruf frisch gebautes Feld wäre nie wieder dasselbe und würde
 * die Fläche endlos neu zeichnen.
 */
function useQuellenFehler(): boolean {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (aendern) => qc.getQueryCache().subscribe(aendern),
    () => qc.getQueryCache().getAll().some((q) => q.queryKey[0] === 'ziel' && q.state.error != null),
  );
}

export function Zielkarte(): JSX.Element {
  const board = useZielkarteBoard();
  const qc = useQueryClient();
  const quellenFehler = useQuellenFehler();

  // ── FUND: die Tafel konnte NICHT sagen, dass niemand mehr antwortet ───────
  // Jedes einzelne Instrument sperrt sich ehrlich, wenn seine Quelle nicht
  // lesbar ist — das war von Anfang an richtig gebaut. Was fehlte, war die
  // Aussage über das GANZE: sind ALLE Zeiger gesperrt, sah die Tafel aus wie
  // ein Haus, in dem an jedem Ziel eine Null steht. Ruhig, gepflegt, und
  // vollkommen missverständlich. Kein einziger Zeiger lesbar heisst nicht
  // „nichts los", es heisst „hier spricht gerade niemand mit dir".
  //
  // Beide Bedingungen zusammen: ein Fehler ALLEIN darf die Tafel nicht leeren,
  // solange noch Zeiger echte Zahlen tragen — dann bleibt die Tafel stehen und
  // nur die betroffenen Instrumente sind gesperrt.
  const keinInstrumentLesbar =
    board.metrics.length > 0 && board.metrics.every((m) => !m.available);
  const zeigeAusfall = quellenFehler && keinInstrumentLesbar && !board.isFirstLoad;

  return (
    <div style={{ padding: 'var(--w14-abstand-20)' }}>
      <Zwischentitel tone="gold" label="Zielkarte" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-16)',
          marginTop: 8,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        {/* Weniger Zeitung (27.07.2026): der Vorspann wohnt im Fragezeichen. */}
        <InfoPunkt
          ariaLabel="Was ist die Zielkarte?"
          text="Die Ziele des Hauses als lebendige Instrumententafel: jeder Zeiger liest denselben Live-Wert wie die Übersicht, das Ziel daneben ist der Richtwert. Ein noch nicht lesbarer Wert zeigt ein gesperrtes Instrument statt einer erfundenen Zahl."
        />
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-8)',
            color: 'var(--w14-ink-faded)',
            fontSize: 'var(--w14-schrift-feld)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: zeigeAusfall
                ? 'var(--w14-wax-red)'
                : board.isFetching
                  ? 'var(--w14-gold)'
                  : 'var(--w14-verdigris)',
              display: 'inline-block',
            }}
          />
          {zeigeAusfall ? 'Keine Quelle antwortet' : board.isFetching ? 'Aktualisiert …' : 'Live · alle 30 s'}
        </span>
      </div>

      {/* Eine Tafel voller gesperrter Zeiger ist keine Tafel — sie ist ein
          Ausfall, der wie ein Ergebnis aussieht. Dann steht hier der Ausfall. */}
      {zeigeAusfall ? (
        <ZustandFehler
          satz="Keine der Quellen antwortet gerade. Die Zeiger blieben deshalb leer, statt eine Zahl zu erfinden."
          folge="Wie das Haus heute steht, lässt sich jetzt nicht sagen. Eine leere Tafel ist kein Nullergebnis."
          onErneut={() => void qc.invalidateQueries({ queryKey: ['ziel'] })}
        />
      ) : (
      /* The dark instrument-panel canvas. */
      <div
        style={{
          position: 'relative',
          background: `radial-gradient(140% 120% at 50% 0%, #17140d, ${C.page} 70%)`,
          borderRadius: 16,
          border: `1px solid ${C.edge}`,
          padding: 'var(--w14-abstand-16)',
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 0 rgba(255,240,200,0.05), 0 8px 26px rgba(0,0,0,0.35)',
        }}
      >
        {/* faint brushed-panel grain over the whole console */}
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 16, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.5 }}
        >
          <filter id="ziel_boardnoise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0.5 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#ziel_boardnoise)" />
        </svg>
        <div
          style={{
            position: 'relative',
            // Innere Schichtung ueber der Rauschflaeche: der gewoehnliche Fluss der
            // Leiter, keine nackte Zahl. Die Rauschflaeche steht davor im
            // Baum, der Inhalt zeichnet deshalb darueber.
            zIndex: 'var(--w14-z-basis)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
            gap: 'var(--w14-abstand-14)',
          }}
        >
          {board.metrics.map((m) => (
            <GoalTile key={m.id} metric={m} />
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            // Innere Schichtung ueber der Rauschflaeche: der gewoehnliche Fluss der
            // Leiter, keine nackte Zahl. Die Rauschflaeche steht davor im
            // Baum, der Inhalt zeichnet deshalb darueber.
            zIndex: 'var(--w14-z-basis)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 'var(--w14-abstand-14)',
            marginTop: 14,
          }}
        >
          <GoalsScroll bars={board.monthlyBars} />
          <TreasureMapPanel overall={board.overall} available={board.overallAvailable} />
        </div>
      </div>
      )}
    </div>
  );
}

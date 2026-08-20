/**
 * Splash — the cold-start parchment behind the session probe.
 *
 * Renders the brand seal + italic motto. Stays under ~200 ms on a healthy
 * network — the operator essentially sees a quiet "warming up" beat, then
 * either the login screen (no session) or the Werkstatt (session restored).
 */

import { Zwischentitel, NornsWortmarke, ParchmentCard } from '@norns/ui-kit';

export function Splash(): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--w14-parchment)',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(380px, 100%)', textAlign: 'center' }}>
        {/* ⚠️ 04.08.2026: hier stand DARÜBER noch `<Seal size="lg" />`, also
            ein N im gestempelten Kreis, direkt über dem echten Zeichen. Der
            Händler sah zwei Marken übereinander, und die obere war eine
            erfundene. Basel hat genau das verboten. Weg damit; die Marke ist
            das Zeichen mit dem Faden, und es steht hier allein. */}
        {/* Die Marke, die der Haendler als ERSTES sieht: das Zeichen, dann
            der Name. */}
        {/* 20.08.2026, Basels Anweisung: EINE Marke, nicht zwei untereinander.
            Das Zeichen ist das N des Namens. */}
        <h1 style={{ margin: '0 0 4px', fontWeight: 500 }}>
          <NornsWortmarke
            faden="var(--w14-weinrot, #9c2630)"
            tinte="var(--w14-ink)"
            style={{ fontSize: 'var(--w14-schrift-flaeche)', fontWeight: 500 }}
          />
        </h1>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Sitzung wird geprüft…
        </p>
        <Zwischentitel />
      </ParchmentCard>
    </div>
  );
}

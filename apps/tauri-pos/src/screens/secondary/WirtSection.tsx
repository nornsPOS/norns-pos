/**
 * Der Wirt — das Geraet, auf dem diese Kasse laeuft.
 *
 * ── WARUM ES DIESE SEKTION GIBT (14.08.2026, Basels Auftrag) ───────────────
 *
 * Die Kasse soll ihren Wirt KENNEN: Betriebssystem samt Kern, Prozessor,
 * Arbeitsspeicher und den Datentraeger, auf dem ihre Daten wirklich liegen.
 * Nicht als Spielerei — bei einem Stoerungsanruf ist „welcher Rechner, wie
 * voll ist die Platte" die erste Frage, und der Haendler soll sie ablesen
 * koennen statt raten.
 *
 * ⚠️ Jede Zahl hier ist GEMESSEN (Rust, sysinfo), keine geraten. Und der
 * Datentraeger ist ueber den Einhaengepunkt des Kassendaten-Ordners
 * bestimmt — eine Kasse mit Daten auf einem zweiten Laufwerk sieht DIESES
 * Laufwerk, nicht stur die Systemplatte.
 *
 * Die Anzeige frischt sich alle 30 Sekunden auf: Speicher und Platte sind
 * lebende Groessen. Ausserhalb der Tauri-Huelle (reiner Browserlauf in der
 * Entwicklung) sagt die Sektion ehrlich, dass sie nichts messen kann.
 */

import { useQuery } from '@tanstack/react-query';

import { Zwischentitel } from '@norns/ui-kit';

import { isRunningInTauri, systemClient, type WirtSteckbrief } from '../../lib/hardware-client.js';

/** Deutsche Zahl mit einer Nachkommastelle, Komma statt Punkt. */
function zahl(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Die Farbe eines Fuellstands: ruhig bis 85 Prozent, gold darueber, rot ab
 * 95 — dieselbe Ampellogik, mit der das Haus ueberall Ernst kennzeichnet.
 */
function fuellFarbe(anteil: number): string {
  if (anteil >= 0.95) return 'var(--w14-danger)';
  if (anteil >= 0.85) return 'var(--w14-gold)';
  return 'var(--w14-verdigris)';
}

function Messleiste({
  beschriftung,
  wert,
  anteil,
}: {
  beschriftung: string;
  wert: string;
  anteil: number;
}): JSX.Element {
  const begrenzt = Math.min(1, Math.max(0, anteil));
  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-8)',
          fontSize: 'var(--w14-schrift-zeile)',
        }}
      >
        <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em' }}>
          {beschriftung}
        </span>
        <span style={{ color: 'var(--w14-ink)', fontVariantNumeric: 'tabular-nums' }}>{wert}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(begrenzt * 100)}
        aria-label={beschriftung}
        style={{ height: 3, borderRadius: 2, background: 'var(--w14-rule)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: `${begrenzt * 100}%`,
            borderRadius: 2,
            background: fuellFarbe(begrenzt),
          }}
        />
      </div>
    </div>
  );
}

export function WirtSection(): JSX.Element {
  const inTauri = isRunningInTauri();
  const { data, isError } = useQuery<WirtSteckbrief>({
    queryKey: ['wirt-steckbrief'],
    queryFn: () => systemClient.wirtSteckbrief(),
    enabled: inTauri,
    // Lebende Groessen, aber keine Boerse: alle 30 Sekunden reicht.
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  return (
    <section aria-label="Dieses Geraet" style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
      <h2
        style={{
          margin: 0,
          fontSize: 'var(--w14-schrift-text)',
          color: 'var(--w14-ink)',
          fontFamily: 'var(--w14-font-display)',
        }}
      >
        Dieses Gerät
      </h2>

      {!inTauri ? (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Ausserhalb der Kassen-Hülle lässt sich das Gerät nicht vermessen.
        </p>
      ) : isError ? (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Die Messung liess sich gerade nicht lesen.
        </p>
      ) : data === undefined ? (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Das Gerät wird vermessen …
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            <strong style={{ color: 'var(--w14-ink)' }}>{data.rechnername}</strong>
            {' · '}
            {data.betriebssystem}
            {' · Kern '}
            {data.kern}
            {' · '}
            {data.prozessor}, {data.kerne} Kerne, {data.architektur}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--w14-abstand-12)',
            }}
          >
            <Messleiste
              beschriftung="Arbeitsspeicher"
              wert={`${zahl(data.speicherBenutztMb / 1024)} von ${zahl(data.speicherGesamtMb / 1024)} GB belegt`}
              anteil={data.speicherGesamtMb === 0 ? 0 : data.speicherBenutztMb / data.speicherGesamtMb}
            />
            <Messleiste
              beschriftung={`Datenträger ${data.plattePfad || ''}`.trim()}
              wert={`${zahl(data.platteFreiGb)} von ${zahl(data.platteGesamtGb)} GB frei`}
              anteil={
                data.platteGesamtGb === 0 ? 0 : (data.platteGesamtGb - data.platteFreiGb) / data.platteGesamtGb
              }
            />
          </div>
        </>
      )}

      <Zwischentitel />
    </section>
  );
}

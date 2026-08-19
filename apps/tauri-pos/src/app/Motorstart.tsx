/**
 * Motorstart — die Wartefläche, bis der Server im Gerät steht.
 *
 * ── WARUM ES DIESE FLÄCHE GIBT ──────────────────────────────────────────────
 *
 * Norns POS bringt seinen Server mit (siehe `src-tauri/src/motor.rs`). Der
 * braucht beim kalten Start 2,4 Sekunden, davon knapp eine für das Anlegen der
 * Datenbank beim allerersten Mal. In dieser Zeit gibt es noch keine Anschrift,
 * unter der die Kasse fragen könnte.
 *
 * Ohne diese Fläche wären das 2,4 Sekunden weisses Fenster, gefolgt von einer
 * Kasse, deren erste zwanzig Abfragen ins Leere gehen. Mit ihr ist es ein
 * ruhiger, erklärter Moment.
 *
 * ── WAS SIE NICHT TUT ───────────────────────────────────────────────────────
 *
 * Kein Fortschrittsbalken mit Prozenten. Wir wissen nicht, wie weit der Motor
 * ist, und einen Balken zu malen, der in Wahrheit nur die Zeit abläuft, wäre
 * gelogen. Es gibt einen Zustand, einen Satz dazu, und eine Linie, die atmet.
 *
 * Und: kein Weiterreichen bei Fehlern. Steht der Motor nicht, kommt die Kasse
 * nicht. Eine Kasse, die ohne ihre Datenbank ein Verkaufsfenster zeigt, nimmt
 * Belege an, die nirgendwo landen.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { NornsZeichen } from '@norns/ui-kit';

/** Der Zustand, wie ihn `motor_stand` in Rust liefert. */
type Stand =
  | { stand: 'startet' }
  | { stand: 'bereit'; adresse: string }
  | { stand: 'fehler'; grund: string };

/**
 * Wie oft nachgefragt wird. 120 ms ist schnell genug, dass der Übergang wie
 * ein Aufschlagen wirkt, und langsam genug, dass in den 2,4 Sekunden nicht
 * zweihundert Anfragen anfallen.
 */
const TAKT = 120;

/**
 * Ab wann die Fläche zugibt, dass es länger dauert als üblich. Sitzung A misst
 * 2,4 s kalt; bei zwölf Sekunden stimmt etwas nicht, und das gehört gesagt,
 * bevor der Händler selbst rät.
 */
const GEDULD = 12_000;

/**
 * Ausserhalb eines Tauri-Fensters (Browser, Tests) gibt es keinen Motor. Dann
 * gilt die Anschrift aus der Umgebung, wie bisher.
 */
async function frageStand(): Promise<Stand | null> {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!tauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('motor_stand')) as Stand;
}

export function Motorstart({
  kind,
}: {
  /** Bekommt die Anschrift des Motors, sobald er steht. */
  kind: (adresse: string | null) => ReactNode;
}) {
  const [stand, setStand] = useState<Stand | 'ohneMotor' | null>(null);
  const [lange, setLange] = useState(false);

  useEffect(() => {
    let lebt = true;
    const geduld = setTimeout(() => lebt && setLange(true), GEDULD);
    let uhr: ReturnType<typeof setTimeout> | undefined;

    const runde = async () => {
      if (!lebt) return;
      try {
        const s = await frageStand();
        if (!lebt) return;
        if (s === null) {
          setStand('ohneMotor');
          return;
        }
        setStand(s);
        // Nur weiterfragen, solange er wirklich noch hochfährt.
        if (s.stand === 'startet') uhr = setTimeout(runde, TAKT);
      } catch (e) {
        if (!lebt) return;
        // Der Befehl selbst ist nicht erreichbar. Das ist ein Fehler des
        // Rumpfes, kein Grund weiterzulaufen.
        setStand({
          stand: 'fehler',
          grund:
            e instanceof Error
              ? e.message
              : 'Die Kasse erreicht ihren eigenen Rumpf nicht.',
        });
      }
    };
    void runde();

    return () => {
      lebt = false;
      clearTimeout(geduld);
      if (uhr) clearTimeout(uhr);
    };
  }, []);

  if (stand === 'ohneMotor') return <>{kind(null)}</>;
  if (stand?.stand === 'bereit') return <>{kind(stand.adresse)}</>;

  const gescheitert = stand?.stand === 'fehler' ? stand.grund : null;
  return <Warteflaeche grund={gescheitert} lange={lange} />;
}

function Warteflaeche({ grund, lange }: { grund: string | null; lange: boolean }) {
  return (
    <div style={HUELLE}>
      <style>{ATEM}</style>
      <div style={MITTE}>
        {/* Dasselbe Zeichen wie an der Zifferntuer und auf dem Startbild. */}
        <NornsZeichen faden="var(--w14-weinrot, #9c2630)"
          size={64}
          tinte="var(--w14-ink)"
          titel="Norns"
          style={{ display: 'block', margin: '0 auto var(--w14-abstand-10)' }}
        />
        <p style={MARKE}>NORNS</p>
        <p style={UNTERZEILE}>Kasse</p>

        <div style={LINIE} aria-hidden="true">
          {!grund && <span className="norns-atem" style={LAEUFER} />}
        </div>

        {grund ? (
          <div role="alert" style={FEHLERFELD}>
            <p style={FEHLERKOPF}>Die Kasse konnte nicht starten.</p>
            <p style={FEHLERTEXT}>{grund}</p>
          </div>
        ) : (
          <p style={SATZ} aria-live="polite">
            {lange
              ? 'Der erste Start dauert länger, weil die Datenbank angelegt wird. Bitte warten Sie noch einen Moment.'
              : 'Die Kasse startet.'}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Aussehen ──────────────────────────────────────────────────────────────
 *
 * Alles aus den Marken des Hauses, kein einziger fester Farbwert: diese Fläche
 * erscheint auch, bevor irgendein Bildschirm der Kasse geladen ist, und muss
 * im hellen wie im dunklen Thema stimmen.
 */

const HUELLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  padding: 'var(--w14-abstand-32)',
};

const MITTE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--w14-abstand-12)',
  maxWidth: '32rem',
  textAlign: 'center',
};

const MARKE: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-step-4)',
  fontWeight: 500,
  // Der Buchstabenabstand trägt hier die ganze Würde: der Name steht allein
  // auf einer leeren Fläche und darf nicht gedrängt wirken.
  letterSpacing: '0.42em',
  // Sperrung fügt rechts vom letzten Buchstaben Luft an; ohne diesen Ausgleich
  // steht das Wort sichtbar links von der Mitte.
  textIndent: '0.42em',
  lineHeight: 1.1,
};

const UNTERZEILE: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-text-meta)',
  letterSpacing: '0.24em',
  textIndent: '0.24em',
  color: 'var(--w14-ink-faded)',
};

const LINIE: React.CSSProperties = {
  position: 'relative',
  width: 'min(18rem, 60vw)',
  height: '2px',
  marginTop: 'var(--w14-abstand-24)',
  overflow: 'hidden',
  background: 'var(--w14-rule)',
  borderRadius: '2px',
};

const LAEUFER: React.CSSProperties = {
  position: 'absolute',
  insetBlock: 0,
  width: '40%',
  background: 'var(--w14-gold)',
  borderRadius: '2px',
};

const SATZ: React.CSSProperties = {
  margin: 'var(--w14-abstand-16) 0 0',
  fontSize: 'var(--w14-text-body)',
  lineHeight: 1.6,
  color: 'var(--w14-ink-aged)',
  textWrap: 'pretty',
};

const FEHLERFELD: React.CSSProperties = {
  marginTop: 'var(--w14-abstand-24)',
  padding: 'var(--w14-abstand-20) var(--w14-abstand-24)',
  border: '1px solid var(--w14-danger)',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-card)',
  textAlign: 'left',
};

const FEHLERKOPF: React.CSSProperties = {
  margin: '0 0 var(--w14-abstand-8)',
  fontWeight: 600,
  fontSize: 'var(--w14-text-sub)',
  color: 'var(--w14-danger)',
};

const FEHLERTEXT: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-text-body)',
  lineHeight: 1.65,
  color: 'var(--w14-ink)',
  textWrap: 'pretty',
};

/**
 * Die atmende Linie. Bewusst `transform`, nicht `left`: eine Bewegung über
 * Layout-Eigenschaften lässt den Browser in jedem Bild neu rechnen, und das
 * ausgerechnet in der Sekunde, in der daneben ein Server hochfährt.
 *
 * Bei `prefers-reduced-motion` steht sie still und zeigt stattdessen einen
 * ruhenden Abschnitt: die Fläche bleibt lesbar, nur ohne Bewegung.
 */
const ATEM = `
@keyframes norns-atem {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
.norns-atem {
  animation: norns-atem 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .norns-atem { animation: none; transform: translateX(75%); }
}
`;

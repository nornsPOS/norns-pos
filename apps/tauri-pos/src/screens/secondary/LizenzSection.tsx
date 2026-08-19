/**
 * LizenzSection — ist diese Kasse freigeschaltet.
 *
 * Die Prüfung liegt in Rust (`src-tauri/src/lizenz.rs`), nicht hier. Das ist
 * kein Zufall: eine Freischaltung, über die die Oberfläche entscheidet, ist
 * mit den Werkzeugen des Browsers in einer Minute ausgehebelt.
 *
 * ── WAS DIESE FLÄCHE EHRLICH SAGEN MUSS ─────────────────────────────────────
 *
 * Bei fehlender oder abgelaufener Lizenz steht der VERKAUF, nicht die Kasse.
 * Bücher, Kassenbuch, DATEV, DSFinV-K und das Prüferpaket bleiben offen — nach
 * § 147 AO muss der Händler seine Aufzeichnungen vorlegen können, und eine
 * Kasse, die ihm den Zugang sperrt, bringt ihn in die Pflichtverletzung.
 *
 * Deshalb sagt der Text hier genau das, statt „gesperrt" zu drohen. Wer die
 * Grenze kennt, ruft an; wer sie nicht kennt, hält die Kasse für kaputt.
 */

// Aus dem Bausatz, nicht direkt aus lucide: das Haus hat eine Symbolsprache,
// und ein Bildschirm, der daran vorbeigreift, führt sie langsam auseinander.
import { Icon, KeyRound, Lock, ShieldCheck, TriangleAlert } from '@norns/ui-kit';
import { useCallback, useEffect, useState } from 'react';

type Stand =
  | { stand: 'fehlt' }
  | { stand: 'gueltig'; haendler: string; ab: string; bis: string }
  | { stand: 'abgelaufen'; haendler: string; bis: string }
  | { stand: 'fremdesgeraet'; haendler: string }
  | { stand: 'ungueltig'; grund: string };

async function ruf<T>(befehl: string, argumente?: Record<string, unknown>): Promise<T | null> {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!tauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke(befehl, argumente)) as T;
}

/** Ein Datum aus der Lizenz für Menschen schreiben. Leer heisst unbefristet. */
function datum(iso: string): string {
  if (!iso) return '';
  const [j, m, t] = iso.split('-');
  return t && m && j ? `${t}.${m}.${j}` : iso;
}

export function LizenzSection() {
  const [stand, setStand] = useState<Stand | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const holen = useCallback(async () => {
    const s = await ruf<Stand>('lizenz_stand');
    setStand(s ?? { stand: 'fehlt' });
  }, []);

  useEffect(() => {
    void holen();
  }, [holen]);

  const einloesen = async () => {
    if (!eingabe.trim() || laeuft) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const s = await ruf<Stand>('lizenz_einloesen', { text: eingabe });
      if (!s) {
        setMeldung('Eine Lizenz lässt sich nur in der installierten Kasse einlösen.');
        return;
      }
      setStand(s);
      if (s.stand === 'gueltig') {
        setEingabe('');
        setMeldung('Die Kasse ist freigeschaltet.');
      } else {
        // Der Grund steht in der Anzeige oben; hier nichts doppeln.
        setMeldung(null);
      }
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-24)' }}>
      <Anzeige stand={stand} />

      {stand?.stand !== 'gueltig' && (
        <div style={FELD}>
          <label htmlFor="lizenzschluessel" style={BESCHRIFTUNG}>
            Lizenzschlüssel einfügen
          </label>
          <p style={HINWEIS}>
            Alle vier Zeilen aus der Lizenzdatei, so wie sie geliefert wurde. Auch die
            beiden Kommentarzeilen gehören dazu.
          </p>
          <textarea
            id="lizenzschluessel"
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'untrusted comment: …\n…\ntrusted comment: …\n…'}
            style={EINGABE}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-16)' }}>
            <button
              type="button"
              onClick={() => void einloesen()}
              disabled={!eingabe.trim() || laeuft}
              style={KNOPF}
            >
              <Icon icon={KeyRound} size={16} className="w14-symbol" />
              {laeuft ? 'Wird geprüft …' : 'Kasse freischalten'}
            </button>
            {meldung && (
              <span style={MELDUNG} role="status">
                {meldung}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Anzeige({ stand }: { stand: Stand | null }) {
  if (stand === null) {
    return <p style={HINWEIS}>Die Freischaltung wird gelesen …</p>;
  }

  // Jeder Fall bekommt Symbol, Überschrift und einen Satz, der sagt, was JETZT
  // gilt und was zu tun ist. Kein Zustand ohne nächsten Schritt.
  const [symbol, farbe, kopf, satz] = ((): [typeof ShieldCheck, string, string, string] => {
    switch (stand.stand) {
      case 'gueltig':
        return [
          ShieldCheck,
          'var(--w14-success, var(--w14-gold))',
          'Freigeschaltet',
          stand.bis
            ? `Ausgestellt auf ${stand.haendler}, gültig bis ${datum(stand.bis)}.`
            : `Ausgestellt auf ${stand.haendler}, unbefristet.`,
        ];
      case 'abgelaufen':
        return [
          TriangleAlert,
          'var(--w14-danger)',
          'Die Lizenz ist abgelaufen',
          `Die Lizenz für ${stand.haendler} lief am ${datum(stand.bis)} aus. ` +
            'Neue Verkäufe und Ankäufe sind bis zur Verlängerung nicht möglich. ' +
            'Ihre Bücher, das Kassenbuch und alle Exporte bleiben vollständig offen.',
        ];
      case 'fremdesgeraet':
        return [
          Lock,
          'var(--w14-danger)',
          'Diese Lizenz gehört zu einem anderen Gerät',
          `Die Lizenz für ${stand.haendler} wurde für eine andere Kasse ausgestellt. ` +
            'Für dieses Gerät wird ein eigener Schlüssel gebraucht.',
        ];
      case 'ungueltig':
        return [TriangleAlert, 'var(--w14-danger)', 'Der Lizenzschlüssel wurde nicht angenommen', stand.grund];
      default:
        return [
          Lock,
          'var(--w14-ink-faded)',
          'Noch nicht freigeschaltet',
          'Diese Kasse ist noch nicht freigeschaltet. Verkaufen und Ankaufen sind ' +
            'gesperrt. Bücher, Kassenbuch und alle Exporte sind offen und bleiben es.',
        ];
    }
  })();

  return (
    <div style={{ ...ANZEIGE, borderColor: farbe }}>
      <Icon icon={symbol} size={28} style={{ color: farbe, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ ...ANZEIGE_KOPF, color: farbe }}>{kopf}</p>
        <p style={ANZEIGE_SATZ}>{satz}</p>
      </div>
    </div>
  );
}

const ANZEIGE: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--w14-abstand-16)',
  alignItems: 'flex-start',
  padding: 'var(--w14-abstand-20)',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-card)',
};

const ANZEIGE_KOPF: React.CSSProperties = {
  margin: '0 0 var(--w14-abstand-6)',
  fontSize: 'var(--w14-text-sub)',
  fontWeight: 600,
};

const ANZEIGE_SATZ: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-text-body)',
  lineHeight: 1.6,
  color: 'var(--w14-ink-aged)',
  textWrap: 'pretty',
};

const FELD: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-8)',
};

const BESCHRIFTUNG: React.CSSProperties = {
  fontSize: 'var(--w14-text-body)',
  fontWeight: 600,
  color: 'var(--w14-ink)',
};

const HINWEIS: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-text-meta)',
  lineHeight: 1.6,
  color: 'var(--w14-ink-faded)',
  maxWidth: '60ch',
};

const EINGABE: React.CSSProperties = {
  width: '100%',
  // Ohne das sprengt ein Innenrand die Breite des Elternteils.
  boxSizing: 'border-box',
  minWidth: 0,
  padding: 'var(--w14-abstand-12)',
  fontFamily: 'var(--w14-font-mono)',
  fontSize: 'var(--w14-text-meta)',
  lineHeight: 1.5,
  color: 'var(--w14-ink)',
  background: 'var(--w14-parchment)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-button)',
  resize: 'vertical',
};

const KNOPF: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
  padding: 'var(--w14-abstand-12) var(--w14-abstand-20)',
  fontSize: 'var(--w14-text-body)',
  fontWeight: 600,
  color: 'var(--w14-parchment)',
  background: 'var(--w14-ink)',
  border: 'none',
  borderRadius: 'var(--w14-radius-button)',
  cursor: 'pointer',
};

const MELDUNG: React.CSSProperties = {
  fontSize: 'var(--w14-text-meta)',
  color: 'var(--w14-ink-aged)',
};

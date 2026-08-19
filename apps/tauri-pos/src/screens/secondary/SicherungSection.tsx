/**
 * SicherungSection — die Bücher auf einen zweiten Datenträger.
 *
 * ── WARUM DAS EINE EIGENE FLÄCHE IST ────────────────────────────────────────
 *
 * Basels Ordnung für Norns POS war „die Einstellungen auf das Nötigste":
 * DATEV-Ausfuhr, die drei Drucker, der Zustand der TSE, der Zustand der
 * Freischaltung. Diese Fläche kommt trotzdem dazu, und der Grund ist kein
 * Geschmack:
 *
 * Nach § 147 AO muss der HÄNDLER seine Aufzeichnungen zehn Jahre lang
 * vorhalten. In Warehouse14 sichert ein Server im Rechenzentrum. Norns POS hat
 * keinen Server im Rechenzentrum — die Datenbank liegt in diesem Gerät, und
 * wenn das Gerät stirbt, stirbt alles mit. Ohne diese Fläche gäbe es keinen
 * Weg, an dem der Händler seine Bücher retten kann, und ein solcher Weg,
 * den niemand findet, ist kein Weg.
 *
 * Die Arbeit macht der Dienst selbst (Sitzung A, `start.mjs --sicherung`).
 * Hier steht nur der Knopf, die Wahl des Ordners und die EHRLICHE Meldung.
 *
 * ── DIE EHRLICHKEIT DIESER FLÄCHE ───────────────────────────────────────────
 *
 * Sie meldet Erfolg NUR mit Zahlen: so viele Tabellen, so viele Zeilen. Ein
 * grüner Haken über einem leeren Ordner hat in diesem Haus schon einmal wie
 * Erfolg ausgesehen; eine Sicherung mit null Zeilen ist keine Sicherung.
 */

import { ArrowDownToLine, Icon, ShieldCheck, TriangleAlert } from '@norns/ui-kit';
import { useState } from 'react';

import { heute } from '../../lib/sicherung-nach-abschluss.js';
import { zielLesen, zielSchreiben, zuletztSchreiben } from '../../lib/sicherungsziel-store.js';

type Bericht = { datei: string; tabellen: number; zeilen: number; sequenzen: number };

export function SicherungSection() {
  // ⚠️ 13.08.2026: hier stand `useState(VORGABE)`. Der Zielordner ueberlebte
  // keinen Reiterwechsel — der Haendler tippte ihn bei JEDER Sicherung neu.
  // Eine Sicherung, die man jedes Mal neu einrichten muss, macht niemand
  // taeglich, und seit dem Kassenschluss braucht ihn auch die automatische
  // Sicherung. Er wird jetzt oertlich gemerkt (siehe sicherungsziel-store).
  const [ziel, setZiel] = useState(zielLesen);
  const [laeuft, setLaeuft] = useState(false);
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const sichern = async () => {
    if (laeuft || !ziel.trim()) return;
    setLaeuft(true);
    setBericht(null);
    setFehler(null);
    try {
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      if (!tauri) {
        setFehler('Eine Sicherung läuft nur in der installierten Kasse.');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const b = (await invoke('sicherung_jetzt', { zielordner: ziel })) as Bericht;
      setBericht(b);
      // Der Tag zaehlt erst nach dem Erfolg — sonst sperrt sich die
      // automatische Sicherung nach einem Fehlschlag bis morgen selbst aus.
      zuletztSchreiben(heute());
    } catch (e) {
      // Der Grund kommt aus dem Dienst und ist bereits ein deutscher Satz.
      setFehler(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Die Sicherung ist gescheitert.',
      );
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-20)' }}>
      <p style={ERKLAERUNG}>
        Ihre Bücher liegen in diesem Gerät. Geht das Gerät verloren, sind sie ohne Sicherung nicht
        wiederherstellbar. Das Finanzamt verlangt sie zehn Jahre lang. Legen Sie die Sicherung auf
        einen zweiten Datenträger, nicht auf dieselbe Platte.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
        <label htmlFor="sicherungsziel" style={BESCHRIFTUNG}>
          Zielordner
        </label>
        <input
          id="sicherungsziel"
          value={ziel}
          onChange={(e) => {
            setZiel(e.target.value);
            // Sofort merken, nicht erst beim Sichern: sonst waere der Ordner
            // nach einem Reiterwechsel wieder weg, und die automatische
            // Sicherung nach dem Kassenschluss haette kein Ziel.
            zielSchreiben(e.target.value);
          }}
          spellCheck={false}
          style={EINGABE}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-16)' }}>
        <button
          type="button"
          onClick={() => void sichern()}
          disabled={laeuft || !ziel.trim()}
          style={KNOPF}
        >
          <Icon icon={ArrowDownToLine} size={16} className="w14-symbol" />
          {laeuft ? 'Sicherung läuft …' : 'Sicherung jetzt'}
        </button>
        {laeuft && (
          <span style={NEBENSATZ}>
            Die Kasse bleibt benutzbar. Bei vielen Belegen dauert es einen Moment.
          </span>
        )}
      </div>

      {bericht && (
        <div style={{ ...MELDUNG, borderColor: 'var(--w14-gold)' }} role="status">
          <Icon icon={ShieldCheck} size={24} style={{ color: 'var(--w14-gold)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ ...MELDUNGKOPF, color: 'var(--w14-gold)' }}>Sicherung erstellt</p>
            <p style={MELDUNGTEXT}>
              {/* Die ZAHLEN sind die Meldung. „Fertig" allein ist keine. */}
              {bericht.tabellen} Tabellen mit {bericht.zeilen.toLocaleString('de-DE')} Zeilen, dazu{' '}
              {bericht.sequenzen} Zähler.
            </p>
            <p
              style={{
                ...MELDUNGTEXT,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-text-meta)',
              }}
            >
              {bericht.datei}
            </p>
            {bericht.zeilen === 0 && (
              <p style={{ ...MELDUNGTEXT, color: 'var(--w14-danger)', fontWeight: 600 }}>
                Achtung: die Sicherung enthält keine einzige Zeile. Bitte prüfen Sie den Zielordner,
                bevor Sie sich darauf verlassen.
              </p>
            )}
          </div>
        </div>
      )}

      {fehler && (
        <div style={{ ...MELDUNG, borderColor: 'var(--w14-danger)' }} role="alert">
          <Icon
            icon={TriangleAlert}
            size={24}
            style={{ color: 'var(--w14-danger)', flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <p style={{ ...MELDUNGKOPF, color: 'var(--w14-danger)' }}>
              Die Sicherung ist NICHT erstellt
            </p>
            <p style={MELDUNGTEXT}>{fehler}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const ERKLAERUNG: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-text-body)',
  lineHeight: 1.65,
  color: 'var(--w14-ink-aged)',
  maxWidth: '68ch',
  textWrap: 'pretty',
};

const BESCHRIFTUNG: React.CSSProperties = {
  fontSize: 'var(--w14-text-body)',
  fontWeight: 600,
  color: 'var(--w14-ink)',
};

const EINGABE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minWidth: 0,
  maxWidth: '40rem',
  padding: 'var(--w14-abstand-12)',
  fontSize: 'var(--w14-text-body)',
  color: 'var(--w14-ink)',
  background: 'var(--w14-parchment)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-button)',
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

const NEBENSATZ: React.CSSProperties = {
  fontSize: 'var(--w14-text-meta)',
  color: 'var(--w14-ink-faded)',
};

const MELDUNG: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--w14-abstand-16)',
  alignItems: 'flex-start',
  padding: 'var(--w14-abstand-20)',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-card)',
};

const MELDUNGKOPF: React.CSSProperties = {
  margin: '0 0 var(--w14-abstand-6)',
  fontSize: 'var(--w14-text-sub)',
  fontWeight: 600,
};

const MELDUNGTEXT: React.CSSProperties = {
  margin: '0 0 var(--w14-abstand-4)',
  fontSize: 'var(--w14-text-body)',
  lineHeight: 1.6,
  color: 'var(--w14-ink-aged)',
  textWrap: 'pretty',
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ EINE ERPROBUNGSUMGEBUNG WIRD NIE VERSCHWIEGEN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG VOM 15.08.2026 ────────────────────────────────────────
 *
 *     „Stelle sicher, dass die Testumgebung im UI absolut unübersehbar ist."
 *
 * ── DER BEFUND, DER DAHINTER STEHT ─────────────────────────────────────────
 *
 * Gemessen am selben Tag: `config::FiskalUmgebung::ist_rechtsgueltig` gab es
 * in Rust, ein eigener Wächter mass sie — und im ganzen Produktivcode rief sie
 * NIEMAND. Die Oberfläche kannte die Wörter „Erprobung" und „Testumgebung"
 * nicht ein einziges Mal.
 *
 * Damit konnte eine ausgelieferte Kasse mit EINER Umgebungsvariablen gegen die
 * fiskaly-Erprobung signieren, und alles sah richtig aus: grüne Ampel,
 * signierte Belege, QR-Codes, DSFinV-K-Ausfuhr. Wertlos wäre jede einzelne
 * Signatur gewesen — und der Händler hätte es am Tag der Kassennachschau
 * erfahren, mit Jahren ungültiger Aufzeichnungen im Rücken.
 *
 * ── WARUM EIN STREIFEN UND KEIN ABZEICHEN ──────────────────────────────────
 *
 * Ein kleines Abzeichen in einer Ecke wird nach drei Tagen nicht mehr gesehen.
 * Dieser Streifen liegt über der ganzen Breite, trägt die Warnfarbe des Hauses
 * und nennt beides: dass die Signaturen wertlos sind, und gegen WELCHE Adresse
 * signiert wird. Er verschwindet nur, wenn die Kasse wirklich gegen die
 * amtliche Umgebung arbeitet.
 *
 * ⚠️ Kein Netz, kein Zugang: die Umgebung steht beim Start fest und wird EINMAL
 * gelesen. Ein Streifen, der auf eine Netzantwort wartet, fehlte genau dann,
 * wenn das Netz klemmt.
 */

import { useEffect, useState } from 'react';

import { invoke, isTauri } from '@tauri-apps/api/core';

export interface FiskalUmgebungAnsicht {
  /** Sind die Signaturen dieser Kasse vor dem Finanzamt etwas wert? */
  rechtsgueltig: boolean;
  /** Die Adresse, gegen die wirklich signiert wird. */
  adresse: string;
}

/**
 * Was der Streifen sagt — rein, damit es ohne Fläche prüfbar ist.
 *
 * `null` heisst: nichts anzeigen. Das ist der Regelfall beim Händler.
 */
export function streifenText(
  umgebung: FiskalUmgebungAnsicht | null,
): { titel: string; satz: string } | null {
  if (umgebung === null) return null;
  if (umgebung.rechtsgueltig) return null;
  return {
    titel: 'ERPROBUNGSUMGEBUNG: KEINE GÜLTIGEN SIGNATUREN',
    satz:
      'Diese Kasse signiert gegen eine Erprobungsumgebung. Jeder Beleg sieht ' +
      'vollständig aus, ist aber vor dem Finanzamt wertlos. Nicht im Echtbetrieb ' +
      `verwenden. Adresse: ${umgebung.adresse}`,
  };
}

export function ErprobungsStreifen(): JSX.Element | null {
  const [umgebung, setUmgebung] = useState<FiskalUmgebungAnsicht | null>(null);

  useEffect(() => {
    let lebt = true;
    void (async () => {
      // Ohne Kassenkern (Browser-Vorschau) gibt es keine Umgebung zu lesen.
      if (!isTauri()) return;
      try {
        const gelesen = await invoke<FiskalUmgebungAnsicht>('fiskal_umgebung_lesen');
        if (lebt) setUmgebung(gelesen);
      } catch {
        /*
         * ⚠️ Ein Fehler hier darf den Streifen NICHT verschwinden lassen und
         * auch nicht fälschlich zeigen. Bleibt die Umgebung unbekannt, bleibt
         * der Streifen aus — dieselbe Lage wie in der Browser-Vorschau. Die
         * eigentliche Sicherung liegt im Motor, der ohne Sicherungseinrichtung
         * gar nicht erst bucht.
         */
      }
    })();
    return () => {
      lebt = false;
    };
  }, []);

  const text = streifenText(umgebung);
  if (text === null) return null;

  return (
    <div
      role="alert"
      style={{
        width: '100%',
        background: 'var(--w14-wax-red)',
        color: 'var(--w14-parchment)',
        padding: 'var(--space-2) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        borderBottom: '2px solid var(--w14-ink)',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ fontSize: 'var(--w14-schrift-feld)', letterSpacing: '0.08em', fontWeight: 700 }}
      >
        {text.titel}
      </span>
      <span style={{ fontSize: 'var(--w14-schrift-zeile)', lineHeight: 1.35 }}>{text.satz}</span>
    </div>
  );
}

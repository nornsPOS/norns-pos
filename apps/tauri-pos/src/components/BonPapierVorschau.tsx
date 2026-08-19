/**
 * BonPapierVorschau — ⭐ die Live-Vorschau aus ECHTEN ESC/POS-Bytes.
 *
 * BASELS KERNWUNSCH (26.07.2026): der Haendler sieht SOFORT das ENDGUELTIGE
 * Druckbild, ohne einen Probebon zu drucken. Darum laeuft hier KEIN zweiter
 * Nachbau in React: `preview_thermal_receipt` (thermal.rs) baut mit
 * `build_escpos` denselben Bytestrom, der drucken wuerde, und der
 * Papiersimulator liest ihn zurueck in Zeilen — was hier steht, IST der Strom.
 *
 * Zwei Bloecke sind kein Text und kommen deshalb als Daten: das Logo-Raster
 * traegt seine ECHTEN Bits (als PNG verpackt, `rasterPngBase64`) samt seiner
 * Punktmasse, der QR seinen Inhalt (`qrDaten`) — gezeichnet wird derselbe
 * Code, den der Drucker druckt.
 *
 * Ehrliche Grenzen statt stiller Luecken:
 *   • ausserhalb von Tauri (reiner Browser) gibt es keine Bytes — das steht
 *     dann da, mit dem React-Fallback des Aufrufers;
 *   • traegt die laufende Kassen-Version den Befehl noch nicht, sagt die
 *     Flaeche genau das („not found" der Bruecke, `isCommandMissing`).
 */

import { useEffect, useRef, useState } from 'react';

import {
  type PapierZeile,
  type ThermalReceiptData,
  isCommandMissing,
  isRunningInTauri,
  thermalClient,
} from '../lib/hardware-client.js';
import { druckbreitePunkte } from '../lib/logo-werk.js';
import { useHardwareStore } from '../state/hardware-store.js';
import { QrBild } from './QrBild.js';

// Physisches Thermopapier-Creme — bewusst wörtlich statt Thememarke, damit
// das Papier in hell wie dunkel Papier bleibt (gleiches Muster wie
// Belegdesigner/ReceiptPreview, an parchment-2 ausgerichtet).
const PAPER = '#faf8f2';
const INK = '#1c1814';

type Stand =
  | { art: 'laedt' }
  | { art: 'papier'; zeilen: PapierZeile[] }
  | { art: 'keinTauri' }
  | { art: 'befehlFehlt' }
  | { art: 'fehler' };

export function BonPapierVorschau({
  daten,
  fallback,
}: {
  /** Der Beleg, fertig gebaut — einschliesslich der Logo-Felder. */
  daten: ThermalReceiptData;
  /** Was gezeigt wird, wenn es (noch) keine Bytes geben kann. */
  fallback: JSX.Element;
}): JSX.Element {
  // ⚠️ 19.08.2026: hier stand fest 80. Die Vorschau ignorierte damit die
  // konfigurierte Rollenbreite UND die Werksvorgabe 58 — der Inhaber sah
  // eine Breite, die sein Drucker nie druckt (Basels Punkt: Vorgabe 58).
  // Die Umschalter 58/80 unten bleiben; nur der START folgt dem Geraet.
  const [breite, setBreite] = useState<58 | 80>(
    () => useHardwareStore.getState().config.thermal.paperWidthMm,
  );
  const [stand, setStand] = useState<Stand>({ art: 'laedt' });
  const zeitgeber = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cols = breite === 80 ? 48 : 32;

  useEffect(() => {
    if (!isRunningInTauri()) {
      setStand({ art: 'keinTauri' });
      return undefined;
    }
    // Entprellt: jede Tastatureingabe im Designer aendert `daten`, und ein
    // IPC-Rundgang je Anschlag waere Laerm ohne Nutzen.
    if (zeitgeber.current !== null) clearTimeout(zeitgeber.current);
    let veraltet = false;
    zeitgeber.current = setTimeout(() => {
      thermalClient
        .simulate({ ...daten, paperCols: cols })
        .then((vorschau) => {
          if (!veraltet) setStand({ art: 'papier', zeilen: vorschau.zeilen });
        })
        .catch((err: unknown) => {
          if (veraltet) return;
          setStand(isCommandMissing(err) ? { art: 'befehlFehlt' } : { art: 'fehler' });
        });
    }, 250);
    return () => {
      veraltet = true;
      if (zeitgeber.current !== null) clearTimeout(zeitgeber.current);
    };
  }, [daten, cols]);

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)', justifyItems: 'center' }}>
      {/* 58/80 mm umschaltbar — 44-Punkt-Ziele, die Flaeche faehrt spaeter
          auf der Android-Schale. */}
      <div role="tablist" aria-label="Papierbreite" style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
        {([58, 80] as const).map((mm) => (
          <button
            key={mm}
            type="button"
            role="tab"
            aria-selected={breite === mm}
            onClick={() => setBreite(mm)}
            style={{
              minHeight: 44,
              minWidth: 88,
              padding: 'var(--w14-abstand-8) var(--w14-abstand-16)',
              borderRadius: 'var(--w14-radius-button)',
              border:
                breite === mm ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
              background: breite === mm ? 'var(--w14-parchment-2)' : 'transparent',
              color: breite === mm ? 'var(--w14-ink)' : 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-text)',
              cursor: 'pointer',
            }}
          >
            {mm} mm
          </button>
        ))}
      </div>

      {stand.art === 'papier' ? (
        <Papier zeilen={stand.zeilen} cols={cols} />
      ) : stand.art === 'laedt' ? (
        <Hinweis text="Vorschau wird gebaut…" />
      ) : stand.art === 'befehlFehlt' ? (
        <>
          <Hinweis text="Die Byte-Vorschau braucht die naechste Kassen-Version (Druckerteil). Bis dahin zeigt die Seitenansicht den Aufbau." />
          {fallback}
        </>
      ) : stand.art === 'fehler' ? (
        <>
          <Hinweis text="Die Vorschau konnte nicht gebaut werden. Die Seitenansicht zeigt den Aufbau." />
          {fallback}
        </>
      ) : (
        // keinTauri — reiner Browser (Entwicklung): es gibt keine Bytes.
        <>
          <Hinweis text="Byte-Vorschau nur in der Kassen-Anwendung. Hier zeigt die Seitenansicht den Aufbau." />
          {fallback}
        </>
      )}
    </div>
  );
}

function Hinweis({ text }: { text: string }): JSX.Element {
  return (
    <p
      style={{
        margin: 0,
        maxWidth: 340,
        fontSize: 'var(--w14-schrift-zeile)',
        color: 'var(--w14-ink-faded)',
        fontStyle: 'italic',
        textAlign: 'center',
      }}
    >
      {text}
    </p>
  );
}

function Papier({ zeilen, cols }: { zeilen: PapierZeile[]; cols: number }): JSX.Element {
  const rolle = druckbreitePunkte(cols);
  return (
    <div
      style={{
        background: PAPER,
        color: INK,
        borderRadius: 6,
        boxShadow: 'var(--w14-shadow-modal, 0 12px 40px rgba(0,0,0,0.25))',
        padding: 'var(--w14-abstand-16) var(--w14-abstand-16) var(--w14-abstand-20)',
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          // `ch` ist die Breite einer Monospace-Ziffer: das Papier ist damit
          // EXAKT so viele Zeichen breit, wie der Bytestrom setzt — eine
          // ueberlaufende Zeile waere hier sichtbar, wie auf dem Geraet.
          width: `${cols}ch`,
          fontFamily: 'var(--w14-font-mono, monospace)',
          fontSize: cols === 48 ? '11px' : '13px', // schriftleiter-frei: Papiersimulator, Groesse folgt der Bonbreite (48/32 Zeichen)
          lineHeight: 1.45,
        }}
      >
        {zeilen.map((z, i) => {
          if (z.rasterPngBase64 != null) {
            // Das Logo-Raster: die ECHTEN Bits aus dem Strom. Die Breite ist
            // der Anteil der Rasterpunkte an der Rolle — dasselbe Verhaeltnis
            // wie auf dem Papier.
            const prozent = Math.min(
              100,
              ((z.rasterBreitePunkte ?? rolle) / rolle) * 100,
            );
            return (
              <div key={i} style={{ display: 'grid', justifyItems: 'center' }}>
                <img
                  src={`data:image/png;base64,${z.rasterPngBase64}`}
                  alt="Logo, wie es druckt"
                  style={{
                    width: `${prozent}%`,
                    height: 'auto',
                    // Das Raster ist 1-Bit; Kantenglaettung wuerde ein
                    // weicheres Bild zeigen, als der Drucker schneidet.
                    imageRendering: 'pixelated',
                  }}
                />
              </div>
            );
          }
          if (z.qrDaten != null && z.qrDaten.length > 0) {
            return (
              <div key={i} style={{ display: 'grid', justifyItems: 'center', padding: 'var(--w14-abstand-4) 0' }}>
                <QrBild inhalt={z.qrDaten} groesse={cols === 48 ? 120 : 96} />
              </div>
            );
          }
          const stil: React.CSSProperties = {
            whiteSpace: 'pre',
            minHeight: '1.45em',
            textAlign: z.mittig ? 'center' : 'left',
            fontWeight: z.fett ? 700 : 400,
          };
          if (z.doppeltHoch) {
            // Doppelte HOEHE, nicht Breite — genau wie `GS ! 1` auf dem
            // Geraet: die Spaltenzahl bleibt, die Zeile waechst nach oben.
            stil.transform = 'scaleY(1.8)';
            stil.transformOrigin = z.mittig ? 'center' : 'left center';
            stil.margin = '0.4em 0';
          }
          if (z.schriftB) {
            // Schrift B: ein Drittel mehr Zeichen je Zeile, also 3/4 der
            // Zeichenbreite — die schmalere Type des Kopfes.
            stil.fontSize = '0.75em';
          }
          return (
            <div key={i} style={stil}>
              {z.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

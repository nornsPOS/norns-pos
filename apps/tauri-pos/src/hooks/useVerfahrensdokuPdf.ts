/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Verfahrensdokumentation holen und als PDF setzen
 * ════════════════════════════════════════════════════════════════════════
 *
 * Zwei Schritte, beide netzfrei: der Motor liefert den Befund aus der
 * laufenden Anlage, Typst setzt ihn im Programm selbst.
 *
 * ⚠️ Bis zum 08.08.2026 lag hier gar nichts: die Fläche bot eine ins
 * Programm gebackene Textdatei über ein FREMDES Erzeugnis an, elfmal
 * „warehouse14", nullmal Norns, mit dem Stand vom 08.06.2026.
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';

import { describeError } from '@norns/i18n-de';

import type { ApiClient } from '@norns/api-client';

import { describeHardwareError, isHardwareError } from '../lib/hardware-client.js';

export interface VdAngabe {
  etikett: string;
  wert: string;
  fehlt: boolean;
  herkunft: 'erzeugnis' | 'gemessen' | 'haendler';
  wo?: string;
}

export interface VdAbschnitt {
  nummer: string;
  titel: string;
  fundstelle?: string;
  absaetze: string[];
  angaben?: VdAngabe[];
  tabelle?: { kopf: string[]; zeilen: string[][] };
}

export interface VerfahrensdokuBefund {
  erzeugtAm: string;
  fassung: string;
  erzeugnis: string;
  abschnitte: VdAbschnitt[];
  offeneAngaben: { etikett: string; wo: string }[];
  vollstaendig: boolean;
}

/** Der Erzeugungszeitpunkt in Berliner Schreibweise, für Deckblatt und Kopf. */
export function zeitpunktText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${p} Uhr`;
}

/**
 * Die Firma aus dem Befund ziehen.
 *
 * ⚠️ Über das Etikett, nicht über die Stellung im Feld: eine Umstellung der
 * Abschnitte darf nicht dazu führen, dass auf dem Deckblatt still die
 * Steuernummer als Firma steht.
 */
export function firmaAus(befund: VerfahrensdokuBefund): string {
  for (const a of befund.abschnitte) {
    for (const g of a.angaben ?? []) {
      if (g.etikett === 'Firma') return g.fehlt ? '' : g.wert;
    }
  }
  return '';
}

export interface UseVerfahrensdokuPdf {
  /** Befund holen, setzen, Bytes zurückgeben. */
  erzeugen: () => Promise<{ bytes: Uint8Array; befund: VerfahrensdokuBefund }>;
  laeuft: boolean;
  fehler: string | null;
}

export function useVerfahrensdokuPdf(client: ApiClient): UseVerfahrensdokuPdf {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const erzeugen = useCallback(async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      const befund = await client.request<VerfahrensdokuBefund>(
        'GET',
        '/api/verfahrensdokumentation',
      );

      const daten = {
        erzeugtAmText: zeitpunktText(befund.erzeugtAm),
        fassung: befund.fassung,
        erzeugnis: befund.erzeugnis,
        firma: firmaAus(befund),
        abschnitte: befund.abschnitte,
        offeneAngaben: befund.offeneAngaben,
        vollstaendig: befund.vollstaendig,
      };

      // Rust gibt `Vec<u8>` zurück; über die Brücke kommt eine Zahlenreihe.
      const bytes = await invoke<number[]>('generate_verfahrensdoku_pdf', { daten });
      return { bytes: new Uint8Array(bytes), befund };
    } catch (err) {
      const satz = isHardwareError(err) ? describeHardwareError(err) : describeError(err);
      setFehler(satz);
      throw err;
    } finally {
      setLaeuft(false);
    }
  }, [client]);

  return { erzeugen, laeuft, fehler };
}

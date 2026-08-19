/**
 * last-receipt-store — der Belegspeicher der Kasse.
 *
 * ── WAS HIER GEMESSEN FALSCH WAR (13.08.2026) ──────────────────────────────
 *
 * Der Speicher hielt GENAU EINEN Beleg, nur im Arbeitsspeicher:
 *
 *     lastReceipt: null,
 *     setLastReceipt: (r) => set({ lastReceipt: r }),
 *
 * Jeder neue Verkauf überschrieb den vorigen bedingungslos, und ein Neustart
 * der Kasse löschte auch den letzten. Der Händler erlebte das so: ein Kunde
 * kommt eine halbe Stunde später mit seinem Bon zurück, inzwischen wurde
 * EINMAL dazwischen kassiert — und der Nachdruck im Kassenbuch ist grau. Am
 * nächsten Morgen war er ohnehin grau. Der Ankaufdialog versprach derweil
 * wörtlich, der Beleg sei „auch später nachdruckbar".
 *
 * Der frühere Kopfkommentar behauptete zusätzlich, der Speicher werde „beim
 * Abmelden geleert". Auch das war falsch: `fuehreAbmeldungAus` (lib/sign-out.ts)
 * ruft `clearLastReceipt` an keiner Stelle.
 *
 * ── WAS JETZT GILT ─────────────────────────────────────────────────────────
 *
 * Der Speicher hält die letzten `BELEGARCHIV_HOECHSTZAHL` Belege und legt sie
 * auf der Platte ab (`lib/belegarchiv.ts`). Er überlebt damit den Neustart und
 * jeden weiteren Verkauf.
 *
 * `lastReceipt` bleibt als Feld bestehen, weil das Kassenbuch danach fragt. Es
 * ist IMMER `belege[0]` und wird nur hier gesetzt, im selben `set` wie die
 * Liste — zwei Felder, die getrennt geschrieben werden, laufen irgendwann
 * auseinander. Ein Prüfsatz hält diese Regel fest.
 */

import { create } from 'zustand';

import {
  belegEinreihen,
  belegeLesen,
  belegeLoeschen,
  belegeSchreiben,
  plattenVorhanden,
} from '../lib/belegarchiv.js';
import type { ThermalReceiptData } from '../lib/hardware-client.js';

interface LastReceiptState {
  /** Die letzten Belege dieser Kasse, jüngster zuerst. */
  belege: ThermalReceiptData[];
  /** Immer `belege[0]`. Der Nachdruckknopf im Kassenbuch liest dieses Feld. */
  lastReceipt: ThermalReceiptData | null;
  /**
   * Hat die Platte den Vorrat zuletzt angenommen?
   *
   * ⚠️ Die Belegliste behauptet auf dem Bildschirm, die Belege überstünden
   * einen Neustart. `belegeSchreiben` schluckt aber einen vollen oder
   * abgeschalteten Speicher bewusst und meldet ihn NUR am Rückgabewert. Der
   * wurde hier vorher weggeworfen, also konnte die Fläche die Zusage gar nicht
   * prüfen. Jetzt trägt der Speicher die Antwort, und der Kopfsatz sagt die
   * Wahrheit, statt sie zu vermuten.
   *
   * Beginnt mit dem, was beim Start SCHON messbar ist: ohne Speicher des
   * Fensters überlebt gar nichts einen Neustart, und dann darf die Fläche das
   * auch nicht vom ersten Rendern an behaupten. Liegt eine Platte vor, gilt die
   * Zusage, bis ein Schreibvorgang sie widerlegt; ein Verdacht ohne Messung
   * wäre ebenfalls eine Lüge.
   */
  ueberlebtNeustart: boolean;
  setLastReceipt: (r: ThermalReceiptData) => void;
  /** Den ganzen Vorrat verwerfen, auch auf der Platte. */
  clearLastReceipt: () => void;
}

const anfang = belegeLesen();

export const useLastReceiptStore = create<LastReceiptState>((set, get) => ({
  belege: anfang,
  lastReceipt: anfang[0] ?? null,
  ueberlebtNeustart: plattenVorhanden(),
  setLastReceipt: (r) => {
    const belege = belegEinreihen(get().belege, r);
    // Erst auf die Platte, dann in den Zustand. Scheitert das Schreiben (voller
    // oder abgeschalteter Speicher), gilt der Beleg trotzdem für diese Sitzung
    // — das ist genau der Stand von vorher, also nie schlechter. Gemerkt wird
    // der Fehlschlag trotzdem, weil die Fläche eine Zusage darauf stützt.
    const aufDerPlatte = belegeSchreiben(belege);
    set({
      belege,
      lastReceipt: belege[0] ?? null,
      // Einmal falsch bleibt falsch: der Beleg, der nicht auf die Platte kam,
      // kommt durch einen späteren gelungenen Schreibvorgang nicht zurück.
      ueberlebtNeustart: get().ueberlebtNeustart && aufDerPlatte,
    });
  },
  clearLastReceipt: () => {
    belegeLoeschen();
    // Nach dem Leeren ist nichts mehr verloren, was hier stand. Ob die Platte
    // taugt, bleibt aber eine Frage der Platte, nicht des Leerens.
    set({ belege: [], lastReceipt: null, ueberlebtNeustart: plattenVorhanden() });
  },
}));

/**
 * Abmelden — EINE Kaskade, für jeden Knopf, der abmeldet.
 *
 * ── DER FUND (25.07.2026) ──────────────────────────────────────────────────
 * Es gab drei „Abmelden" in der Kasse und nur EINES davon räumte auf:
 *
 *   • Einstellungen → Abmelden      → die vollständige Kaskade (§19.2 C-2)
 *   • Medaillon oben links → Abmelden → nur Sitzung weg
 *   • Sperrbild → Mit Google neu anmelden → nur Sitzung weg
 *
 * Die beiden kurzen Wege liessen den Verkaufskorb im `localStorage` stehen,
 * die gelesenen Kundenakten im Zwischenspeicher und — das Schwerste — die
 * SERVERSEITIGEN Reservierungen offen. Eine Kassen-Reservierung hat keine
 * Verfallszeit (Migration 0006 verbietet sie ausdrücklich für `POS`), also
 * blieb die Ware für Webshop und eBay gesperrt, bis der Inhaber sie von Hand
 * löste. Und der nächste Mensch am Tresen fand den Korb seines Vorgängers vor.
 *
 * Der Weg mit der Kaskade lag hinter drei Klicks, der kaputte war der
 * offensichtliche. Deshalb steht die Kaskade jetzt hier, in einer gewöhnlichen
 * Funktion ohne React-Haken: sie ist von überall aufrufbar, auch aus einem
 * Bild, unter dem die AppShell gar nicht mehr hängt.
 */

import type { QueryClient } from '@tanstack/react-query';

import { type ApiClient, authPin } from '@norns/api-client';

import { clearCachedRead } from '../offline/index.js';
import { useAnkaufCartStore } from '../state/ankauf-cart-store.js';
import { useBewertungStore } from '../state/bewertung-store.js';
import { useCartStore } from '../state/cart-store.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { useRecents } from '../state/recents-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useToastStore } from '../state/toast-store.js';
import { releaseCart } from './release-cart.js';
import { clearSessionToken } from './session-token.js';

/**
 * Schlüssel im `localStorage`, die AN EINEM MENSCHEN hängen (§19.2 C-2).
 *
 * Sie werden beim ersten Rendern gelesen und überleben jeden React-Lebenslauf.
 * Wer sie beim Abmelden stehen lässt, vererbt Korbzeilen, Kundenkennungen und
 * Ankaufstücke an den nächsten Menschen am selben Tresen.
 *
 * NICHT in dieser Liste: die offenen TSE-Signaturen. Die liegen seit Phase 1.3
 * in der dauerhaften SQLite-Warteschlange und sind FISKALISCHE Aufzeichnungen
 * des Hauses (§146a KassenSichV), nicht Eigentum einer Sitzung. Sie überleben
 * jede Abmeldung und werden später nachgereicht.
 */
export const PER_OPERATOR_STORAGE_KEYS = [
  'w14.cart.v1', // Verkaufskorb (mit den Reservierungskennungen)
  'w14.ankauf.v1', // Ankaufkorb (Kundenkontext + Stücke)
  'w14.bewertung.v1', // Bewertungsauswahl (Kunden- und Bewertungskennung)
] as const;

/**
 * Erblast des abgeschafften GERÄTECODES (entfernt 14.08.2026).
 *
 * Bis zur Ein-Code-Anordnung vom 05.08.2026 hielt die Kasse einen zweiten,
 * lokalen Code in diesen Schlüsseln (PBKDF2-Datensatz + Fehlversuchszähler).
 * Der Code samt Sperrbild ist gelöscht; auf Kassen, die vor dem Umbau liefen,
 * können die Schlüssel aber noch liegen. Die Abmeldung räumt sie mit ab,
 * damit die Erblast nicht ewig auf der Platte überwintert.
 */
const LEGACY_GERAETECODE_KEYS = ['w14.local-pin', 'w14.local-pin.attempts'] as const;

export interface AbmeldeOptionen {
  api: ApiClient;
  /** Der Lesezwischenspeicher der Oberfläche. */
  qc: QueryClient;
}

/**
 * Die vollständige Abmeldung. Wirft nie — ein Mensch darf am Tresen niemals
 * zwischen zwei Zuständen hängen bleiben, nur weil das Netz gerade weg ist.
 *
 * Die Reihenfolge ist Absicht:
 *   1. Korb sichern und die SERVERSEITIGEN Reservierungen freigeben — zuerst,
 *      weil sie ohne Verfallszeit sonst dauerhaft Ware sperren.
 *   2. Ankaufkorb und Bewertung zurücksetzen (reine Personendaten).
 *   3. Beim Server abmelden (bester Versuch).
 *   4. Sitzung, Buch, Verlauf und Meldungen leeren.
 *   5. BEIDE Lesezwischenspeicher leeren — den der Oberfläche und den
 *      Offline-Speicher, der auch auf die Platte schreibt.
 *   6. Jeden personengebundenen Schlüssel im `localStorage` entfernen.
 */
export async function fuehreAbmeldungAus(opts: AbmeldeOptionen): Promise<void> {
  const { api, qc } = opts;

  // 1. Reservierungshygiene ZUERST.
  const korb = useCartStore.getState().snapshotAndClear();
  try {
    await releaseCart({ api, lines: korb, reason: 'pos_cart_cleared' });
  } catch {
    /* Das Netz darf die Abmeldung nicht aufhalten. */
  }

  // 2. Der Ankaufkorb hält keine Reservierung — die Stücke sind noch keine
  //    Ware. Die Abschrift wird nur gelesen, damit ein späterer Entwurf sie
  //    einmal auffangen kann; heute wird sie verworfen.
  void useAnkaufCartStore.getState().snapshotAndReset();
  useBewertungStore.getState().reset();

  // 3. Beim Server abmelden.
  try {
    await authPin.signOut(api);
  } catch {
    /* Ein Netzfehler darf die lokale Abmeldung nicht blockieren. */
  }

  // 4. Sitzung und Oberflächenzustand.
  clearSessionToken();
  useSessionStore.getState().setUnauthenticated();
  useLedgerFeed.getState().clear();
  useRecents.getState().clear();
  useToastStore.getState().clear();

  // 5. Alles, was dieser Mensch gelesen hat.
  qc.clear();
  clearCachedRead();

  // 6. Und die Spuren auf der Platte. Auch wenn oben schon jeder Speicher
  //    zurückgesetzt wurde: Zustands schreibt verzögert, also wird der
  //    Schlüssel hier noch einmal selbst entfernt.
  if (typeof window !== 'undefined' && window.localStorage) {
    for (const key of [...PER_OPERATOR_STORAGE_KEYS, ...LEGACY_GERAETECODE_KEYS]) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* Speicher voll oder abgeschaltet — mehr ist hier nicht zu tun. */
      }
    }
  }
}

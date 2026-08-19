/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS TOR — wer den Assistenten sieht, und wer nicht
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ WARUM DIE ENTSCHEIDUNG AN DEN DATEN HÄNGT ────────────────────────
 *
 * Der naheliegende Weg wäre ein Merkzeichen im Fensterspeicher
 * („einrichtung.gesehen"). Der löge in beide Richtungen:
 *
 *   Zweitkasse         frisch installiert, Merkzeichen fehlt → der Assistent
 *                      fragt nach Angaben, die im Betrieb längst stehen
 *   Neu aufgesetzt     Merkzeichen liegt noch da, Datenbank ist leer → der
 *                      Assistent erscheint NICHT, und niemand merkt es
 *
 * Beides sind Fassungen derselben Hausklasse: ein Stellvertreter wird
 * gemessen statt der Sache. Deshalb wird hier die Sache gemessen — der
 * Firmenname, den Wanderung 0126 bewusst LEER anlegt und ohne den weder ein
 * Prüferpaket noch ein Buchungsstapel entsteht.
 *
 * ── UND WARUM ER SICH SCHLIESSEN LÄSST ──────────────────────────────────
 *
 * „Später" gilt für DIESEN Programmlauf. Beim nächsten Start fragt die Kasse
 * wieder, solange der Firmenname fehlt — das ist kein Nörgeln, sondern der
 * ehrliche Zustand: ohne ihn verkauft sie ohnehin nicht.
 *
 * ⚠️ Das Übergehen wird NICHT auf die Platte geschrieben. Ein gespeichertes
 * „später" wäre genau das Merkzeichen, das oben als Lüge beschrieben ist.
 *
 * ── UND WARUM ER BEI EINEM FEHLER AUS DEM WEG GEHT ──────────────────────
 *
 * Antwortet der Motor nicht, erscheint der Assistent NICHT. Ein Tor, das bei
 * einer Störung schliesst, sperrte den Kassierer am Morgen aus dem Verkauf
 * aus, und zwar für eine Frage, die mit dem Verkauf nichts zu tun hat.
 */

import { useState, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../lib/api-context.js';

import { EinrichtungsAssistent } from './EinrichtungsAssistent.js';
import { brauchtEinrichtung } from './einrichtungs-schritte.js';

interface SettingsAntwort {
  settings: Array<{ key: string; value: string }>;
}

function auspacken(roh: string): string {
  try {
    const geparst: unknown = JSON.parse(roh);
    return typeof geparst === 'string' ? geparst : roh;
  } catch {
    return roh;
  }
}

export function EinrichtungsTor({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const [uebergangen, setUebergangen] = useState(false);

  const abfrage = useQuery({
    queryKey: ['settings', 'tor'],
    queryFn: () => api.request<SettingsAntwort>('GET', '/api/settings'),
    // Einmal je Programmlauf genügt. Der Assistent selbst hält seinen Stand.
    staleTime: Infinity,
    retry: 1,
  });

  /*
   * Solange nichts gemessen ist, wird nichts behauptet: die Kasse zeigt sich
   * normal. Ein Ladebalken vor dem ganzen Programm für eine Frage, die
   * meistens „nein" lautet, wäre der falsche Tausch.
   */
  if (abfrage.data === undefined || uebergangen) return <>{children}</>;

  const werte: Record<string, string> = {};
  for (const zeile of abfrage.data.settings) werte[zeile.key] = auspacken(zeile.value);

  if (!brauchtEinrichtung(werte)) return <>{children}</>;

  return <EinrichtungsAssistent onVerlassen={() => setUebergangen(true)} />;
}

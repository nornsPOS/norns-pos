/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useSteuermodus — welchen Steuerstatus dieser Betrieb führt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER FUND VOM 20.08.2026 ────────────────────────────────────────────────
 *
 * Der Kleinunternehmer nach § 19 UStG weist KEINE Umsatzsteuer aus, und sein
 * Beleg MUSS das sagen. Der Server kannte den Status längst
 * (`lib/steuermodus.ts` prüft ihn bei jedem Verkauf) und stellte sogar den
 * fertigen Hinweissatz her — und warf ihn dann weg. Die Kasse fragte nie
 * danach. Ergebnis: der Beleg eines Kleinunternehmers trug den Pflichthinweis
 * nie, in keiner einzigen Fassung dieser Kasse.
 *
 * ── WARUM DAS EIN EIGENER HAKEN IST ────────────────────────────────────────
 *
 * Der Status steht in den Einstellungen (`steuer.modus`), also dort, wo auch
 * Anschrift und Steuernummer liegen. Der Verkaufsweg darf ihn NICHT jedes Mal
 * neu holen — er ändert sich vielleicht einmal im Leben eines Betriebs.
 * Deshalb: eine Abfrage, fünf Minuten frisch gehalten, geteilt von jeder
 * Fläche, die einen Beleg baut.
 *
 * ── WAS ER BEI UNKLARHEIT TUT ──────────────────────────────────────────────
 *
 * `null`, solange nichts geladen ist ODER der Status nicht gesetzt wurde.
 * Er RÄT NICHT auf Regelbesteuerung: ein geratener Steuerstatus ist nach
 * § 14c UStG geschuldete Steuer. Der Verkaufsweg des Servers weist eine
 * Kasse ohne gesetzten Status ohnehin ab, bevor ein Beleg entsteht.
 */

import { useQuery } from '@tanstack/react-query';

import type { BetriebsSteuermodus } from '../lib/beleg-steuerausweis.js';
import { useApiClient } from '../lib/api-context.js';

interface EinstellungenAntwort {
  settings: ReadonlyArray<{ key: string; value: unknown }>;
}

/** Der gesetzte Steuerstatus, oder `null`, solange keiner feststeht. */
export function useSteuermodus(): BetriebsSteuermodus | null {
  const api = useApiClient();
  const { data } = useQuery({
    queryKey: ['einstellungen', 'steuer-modus'],
    queryFn: () => api.request<EinstellungenAntwort>('GET', '/api/settings'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const roh = data?.settings?.find((s) => s.key === 'steuer.modus')?.value;
  // Der Wert kommt als JSON-Wert aus der Datenbank; nur die zwei bekannten
  // Zeichenketten gelten, alles andere heisst „unklar".
  const wert = typeof roh === 'string' ? roh.replaceAll('"', '').trim() : null;
  return wert === 'KLEINUNTERNEHMER_19' || wert === 'REGELBESTEUERUNG' ? wert : null;
}

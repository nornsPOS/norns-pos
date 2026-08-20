/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useKurspreise — die Tagespreise der Stücke im Korb, laufend
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Motor holt alle fünf Minuten neue Metallkurse. Zwischen „Ring in den
 * Korb" und „bezahlt" liegen Minuten, und in denen dreht sich der Goldkurs.
 * Dieser Haken fragt den Motor nach den geltenden Preisen und hält sie frisch.
 *
 * ── WARUM ER SCHNELLER FRAGT ALS DER MOTOR HOLT ────────────────────────────
 *
 * Der Motor holt im Fünf-Minuten-Takt; dieser Haken fragt alle dreissig
 * Sekunden. Nicht aus Ungeduld: die beiden Takte laufen NICHT synchron, und
 * wer im selben Takt fragt, sieht einen neuen Kurs im schlechtesten Fall erst
 * fünf Minuten nachdem er da war. Dreissig Sekunden sind der Preis dafür,
 * dass die Zahl am Tresen nie älter ist als eine halbe Minute — und die
 * Abfrage ist billig (eine Zeile je Stück, keine Entschlüsselung).
 *
 * ── WAS ER TUT, WENN ER NICHTS WEISS ───────────────────────────────────────
 *
 * Nichts. Die Karte bleibt leer, und `geltenderPreis` fällt auf den
 * gespeicherten Preis zurück. Ein Korb funktioniert ohne diesen Haken
 * vollständig — er wird nur genauer mit ihm.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../lib/api-context.js';
import type { Preisauskunft } from '../lib/korbpreis.js';

interface Antwort {
  preise: Preisauskunft[];
  kurseGeholtAm: string | null;
}

export interface Kurspreisstand {
  /** Je Stück-Kennung die Auskunft des Motors. Leer, solange nichts da ist. */
  auskuenfte: Map<string, Preisauskunft>;
  /** Wann die Kurse zuletzt geholt wurden — für den Countdown. */
  kurseGeholtAm: string | null;
}

const LEER: Kurspreisstand = { auskuenfte: new Map(), kurseGeholtAm: null };

export function useKurspreise(productIds: readonly string[]): Kurspreisstand {
  const api = useApiClient();
  // Die Kennungen sortiert in den Schlüssel: derselbe Korb in anderer
  // Reihenfolge ist dieselbe Frage und darf nicht neu geladen werden.
  const schluessel = [...productIds].sort().join(',');

  const { data } = useQuery({
    queryKey: ['kurspreise', schluessel],
    enabled: productIds.length > 0,
    queryFn: () =>
      api.request<Antwort>('POST', '/api/products/kurspreise', {
        productIds: [...productIds],
      }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    // Ein Netzstolperer darf den Korb nicht leeren: der letzte bekannte
    // Stand bleibt stehen, bis ein neuer kommt.
    placeholderData: (vorher) => vorher,
    retry: 1,
  });

  if (!data) return LEER;
  return {
    auskuenfte: new Map(data.preise.map((p) => [p.productId, p])),
    kurseGeholtAm: data.kurseGeholtAm,
  };
}

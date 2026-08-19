/**
 * useBelegLogo — das Haendler-Logo fuer Bonkopf und Belegdesigner.
 *
 * Liest ueber `logoAbrufen` (logo-dienst): der Server ist die Quelle der
 * Wahrheit, jedes Ergebnis wird ins Offline-Lager gespiegelt, und die drei
 * ehrlichen Zustaende (verfuegbar / alterServer / offline) kommen unverändert
 * bei der Flaeche an — sie luegt nie „kein Logo", wenn nur das Netz fehlt.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../lib/api-context.js';
import { type LogoAbruf, logoAbrufen } from '../lib/logo-dienst.js';

export const belegLogoQueryKey = ['beleg-logo'] as const;

export function useBelegLogo(): { abruf: LogoAbruf | undefined } {
  const api = useApiClient();
  const { data } = useQuery<LogoAbruf>({
    queryKey: belegLogoQueryKey,
    // logoAbrufen faengt selbst alles und antwortet mit einem Status —
    // react-query sieht nie einen Fehler, retry ist deshalb ohne Belang.
    queryFn: () => logoAbrufen(api),
    staleTime: 5 * 60 * 1000,
  });
  return { abruf: data };
}

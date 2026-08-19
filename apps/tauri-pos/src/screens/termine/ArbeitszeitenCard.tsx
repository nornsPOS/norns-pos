/**
 * Die Woche des Betriebs — ohne sie gibt es keinen einzigen Termin.
 *
 * ── WARUM DIESE KARTE OBEN STEHT UND NICHT IN DEN EINSTELLUNGEN ────────────
 *
 * `available_slots()` im Motor baut die Kapazität mit einem CROSS JOIN auf die
 * Arbeitszeiten. Sind keine hinterlegt, ergibt der Join null Zeilen, also null
 * freie Fenster, also 409 — bei JEDEM Terminversuch, für immer.
 *
 * Am Tresen war das ein Kreis ohne Ausgang: der Inhaber wählte Kunde, Uhrzeit,
 * drückte Anlegen und las „Dieser Zeitpunkt ist nicht mehr frei". Andere
 * Uhrzeit, derselbe Satz. Anderer Tag, derselbe Satz. Die Meldung liess ihn
 * glauben, es liege an der Auslastung — dabei gab es nie ein freies Fenster.
 *
 * Deshalb steht die Karte HIER, wo der Mensch den Fehler erlebt, und nicht drei
 * Flächen entfernt in den Einstellungen. Solange niemand Zeiten hat, hat sie
 * Vorrang vor allem anderen auf dieser Fläche.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

interface Fenster {
  wochentag: number;
  von: string;
  bis: string;
}
interface Person {
  userId: string;
  name: string;
  fenster: Fenster[];
}
interface Antwort {
  personen: Person[];
  keineZeitenHinterlegt: boolean;
  wochentage: { nummer: number; name: string }[];
}

/** Die Tage, die der Knopf verspricht. In der Reihenfolge der Beschriftung. */
export const WERKTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'] as const;

/**
 * Die übliche Woche eines Ladengeschäfts als Vorschlag.
 *
 * ⚠️ Ein VORSCHLAG, kein Vorgabewert: er wird erst geschrieben, wenn der
 * Mensch ihn bestätigt. Öffnungszeiten still zu erfinden wäre dieselbe Klasse
 * Fehler wie ein erfundener Steuerschlüssel: es sieht aus wie eine Antwort
 * und ist eine Behauptung.
 *
 * ⚠️ 02.08.2026 BERICHTIGT, und der Fehler war meiner, zum zweiten Mal am
 * selben Tag. Hier stand `[1, 2, 3, 4, 5]`, also die übliche SQL-Zählung
 * `DOW` mit Sonntag = 0. Der Server rechnet aber mit `EXTRACT(ISODOW) - 1`,
 * also MONTAG = 0. Der Knopf hiess „Montag bis Freitag" und schrieb Dienstag
 * bis Samstag: montags war zu, samstags nahm die Kasse Termine an, obwohl der
 * Laden geschlossen ist. Im Server hatte ich dieselbe Verwechslung eine
 * Stunde vorher berichtigt und die Fläche darüber vergessen.
 *
 * Deshalb kennt diese Karte die Nummern jetzt GAR NICHT mehr. Sie nimmt die
 * Namen, die der Server mitliefert, und schlägt die Nummer dort nach. Wer die
 * Zählung künftig ändert, ändert sie an einer Stelle, und diese Karte folgt
 * ihr von selbst.
 */
export function vorschlagAus(wochentage: { nummer: number; name: string }[]): Fenster[] {
  const fenster: Fenster[] = [];
  for (const name of WERKTAGE) {
    const tag = wochentage.find((t) => t.name === name);
    // Kennt der Server einen Werktag nicht, wird er ausgelassen statt geraten.
    // Eine erfundene Nummer wäre hier genau der Fehler, der berichtigt wurde.
    if (tag !== undefined) fenster.push({ wochentag: tag.nummer, von: '09:00', bis: '18:00' });
  }
  return fenster;
}

export function ArbeitszeitenCard(): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [offen, setOffen] = useState(false);

  const { data } = useQuery<Antwort>({
    queryKey: ['arbeitszeiten'],
    queryFn: () => api.request('GET', '/api/arbeitszeiten') as Promise<Antwort>,
  });

  const setzen = useMutation({
    mutationFn: (p: { userId: string; fenster: Fenster[] }) =>
      api.request('PUT', '/api/arbeitszeiten', p),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['arbeitszeiten'] });
      // Auch die Terminliste: sie hing an derselben leeren Kapazität.
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      addToast({
        tone: 'success',
        title: 'Zeiten gespeichert',
        body: 'Ab jetzt lassen sich Termine in diesen Zeiten anlegen.',
      });
      setOffen(false);
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Zeiten nicht gespeichert',
        body: err instanceof Error ? err.message : 'Die Eingabe wurde nicht angenommen.',
      });
    },
  });

  const namen = useMemo(
    () => new Map((data?.wochentage ?? []).map((t) => [t.nummer, t.name])),
    [data?.wochentage],
  );

  const vorschlag = useMemo(() => vorschlagAus(data?.wochentage ?? []), [data?.wochentage]);

  const uebernehmen = useCallback(
    (userId: string) => setzen.mutate({ userId, fenster: vorschlag }),
    [setzen, vorschlag],
  );

  if (data === undefined) return null;

  // ⚠️ Der WARNENDE Zustand. Er ist kein Hinweis am Rand, sondern die
  // Auskunft, ohne die jede andere Handlung auf dieser Fläche scheitert.
  if (data.keineZeitenHinterlegt) {
    return (
      <section
        aria-label="Arbeitszeiten fehlen"
        style={{
          border: '1px solid var(--w14-danger)',
          background: 'var(--w14-card)',
          borderRadius: 'var(--w14-radius-card)',
          padding: 'var(--w14-abstand-12)',
          display: 'grid',
          gap: 'var(--w14-abstand-8)',
        }}
      >
        <strong style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink)' }}>
          Es sind noch keine Arbeitszeiten hinterlegt
        </strong>
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Solange niemand Zeiten hat, gibt es kein einziges freies Zeitfenster, und jeder Termin
          wird abgelehnt, unabhängig von Uhrzeit und Tag. Bitte für mindestens eine Person die
          Woche eintragen.
        </p>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)' }}>
          {data.personen.map((p) => (
            <div
              key={p.userId}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}
            >
              <span style={{ flexGrow: 1, fontSize: 'var(--w14-schrift-text)' }}>{p.name}</span>
              <button
                type="button"
                disabled={setzen.isPending}
                onClick={() => uebernehmen(p.userId)}
                style={{ minHeight: 36 }}
              >
                {`${WERKTAGE[0]} bis ${WERKTAGE[WERKTAGE.length - 1]}, 09:00 bis 18:00 übernehmen`}
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Arbeitszeiten" style={{ display: 'grid', gap: 'var(--w14-abstand-6)' }}>
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        style={{ justifySelf: 'start', minHeight: 32 }}
      >
        {offen ? 'Arbeitszeiten schliessen' : 'Arbeitszeiten ansehen'}
      </button>
      {offen ? (
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)' }}>
          {data.personen.map((p) => (
            <p key={p.userId} style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)' }}>
              <strong>{p.name}</strong>
              {': '}
              {p.fenster.length === 0
                ? 'nimmt keine Termine an'
                : p.fenster
                    .map((f) => `${namen.get(f.wochentag) ?? f.wochentag} ${f.von} bis ${f.bis}`)
                    .join(' · ')}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

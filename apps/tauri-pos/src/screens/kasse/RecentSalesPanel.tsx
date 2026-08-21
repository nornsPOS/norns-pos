/**
 * RecentSalesPanel — last 24h of sales so the cashier can Storno a mistaken
 * ring AFTER leaving the post-finalize screen (late storno). Reuses the same
 * StornoDialog (PIN step-up). Already-stornoed / storno rows can't be reversed
 * again.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useQueryClient } from '@tanstack/react-query';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';

import type { ApiClient } from '@norns/api-client';
import {
  Button,
  Zwischentitel,
  MoneyAmount,
  ParchmentCard,
  ZustandFehler,
  ZustandLeer,
} from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { SuchFeld } from '../../components/SuchFeld.js';
import { belegLeerMeldung, filtereBelege } from '../../lib/belegsuche.js';

import { StornoDialog } from '../verkauf/StornoDialog.js';
import { RueckgabeDialog } from './RueckgabeDialog.js';

interface ArchivFund {
  id: string;
  receiptLocator: string;
  direction: 'VERKAUF' | 'ANKAUF';
  totalEur: string;
  finalizedAt: string;
  isStorno: boolean;
  alreadyStornoed: boolean;
  gefundenUeber: 'BELEGKENNUNG' | 'SERIENNUMMER' | 'GRAVUR' | 'ARTIKELNUMMER';
  stueckName: string | null;
}

interface RecentItem {
  id: string;
  receiptLocator: string;
  totalEur: string;
  finalizedAt: string;
  isStorno: boolean;
  alreadyStornoed: boolean;
}

export const recentSalesQueryKey = ['transactions', 'recent'] as const;

export function RecentSalesPanel(): JSX.Element {
  const api = useApiClient() as ApiClient;
  const qc = useQueryClient();
  const [storno, setStorno] = useState<{ id: string; locator: string } | null>(null);
  const [rueckgabe, setRueckgabe] = useState<{ id: string; locator: string } | null>(null);
  // Basels Befund: „مافي بحث برقم الفاتورة". Ein Kunde kommt mit seinem Bon
  // zurueck; ohne Suche wird gescrollt, waehrend er wartet.
  const [suche, setSuche] = useState('');

  // Offline-resilient (Phase 2.5): seeds from the last-good snapshot so the last
  // sales still show when the LAN drops mid-glance, marked with a StaleBadge.
  const recent = useCachedQuery<{ items: RecentItem[] }>({
    queryKey: recentSalesQueryKey,
    queryFn: () => api.request<{ items: RecentItem[] }>('GET', '/api/transactions/recent'),
    cacheKey: 'transactions:recent',
    staleTime: 15_000,
  });
  const { data, isLoading, isError } = recent;

  const alle = useMemo(() => data?.items ?? [], [data]);
  // `alle` bleibt daneben stehen, damit die Leermeldung sagen kann „acht
  // Verkaeufe liegen hier, aber keiner passt" statt der falschen Aussage
  // „keine Verkaeufe in 24 Stunden".
  const items = useMemo(() => filtereBelege(alle, suche), [alle, suche]);

  /*
   * ── Die Tiefensuche: „Ich moechte das zurueckgeben" (19.08.2026) ────────
   *
   * Die Liste oben sieht 24 Stunden. Der Kunde mit dem Bon von letzter Woche
   * — oder OHNE Bon, aber mit dem gravierten Stueck in der Hand — war bis
   * heute unauffindbar, obwohl sein Beleg samt Hash-Kette in der Datenbank
   * liegt. Sobald die oertliche Filterung LEER ausgeht und der Suchtext
   * tragfaehig ist, fragt die Kasse das Archiv: erst als Belegkennung
   * (RCP-…), sonst als Seriennummer/Gravur, zuletzt als Artikelnummer.
   * Entprellt (350 ms), damit nicht jeder Anschlag eine Anfrage wird.
   */
  const [tiefeAnfrage, setTiefeAnfrage] = useState('');
  useEffect(() => {
    const wert = suche.trim();
    const tragfaehig = wert.length >= 4 && items.length === 0 && !isLoading;
    const t = window.setTimeout(() => setTiefeAnfrage(tragfaehig ? wert : ''), 350);
    return () => window.clearTimeout(t);
  }, [suche, items.length, isLoading]);

  const tiefe = useQuery({
    queryKey: ['transactions', 'suche', tiefeAnfrage],
    enabled: tiefeAnfrage.length >= 4,
    staleTime: 30_000,
    queryFn: async (): Promise<{ items: ArchivFund[] }> => {
      const q = tiefeAnfrage;
      if (/^rcp/i.test(q)) {
        return api.request('GET', `/api/transactions/suche?locator=${encodeURIComponent(q)}`);
      }
      const perSerie = await api.request<{ items: ArchivFund[] }>(
        'GET',
        `/api/transactions/suche?seriennummer=${encodeURIComponent(q)}`,
      );
      if (perSerie.items.length > 0) return perSerie;
      return api.request('GET', `/api/transactions/suche?sku=${encodeURIComponent(q)}`);
    },
  });
  const archivFunde = tiefeAnfrage.length >= 4 ? (tiefe.data?.items ?? []) : [];
  const time = (iso: string): string =>
    new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label="Letzte Verkäufe" />
      {/* Die Suche steht ueber der Liste, nicht darin: sie gehoert zur ganzen
          Liste, und ein Feld zwischen den Zeilen waere ein zweiter Sinn. */}
      {/* 19.08.2026: das Feld stand nur da, wenn die 24-Stunden-Liste etwas
          trug — aber die ARCHIVSUCHE (alte Belege, Seriennummer, Gravur)
          haengt an genau diesem Feld. Ein leerer Vormittag versteckte den
          einzigen Weg, den Kunden mit dem Bon von letzter Woche zu bedienen.
          Am laufenden Schirm gefunden. */}
      {(alle.length > 0 || !isLoading) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <SuchFeld
            wert={suche}
            setzen={setSuche}
            name="Beleg suchen"
            platzhalter="Belegnummer oder Betrag"
            breite={260}
          />
        </div>
      )}
      {recent.fromCache && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <StaleBadge cachedAt={recent.cachedAt} stale={recent.isStale} />
        </div>
      )}
      {isLoading ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}
        >
          Lädt …
        </p>
      ) : isError ? (
        // FUND: fiel der Abruf aus UND lag kein Stand im Zwischenspeicher, war
        // `alle` leer — und `belegLeerMeldung` sagte dann „Keine Verkäufe in den
        // letzten 24 Stunden." Am Tresen steht in diesem Moment ein Kunde mit
        // seinem Bon in der Hand. Die Kasse hätte ihm gesagt, diesen Verkauf
        // gebe es nicht. Ein Ausfall ist kein leerer Tag.
        // `useCachedQuery` meldet nur DASS es schiefging, nicht WOMIT — der
        // Fehlerwert wird dort nicht durchgereicht. Der Satz kommt trotzdem aus
        // `describeError`, das für einen unbekannten Fehler die allgemeine
        // deutsche Zeile liefert. Erfunden wird hier nichts.
        <ZustandFehler
          satz={describeError(null)}
          folge="Ob ein bestimmter Bon hier liegt, lässt sich jetzt nicht sagen. Bitte keinen Kunden mit seinem Bon abweisen."
          onErneut={() => recent.refetch()}
        />
      ) : items.length === 0 ? (
        // Echtes Leer in den 24 Stunden. Wurde gesucht, fragt die Kasse
        // ZUERST das Archiv (Belegkennung, Seriennummer, Gravur,
        // Artikelnummer — siehe Tiefensuche oben), bevor sie „nicht
        // gefunden" sagt: der Kunde mit dem Bon von letzter Woche steht
        // JETZT am Tresen.
        archivFunde.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)' }}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--w14-schrift-marke)',
                color: 'var(--w14-ink-faded)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              Im Archiv gefunden
            </p>
            {archivFunde.map((f) => {
              const reversed = f.isStorno || f.alreadyStornoed;
              const wie =
                f.gefundenUeber === 'BELEGKENNUNG'
                  ? null
                  : f.gefundenUeber === 'SERIENNUMMER'
                    ? 'über Seriennummer'
                    : f.gefundenUeber === 'GRAVUR'
                      ? 'über Gravur'
                      : 'über Artikelnummer';
              return (
                <div
                  key={f.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    alignItems: 'center',
                    gap: 'var(--w14-abstand-10)',
                    padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
                    borderBottom: '1px solid var(--w14-rule)',
                    opacity: reversed ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: 'var(--w14-schrift-zeile)',
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    {new Date(f.finalizedAt).toLocaleDateString('de-DE')}
                  </span>
                  <span style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-feld)' }}>
                    {f.receiptLocator}
                    {f.direction === 'ANKAUF' && (
                      <span style={{ color: 'var(--w14-ink-faded)', marginLeft: 6 }}>(Ankauf)</span>
                    )}
                    {f.isStorno && (
                      <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>(Storno)</span>
                    )}
                    {f.alreadyStornoed && !f.isStorno && (
                      <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>storniert</span>
                    )}
                    {(wie || f.stueckName) && (
                      <span
                        style={{
                          display: 'block',
                          fontFamily: 'var(--w14-font-body)',
                          fontSize: 'var(--w14-schrift-marke)',
                          color: 'var(--w14-ink-faded)',
                        }}
                      >
                        {[f.stueckName, wie].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <MoneyAmount valueEur={f.totalEur} />
                  {reversed || f.direction === 'ANKAUF' ? (
                    <span style={{ width: 92 }} />
                  ) : (
                    <span style={{ display: 'flex', gap: 'var(--w14-abstand-6)' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRueckgabe({ id: f.id, locator: f.receiptLocator })}
                      >
                        Rückgabe
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStorno({ id: f.id, locator: f.receiptLocator })}
                      >
                        Stornieren
                      </Button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : suche.trim().length > 0 ? (
          tiefe.isFetching ? (
            <p
              style={{
                margin: 0,
                color: 'var(--w14-ink-faded)',
                textAlign: 'center',
                fontStyle: 'italic',
              }}
            >
              Archiv wird durchsucht …
            </p>
          ) : (
            <ZustandLeer
              satz={belegLeerMeldung(suche, alle.length)}
              wegweiser="Auch im Archiv (Belegkennung, Seriennummer, Gravur, Artikelnummer) kein Treffer."
              handlung={{ text: 'Suche zurücksetzen', onTun: () => setSuche('') }}
            />
          )
        ) : (
          <ZustandLeer
            satz={belegLeerMeldung(suche, alle.length)}
            wegweiser="Sobald ein Verkauf abgeschlossen ist, erscheint er hier."
          />
        )
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w14-abstand-6)',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {items.map((it) => {
            const reversed = it.isStorno || it.alreadyStornoed;
            return (
              <div
                key={it.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-10)',
                  padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
                  borderBottom: '1px solid var(--w14-rule)',
                  opacity: reversed ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-zeile)',
                    color: 'var(--w14-ink-aged)',
                  }}
                >
                  {time(it.finalizedAt)}
                </span>
                <span style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-feld)' }}>
                  {it.receiptLocator}
                  {it.isStorno && (
                    <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>(Storno)</span>
                  )}
                  {it.alreadyStornoed && !it.isStorno && (
                    <span style={{ color: 'var(--w14-wax-red)', marginLeft: 6 }}>storniert</span>
                  )}
                </span>
                <MoneyAmount valueEur={it.totalEur} />
                {reversed ? (
                  <span style={{ width: 92 }} />
                ) : (
                  <span style={{ display: 'flex', gap: 'var(--w14-abstand-6)' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRueckgabe({ id: it.id, locator: it.receiptLocator })}
                    >
                      Rückgabe
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStorno({ id: it.id, locator: it.receiptLocator })}
                    >
                      Stornieren
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rueckgabe && (
        <RueckgabeDialog
          transactionId={rueckgabe.id}
          receiptLocator={rueckgabe.locator}
          onClose={() => setRueckgabe(null)}
          onDone={() => {
            setRueckgabe(null);
            void qc.invalidateQueries({ queryKey: recentSalesQueryKey });
            void qc.invalidateQueries({ queryKey: ['transactions', 'suche'] });
          }}
        />
      )}
      {storno && (
        <StornoDialog
          transactionId={storno.id}
          receiptLocator={storno.locator}
          onClose={() => setStorno(null)}
          onStornoed={() => {
            setStorno(null);
            void qc.invalidateQueries({ queryKey: recentSalesQueryKey });
          }}
        />
      )}
    </ParchmentCard>
  );
}

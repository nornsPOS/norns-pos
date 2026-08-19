/**
 * Kurse, der Edelmetall-Kursraum.
 *
 * 27.07.2026: der alte Kopf beschrieb „vier Kacheln mit Sparkline und ein
 * Override-Modal"; die Fläche ist längst mehr:
 *
 *   • Vier Metalle (Gold, Silber, Platin, Palladium) mit aktuellem €/g,
 *     zeitgewichtetem 10-Tage-Durchschnitt und dem daraus abgeleiteten
 *     Ankaufskurs je Gramm (`metal-margin.ts`), dieselbe Quelle wie im
 *     Ticker und am Ankauftresen.
 *   • Ein grosses TradingTerminal für das gewählte Metall: volles
 *     History-Fenster (Server-Deckel 200), Verkaufs- und Ankauflinie.
 *   • Ankaufmarge je Metall bearbeiten (ADMIN), tief erreichbar aus dem
 *     Ticker-Popover. Der Spot-Override ist am 18.08.2026 abgeschafft:
 *     der Kurs kommt nur noch aus der eingestellten Quelle.
 *   • 18.08.2026: der Verlauf war serverseitig ADMIN-gesperrt, darum sah
 *     der Kassierer statt der Kurve nur den Platzhalter („der gebaute
 *     Puls", Basels Befund). Die Sperre ist gefallen; die Kurve gehört
 *     an den Tresen.
 *   • Ehrliche Fehlzeilen: fällt /rates aus, steht „Ankauf-Kurs nicht
 *     abrufbar" auf der Fläche, statt dass die Zeile wortlos verschwindet,
 *     und der Hinweis warnt vor dem Bepreisen frei Hand.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ApiError,
  type CurrentMetalPrice,
  METAL_KIND_ORDER,
  type MetalKind,
  type MetalPriceHistoryRow,
  type MetalRate,
  metalPricesApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, ParchmentCard, ZustandFehler } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { deriveAnkaufPerGram, formatPerGram } from '../../lib/metal-margin.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { TradingTerminal } from './TradingTerminal.js';
import { describeError } from '@norns/i18n-de';

const METAL_LABEL: Record<MetalKind, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

// Metal identity accents — warm, token-only (no cool greys). Each metal reads
// as a distinct antique tone the way gold reads via --w14-gold: silver = warm
// umber, platinum = the pale warm-gold hairline (its bright sheen), palladium =
// faded warm grey. Consistent with gold's decorative-var treatment.
const METAL_ACCENT: Record<MetalKind, string> = {
  gold: 'var(--w14-gold)',
  silver: 'var(--w14-ink-aged)',
  // 19.08.2026: war die Haarlinien-Marke rule (im Hellthema fast der Grund).
  platinum: 'var(--w14-gold-soft)',
  palladium: 'var(--w14-ink-faded)',
};

export function Kurse(): JSX.Element {
  const api = useApiClient();
  const actor = useSessionStore((s) => s.actor);
  const isAdmin = actor?.role === 'ADMIN';

  // Live: poll the market price every 20 s so the room reflects the market.
  const currentQ = useQuery({
    queryKey: ['metal-prices', 'current'],
    queryFn: () => metalPricesApi.current(api),
    staleTime: 20_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  // Rates: current + time-weighted 10-day average + Ankauf buy rate per metal.
  const ratesQ = useQuery({
    queryKey: ['metal-prices', 'rates'],
    queryFn: () => metalPricesApi.rates(api),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });

  // Which metal the big trading terminal is showing.
  const [selectedMetal, setSelectedMetal] = useState<MetalKind>('gold');

  // Four parallel history queries, one per metal — context for the terminal.
  // We pull the full window (server cap 200) and let the terminal bucket it
  // into the selected range (1T/1W/1M/6M/1J) client-side.
  const historyQs = useQueries({
    queries: METAL_KIND_ORDER.map((metal) => ({
      queryKey: ['metal-prices', 'history', metal] as const,
      queryFn: () => metalPricesApi.history(api, { metal, limit: 200 }),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });

  const [marginOpen, setMarginOpen] = useState(false);

  // Deep-open from the ticker popover's "Ankaufmarge bearbeiten →" link
  // (/kurse?marge=1). ADMIN only; consume the param so a refresh doesn't reopen.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (isAdmin && searchParams.get('marge') === '1') {
      setMarginOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('marge');
      setSearchParams(next, { replace: true });
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const safetyMarginPct = ratesQ.data?.safetyMarginPct ?? null;

  // ── FUND: sieben Ladehinweise, kein einziger Fehlerzweig ──────────────────
  // Fiel ein Abruf aus, blieb die Kopfzeile auf „live" stehen und die Kachel
  // schrieb „Noch kein Kurs erfasst." — ein Satz, der behauptet, es habe noch
  // nie einen Kurs gegeben. Am Tresen heisst das: der Händler nennt einen Preis
  // aus dem Kopf, oder er nennt gar keinen. Ein Edelmetallhändler darf beim
  // Metallkurs nicht raten.
  //
  // Ab jetzt trägt die Fläche alle vier Zustände: LÄDT / FEHLER / LEER / DATEN.
  // Und weil ein alter Kurs mehr wert ist als eine leere Kachel, bleibt die
  // letzte gute Antwort stehen, sobald es eine gibt — mit ihrer Uhrzeit
  // daneben, damit „Stand 9:15" nie mit „jetzt" verwechselt wird.
  const kursFehler: unknown =
    currentQ.error ?? ratesQ.error ?? historyQs.find((h) => h.error != null)?.error ?? null;
  const hatKurse = currentQ.data != null;
  const kursStand =
    currentQ.dataUpdatedAt > 0
      ? new Date(currentQ.dataUpdatedAt).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  const erneutLaden = (): void => {
    void currentQ.refetch();
    void ratesQ.refetch();
    for (const h of historyQs) void h.refetch();
  };

  return (
    <section
      aria-label="Edelmetallkurse"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-24)',
        gap: 'var(--w14-abstand-16)',
        overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-flaeche)',
          }}
        >
          Edelmetallkursraum
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-14)' }}>
          {/* ⚠️ Basels Befund vom 04.08.2026: als stiller Knopf war das ein
              Text, den man erst beim Druecken als Knopf erkannte. Es ist eine
              ECHTE Handlung, sie aendert den Ankaufpreis jedes Metalls. */}
          {isAdmin && (
            <Button
              variant="zweit"
              size="md"
              onClick={() => setMarginOpen(true)}
              title="Ankaufmarge je Metall → Ankaufpreis überall (Ticker, Ankauf, Kursraum)"
            >
              Ankaufmarge je Metall
            </Button>
          )}
          <span
            className="w14-smallcaps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-6)',
              color: 'var(--w14-ink-faded)',
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.1em',
            }}
          >
            {/* Das Wort „live" war die gefährlichste Zeile der Fläche: es stand
                auch dann da, wenn seit Stunden kein Abruf mehr durchkam. Der
                Punkt trägt jetzt drei Wahrheiten, nicht zwei. */}
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background:
                  kursFehler != null
                    ? 'var(--w14-wax-red)'
                    : currentQ.isFetching || ratesQ.isFetching
                      ? 'var(--w14-gold)'
                      : 'var(--w14-verdigris)',
                boxShadow: '0 0 0 3px color-mix(in srgb, var(--w14-verdigris) 25%, transparent)',
              }}
            />
            {kursFehler != null
              ? 'nicht aktuell'
              : currentQ.isFetching || ratesQ.isFetching
                ? 'aktualisiert…'
                : 'live'}
          </span>
        </div>
      </header>

      <Zwischentitel />

      {/* Liegt ein Kurs im Speicher, bleibt er stehen — leeren wäre schlechter
          als ihn zu zeigen. Aber er trägt seine Uhrzeit und den Grund, warum er
          nicht nachgezogen wurde. */}
      {hatKurse && kursFehler != null && (
        <KursStandHinweis
          satz={describeError(kursFehler)}
          stand={kursStand}
          onErneut={erneutLaden}
        />
      )}

      {!hatKurse && kursFehler != null ? (
        <ZustandFehler
          satz={describeError(kursFehler)}
          folge="Der aktuelle Metallkurs lässt sich jetzt nicht sagen. Bitte keinen Ankauf frei Hand bepreisen."
          onErneut={erneutLaden}
        />
      ) : (
        <>
      {/* ── Big interactive trading chart for the selected metal ───────── */}
      <ParchmentCard padding="lg">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 'var(--w14-abstand-12)',
            marginBottom: 12,
          }}
        >
          {/* Metal tabs */}
          <div style={{ display: 'inline-flex', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap' }}>
            {METAL_KIND_ORDER.map((m) => {
              const active = m === selectedMetal;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMetal(m)}
                  className="w14-smallcaps"
                  style={{
                    padding: 'var(--w14-abstand-6) var(--w14-abstand-14)',
                    fontSize: 'var(--w14-schrift-feld)',
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    borderRadius: 'var(--w14-radius-button)',
                    border: `1px solid ${active ? METAL_ACCENT[m] : 'var(--w14-rule)'}`,
                    background: active ? METAL_ACCENT[m] : 'transparent',
                    // 19.08.2026: '#fff' fiel je Thema auf Platin/Gold/Silber durch;
                    // Parchment kippt mit (Messprotokoll Kontrast-Vermessung).
                    color: active ? 'var(--w14-parchment)' : 'var(--w14-ink-faded)',
                    transition: 'border-color var(--w14-dur-exit) var(--w14-ease-hover), background-color var(--w14-dur-exit) var(--w14-ease-hover), color var(--w14-dur-exit) var(--w14-ease-hover)',
                  }}
                >
                  {METAL_LABEL[m]}
                </button>
              );
            })}
          </div>
          {/* Current price headline for the selected metal */}
          {(() => {
            const cur = currentQ.data?.prices.find((p) => p.metal === selectedMetal);
            return (
              <div style={{ textAlign: 'right' }}>
                <div
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontWeight: 600,
                    fontSize: 'var(--w14-schrift-betrag)',
                    color: 'var(--w14-ink)',
                    lineHeight: 1.1,
                  }}
                >
                  {cur?.pricePerGramEur ? formatPrice(cur.pricePerGramEur) : '-'}{' '}
                  <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>€/g</span>
                </div>
                <div
                  className="w14-smallcaps"
                  style={{
                    fontSize: 'var(--w14-schrift-zeile)',
                    letterSpacing: '0.06em',
                    color: 'var(--w14-ink-faded)',
                    marginTop: 2,
                  }}
                >
                  <span style={{ color: METAL_ACCENT[selectedMetal] }}>● Verkauf</span>
                  {'   '}
                  <span>┄ Ankauf</span>
                </div>
              </div>
            );
          })()}
        </div>
        <TradingTerminal
          metalLabel={METAL_LABEL[selectedMetal]}
          accent={METAL_ACCENT[selectedMetal]}
          history={historyQs[METAL_KIND_ORDER.indexOf(selectedMetal)]?.data?.items ?? []}
          currentPrice={
            currentQ.data?.prices.find((p) => p.metal === selectedMetal)?.pricePerGramEur ?? null
          }
          safetyMarginPct={
            ratesQ.data?.rates.find((r) => r.metal === selectedMetal)?.safetyMarginPct ??
            safetyMarginPct
          }
          fetching={currentQ.isFetching}
        />
      </ParchmentCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--w14-abstand-16)',
        }}
      >
        {METAL_KIND_ORDER.map((metal, i) => {
          const current = currentQ.data?.prices.find((p) => p.metal === metal);
          const history = historyQs[i]?.data?.items ?? [];
          const rate = ratesQ.data?.rates.find((r) => r.metal === metal);
          return (
            <PriceTile
              key={metal}
              metal={metal}
              current={current}
              rate={rate}
              history={history}
              // Ein Ladeflimmern DARF nicht mehr über einem Fehler stehen: sonst
              // wartet die Kachel ewig auf Daten, die nie kommen.
              loading={
                kursFehler == null && (currentQ.isLoading || historyQs[i]?.isLoading === true)
              }
              ratesFehlt={ratesQ.error != null}
              verlaufFehlt={historyQs[i]?.error != null}
              isAdmin={isAdmin}
            />
          );
        })}
      </div>
        </>
      )}

      {/*
        ⚰️ 18.08.2026: hier stand das ManualOverrideModal. Basels Anweisung:
        ein Goldpreis wird nicht von Hand eingetragen, verboten. Der Motor
        antwortet auf dem alten Weg mit 410. Die Folge steht dort im
        Routen-Kommentar: ohne Netz und mit veraltetem Kurs gibt es KEINEN
        Ankaufsvorschlag mehr, und keinen Handgriff, ihn zu erzwingen.
      */}

      {marginOpen && (
        <MarginModal rates={ratesQ.data?.rates ?? []} onClose={() => setMarginOpen(false)} />
      )}
    </section>
  );
}

/**
 * Der ehrliche Stand-Streifen: der Kurs auf dem Schirm ist echt, aber alt.
 * Er nennt die Uhrzeit der letzten guten Antwort und den Grund des Ausfalls,
 * damit „Stand 9:15" nie als „jetzt" gelesen wird.
 */
function KursStandHinweis({
  satz,
  stand,
  onErneut,
}: {
  satz: string;
  stand: string | null;
  onErneut: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{ borderLeft: '3px solid var(--w14-wax-red)' }}
      role="status"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-14)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-wax-red)',
              letterSpacing: '0.08em',
              fontSize: 'var(--w14-schrift-zeile)',
            }}
          >
            {stand ? `Kurs nicht aktuell · Stand ${stand} Uhr` : 'Kurs nicht aktuell'}
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)' }}>
            {satz}
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={onErneut}>
          Erneut laden
        </Button>
      </div>
    </ParchmentCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tile
// ════════════════════════════════════════════════════════════════════════

function PriceTile({
  metal,
  current,
  rate,
  history,
  loading,
  ratesFehlt,
  verlaufFehlt,
  isAdmin,
}: {
  metal: MetalKind;
  current: CurrentMetalPrice | undefined;
  rate: MetalRate | undefined;
  history: MetalPriceHistoryRow[];
  loading: boolean;
  /** Der Ankauf-Kurs kam nicht durch — die Zeile fehlt, statt still zu sein. */
  ratesFehlt: boolean;
  /** Der Verlauf kam nicht durch — die Kurve fehlt, statt still zu sein. */
  verlaufFehlt: boolean;
  isAdmin: boolean;
}): JSX.Element {
  const accent = METAL_ACCENT[metal];

  // The first (most recent) row in the history is the CURRENT one; the next
  // is "yesterday" for delta purposes. The history is ordered DESC.
  const delta = useMemo(() => {
    if (history.length < 2 || !current?.pricePerGramEur) return null;
    const prev = Number.parseFloat(history[1]!.pricePerGramEur);
    const now = Number.parseFloat(current.pricePerGramEur);
    if (!Number.isFinite(prev) || !Number.isFinite(now) || prev === 0) return null;
    return { abs: now - prev, pct: ((now - prev) / prev) * 100 };
  }, [history, current]);

  if (loading) {
    return (
      <ParchmentCard padding="lg">
        <div
          aria-hidden
          style={{
            height: 140,
            borderRadius: 'var(--w14-radius-fein)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
          }}
        />
      </ParchmentCard>
    );
  }

  const noData = !current || current.pricePerGramEur === null;

  return (
    <ParchmentCard padding="lg" style={{ borderTop: `3px solid ${accent}` }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          className="w14-smallcaps"
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            color: accent,
            letterSpacing: '0.1em',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          {METAL_LABEL[metal]}
        </h2>
        {current?.source && <SourceBadge source={current.source} />}
      </header>

      {noData ? (
        <p
          style={{
            margin: '14px 0',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Noch kein Kurs erfasst.
        </p>
      ) : (
        <>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontWeight: 600,
              fontSize: 'var(--w14-schrift-betrag)',
              margin: '12px 0 4px',
              color: 'var(--w14-ink)',
            }}
          >
            {formatPrice(current.pricePerGramEur!)}{' '}
            <span style={{ fontSize: 'var(--w14-schrift-betont)', color: 'var(--w14-ink-faded)' }}>€/g</span>
          </div>

          {delta && <DeltaRow delta={delta} />}

          <p
            className="w14-tabular"
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            zuletzt {current.fetchedAt ? new Date(current.fetchedAt).toLocaleString('de-DE') : '-'}
          </p>

          <RatesBlock rate={rate} fehlt={ratesFehlt} />

          <PriceChart history={history} accent={accent} avg={rate?.avg10dPricePerGramEur ?? null} />
          {verlaufFehlt && history.length === 0 && (
            <p style={{ ...fehlZeile, marginTop: 10 }}>Verlauf nicht abrufbar.</p>
          )}
        </>
      )}

      {isAdmin && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 'var(--w14-abstand-10)',
          }}
        >
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            setzt den Marktwert, nicht die Ankaufmarge
          </span>
        </div>
      )}
    </ParchmentCard>
  );
}

function DeltaRow({ delta }: { delta: { abs: number; pct: number } }): JSX.Element {
  const up = delta.abs >= 0;
  const color = up ? 'var(--w14-gold)' : 'var(--w14-wax-red)';
  const sign = up ? '+' : '−';
  return (
    <div
      className="w14-tabular"
      style={{
        fontFamily: 'var(--w14-font-mono)',
        fontSize: 'var(--w14-schrift-feld)',
        color,
      }}
    >
      {sign}
      {Math.abs(delta.abs).toFixed(4)} € · {sign}
      {Math.abs(delta.pct).toFixed(2)} %
    </div>
  );
}

/** Ein fehlender Wert sagt, dass er fehlt. Stillschweigen wäre am Ankauftresen
 *  die Aussage „es gibt hier keine Marge" — und die wäre falsch. */
const fehlZeile: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-zeile)',
  fontStyle: 'italic',
  color: 'var(--w14-wax-red)',
};

function RatesBlock({
  rate,
  fehlt,
}: {
  rate: MetalRate | undefined;
  fehlt: boolean;
}): JSX.Element | null {
  // FUND: fiel /rates aus, verschwand die Zeile „Ankauf-Kurs" wortlos. Wer am
  // Tresen ankauft, hätte daraus geschlossen, für dieses Metall sei keine Marge
  // hinterlegt, und frei Hand gerechnet.
  if (!rate) {
    return fehlt ? (
      <p style={{ ...fehlZeile, marginTop: 12 }}>Ankauf-Kurs nicht abrufbar.</p>
    ) : null;
  }
  const spot = rate.verkaufBasePerGramEur ?? rate.currentPricePerGramEur;
  const ankaufLabel = `Ankauf-Kurs (−${formatPct(rate.safetyMarginPct ?? 0.1)})`;
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 'var(--w14-abstand-4)' }}>
      <RateRow label="Spot-Kurs (Marktwert)" value={spot} />
      <RateRow label={ankaufLabel} value={rate.ankaufRatePerGramEur} tone="wax" />
      {/* „Mittel (bis 10 Tage)", nicht „10-Tage-Mittel": der Motor rechnet
          zeitgewichtet ueber das, was aufgezeichnet IST, ab dem ersten Kurs.
          Die alte Beschriftung las sich, als muesse man zehn Tage warten —
          Basels Einwand vom 18.08.2026, und er stimmte fuer das Wort,
          nicht fuer die Rechnung. */}
      <RateRow label="Mittel (bis 10 Tage)" value={rate.avg10dPricePerGramEur} muted />
    </div>
  );
}

function RateRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string | null;
  tone?: 'wax';
  muted?: boolean;
}): JSX.Element {
  const color =
    tone === 'wax' ? 'var(--w14-wax-red)' : muted ? 'var(--w14-ink-faded)' : 'var(--w14-ink)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.06em', fontSize: 'var(--w14-schrift-zeile)' }}
      >
        {label}
      </span>
      <span
        className="w14-tabular"
        style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-text)', color }}
      >
        {value !== null ? `${formatPrice(value)} €/g` : '-'}
      </span>
    </div>
  );
}

function formatPct(frac: number): string {
  return `${(frac * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;
}

/**
 * Die Herkunft eines Kurses, in Worten des Händlers.
 *
 * ⚠️ 31.07.2026: hier stand der rohe Wert. Auf dem Schirm las der Händler
 * `SPOT_VENDOR` oder `XAUEUR_VENDOR` — ein Wort aus der Datenbank, in
 * Grossbuchstaben, mit Unterstrich, auf genau der Fläche, die sein Vertrauen
 * in den Goldpreis tragen soll. Basel hat es zur Chefsache gemacht: die
 * Quelle muss GENANNT werden, nicht angedeutet.
 *
 * Jede Herkunft trägt jetzt einen Namen und einen Satz, der sagt, was sie
 * bedeutet. Der Satz erscheint beim Verweilen und als Vorlesetext.
 *
 * Der Rückfall ist bewusst KEIN Verstecken: eine unbekannte Herkunft zeigt
 * ihren rohen Wert weiter an. Lieber ein hässliches Wort, das jemand meldet,
 * als eine stille Lücke, die niemand sieht.
 */
const HERKUNFT: Record<string, { name: string; bedeutung: string }> = {
  LBMA: {
    name: 'London Fix',
    bedeutung:
      'Der amtliche Feinunzenpreis der London Bullion Market Association. Nur mit Lizenz führbar.',
  },
  SPOT_VENDOR: {
    name: 'Spotkurs, EZB-gerechnet',
    bedeutung:
      'Der Marktpreis je Feinunze in Dollar, umgerechnet mit dem Referenzkurs der Europäischen Zentralbank vom selben Tag. Der amtliche Weg für Euro-Beträge in Deutschland.',
  },
  XAUEUR_VENDOR: {
    name: 'Anbieterkurs',
    bedeutung: 'Ein Euro-Kurs direkt vom Datenanbieter, ohne eigene Umrechnung.',
  },
  MANUAL: {
    name: 'Von Hand gesetzt',
    bedeutung:
      'Dieser Kurs wurde in dieser Kasse eingetragen, mit Begründung und Namen im Tagebuch.',
  },
  INTERNAL_ESTIMATE: {
    name: 'Eigener Schätzwert',
    bedeutung: 'Kein Marktkurs. Ein Behelf, solange keine Quelle erreichbar war.',
  },
};

function SourceBadge({ source }: { source: string }): JSX.Element {
  const bekannt = HERKUNFT[source];
  return (
    <span
      className="w14-smallcaps"
      title={bekannt?.bedeutung ?? `Unbekannte Herkunft: ${source}`}
      aria-label={
        bekannt ? `Herkunft: ${bekannt.name}. ${bekannt.bedeutung}` : `Unbekannte Herkunft ${source}`
      }
      style={{
        fontSize: 'var(--w14-schrift-kuerzel)',
        letterSpacing: '0.08em',
        padding: 'var(--w14-abstand-2) var(--w14-abstand-8)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        color: 'var(--w14-ink-faded)',
        cursor: 'help',
      }}
    >
      {bekannt?.name ?? source}
    </span>
  );
}

/**
 * PriceChart — an advanced area chart: gradient fill under the line, min/max
 * y-axis labels, first/last date labels, the 10-day mean (dashed), and a
 * highlighted last point. Pure SVG, no chart dependency.
 */
function PriceChart({
  history,
  accent,
  avg,
}: {
  history: MetalPriceHistoryRow[];
  accent: string;
  avg?: string | null;
}): JSX.Element | null {
  const gradId = useId();
  if (history.length < 2) return null;

  // History is DESC → ASC for time order.
  const rows = [...history]
    .reverse()
    .map((r) => ({ v: Number.parseFloat(r.pricePerGramEur), t: r.validFrom }))
    .filter((p) => Number.isFinite(p.v));
  if (rows.length < 2) return null;

  const values = rows.map((p) => p.v);
  const avgNum = avg != null ? Number.parseFloat(avg) : Number.NaN;
  const hasAvg = Number.isFinite(avgNum);

  const domain = hasAvg ? [...values, avgNum] : values;
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const range = max - min || 1;

  const W = 300;
  const H = 120;
  const top = 8;
  const bottom = 96;
  const plotH = bottom - top;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const xOf = (i: number): number => i * step;
  const yOf = (v: number): number => bottom - ((v - min) / range) * plotH;

  const linePts = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const areaPath = `M0,${bottom} ${values
    .map((v, i) => `L${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')} L${W},${bottom} Z`;
  const avgY = hasAvg ? yOf(avgNum) : null;
  // biome-ignore lint/style/noNonNullAssertion: values.length >= 2 guarded above.
  const lastV = values[values.length - 1]!;

  const fmtDate = (s: string): string => {
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={120}
      preserveAspectRatio="none"
      role="img"
      style={{ marginTop: 12, display: 'block' }}
    >
      <title>Verlauf{hasAvg ? ' · Mittel bis 10 Tage (gestrichelt)' : ''}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: accent, stopOpacity: 0.3 }} />
          <stop offset="100%" style={{ stopColor: accent, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <line
        x1={0}
        x2={W}
        y1={bottom}
        y2={bottom}
        stroke="var(--w14-rule)"
        strokeWidth={0.75}
        opacity={0.5}
      />
      {avgY !== null && (
        <line
          x1={0}
          x2={W}
          y1={avgY.toFixed(1)}
          y2={avgY.toFixed(1)}
          stroke="var(--w14-ink-faded)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        fill="none"
        stroke={accent}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={linePts}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={xOf(values.length - 1).toFixed(1)}
        cy={yOf(lastV).toFixed(1)}
        r={3}
        fill={accent}
      />
      <text
        x={2}
        y={top + 4}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {max.toFixed(2)}
      </text>
      <text
        x={2}
        y={bottom - 3}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {min.toFixed(2)}
      </text>
      <text
        x={2}
        y={H - 3}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {fmtDate(rows[0]?.t ?? '')}
      </text>
      <text
        x={W - 2}
        y={H - 3}
        fontSize={8}
        textAnchor="end"
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {fmtDate(rows[rows.length - 1]?.t ?? '')}
      </text>
    </svg>
  );
}

function formatPrice(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// ════════════════════════════════════════════════════════════════════════
// Margen-Modal (ADMIN). Bis 18.08.2026 stand hier auch das Override-Modal;
// es ist mit der Handeingabe abgeschafft, `inputStyle` traegt nur noch die
// Margenfelder.
// ════════════════════════════════════════════════════════════════════════


const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-betont)',
  color: 'var(--w14-ink)',
  outline: 'none',
};

// ════════════════════════════════════════════════════════════════════════
// Safety-Margin Modal (Owner / step-up)
// ════════════════════════════════════════════════════════════════════════

function MarginModal({ rates, onClose }: { rates: MetalRate[]; onClose: () => void }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  // Each field edits a PERCENT (e.g. 10); the API stores a fraction (0.10).
  const initial = useMemo(() => {
    const m = {} as Record<MetalKind, string>;
    for (const mk of METAL_KIND_ORDER) {
      const r = rates.find((x) => x.metal === mk);
      m[mk] = r ? String(Number(((r.safetyMarginPct ?? 0.1) * 100).toFixed(2))) : '10';
    }
    return m;
  }, [rates]);
  const [pcts, setPcts] = useState<Record<MetalKind, string>>(initial);

  const numOf = (mk: MetalKind): number => Number(pcts[mk].replace(',', '.'));
  const validOf = (mk: MetalKind): boolean => {
    const n = numOf(mk);
    return Number.isFinite(n) && n >= 0 && n <= 50;
  };
  const allValid = METAL_KIND_ORDER.every(validOf);

  // The base the server applies the margin to: the 10-day time-weighted mean.
  const baseOf = (mk: MetalKind): string | null => {
    const r = rates.find((x) => x.metal === mk);
    return r?.avg10dPricePerGramEur ?? r?.currentPricePerGramEur ?? null;
  };
  // Live Ankauf preview via the SAME formula the server uses (deriveAnkaufPerGram
  // mirrors ROUND(avg × (1 − margin), 4)); the authoritative value still arrives
  // from the /rates refetch after save. 19.08.2026: die Marge geht als ROHE
  // Prozent-Zeichenkette hinein (nur das Komma normalisiert) — die Rechnung
  // laeuft in BigInt, exakt wie SQL, kein Gleitkomma dazwischen.
  const previewAnkauf = (mk: MetalKind): string =>
    formatPerGram(deriveAnkaufPerGram(baseOf(mk), pcts[mk].replace(',', '.')));

  const save = useMutation({
    mutationFn: async () => {
      // PATCH only the metals whose margin changed. The first call triggers the
      // step-up modal; the elevated session covers the rest of the burst.
      for (const mk of METAL_KIND_ORDER) {
        const r = rates.find((x) => x.metal === mk);
        const cur = r ? Number((r.safetyMarginPct * 100).toFixed(2)) : null;
        const n = numOf(mk);
        if (validOf(mk) && n !== cur) {
          await metalPricesApi.updateMargin(api, { metal: mk, marginPct: n / 100 });
        }
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Margen gespeichert',
        body: 'Ankaufskurse überall aktualisiert: Ticker, Ankauf-Vorschlag, Kursraum.',
      });
      // CORE FIX: invalidate the WHOLE metal-prices family (not just 'rates') so
      // EVERY consumer refetches the new server-derived Ankauf rate at once. The
      // chrome ticker (useMetalRates), the Ankauf estimator (IntakeList +
      // AppraisalItemForm) and this Kursraum all share the ['metal-prices', …]
      // key prefix → a single invalidation reaches all of them.
      await qc.invalidateQueries({ queryKey: ['metal-prices'] });
      onClose();
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role="dialog" to match the existing modal pattern in this screen
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Sicherheitsmargen je Metall"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 10, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
        // Die Ebenenleiter statt einer nackten Zahl: 100 ist die Stufe der
        // klebenden Kopfzeilen — ein Dialog auf derselben Stufe kann von einer
        // solchen Kopfzeile ueberdeckt werden.
        zIndex: 'var(--w14-z-fenster)',
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
          }}
        >
          Sicherheitsmargen je Metall
        </h2>
        <Zwischentitel />

        <p style={{ margin: '8px 0 0', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
          <strong>Ankaufpreis = Mittel der Aufzeichnung (bis 10 Tage) × (1 − Marge).</strong> Das
          Mittel rechnet ab dem ersten aufgezeichneten Kurs, es wartet nicht zehn Tage. Jede Marge ist einzeln
          einstellbar (0 bis 50 %). Speichern wirkt <strong>sofort überall</strong>: Ticker,
          Ankauf-Vorschlag und Kursraum.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Die Marge betrifft nur den <strong>Ankauf</strong>. Verkaufspreise sind je Artikel
          (Listenpreis), nicht Spot × Marge.
        </p>

        <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)', marginTop: 14 }}>
          {METAL_KIND_ORDER.map((mk) => (
            <div
              key={mk}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 96px 1fr',
                gap: 'var(--w14-abstand-12)',
                alignItems: 'center',
              }}
            >
              <span
                className="w14-smallcaps"
                style={{ color: METAL_ACCENT[mk], fontWeight: 600, letterSpacing: '0.06em' }}
              >
                {METAL_LABEL[mk]}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--w14-abstand-4)' }}>
                <input
                  value={pcts[mk]}
                  onChange={(e) => setPcts((s) => ({ ...s, [mk]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`Marge ${METAL_LABEL[mk]} in Prozent`}
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--w14-font-mono)',
                    textAlign: 'right',
                    borderColor: validOf(mk) ? 'var(--w14-feldlinie)' : 'var(--w14-wax-red)',
                  }}
                />
                <span style={{ color: 'var(--w14-ink-faded)' }}>%</span>
              </span>
              <span
                className="w14-tabular"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-feld)',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ color: 'var(--w14-ink-faded)' }}>
                  Ø10T {formatPerGram(baseOf(mk))}
                </span>
                <span style={{ color: 'var(--w14-wax-red)', fontWeight: 600 }}>
                  → Ankauf {previewAnkauf(mk)}
                </span>
              </span>
            </div>
          ))}
        </div>

        {!allValid && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-wax-red)' }}>
            Bitte je Metall einen Wert zwischen 0 und 50 eingeben.
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end', marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!allValid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Speichert…' : 'Übernehmen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

/**
 * MetalTicker — the always-visible Edelmetall price strip in the app chrome
 * (UX-REDESIGN §3.A / §4.4). Replaces the Kurse PRIMARY tab on the daily hot
 * path: prices are a glanceable TICKER, not a 983-LOC screen.
 *
 * Four cells (Gold/Silber/Platin/Palladium) — label · €/g (mono) · Δ — driven
 * by the pure `formatMetalTick` over the SHARED rates query (no second fetch).
 * Clicking a cell anchors a lightweight detail popover (current/Δ/last-update
 * + a real-history Sparkline + a "Details" link to the full Kurse view).
 */
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  METAL_KIND_ORDER,
  type MetalKind,
  type MetalRate,
  metalPricesApi,
} from '@norns/api-client';
import { Popover, Sparkline, type SparklineTone } from '@norns/ui-kit';

import { useMetalRates } from '../../hooks/useMetalRates.js';
import { useApiClient } from '../../lib/api-context.js';
import { zahlVomServer } from '../../lib/decimal.js';
import { formatKursalter } from '../../lib/intake-math.js';
import { formatPerGram } from '../../lib/metal-margin.js';
import { type TickTone, formatMetalTick, deckeMittelAb } from '../../lib/metal-tick.js';
import { useSessionStore } from '../../state/session-store.js';

const METAL_LABEL: Record<MetalKind, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

const TONE_COLOR: Record<TickTone, string> = {
  up: 'var(--w14-verdigris)',
  down: 'var(--w14-wax-red)',
  flat: 'var(--w14-ink-faded)',
};

const SPARK_TONE: Record<TickTone, SparklineTone> = {
  up: 'up',
  down: 'down',
  flat: 'gold',
};

export function MetalTicker(): JSX.Element | null {
  /*
   * ── Der Modulschalter (14.08.2026, Basels Entscheidung) ──────────────────
   *
   * Nicht jeder Betrieb handelt mit Edelmetall. `modul.kursleiste` schaltet
   * diese Leiste je Betrieb ab; der Code bleibt vollstaendig. Leer gilt als
   * AN (die heutigen Kunden sind Juweliere), und ein Netzfehler beim Lesen
   * der Einstellung darf die Leiste NICHT verstecken: verschwinden darf sie
   * nur auf ein ausdrueckliches AUS.
   */
  const api = useApiClient();
  const modulQ = useQuery({
    queryKey: ['settings', 'modul.kursleiste'],
    queryFn: () =>
      api.request<{ settings: Array<{ key: string; value: string }> }>('GET', '/api/settings'),
    staleTime: 60_000,
    select: (d) => d.settings.find((s) => s.key === 'modul.kursleiste')?.value ?? '',
  });
  const abgeschaltet = modulQ.data === 'AUS';

  const ratesQ = useMetalRates();
  if (abgeschaltet) return null;
  const byMetal = new Map<MetalKind, MetalRate>();
  for (const r of ratesQ.data?.rates ?? []) byMetal.set(r.metal, r);

  const loadingFirst = ratesQ.isLoading && !ratesQ.data;

  // ── WIE ALT DER KURS WIRKLICH IST ────────────────────────────────────────
  //
  // ⚠️ 31.07.2026: hier stand
  //     const stale = ratesQ.isError && !!ratesQ.data;
  // Das meldete „veraltet" NUR, wenn die Abfrage FEHLSCHLUG. Kam sie sauber
  // zurück und trug einen Kurs von letzter Woche, stand die Zahl da wie
  // heute gemessen — ohne ein Zeichen.
  //
  // Für einen Altgoldankauf ist das kein Schönheitsfehler. Der Preis ist
  // Kurs mal Feingehalt mal Gewicht; ein alter Kurs zahlt bei JEDEM Ankauf
  // falsch, und immer in dieselbe Richtung.
  //
  // Der Server rechnet das Alter längst aus und schickt es mit
  // (`routes/metal-prices.ts`, `asOf`, `ageHours`, `stale`). Ab jetzt
  // entscheidet ER, nicht der Zustand unserer Verbindung.
  const alleKurse = ratesQ.data?.rates ?? [];
  const serverSagtVeraltet = alleKurse.some((r) => r.stale);
  const verbindungGestoert = ratesQ.isError && !!ratesQ.data;
  const stale = serverSagtVeraltet || verbindungGestoert;

  // Das ALTER des ältesten Kurses, für den Satz daneben. Ein Kurs ohne
  // `ageHours` ist einer, den es noch gar nicht gibt; der zählt hier nicht.
  const alterStunden = alleKurse.reduce<number | null>((max, r) => {
    if (r.ageHours == null) return max;
    return max == null || r.ageHours > max ? r.ageHours : max;
  }, null);

  // „Kurs 12 Min. alt", „Kurs 3 Std alt", „Kurs 6 Tage alt" — nie eine nackte
  // Zahl. Die Staffelung stand bis zum 11.08.2026 NUR hier; die Ankauffläche
  // nannte dasselbe Alter gar nicht. Jetzt steht sie in `intake-math.ts` und
  // beide Flächen sagen dasselbe.

  return (
    <section
      aria-label="Edelmetall-Ticker"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderBottom: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-2)',
        overflowX: 'auto',
        opacity: stale ? 0.85 : 1,
      }}
    >
      {METAL_KIND_ORDER.map((metal) => (
        <MetalCell key={metal} metal={metal} rate={byMetal.get(metal)} loading={loadingFirst} />
      ))}
      {stale && (
        <span
          className="w14-smallcaps"
          title={
            serverSagtVeraltet
              ? 'Dieser Kurs ist zu alt für einen Ankaufvorschlag. Bitte neu holen oder den Kurs bestätigen.'
              : // ⚠️ Hier stand „Verbindung gestört". Bewiesen ist aber nur
                // `ratesQ.isError` — und das ist auch ein Serverfehler oder
                // ein Fehler in der Kasse. Der Satz sagt jetzt, was gemessen
                // ist: die Zahl daneben ist alt, weil das Holen misslang.
                'Letzter bekannter Kurs. Die Aktualisierung ist fehlgeschlagen.'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 var(--w14-abstand-12)',
            color: 'var(--w14-ink-faded)',
            fontSize: 'var(--w14-schrift-kuerzel)',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
          }}
        >
          {/* 27.07.2026: „offline" allein sagte nicht, WAS mit den Zahlen
              ist — die tragende Auskunft (letzter bekannter Kurs) stand nur
              im title= und war dem Finger unsichtbar. Jetzt steht sie da. */}
          {/* Der Satz sagt jetzt WIE alt und WARUM, statt nur „veraltet".
              Ein Kurs von gestern ist brauchbar, WENN er so heisst; er ist
              gefährlich, wenn er aussieht wie der von jetzt. */}
          {serverSagtVeraltet
            ? `· ${formatKursalter(alterStunden) ?? 'Kurs zu alt'} · kein Ankaufvorschlag`
            : '· letzter bekannter Kurs, nicht aktualisiert'}
        </span>
      )}
    </section>
  );
}

const CELL_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  minHeight: 44,
  padding: 'var(--space-2) var(--space-4)',
  border: 'none',
  borderRight: '1px solid var(--w14-rule)',
  background: 'transparent',
  color: 'var(--w14-ink)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function MetalCell({
  metal,
  rate,
  loading,
}: {
  metal: MetalKind;
  rate: MetalRate | undefined;
  loading: boolean;
}): JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const tick = formatMetalTick(
    rate?.currentPricePerGramEur ?? null,
    rate?.avg10dPricePerGramEur ?? null,
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={CELL_BTN}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--w14-parchment-3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          className="w14-smallcaps"
          style={{ fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.06em', color: 'var(--w14-ink-faded)' }}
        >
          {METAL_LABEL[metal]}
        </span>
        {loading ? (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 64,
              height: 12,
              borderRadius: 'var(--w14-radius-fein)',
              background: 'var(--w14-parchment-3)',
            }}
          />
        ) : (
          <>
            <span
              className="w14-tabular"
              style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-betont)', fontWeight: 600 }}
            >
              {tick.price}
              <span style={{ color: 'var(--w14-ink-faded)', fontWeight: 400 }}> €/g</span>
            </span>
            {tick.deltaLabel && (
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-feld)',
                  color: TONE_COLOR[tick.tone],
                }}
              >
                {tick.deltaLabel}
              </span>
            )}
          </>
        )}
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        ariaLabel={`${METAL_LABEL[metal]}, Kursdetail`}
      >
        <MetalDetail metal={metal} rate={rate} />
      </Popover>
    </>
  );
}

function MetalDetail({
  metal,
  rate,
}: { metal: MetalKind; rate: MetalRate | undefined }): JSX.Element {
  const api = useApiClient();
  const navigate = useNavigate();
  const isAdmin = useSessionStore((s) => s.actor?.role === 'ADMIN');
  const tick = formatMetalTick(
    rate?.currentPricePerGramEur ?? null,
    rate?.avg10dPricePerGramEur ?? null,
  );
  const marginPct = rate?.safetyMarginPct ?? null;

  // Shares Kurse's history queryKey → cache-deduped. Lazy: only runs while the
  // popover (and thus this component) is mounted.
  const histQ = useQuery({
    queryKey: ['metal-prices', 'history', metal],
    queryFn: () => metalPricesApi.history(api, { metal, limit: 60 }),
    staleTime: 60_000,
  });
  const items = histQ.data?.items ?? [];
  const values = items
    // ⚠️ Hier stand `Number(normalizeDecimal(...))`, dieselbe Falle wie im
    // Kursfeld daneben: eine Motorzahl durch den Menschentipp-Parser. Die
    // Begruendung steht bei `zahlVomServer`.
    .map((i) => zahlVomServer(i.pricePerGramEur) ?? Number.NaN)
    .filter((n) => Number.isFinite(n))
    .reverse(); // history is DESC; chart wants ASC
  const lastUpdateIso = items[0]?.fetchedAt ?? null;
  // Wie viele Kurstage stecken wirklich im Serverdurchschnitt (siehe unten).
  const deckung = deckeMittelAb(
    items.map((i) => i.fetchedAt),
    new Date(),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-12)',
        }}
      >
        <strong style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-grund)' }}>
          {METAL_LABEL[metal]}
        </strong>
        <span
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600 }}
        >
          {tick.price} €/g
        </span>
      </div>
      {/* ⚠️ 01.08.2026: hier stand fest „ggü. Ø 10 Tage". Auf einer frischen
          Kasse mit einem einzigen Kurstag ist das Mittel der heutige Kurs, die
          Differenz also zwangsläufig 0,0 % — die Kasse zeigte „unverändert" und
          meinte „ich habe nichts zum Vergleichen". `deckeMittelAb` zählt die
          Tage, die diese Fläche ohnehin geladen hat, statt zehn zu behaupten;
          bei einem einzigen Tag verschwindet die Prozentzahl ganz. */}
      {tick.deltaLabel && deckung.vergleichstext !== null && (
        <div style={{ fontSize: 'var(--w14-schrift-feld)', color: TONE_COLOR[tick.tone] }}>
          {tick.deltaLabel}{' '}
          <span style={{ color: 'var(--w14-ink-faded)' }}>{deckung.vergleichstext}</span>
        </div>
      )}
      {deckung.vergleichstext === null && !histQ.isLoading && (
        <div style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
          {deckung.tage === 0
            ? 'Noch kein Kursverlauf erfasst.'
            : 'Erst ein Kurstag erfasst, noch kein Mittel zum Vergleichen.'}
        </div>
      )}

      {/* The buy rate, derived server-side from the per-metal margin. Shares the
          rates query → editing the margin (below) moves this line live, so the
          ticker reflects the change, not just one isolated screen. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-12)',
          fontSize: 'var(--w14-schrift-feld)',
        }}
      >
        <span style={{ color: 'var(--w14-ink-faded)' }}>
          Ankauf{marginPct != null ? ` (−${(marginPct * 100).toFixed(1)} %)` : ''}
        </span>
        <span
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-wax-red)' }}
        >
          {formatPerGram(rate?.ankaufRatePerGramEur ?? null)}
        </span>
      </div>

      {histQ.isLoading ? (
        <div
          style={{
            height: 56,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: 'var(--w14-schrift-feld)',
          }}
        >
          Verlauf lädt…
        </div>
      ) : values.length >= 2 ? (
        <Sparkline
          values={values}
          ariaLabel={`${METAL_LABEL[metal]} Kursverlauf`}
          tone={SPARK_TONE[tick.tone]}
        />
      ) : (
        <div
          style={{
            height: 56,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: 'var(--w14-schrift-feld)',
          }}
        >
          Kein Verlauf verfügbar
        </div>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={() => navigate('/kurse?marge=1')}
          className="w14-smallcaps"
          style={{
            alignSelf: 'flex-start',
            minHeight: 44,
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-gold)',
            cursor: 'pointer',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.06em',
            padding: 0,
          }}
        >
          Ankaufmarge bearbeiten →
        </button>
      )}

      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w14-abstand-12)' }}
      >
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          {lastUpdateIso ? `Stand: ${new Date(lastUpdateIso).toLocaleString('de-DE')}` : ''}
        </span>
        <button
          type="button"
          onClick={() => navigate('/kurse')}
          className="w14-smallcaps"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-gold)',
            cursor: 'pointer',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.06em',
            padding: 0,
          }}
        >
          Details / Verlauf →
        </button>
      </div>
    </div>
  );
}

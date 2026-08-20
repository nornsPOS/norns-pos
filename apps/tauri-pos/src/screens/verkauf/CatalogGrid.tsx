/**
 * CatalogGrid — left column of Verkauf.
 *
 * Loads `GET /api/products?status=AVAILABLE` via TanStack Query. Renders a
 * responsive grid of IMAGE CARDS: each tile leads with the product's primary
 * photo (a tasteful placeholder when none), then name, price, SKU and a small
 * status/metal chip. Clicking a card fires the reservation flow (parent handles
 * the API + cart-store push).
 *
 * Search affordance — the brand MagnifierIcon + a mono input — refetches
 * with the `q` query param so the server does the ILIKE work. Debounced
 * 240 ms.
 *
 * Performance: the tile is wrapped in `React.memo` and `onSelect` is forwarded
 * unchanged from the parent (a stable useCallback), so a scanner burst that
 * mutates `reservingProductIds` / `inCart` only re-renders the tiles whose
 * membership actually flipped — not the whole grid (audit fix for the
 * re-render storms under fast USB-scanner input).
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { type ProductListRow, productsApi } from '@norns/api-client';
import { Button, MagnifierIcon, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useInventoryCounts } from '../../hooks/useInventoryCounts.js';
import { AVAILABILITY_BUCKETS, bucketCount } from '../../lib/availability-ui.js';
import { useApiClient } from '../../lib/api-context.js';
import { geltenderPreis } from '../../lib/korbpreis.js';
import {
  TAGESPREIS_HINWEIS_KASSE,
  fasseTagespreiseZusammen,
  standSatz,
} from '../lager/tagespreis-anzeige.js';
import { Eintreffen, SkelettBalken } from '../_shared/SanfteMomente.js';

/** German labels for the metal chip. `null` metal renders no chip. */
const METAL_LABEL: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

/**
 * Resolve the catalog tile image. The API returns a RELATIVE thumb path
 * (`/api/photos/<id>/thumb`); we prefix it with the api-client baseUrl so the
 * public-by-UUID /thumb route resolves cross-origin in the Tauri webview.
 */
function resolveThumbUrl(baseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export interface CatalogGridProps {
  /**
   * Set of product ids currently mid-reserve. Each tile disables itself
   * only when ITSELF is in the set — other tiles remain clickable so a
   * USB barcode scanner can fire 5–10 reservations per second without
   * being throttled by a single in-flight global guard.
   */
  reservingProductIds: ReadonlySet<string>;
  /** Set of product ids already in cart — render with subdued look. */
  inCart: ReadonlySet<string>;
  onSelect: (product: ProductListRow) => void;
  /**
   * Incremented by the parent after a sale finalizes and its dialog closes —
   * refocuses the search input so the next scan/typing lands here. Ignored on
   * the initial render (autoFocus handles first mount).
   */
  focusToken?: number;
  /**
   * Incremented by the parent after a barcode scan is handled. The scanner's
   * keystrokes leak into this input (the hook only swallows the trailing
   * Enter), so we clear it — otherwise the grid would filter to the just-sold
   * SKU and show "Keine Treffer" after a successful scan.
   */
  searchResetToken?: number;
}

const METAL_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'ALL', label: 'Alle' },
  { key: 'gold', label: 'Gold' },
  { key: 'silver', label: 'Silber' },
  { key: 'platinum', label: 'Platin' },
  { key: 'palladium', label: 'Palladium' },
  { key: 'other', label: 'Sonstiges' },
];

export function CatalogGrid({
  reservingProductIds,
  inCart,
  onSelect,
  focusToken,
  searchResetToken,
}: CatalogGridProps): JSX.Element {
  const api = useApiClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');
  const [metalFilter, setMetalFilter] = useState<string>('ALL');
  // Keyboard ring-up (Wave 1.2): the highlighted result index. Enter rings it.
  const [highlight, setHighlight] = useState<number>(0);

  // P2: when the parent bumps `focusToken` (after a successful finalize closes
  // the Bezahlen dialog), refocus + select the search so the next USB-scanner
  // burst or keystroke lands here — no clicking required to start the next sale.
  useEffect(() => {
    if (focusToken && focusToken > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [focusToken]);

  // Clear the search after a handled scan so the leaked SKU keystrokes don't
  // strand the grid on a now-reserved item. Skip the initial mount.
  useEffect(() => {
    if (searchResetToken && searchResetToken > 0) {
      setSearchInput('');
      setDebouncedQ('');
      searchRef.current?.focus();
    }
  }, [searchResetToken]);

  // 240ms debounce on the search input.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDebouncedQ(searchInput.trim());
    }, 240);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [searchInput]);

  const q = useQuery({
    queryKey: ['products', 'list', { status: 'AVAILABLE', q: debouncedQ }],
    queryFn: () =>
      productsApi.list(api, {
        status: 'AVAILABLE',
        ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
        limit: 60,
      }),
    // ⚠️ ZEHN SEKUNDEN, UND DIE FLÄCHE SAGT ES SELBST. Diese Abfrage trägt
    // auch den gerechneten Tagespreis der Kacheln. Sie rechnet ihn nicht
    // laufend nach; ein Dauerlauf mitten in einem Verkaufsvorgang würde die
    // Kacheln unter der Hand des Verkäufers wechseln. Statt „sofort" zu
    // versprechen, steht der STAND an der Tagespreis-Zeile — die Uhrzeit, zu
    // der gelesen wurde. Gebucht wird ohnehin der Preis auf der Kachel.
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    // Sanftheit der Verbindung: bei Suche und Filterwechsel bleiben die alten
    // Kacheln stehen, bis die neuen eintreffen — kein Blitzen auf Leere. Das
    // „sucht…" in der Suchzeile sagt derweil ehrlich, dass gearbeitet wird.
    placeholderData: keepPreviousData,
  });

  // Live availability at a glance (Phase 2.7): the catalog shows only sellable
  // AVAILABLE tiles, so the strip surfaces the fuller picture — what's held
  // (Reserviert) and gone (Verkauft) — keyed to the current search.
  const inventoryCounts = useInventoryCounts({ q: debouncedQ });

  const allItems = useMemo(() => q.data?.items ?? [], [q.data]);
  const items = useMemo(() => {
    if (metalFilter === 'ALL') return allItems;
    if (metalFilter === 'other') return allItems.filter((i) => i.metal == null);
    return allItems.filter((i) => i.metal === metalFilter);
  }, [allItems, metalFilter]);

  // Das Tagespreis-Bild über die SICHTBAREN Kacheln. Gezählt wird nur, was der
  // Motor wirklich mitgeschickt hat; sonst bleibt der Satz null.
  //
  // ⚠️ Die Abfrage holt höchstens sechzig Kacheln, und der Metallfilter nimmt
  // davon noch einmal welche weg. Die Gesamtzahl der Auswahl (`total`) muss
  // deshalb mit, sonst klänge der Satz nach dem ganzen Bestand. Ohne Antwort
  // gibt es keine Gesamtzahl — dann sagt der Satz selbst, dass nur das
  // Gezeigte zählt, statt eine Zahl zu erfinden.
  const gesamtImKatalog = q.data?.total;
  const tagespreisbild = useMemo(
    () =>
      fasseTagespreiseZusammen(
        items,
        gesamtImKatalog === undefined ? undefined : { gesamt: gesamtImKatalog, rest: 'gezeigt' },
      ),
    [items, gesamtImKatalog],
  );
  // Wann die gezeigten Zahlen gelesen wurden — absolute Uhrzeit, kein Alter.
  const tagespreisStand = standSatz(q.dataUpdatedAt);

  // A new query / filter parks the keyboard highlight on the top (best) result,
  // so typing a few characters and pressing Enter rings up the first match.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new result set
  useEffect(() => {
    setHighlight(0);
  }, [debouncedQ, metalFilter]);
  /**
   * Zeigt die Liste, was gerade im Feld steht?
   *
   * Solange die Entprellung laeuft, gehoert die sichtbare Liste noch zum
   * VORIGEN Suchtext — und Enter darf daraus nichts greifen.
   */
  const listeIstAktuell = searchInput.trim() === debouncedQ;

  // The highlight clamped to the current result set (items can shrink on refetch).
  const activeHighlight =
    items.length === 0 ? -1 : Math.min(Math.max(0, highlight), items.length - 1);

  return (
    <section
      aria-label="Kataloge"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-16)',
        gap: 'var(--w14-abstand-14)',
      }}
    >
      {/* Search row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w14-abstand-10)',
          padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
          backgroundColor: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <MagnifierIcon size={20} tone="ink" />
        <input
          ref={searchRef}
          type="text"
          value={searchInput}
          onChange={(ev) => setSearchInput(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') {
              setSearchInput('');
              return;
            }
            if (ev.key === 'Enter' && !listeIstAktuell) {
              // ── DER STILLE FALSCHVERKAUF (25.07.2026) ────────────────────
              // Die Liste haengt 240 ms hinter der Eingabe zurueck. Wer
              // „MZ-0042" abschickt, dann „MZ-0043" tippt und SOFORT Enter
              // drueckt, legte bis heute die ALTE Muenze in den Korb — sie
              // stand ja noch auf Platz eins. Auf dem Bon stand der falsche
              // Artikel, und im Bestand wurde das falsche Einzelstueck
              // verkauft.
              //
              // Hier wird deshalb nichts gegriffen, sondern die Wartezeit
              // sofort beendet. Die Liste steht damit im selben Augenblick;
              // der zweite Enter trifft das Richtige.
              ev.preventDefault();
              if (timer.current !== null) window.clearTimeout(timer.current);
              setDebouncedQ(searchInput.trim());
              return;
            }
            if (items.length === 0) return;
            if (ev.key === 'ArrowDown') {
              ev.preventDefault();
              setHighlight((h) => Math.min(items.length - 1, h + 1));
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (ev.key === 'Enter') {
              ev.preventDefault();
              const it = items[activeHighlight];
              if (it && !reservingProductIds.has(it.id) && !inCart.has(it.id)) onSelect(it);
            }
          }}
          placeholder="SKU · Name · Beschreibung"
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
        {q.isFetching && (
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            sucht…
          </span>
        )}
      </div>

      {/* Availability at a glance (Verfügbar/Reserviert/Verkauft). */}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-16)', flexWrap: 'wrap', alignItems: 'center' }}>
        {AVAILABILITY_BUCKETS.map((b) => (
          <span
            key={b.bucket}
            className="w14-smallcaps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-6)',
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.06em',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {b.label}
            <span
              style={{
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontVariantNumeric: 'tabular-nums',
                color: b.tone === 'available' ? 'var(--w14-verdigris)' : 'var(--w14-ink-aged)',
              }}
            >
              {/* No fake 0 while the first count loads. */}
              {inventoryCounts.data ? bucketCount(inventoryCounts.data, b.bucket) : '-'}
            </span>
          </span>
        ))}
      </div>

      {/* ── Der Tagespreis gegen den Preis auf der Kachel ──────────────────
          Der Motor legt bei jeder Lagerabfrage den gerechneten Tagespreis bei
          (products-list.ts:275); diese Fläche las ihn nicht. Der Verkäufer
          kassierte bei steigendem Goldkurs weiter den eingefrorenen Preis.
          Diese Zeile sagt, wie viele Kacheln betroffen sind, und WO die Zahl
          nachgezogen wird. Sie erscheint nur, wenn wirklich etwas abweicht. */}
      {tagespreisbild.satz !== null && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 'var(--w14-abstand-8)',
            padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            background: 'var(--w14-parchment-1)',
          }}
        >
          <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
            {tagespreisbild.satz}
          </span>
          {tagespreisbild.umfangSatz !== null && (
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
              {tagespreisbild.umfangSatz}
            </span>
          )}
          {tagespreisStand !== null && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {tagespreisStand}
            </span>
          )}
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            {TAGESPREIS_HINWEIS_KASSE}
          </span>
        </div>
      )}

      {/* Quick metal filters */}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
        {METAL_FILTERS.map((f) => {
          const active = f.key === metalFilter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setMetalFilter(f.key)}
              className="w14-smallcaps"
              style={{
                padding: 'var(--w14-abstand-6) var(--w14-abstand-16)',
                fontSize: 'var(--w14-schrift-feld)',
                letterSpacing: '0.04em',
                borderRadius: 'var(--w14-radius-pille)',
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
                /* AA-safe brass (--w14-accent) for the active fill; decorative
                   --w14-gold here was ~2.0:1 and failed WCAG AA.
                   ── UND DIE SCHRIFT DAZU (27.07.2026): hartes #fff bestand nur
                   im Hellthema. Im Dunkelthema ist --w14-accent ein HELLES
                   Patinagruen, weiss darauf mass live 2,18:1 — der einzige
                   Textbefund unter 4,5 im ganzen Abschlussrundgang. Die Marke
                   --w14-accent-ink traegt je Thema die richtige Gegenfarbe
                   (hell f8f6f1, dunkel 0c1013). */
                background: active ? 'var(--w14-accent)' : 'var(--w14-parchment-2)',
                color: active ? 'var(--w14-accent-ink)' : 'var(--w14-ink-faded)',
                fontWeight: active ? 600 : 500,
                transition: 'background var(--w14-dur-press) var(--w14-ease-hover)',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {q.isError && items.length === 0 ? (
          <CatalogError onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : q.isLoading && items.length === 0 ? (
          <CatalogPlaceholder />
        ) : items.length === 0 ? (
          <EmptyState query={debouncedQ} />
        ) : (
          <Eintreffen
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 'var(--w14-abstand-14)',
            }}
          >
            {items.map((it, idx) => {
              const busy = reservingProductIds.has(it.id);
              const isInCart = inCart.has(it.id);
              return (
                <ProductTile
                  key={it.id}
                  product={it}
                  thumbUrl={resolveThumbUrl(api.baseUrl, it.primaryPhotoThumbUrl)}
                  disabled={busy || isInCart}
                  busy={busy}
                  inCart={isInCart}
                  highlighted={idx === activeHighlight}
                  onSelect={onSelect}
                />
              );
            })}
          </Eintreffen>
        )}
      </div>
    </section>
  );
}

interface ProductTileProps {
  product: ProductListRow;
  /** Absolute thumb URL, or null when the product has no primary photo. */
  thumbUrl: string | null;
  disabled: boolean;
  busy: boolean;
  inCart: boolean;
  /** Keyboard-selected tile (Enter rings it) — shows an accent ring + scrolls into view. */
  highlighted: boolean;
  onSelect: (p: ProductListRow) => void;
}

/**
 * Image card for one catalog product. Memoized so a scanner burst that flips
 * one product's reserve/cart membership doesn't re-render every sibling tile.
 */
const ProductTile = memo(function ProductTile({
  product,
  thumbUrl,
  disabled,
  busy,
  inCart,
  highlighted,
  onSelect,
}: ProductTileProps): JSX.Element {
  const metalLabel = product.metal ? METAL_LABEL[product.metal] : null;
  /*
   * Was diese Kachel kostet, wenn man sie antippt — DIESELBE Regel, die der
   * Korb anwendet (`lib/korbpreis.ts`). Eine zweite Regel hier wäre der
   * Anfang von zwei Preisen für dasselbe Stück.
   */
  const kachelPreis = geltenderPreis(product.listPriceEur, {
    productId: product.id,
    listPriceEur: product.listPriceEur,
    kurspreisEur: product.kurspreisEur,
    kurspreisGrund: product.kurspreisGrund,
    festerPreis: product.festerPreis,
  });
  const tileRef = useRef<HTMLButtonElement>(null);
  // Keep the keyboard-highlighted tile visible as the operator arrows through.
  useEffect(() => {
    if (highlighted) tileRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return (
    <button
      ref={tileRef}
      type="button"
      onClick={() => onSelect(product)}
      disabled={disabled || inCart}
      title={`${product.name} · ${product.sku}`}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
        border: `1px solid ${highlighted ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-card)',
        backgroundColor: inCart ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        boxShadow: highlighted
          ? '0 0 0 2px var(--w14-accent), var(--w14-shadow-card)'
          : 'var(--w14-shadow-card)',
        color: 'var(--w14-ink)',
        cursor: disabled || inCart ? 'default' : 'pointer',
        opacity: disabled && !busy ? 0.6 : 1,
        transition:
          'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
          ' box-shadow var(--w14-dur-short) var(--w14-ease-curator),' +
          ' transform var(--w14-dur-short) var(--w14-ease-curator)',
      }}
      onMouseEnter={(ev) => {
        if (disabled || inCart) return;
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--w14-gold)';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(ev) => {
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.borderColor = highlighted ? 'var(--w14-accent)' : 'var(--w14-rule)';
        el.style.transform = 'translateY(0)';
      }}
    >
      {/* Image */}
      <ProductThumb thumbUrl={thumbUrl} alt={product.name} dimmed={inCart} />

      {/* Body */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-abstand-6)',
          padding: 'var(--w14-abstand-12) var(--w14-abstand-14) var(--w14-abstand-14)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--w14-abstand-8)',
          }}
        >
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.sku}
          </span>
          {metalLabel && (
            <span
              className="w14-smallcaps"
              style={{
                flexShrink: 0,
                padding: 'var(--w14-abstand-2) var(--w14-abstand-8)',
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: '0.06em',
                borderRadius: 'var(--w14-radius-pille)',
                border: '1px solid var(--w14-rule)',
                color: 'var(--w14-ink-faded)',
                backgroundColor: 'var(--w14-parchment-1)',
              }}
            >
              {metalLabel}
            </span>
          )}
        </div>

        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-grund)',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.5em',
          }}
        >
          {product.name}
        </span>

        <div
          style={{
            marginTop: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 'var(--w14-abstand-8)',
          }}
        >
          {/*
            ⛔ 20.08.2026, bei der Nachpruefung gefunden: hier stand
            `product.listPriceEur` — der GESPEICHERTE Preis.

            Seit die Karte zum Tageskurs verkauft, war das die zweite
            Wahrheit derselben Kasse: auf der Kachel 1158,16 €, in der Karte
            160,93 €. Am Tresen sieht das aus wie ein kaputtes Programm, und
            der Kassierer weiss nicht, welche Zahl gilt.

            Die Kachel zeigt jetzt, was die Karte auch buchen wird — DIESELBE
            Regel (`geltenderPreis`), nicht eine zweite daneben.
          */}
          <MoneyAmount valueEur={kachelPreis.preisEur} emphasis />
          {inCart && (
            <span
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-gold)',
                letterSpacing: '0.08em',
              }}
            >
              im Korb
            </span>
          )}
          {busy && !inCart && (
            <span
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              reserviert…
            </span>
          )}
        </div>

        {/*
          ── 20.08.2026: DIESER SATZ STAND HIER UND WAR HEUTE FRÜH NOCH WAHR ──

          „Der Tagespreis steht UNTER dem Preis, nie an seiner Stelle.
           Gebucht wird, was in die Karte wandert, und das ist der
           gespeicherte Preis."

          Er war richtig, solange die Karte den gespeicherten Preis buchte.
          Seit heute bucht sie den Tageskurs — und damit hat sich der Satz
          umgedreht: die grosse Zahl auf der Kachel MUSS jetzt der Tagespreis
          sein, sonst zeigt die Kachel eine Zahl, die der Beleg nicht trägt.

          Darunter steht keine zweite ZAHL mehr (zwei Preise nebeneinander
          waren genau die Verwirrung), sondern nur noch der Grund, warum sich
          diese Zahl bewegt.
        */}
        {kachelPreis.herkunft === 'tagespreis' && (
          <span
            className="w14-smallcaps"
            title="Der Preis dieses Stücks folgt dem Metallkurs und ändert sich mit ihm."
            style={{
              fontSize: 'var(--w14-schrift-kuerzel)',
              letterSpacing: '0.06em',
              lineHeight: 1.3,
              color: 'var(--w14-ink-faded)',
            }}
          >
            folgt dem Tageskurs
          </span>
        )}
      </div>
    </button>
  );
});

/*
 * 20.08.2026: hier stand `TagespreisZeile` — die zweite Zahl unter dem
 * Preis. Sie hatte ihren Sinn, solange die Kachel den gespeicherten Preis
 * zeigte und die Karte ihn buchte. Jetzt zeigt die Kachel den geltenden
 * Preis, und eine zweite Zahl daneben wäre wieder die Verwirrung, die sie
 * einmal aufgelöst hat.
 *
 * ⚠️ `tagespreis-anzeige.ts` bleibt und wird weiter gebraucht: im LAGER
 * gehören beide Zahlen nebeneinander, denn dort geht es um den Bestand und
 * seinen gepflegten Wert, nicht um den Preis an der Kasse.
 */

/**
 * Square image header for a tile. Renders the WebP thumb when present, else a
 * neutral placeholder mark. Decoupled into its own component so an `onError`
 * fallback (e.g. a deleted byte / offline thumb route) doesn't force the whole
 * tile to carry image-load state.
 */
function ProductThumb({
  thumbUrl,
  alt,
  dimmed,
}: {
  thumbUrl: string | null;
  alt: string;
  dimmed: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  const showImage = thumbUrl !== null && !failed;

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        width: '100%',
        backgroundColor: 'var(--w14-parchment-3)',
        borderBottom: '1px solid var(--w14-rule)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showImage ? (
        <img
          src={thumbUrl ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: dimmed ? 0.7 : 1,
          }}
        />
      ) : (
        <PhotoPlaceholder />
      )}
    </div>
  );
}

/** Neutral mark shown when a product has no catalog photo yet. */
function PhotoPlaceholder(): JSX.Element {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Kein Foto"
      style={{ color: 'var(--w14-ink-faded)', opacity: 0.5 }}
    >
      <rect x={3} y={4} width={18} height={16} rx={2} stroke="currentColor" strokeWidth={1.4} />
      <circle cx={8.5} cy={9} r={1.6} fill="currentColor" />
      <path
        d="M4 17l4.5-4.5 3 3L16 11l4 5"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Erstes Laden: ruhige Skelett-Kacheln in der Geometrie der echten Kacheln
 * (quadratisches Bild, SKU-Zeile, zweizeiliger Name, Preis), damit beim
 * Eintreffen nichts springt. Die Deckkraft nimmt nach hinten ab, wie bei den
 * Skelettzeilen im Lager; Fläche und Schimmer kommen aus der Haus-Klasse
 * `w14-skelett` — kein Kreisel, keine eigene Keyframe-Kopie.
 */
function CatalogPlaceholder(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--w14-abstand-14)',
      }}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: statische Platzhalterliste, wird nie umsortiert
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            backgroundColor: 'var(--w14-parchment-2)',
            boxShadow: 'var(--w14-shadow-card)',
            opacity: 1 - i * 0.09,
          }}
        >
          <div
            className="w14-skelett"
            style={{
              aspectRatio: '1 / 1',
              width: '100%',
              borderBottom: '1px solid var(--w14-rule)',
            }}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w14-abstand-8)',
              padding: 'var(--w14-abstand-12) var(--w14-abstand-14) var(--w14-abstand-14)',
            }}
          >
            <SkelettBalken breite="40%" hoehe={10} />
            <SkelettBalken breite="85%" />
            <SkelettBalken breite="55%" hoehe={16} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Distinct from the empty state: the catalog request FAILED. Telling the
 * operator "leer" here would be a lie (the inventory may be full) — show the
 * real cause + a retry instead.
 */
function CatalogError({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <p
        style={{
          margin: '0 0 12px',
          color: 'var(--w14-ink-aged)',
          fontFamily: 'var(--w14-font-display)',
        }}
      >
        Katalog konnte nicht geladen werden. Verbindung prüfen.
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Lädt…' : 'Erneut laden'}
      </Button>
    </ParchmentCard>
  );
}

function EmptyState({ query }: { query: string }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
        }}
      >
        {query.length > 0
          ? `Keine Treffer für „${query}“.`
          : 'Der Katalog ist leer. Fügen Sie Artikel über die Aufnahme hinzu.'}
      </p>
    </ParchmentCard>
  );
}

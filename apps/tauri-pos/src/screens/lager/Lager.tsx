/**
 * Lager — Tier-1 surface #6 (Day 9). Inventory observability + audit-safe
 * mutation. The operator's bird's-eye view of every product in the catalog.
 *
 * State machine:
 *   • idle → load page (TanStack Query keyed on filters)
 *   • filter change → re-query (cached if seen before)
 *   • barcode scan → exact-match query → row auto-highlights + scrolls into view
 *   • row click → ProductSheet (manage mode); "+ Neues Produkt" → ProductSheet (create)
 *   • sheet success → catalog query invalidates; row updates in place
 *   • ?produkt=<id> → re-opens the ProductSheet (round-trip back from /fotos)
 *
 * Audit posture: every mutation goes through
 * `POST /api/products/:id/inventory-adjustment` (Day 9 additive). NEVER
 * touch products directly from the client — the route writes audit_log
 * + (for LOCATION_CHANGE) updates the row in one DB transaction.
 *
 * No shift gate: Lager is a read-mostly observability surface that the
 * Owner may open before / after a shift. The mutation gate is step-up,
 * not shift presence.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  type ProductListResponse,
  type ProductListRow,
  type ProductStatus,
  productsApi,
} from '@norns/api-client';
import {
  Button,
  Zwischentitel,
  Icon,
  MagnifierIcon,
  ParchmentCard,
  Plus,
} from '@norns/ui-kit';

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useInventoryCounts } from '../../hooks/useInventoryCounts.js';
import { type AvailabilityBucket, bucketCount } from '../../lib/availability-ui.js';
import { useApiClient } from '../../lib/api-context.js';
import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { type StatusFilter, useLagerFilterStore } from '../../state/lager-filter-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { DeleteProductDialog } from './DeleteProductDialog.js';
import { useBlattAnordnung } from './lager-layout.js';
import { LagerTable } from './LagerTable.js';
import { ProductSheet } from './ProductSheet.js';
import {
  TAGESPREIS_HINWEIS_LAGER,
  fasseTagespreiseZusammen,
  standSatz,
} from './tagespreis-anzeige.js';

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'AVAILABLE', label: 'Verfügbar' },
  { value: 'DRAFT', label: 'Entwurf' },
  { value: 'RESERVED', label: 'Reserviert' },
  { value: 'SOLD', label: 'Verkauft' },
];

const PAGE_SIZE = 50;

export function Lager(): JSX.Element {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const filters = useLagerFilterStore();
  // Live per-status totals for the filter chips (Verfügbar/Reserviert/Verkauft),
  // keyed to the current search so the counts match what the list shows.
  const inventoryCounts = useInventoryCounts({ q: filters.q });
  const setStatus = useLagerFilterStore((s) => s.setStatus);
  const setQ = useLagerFilterStore((s) => s.setQ);
  const setBarcode = useLagerFilterStore((s) => s.setBarcode);

  // ── Local UX state ──
  // One unified ProductSheet: productId === null ⇒ create, a id ⇒ manage.
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [sheetProductId, setSheetProductId] = useState<string | null>(null);
  // „Endgültig löschen" row action — the dialog handles deletable vs. sold.
  const [deleteTarget, setDeleteTarget] = useState<ProductListRow | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState<string>('');
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  // Breitbild (26.07.2026): auf dem breiten Gerät wird das Produktblatt rechts
  // ANGEDOCKT statt als überlagernde Schublade — Reihe anklicken, Details
  // sofort daneben, die Liste bleibt sichtbar. Schwelle + Begründung leben
  // geprüft in lager-layout.ts; unter der Schwelle ändert sich nichts.
  const blattAnordnung = useBlattAnordnung();

  // Deep-open: returning from the Foto-Werkstatt (returnTo=/lager?produkt=<id>)
  // re-opens the SAME product's sheet, then clears the param so a later close
  // doesn't reopen it.
  useEffect(() => {
    const pid = searchParams.get('produkt');
    if (!pid) return;
    setSheetProductId(pid);
    setSheetOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('produkt');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  /** Barcode we already auto-opened the dialog for — so a re-render can't reopen it. */
  const autoOpenedBarcodeRef = useRef<string | null>(null);

  // Debounce free-text q.
  const debounceTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPageOffset(0);
    }, 240);
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    };
  }, [searchInput, setQ]);

  // Reset page offset on any other filter change.
  useEffect(() => {
    setPageOffset(0);
  }, [filters.status, filters.barcode, filters.itemType]);

  // ── Catalog query ──
  const queryArgs = useMemo(() => {
    const args: Parameters<typeof productsApi.list>[1] = {
      limit: PAGE_SIZE,
      offset: pageOffset,
    };
    if (filters.status !== 'ALL') {
      args.status = filters.status as ProductStatus;
    }
    if (filters.q.length > 0) args.q = filters.q;
    if (filters.barcode !== null) args.barcode = filters.barcode;
    if (filters.itemType !== null) args.itemType = filters.itemType;
    return args;
  }, [filters, pageOffset]);

  // Offline-resilient catalog (Phase 2.5): seeds each filter/page from the durable
  // last-good snapshot so the Lager stays browsable when the LAN drops, and keeps
  // the previous page on screen while the next loads (no flash to empty).
  const q = useCachedQuery({
    queryKey: ['products', 'list', queryArgs],
    queryFn: () => productsApi.list(api, queryArgs),
    cacheKey: `products:list:${JSON.stringify(queryArgs)}`,
    // ⚠️ DREISSIG SEKUNDEN, UND DIE FLÄCHE SAGT ES SELBST.
    //
    // Diese Liste ist die Grundlage der Tagespreis-Zeile weiter unten. Sie
    // rechnet NICHT laufend nach: kein `refetchInterval`, und bei
    // Fensterwechsel wird nicht nachgeholt. Ein Dauerlauf über fünfzig Zeilen
    // samt Fotoverknüpfung je Kasse wäre teuer und wäre trotzdem nicht
    // „sofort" — er würde nur so aussehen.
    //
    // Statt eines Versprechens steht deshalb der STAND an der Zeile
    // (`standSatz(q.cachedAt)`): der Händler sieht die Uhrzeit, zu der die
    // Zahlen gelesen wurden, und weiss beim Blick darauf selbst, ob sie alt
    // sind. Beim Öffnen der Fläche holt die Abfrage nach, sobald diese
    // dreissig Sekunden vorbei sind.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const hasMore = q.data?.hasMore ?? false;

  // Der gerechnete Tagespreis über die geladene Seite. Gezählt wird NUR, was
  // der Motor wirklich mitgeschickt hat; fehlen die Felder, bleibt der Satz
  // null und die Fläche schweigt, statt Entwarnung zu geben.
  //
  // ⚠️ `total` MUSS mit: die Abfrage holt PAGE_SIZE Zeilen, die Auswahl kann
  // achthundert Stücke gross sein. Ohne diese Zahl läse sich der Satz wie
  // eine Aussage über das ganze Lager.
  const tagespreisbild = useMemo(
    () => fasseTagespreiseZusammen(rows, { gesamt: total, rest: 'geladen' }),
    [rows, total],
  );
  // Wann die gezeigten Zahlen gelesen wurden — absolute Uhrzeit, kein Alter.
  const tagespreisStand = standSatz(q.cachedAt);

  // ── Barcode scanner integration ──
  // Disable scanner while the product sheet or the delete dialog is open
  // (both want their own key handling).
  const scannerEnabled = !sheetOpen && deleteTarget === null;

  const onScan = useCallback(
    (code: string) => {
      setBarcode(code);
      setSearchInput('');
      setPageOffset(0);
      addToast({ tone: 'info', title: 'Barcode erfasst', body: code });
    },
    [addToast, setBarcode],
  );

  useBarcodeScanner({ enabled: scannerEnabled, onScan });

  // Auto-highlight + scroll first row after a scan resolves; on a genuine
  // SINGLE-product match also auto-open the adjustment dialog (P1). A no-match
  // (0 rows) or an ambiguous multi-match (>1) keeps the highlight-only behaviour.
  useEffect(() => {
    if (filters.barcode === null) {
      setHighlightedId(null);
      autoOpenedBarcodeRef.current = null;
      return;
    }
    const first = rows[0];
    if (first) {
      setHighlightedId(first.id);
      const node = tableContainerRef.current?.querySelector(`[data-product-id="${first.id}"]`);
      if (node instanceof HTMLElement) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // NO FACADE: open only when the scan resolved (not mid-fetch) to EXACTLY one
    // product, and only once per scanned barcode (a re-render must not reopen
    // after a manual close). The scanner is disabled while a dialog is open, so
    // there is no race with an in-flight edit.
    if (
      !q.isFetching &&
      rows.length === 1 &&
      first &&
      autoOpenedBarcodeRef.current !== filters.barcode
    ) {
      autoOpenedBarcodeRef.current = filters.barcode;
      setSheetProductId(first.id);
      setSheetOpen(true);
    }
  }, [filters.barcode, rows, q.isFetching]);

  return (
    <section
      aria-label="Lager"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-summe)',
            }}
          >
            Lager
          </h1>
          {/*
            ⚠️ HIER STAND „Tresor · Fach · Position", und hier steht jetzt
            NICHTS.

            Basel, 05.08.2026: „مالها داعي في اشياء وتفاصيل تحتاج تحسين" —
            das hat keinen Zweck.

            Er hatte recht. Die drei Wörter waren die FELDNAMEN des Lagerorts,
            an die Stelle einer Unterzeile gesetzt. Sie sagten niemandem
            etwas: nicht, wie viele Stücke liegen, nicht, was zu tun ist,
            nicht einmal, wo man einen Lagerort einträgt. Eine Zeile, die drei
            Feldnamen aufzählt, ist kein Untertitel, sondern ein Stück
            Bauplan, das nach aussen durchgeschlagen ist.

            Die naheliegende Rettung wäre die Stückzahl gewesen. Die steht
            aber schon rechts in derselben Zeile — sie hier zu wiederholen,
            hiesse Zierde durch Zierde zu ersetzen. Wo nichts zu sagen ist,
            steht besser nichts.
          */}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {q.isFetching ? 'lädt…' : `${total} Stück${total === 1 ? '' : 'e'}`}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSheetProductId(null);
              setSheetOpen(true);
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Icon icon={Plus} size={16} /> Neues Produkt
            </span>
          </Button>
        </div>
      </header>

      <Zwischentitel />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 'var(--space-4)',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            minHeight: 48, // ≥48px scan-to-find target (brief §1/§3)
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
          }}
        >
          <MagnifierIcon size={20} tone="ink" />
          <input
            type="text"
            value={searchInput}
            onChange={(ev) => setSearchInput(ev.target.value)}
            placeholder="SKU · Barcode · Bezeichnung. Oder Barcode-Scanner verwenden"
            spellCheck={false}
            aria-label="Lager durchsuchen"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-betont)',
              color: 'var(--w14-ink)',
            }}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Suche leeren"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                flexShrink: 0,
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--w14-radius-button)',
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-grund)',
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
          {filters.barcode !== null && (
            <button
              type="button"
              onClick={() => setBarcode(null)}
              className="w14-smallcaps"
              style={{
                background: 'transparent',
                border: '1px solid var(--w14-gold)',
                /* AA-safe brass for the text; decorative --w14-gold as a
                   text colour failed WCAG AA on parchment. Hairline border
                   stays gold (1.4.11 exempt). */
                color: 'var(--w14-accent)',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
                padding: 'var(--space-1) var(--space-2)',
                borderRadius: 'var(--w14-radius-button)',
                cursor: 'pointer',
              }}
              aria-label="Barcode-Filter entfernen"
            >
              Scan: {filters.barcode} ×
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {STATUS_CHIPS.map((chip) => (
            <StatusChip
              key={chip.value}
              label={chip.label}
              active={filters.status === chip.value}
              // Live total for the three availability buckets; undefined for
              // ALL/DRAFT and while the first count is still loading (no fake 0).
              count={
                inventoryCounts.data &&
                (chip.value === 'AVAILABLE' ||
                  chip.value === 'RESERVED' ||
                  chip.value === 'SOLD')
                  ? bucketCount(inventoryCounts.data, chip.value as AvailabilityBucket)
                  : undefined
              }
              onClick={() => setStatus(chip.value)}
            />
          ))}
          {/* Honest marker while the catalog is served from the offline seed. */}
          {q.fromCache && (
            <span style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              <StaleBadge cachedAt={q.cachedAt} stale={q.isStale} />
            </span>
          )}
        </div>
      </div>

      {/* ── Der Tagespreis über die geladene Seite ────────────────────────
          Der Motor legt bei jeder Lagerabfrage den gerechneten Tagespreis bei
          (products-list.ts:275). Vor dieser Änderung las ihn niemand, und die
          Aufschlagsfläche versprach trotzdem, alle Goldstücke stiegen mit dem
          Kurs mit. Diese Zeile sagt in Zahlen, wie viele Stücke heute neben
          ihrem gespeicherten Preis stehen, und wo der Händler ihn nachzieht.
          Sie erscheint NUR, wenn wirklich etwas abweicht.

          ⚠️ DREI DINGE STEHEN HIER ZUSAMMEN, UND KEINES DARF WEG:
            1. der Befund MIT seinem Umfang im selben Satz („Von den 50
               geladenen Stücken …"),
            2. was nicht mitgezählt ist (die weiteren der Auswahl),
            3. der Stand — die Uhrzeit, zu der gelesen wurde.
          Zwei ohne das dritte wären wieder eine Zahl, die grösser klingt,
          als sie ist. */}
      {tagespreisbild.satz !== null && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            background: 'var(--w14-parchment-1)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-aged)',
            }}
          >
            {tagespreisbild.satz}
          </span>
          {tagespreisbild.umfangSatz !== null && (
            <span
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-aged)',
              }}
            >
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
          <span
            style={{
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {TAGESPREIS_HINWEIS_LAGER}
          </span>
        </div>
      )}

      {/* Breitbild-Reihe: links die Liste, rechts (nur angedockt) das Blatt.
          Überlagernd rendert das Blatt als Portal — die Reihe stört es nicht. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 'var(--space-4)' }}>
        <div
          ref={tableContainerRef}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {q.isError ? (
            <ErrorBanner
              message="Lagerliste konnte nicht geladen werden."
              onRetry={q.refetch}
              laeuft={q.isFetching}
            />
          ) : (
            <LagerTable
              rows={rows}
              highlightedId={highlightedId}
              loading={q.isFetching}
              total={total}
              hasMore={hasMore}
              baseUrl={api.baseUrl}
              onLoadMore={() => setPageOffset((prev) => prev + PAGE_SIZE)}
              onRowClick={(row) => {
                setSheetProductId(row.id);
                setSheetOpen(true);
              }}
              onDelete={(row) => setDeleteTarget(row)}
            />
          )}
        </div>

        <ProductSheet
          open={sheetOpen}
          productId={sheetProductId}
          anordnung={blattAnordnung}
          onClose={() => {
            setSheetOpen(false);
            setSheetProductId(null);
          }}
        />
      </div>

      <DeleteProductDialog
        open={deleteTarget !== null}
        product={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(productId) => {
          // Optimistic removal: drop the row from every cached list page
          // immediately, then re-sync with the server in the background.
          // The delete is final on the server — there is nothing to roll back.
          queryClient.setQueriesData<ProductListResponse>(
            { queryKey: ['products', 'list'] },
            (old) =>
              old
                ? {
                    ...old,
                    items: old.items.filter((item) => item.id !== productId),
                    total: Math.max(0, old.total - 1),
                  }
                : old,
          );
          void queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
          setDeleteTarget(null);
        }}
        onArchived={() => {
          void queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}

function StatusChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  /** Live per-status total, or undefined while counts load / for chips without one. */
  count?: number | undefined;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w14-smallcaps"
      aria-pressed={active}
      aria-label={count !== undefined ? `${label}: ${count}` : label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        minHeight: 40, // comfortable filter target (brief §1 touch floor)
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        color: active ? 'var(--w14-ink)' : 'var(--w14-ink-aged)', // ≥4.5:1 both states
        fontFamily: 'var(--w14-font-display)',
        fontSize: 'var(--w14-schrift-zeile)',
        letterSpacing: '0.08em',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {label}
      {count !== undefined && (
        <span
          aria-hidden
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: active ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Fehler ohne Schreck: die ruhige Tafel IN der Fläche, mit dem Wiederholen-Weg
 * direkt daneben — kein Alarm-Toast obendrauf (die Listenabfrage toastet nie,
 * das bleibt den Handlungen vorbehalten).
 */
function ErrorBanner({
  message,
  onRetry,
  laeuft,
}: {
  message: string;
  onRetry: () => void;
  laeuft: boolean;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="lg"
      style={{ textAlign: 'center', border: '1px solid var(--w14-wax-red)' }}
    >
      <p
        role="alert"
        style={{
          margin: '0 0 var(--space-3)',
          color: 'var(--w14-wax-red)',
          fontFamily: 'var(--w14-font-display)',
        }}
      >
        {message}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={laeuft}>
        {laeuft ? 'Lädt…' : 'Erneut versuchen'}
      </Button>
    </ParchmentCard>
  );
}

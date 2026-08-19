/**
 * Verkauf — Tier-1 surface #2. The revenue-generating heart of the POS.
 *
 * Three states driven by `useCurrentShift`:
 *   • loading              → Splash
 *   • shift === undefined  → <ShiftReadError/> (the read gave no answer; saying
 *                            "no open shift" here blocked a sale mid-customer)
 *   • shift === null       → <ShiftGuard/>   (no sale allowed; "Zur Kasse" CTA)
 *   • shift.status==='OPEN'→ <VerkaufFloor/> (CatalogGrid + CartPanel)
 *
 * ────────────────────────────────────────────────────────────────────────
 * Atomic reservation flow (memory.md #43 + Day 15 contract)
 * ────────────────────────────────────────────────────────────────────────
 *   1. Operator clicks (or scans) a tile.
 *   2. Generate `crypto.randomUUID()` reservation sessionId.
 *   3. POST /api/inventory/reserve { productId, channel: 'POS', sessionId }
 *        → 200: row locked to us; `reservation_expires_at IS NULL` for POS
 *          (migration 0006 CHECK) so the lock is OURS until we release.
 *        → 409 PRODUCT_NOT_RESERVABLE: another channel grabbed it →
 *          wax-red toast + invalidate `['products', 'list']`.
 *   4. GET /api/products/:id — pulls `acquisitionCostEur` (needed for §25a
 *      margin math) which the list endpoint omits.
 *   5. cart-store.addLine({ …snapshot…, reservationSessionId }).
 *      • If addLine returns MIXED_TAX_TREATMENT or ALREADY_IN_CART:
 *        surface the appropriate toast AND release the reservation we
 *        just took. We never leave a zombie hold.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Rapid barcode scanning (Phase 2 Day 7 hardening)
 * ────────────────────────────────────────────────────────────────────────
 * A real cashier with a USB barcode scanner can fire 5–10 reservations
 * per second. The previous "one in-flight at a time" guard dropped every
 * scan after the first. We now track `reservingProductIds` as a Set —
 * concurrent reserves of DIFFERENT products run in parallel (the backend
 * serialises per-product internally via the single-row UPDATE). The
 * Catalog tile is disabled only when ITSELF is in flight, not when ANY
 * reserve is in flight.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Release lifecycle (per-row + clear-all + sign-out + beforeunload)
 * ────────────────────────────────────────────────────────────────────────
 * Per-row × button → POST /api/inventory/release with the cart-line's
 * sessionId. "Karte leeren" parallel-releases every line via the shared
 * `releaseCart` helper. The AppShell sign-out cascade also calls
 * `releaseCart` BEFORE clearing the store (see AppShell.tsx). On graceful
 * Tauri window close we fire ONE `navigator.sendBeacon` to the batch-release
 * route via `beaconReleaseCart` — a beacon survives page teardown (a normal
 * fetch is cancelled).
 *
 * IMPORTANT: POS reservations have no explicit server-side TTL. If the OS kills
 * the process abruptly (no beforeunload fires), the persisted cart survives on
 * next launch (operator can release/finalize against the same sessionIds), and
 * the worker job `pos_reservation_sweeper` reclaims a hold abandoned past a
 * conservative window (12h) as the durable backstop (P1.4).
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  type ProductDetail,
  type ProductListRow,
  productsApi,
} from '@norns/api-client';
import { Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { zifferFuerFlaeche } from '../../app/chrome/surface-registry.js';

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { classifyCartProductTax } from '../../lib/cart-math.js';
import { beaconReleaseCart, releaseCart } from '../../lib/release-cart.js';
import { classifyScanMatch, normalizeScan } from '../../lib/scan-resolve.js';
import { getSessionToken } from '../../lib/session-token.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import {
  type CartLine,
  selectCartLines,
  selectWebOrderNumber,
  useCartStore,
} from '../../state/cart-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { vorgangBeginnen, vorgangVerwerfen } from '../../lib/vorgangs-uhr.js';

import { ShiftGuard } from '../_shared/ShiftGuard.js';
import { ShiftReadError } from '../_shared/ShiftReadError.js';

import { CartPanel } from './CartPanel.js';
import { CatalogGrid } from './CatalogGrid.js';
import { reservierungsFehlerDeuten } from './reservierung-meldung.js';
import { describeError } from '@norns/i18n-de';

/**
 * Wieviele Kandidaten eine Scan-Suche holt.
 *
 * Zehn waren zu wenig: `q: code` sucht nach TEILTREFFERN, und bei einer
 * Nummernfamilie („R-1001", „R-10010", …) kann das exakte Stueck jenseits der
 * zehn liegen. Fuenfzig macht das deutlich unwahrscheinlicher — und der Fall,
 * dass es doch zubeisst, wird jetzt ausdruecklich gemeldet statt als „gibt es
 * nicht" ausgegeben.
 *
 * Das Servermaximum ist 200 (`schemas/product-list.ts`); mehr als noetig zu
 * holen kostet den Kassierer aber Wartezeit bei jedem Piepen.
 */
const SCAN_SEITE = 50;

export function Verkauf(): JSX.Element {
  const { data: shift, isLoading, isError, error, isFetching, refetch } = useCurrentShift();

  if (isLoading && shift === undefined) return <VerkaufSplash />;

  // `undefined` heißt: die Abfrage hat NICHT geantwortet. Das ist keine
  // geschlossene Schicht, und es darf nicht so behauptet werden: die Kassiererin
  // stand sonst mit einem Kunden davor und wurde zur Kasse geschickt, obwohl die
  // Schicht offen war. Nur `null` ist die echte Aussage „keine offene Schicht".
  if (shift === undefined) {
    return (
      <ShiftReadError
        digitLabel={zifferFuerFlaeche('/verkauf') ?? '◊'}
        detail={isError && error instanceof ApiError ? describeError(error) : null}
        busy={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }
  if (shift === null) {
    return (
      <ShiftGuard
        digitLabel={zifferFuerFlaeche('/verkauf') ?? '◊'}
        surfaceTitle="Keine offene Schicht"
        lede="Bevor ein Beleg entstehen darf, muss eine Schicht eröffnet sein. Die Schublade braucht ein Zuhause für den Kassensturz."
      />
    );
  }
  return <VerkaufFloor />;
}

// ────────────────────────────────────────────────────────────────────────
// Active floor — only mounted when a shift is open
// ────────────────────────────────────────────────────────────────────────

function VerkaufFloor(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();

  // Cart store — stable selectors so unrelated state changes don't re-render us.
  const lines = useCartStore(selectCartLines);
  const addLine = useCartStore((s) => s.addLine);
  const removeLine = useCartStore((s) => s.removeLine);
  const snapshotAndClear = useCartStore((s) => s.snapshotAndClear);
  const clearCart = useCartStore((s) => s.clearCart);
  const findLine = useCartStore((s) => s.findLine);
  // Abholung einer Web-Reservierung (0099): ist das gesetzt, ist die Karte eine
  // geladene Bestellung zur Übergabe, keine frische Kassenkarte. Die Stücke
  // gehören dem Storefront (server-seitig `reserved_by_user_id IS NULL`), darum
  // werden sie hier NICHT über die POS-Freigabe angefasst.
  const webOrderNumber = useCartStore(selectWebOrderNumber);
  const addToast = useToastStore((s) => s.addToast);
  // Fuer die Vorgangs-Uhr: die TSE oeffnet beim ERSTEN Stueck, nicht beim
  // Bezahlen (DSFinV-K Anhang I S. 113). Begruendung in lib/vorgangs-uhr.ts.
  const tseKonfiguration = useHardwareStore((s) => s.config.tse);

  // In-flight reservation tracking. Set (not single ID) so the rapid
  // barcode-scan path can fire concurrent reserves of different products.
  const [reservingProductIds, setReservingProductIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [releasingProductIds, setReleasingProductIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [clearingCart, setClearingCart] = useState<boolean>(false);
  // P2: bumped after a successful finalize closes the Bezahlen dialog →
  // CatalogGrid refocuses its search input so the next scan lands there.
  const [searchFocusToken, setSearchFocusToken] = useState<number>(0);
  // Cashier 3/3: pause the global barcode scanner while the Bezahlen dialog
  // owns Enter + the AmountPad (CartPanel notifies us via onBezahlenOpenChange).
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);
  // Bumped after every handled scan → CatalogGrid clears the leaked SKU text.
  const [searchResetToken, setSearchResetToken] = useState<number>(0);
  // Guard the scan→reserve window: a SKU mid-lookup (before onSelectProduct has
  // marked it reserving) must not be resolved twice by a rapid double-scan.
  const scanResolvingRef = useRef<Set<string>>(new Set());

  /**
   * ── Gebündeltes Auffrischen des Katalogs (19.08.2026, gemessen) ─────────
   *
   * Jede Reservierung stiess `invalidateQueries(['products','list'])` an —
   * ein voller Neuabruf der 60 Kacheln JE PIEPS. Bei den 5 bis 10 Scans je
   * Sekunde, für die dieser Bildschirm gehärtet ist, waren das bis zu zehn
   * identische Abrufe in der Sekunde, und jeder schaltete `isFetching`
   * zweimal um und rannte damit in den Kachel-Neuaufbau.
   *
   * Sichtbar verliert der Kassierer nichts: „im Korb" und „reserviert"
   * kommen aus dem Korb-Zustand (`inCart`, `reservingProductIds`), nicht aus
   * der Liste. Der Neuabruf gleicht nur den Serverstand ab — dafür genügt
   * EINER am Ende des Schubs.
   */
  const katalogAuffrischerRef = useRef<number | null>(null);
  const katalogGebuendeltAuffrischen = useCallback(() => {
    if (katalogAuffrischerRef.current !== null) return;
    katalogAuffrischerRef.current = window.setTimeout(() => {
      katalogAuffrischerRef.current = null;
      void qc.invalidateQueries({ queryKey: ['products', 'list'] });
    }, 300);
  }, [qc]);
  useEffect(
    () => () => {
      if (katalogAuffrischerRef.current !== null) window.clearTimeout(katalogAuffrischerRef.current);
    },
    [],
  );

  // Derived: which productIds are currently in the cart. Memoized so
  // CatalogGrid's `inCart` prop is referentially stable as long as
  // `lines` hasn't changed → no unnecessary re-renders of the grid.
  const inCart = useMemo(() => new Set(lines.map((l) => l.productId)), [lines]);

  // ────────────────────────────────────────────────────────────────────
  // Reserve handler — fires on tile click / barcode scan
  // ────────────────────────────────────────────────────────────────────

  const onSelectProduct = useCallback(
    async (product: ProductListRow): Promise<void> => {
      // Abholung läuft: die Karte ist eine geladene Web-Bestellung. Ein Stück
      // dazu-zu-reservieren würde eine POS-Reservierung (uns gehörend) mit den
      // web-gehaltenen Stücken mischen — der Finalize mit `webOrderNumber` würde
      // dann an genau dieser Position scheitern. Erst übergeben oder abbrechen.
      if (webOrderNumber) {
        addToast({
          tone: 'info',
          title: 'Abholung läuft',
          body: 'Erst die Bestellung übergeben oder abbrechen, dann neu verkaufen.',
        });
        return;
      }

      // Belt-and-braces — CatalogGrid also disables tiles that are in cart
      // or already reserving themselves.
      if (findLine(product.id)) return;

      // Mark THIS productId as in-flight. Other products stay clickable.
      setReservingProductIds((prev) => {
        if (prev.has(product.id)) return prev;
        const next = new Set(prev);
        next.add(product.id);
        return next;
      });

      const sessionId = crypto.randomUUID();
      try {
        await productsApi.reserve(api, {
          productId: product.id,
          channel: 'POS',
          sessionId,
        });

        let detail: ProductDetail;
        try {
          detail = await productsApi.get(api, product.id);
        } catch (err) {
          // Reservation succeeded but detail fetch failed — release the
          // hold so the row isn't stuck reserved on a network glitch.
          await safeRelease(api, product.id, sessionId);
          throw err;
        }

        const treatment = classifyCartProductTax({
          itemType: detail.itemType,
          finenessDecimal: detail.finenessDecimal,
          acquiredFromCustomerId: detail.acquiredFromCustomerId,
          isCommission: detail.isCommission,
          yearMintedFrom: detail.yearMintedFrom,
          // ⚠️ Der hinterlegte Schluessel hat Vorrang. Ohne ihn fiel jedes
          // § 25a-Stueck auf 19 Prozent vom vollen Preis. Siehe cart-math.ts.
          taxTreatmentCode: detail.taxTreatmentCode,
        });

        const newLine: CartLine = {
          productId: detail.id,
          reservationSessionId: sessionId,
          sku: detail.sku,
          name: detail.name,
          listPriceEur: detail.listPriceEur,
          acquisitionCostEur: detail.acquisitionCostEur,
          taxTreatmentCode: treatment,
          addedAt: new Date().toISOString(),
        };

        const korbWarLeer = lines.length === 0;
        const addResult = addLine(newLine);
        if (addResult === null) {
          // Erfolg — den Serverstand GEBÜNDELT abgleichen statt je Pieps.
          // Die Kachel zeigt „im Korb" sofort aus dem Korb-Zustand.
          katalogGebuendeltAuffrischen();
          // Das ERSTE Stueck eroeffnet den VORGANG an der TSE — zeitgerecht
          // (§ 146a AO), nicht erst beim Bezahlen. Web-Abholungen nicht:
          // deren Vorgang gehoert dem Storefront. Best-effort und bewusst
          // nicht erwartet — ein TSE-Schluckauf darf keinen Scan bremsen.
          if (korbWarLeer && !webOrderNumber) {
            void vorgangBeginnen(tseKonfiguration ?? null);
          }
          return;
        }

        // Cart-store rejected — release the just-made hold, then explain WHY in
        // German. A mixed tax treatment is NOT "already in cart"; V1 signs one
        // receipt under one treatment, so the operator must finish the current
        // cart before starting a piece with a different Steuerklasse.
        await safeRelease(api, product.id, sessionId);
        if (addResult.kind === 'MIXED_TAX_TREATMENT') {
          // ⚠️ 18.08.2026, Basels Foto: zwei dieser Blasen uebereinander, beide
          // stehen geblieben. Der Ton war 'alert', und ein Alarm hat mit
          // Absicht keine Uhr — zwei abgewiesene Stuecke hiessen also zwei
          // KLEBENDE Blasen. Die Abweisung ist aber die Definition von
          // 'warn' im Speicher: schiefgegangen, nichts ist kaputt, der Satz
          // will gelesen werden (8 s), nicht quittiert.
          addToast({
            tone: 'warn',
            title: 'Steuerklassen passen nicht zusammen',
            body: `Karte enthält ${TAX_TREATMENT_LABEL[addResult.existing]}; ${detail.sku} wäre ${TAX_TREATMENT_LABEL[addResult.incoming]}. Bitte zuerst abschließen.`,
          });
        } else {
          addToast({
            tone: 'info',
            title: 'Bereits in der Karte',
            // Unique inventory — one product = one physical piece (no quantity to
            // raise). Tell the operator it is already reserved + where to find it.
            body: `${detail.sku}. Einzelstück, bereits reserviert (rechts in der Karte).`,
          });
        }
      } catch (err) {
        // Die Deutung steht in `reservierung-meldung.ts`, nicht hier. Grund:
        // die vier Zweige, die hier standen, endeten in einem `else`, das
        // ALLES auffing, was kein `ApiError` ist — und `ApiOfflineQueuedError`
        // ist keiner. Der Halt lag also im Ausgangskorb, während der Schirm
        // behauptete, es sei nichts gesetzt worden. Eine Meldung, die in einem
        // 600-Zeilen-Bildschirm wohnt, sieht kein Test an; darum wohnt sie
        // jetzt in einer eigenen, geprüften Datei.
        const { hinweis, katalogAuffrischen } = reservierungsFehlerDeuten(err, product.sku);
        if (hinweis) addToast(hinweis);
        if (katalogAuffrischen) await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      } finally {
        setReservingProductIds((prev) => {
          if (!prev.has(product.id)) return prev;
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    },
    [addLine, addToast, api, findLine, katalogGebuendeltAuffrischen, qc, webOrderNumber],
  );

  /**
   * ⚠️ Diese Zeile hat einen Grund, und der Grund ist gemessen (19.08.2026).
   *
   * Hier stand `onSelect={(p) => void onSelectProduct(p)}`. Der Pfeil sieht
   * harmlos aus und ist doch bei JEDEM Rendern ein neues Objekt — womit die
   * ganze Arbeit, die `CatalogGrid` in `React.memo` steckt, wirkungslos wird.
   * Der Dateikopf dort beschreibt genau die Absicht, die diese Aufrufstelle
   * wieder zunichte machte.
   *
   * Gemessen je gescanntem Stück: vier vollständige Durchläufe über alle 60
   * Kacheln (Reservierung setzen, in den Korb legen, Suchfeld zurücksetzen,
   * Reservierung wieder entfernen). Bei den 5 bis 10 Scans je Sekunde, für die
   * dieser Bildschirm gehärtet wurde, sind das 20 bis 40 Sechzig-Kachel-Läufe
   * in der Sekunde — in einer WebView. Die Kassiererin sieht, wie „reserviert"
   * und „im Korb" den Piepstönen hinterherhinken.
   *
   * `onSelectProduct` ist ein stabiles `useCallback`. Es fehlte nur eine
   * Hülle, die das `void` trägt, ohne die Stabilität wegzuwerfen.
   */
  const beiKachelwahl = useCallback(
    (p: ProductListRow): void => {
      void onSelectProduct(p);
    },
    [onSelectProduct],
  );

  // ────────────────────────────────────────────────────────────────────
  // Barcode scan → cart (cashier 3/3)
  // ────────────────────────────────────────────────────────────────────
  // The printed label carries a Code128 of the SKU; the USB scanner emits that
  // SKU. Seit 19.08.2026 läuft der Scan zuerst als EXAKTER Treffer über die
  // eindeutigen Indizes (`code`), und nur bei einem Fehltreffer als
  // Teiltreffer-Suche (`q`). Dann classify the status, and either run the
  // SAME reserve→add path as a tile click or give precise feedback. A per-SKU
  // in-flight guard stops a rapid double-scan from firing two reserves before
  // onSelectProduct can mark it.

  const onScan = useCallback(
    async (raw: string): Promise<void> => {
      const code = normalizeScan(raw);
      if (code.length < 3) return; // ignore stray/short bursts

      // The scanner's keystrokes leaked into the catalog search — clear them so
      // the grid doesn't strand on the (soon-reserved) SKU.
      setSearchResetToken((t) => t + 1);

      let rows: ProductListRow[];
      /**
       * Hat die Obergrenze zugebissen? Dann darf ein ausbleibender Treffer
       * NICHT „gibt es nicht" heissen.
       *
       * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────
       *
       * `q: code` ist eine TEILTREFFER-Suche. Wer „R-1001" scannt, trifft
       * auch „R-10010", „R-10011" und so fort. Liegen mehr als zehn solcher
       * Stuecke im Bestand und das exakte ist nicht unter den ersten zehn,
       * fand `classifyScanMatch` nichts — und die Kasse sagte „Kein Artikel
       * mit Code … gefunden" ueber ein Stueck, das der Kassierer in der Hand
       * haelt.
       *
       * Hausklasse „Liste mit fester Obergrenze wird zur unsichtbaren Wand",
       * hier im Verkaufsweg und mit dem Kunden davor.
       */
      let mehrAlsGezeigt = false;
      try {
        // ── 19.08.2026: erst der Indexweg, dann die Teiltreffer-Suche ─────
        //
        // Gemessen: `q` läuft als vier ILIKE mit führendem Prozentzeichen
        // ZWEIMAL über den ganzen Bestand (Liste und Zählung) — je Pieps, und
        // linear wachsend mit dem Lager. `code` trifft die eindeutigen
        // Indizes von Artikelnummer und Strichcodespalte direkt.
        //
        // Der Rückfall auf `q` bleibt bewusst stehen: `classifyScanMatch`
        // vergleicht unempfindlich gegen Gross-/Kleinschreibung und Ränder.
        // Stünde in der Datenbank je ein Wert, der nur SO passt, fände ihn
        // der exakte Weg nicht — der alte Weg schon. Der Rückfall läuft nur
        // bei einem Fehlscan oder krummen Bestandsdaten, nicht je Pieps.
        //
        // Nebengewinn: der Befund vom 13.08. (exaktes Stück hinter der
        // Obergrenze versteckt) kann auf dem Indexweg gar nicht mehr
        // entstehen — ein eindeutiger Index liefert höchstens zwei Zeilen.
        const exakt = await productsApi.list(api, { code, limit: SCAN_SEITE });
        if (exakt.items.length > 0) {
          rows = exakt.items;
        } else {
          const res = await productsApi.list(api, { q: code, limit: SCAN_SEITE });
          rows = res.items;
          mehrAlsGezeigt = res.hasMore;
        }
      } catch {
        addToast({
          tone: 'alert',
          title: 'Scan-Suche fehlgeschlagen',
          body: `Artikel ${code} konnte nicht geladen werden.`,
        });
        return;
      }

      const match = classifyScanMatch(code, rows);
      switch (match.kind) {
        case 'not-found':
          // Kein exakter Treffer UND die Suche war abgeschnitten: dann ist
          // die ehrliche Auskunft „zu viele Kandidaten", nicht „gibt es
          // nicht". Der Unterschied entscheidet, ob der Kassierer weitersucht
          // oder das Stueck fuer verschwunden haelt.
          addToast(
            mehrAlsGezeigt
              ? {
                  tone: 'alert',
                  title: 'Code nicht eindeutig',
                  body:
                    `Zu ${code} gibt es mehr Stücke, als diese Suche zeigt, und keines ` +
                    'davon trägt genau diesen Code. Bitte im Lager nach dem Stück suchen.',
                }
              : {
                  tone: 'alert',
                  title: 'Kein Treffer',
                  body: `Kein Artikel mit Code ${code} gefunden.`,
                },
          );
          return;
        case 'sold':
          addToast({
            tone: 'alert',
            title: 'Bereits verkauft',
            body: `${match.product.sku} ist bereits verkauft. Nicht mehr im Bestand.`,
          });
          return;
        case 'reserved':
          addToast({
            tone: 'alert',
            title: 'Bereits reserviert',
            body: `${match.product.sku} ist anderswo reserviert (Storefront/eBay).`,
          });
          return;
        case 'draft':
          addToast({
            tone: 'info',
            title: 'Noch nicht verkaufsbereit',
            body: `${match.product.sku} ist ein Entwurf. Erst in Lager veröffentlichen.`,
          });
          return;
        case 'found':
          break;
      }

      const product = match.product;
      // Double-add / race guard: already in the cart, or a reserve for this SKU
      // is already in flight from a prior scan.
      if (findLine(product.id) || scanResolvingRef.current.has(product.id)) {
        addToast({
          tone: 'info',
          title: 'Schon in der Karte',
          body: `${product.sku}. Einzelstück, bereits im Korb.`,
        });
        return;
      }
      scanResolvingRef.current.add(product.id);
      try {
        await onSelectProduct(product);
      } finally {
        scanResolvingRef.current.delete(product.id);
      }
    },
    [addToast, api, findLine, onSelectProduct],
  );

  // Listen globally while a shift is open; pause during payment so the dialog
  // keeps Enter + the AmountPad for itself.
  useBarcodeScanner({ enabled: !bezahlenOpen, onScan: (c) => void onScan(c) });

  // ────────────────────────────────────────────────────────────────────
  // Release handlers
  // ────────────────────────────────────────────────────────────────────

  // Undo affordance (design-brief §1 "undo over confirm"): re-acquire a line the
  // operator just removed. The remove already released the server reservation,
  // so undo re-runs the SAME reserve→add path as a tile click — a fresh
  // sessionId, no special-cased re-attach logic. Reuses `onSelectProduct` by
  // reconstructing the minimal ProductListRow it needs from the cart snapshot.
  const onUndoRemove = useCallback(
    (line: CartLine): void => {
      if (findLine(line.productId)) return; // already back (double-tap guard)
      void onSelectProduct({
        id: line.productId,
        sku: line.sku,
        name: line.name,
        listPriceEur: line.listPriceEur,
      } as ProductListRow);
    },
    [findLine, onSelectProduct],
  );

  const onRemoveLine = useCallback(
    async (productId: string): Promise<void> => {
      const target = findLine(productId);
      if (!target) return;

      // Web-Abholung: die Stücke gehören dem Storefront (`reserved_by_user_id`
      // ist NULL) und die POS-Freigabe würde mit 409 abprallen, der Server
      // übergibt ohnehin nur die GANZE Bestellung. Einzelpositionen lassen sich
      // im Abhol-Modus nicht herausnehmen (das Papierkorb-Icon ist dort
      // ausgeblendet); verworfen wird nur als Ganzes über „Übergabe abbrechen".
      // Defensive Absicherung, falls doch jemand hier landet.
      if (webOrderNumber) return;

      setReleasingProductIds((prev) => {
        if (prev.has(productId)) return prev;
        const next = new Set(prev);
        next.add(productId);
        return next;
      });

      // Optimistic store removal — the row vanishes from the UI immediately.
      removeLine(productId);

      try {
        await productsApi.release(api, {
          productId,
          sessionId: target.reservationSessionId,
          reason: 'pos_cart_cleared',
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
          // Operator cancelled the PIN — the reservation is untouched on the
          // server, so the line must come BACK or it leaks (POS holds have no
          // TTL). Roll the optimistic removal back silently.
          addLine(target);
        } else {
          // Release failed AND the line is gone from the cart, but the server
          // reservation lingers (no TTL ⇒ a zombie hold that blocks re-sale).
          // Roll the optimistic removal back so the operator can retry the
          // release; surface the reason.
          addLine(target);
          addToast({
            tone: 'alert',
            title: 'Freigabe fehlgeschlagen',
            body: `Server-Freigabe für ${target.sku} fehlgeschlagen. Position wiederhergestellt. Bitte erneut entfernen.`,
          });
        }
      } finally {
        setReleasingProductIds((prev) => {
          if (!prev.has(productId)) return prev;
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
        katalogGebuendeltAuffrischen();
      }
    },
    [addToast, addLine, api, findLine, katalogGebuendeltAuffrischen, qc, removeLine, webOrderNumber],
  );

  const onClearCart = useCallback(async (): Promise<void> => {
    if (lines.length === 0 || clearingCart) return;
    // Web-Abholung abbrechen: NUR lokal leeren. Die Reservierung gehört dem
    // Storefront und hat ihre eigene Frist — ein abgebrochener Übergabe-Versuch
    // darf sie nicht freigeben. Die POS-Freigabe würde hier ohnehin mit 409
    // abprallen (fremder Eigentümer), also gar nicht erst versuchen.
    if (webOrderNumber) {
      clearCart();
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      return;
    }
    setClearingCart(true);
    // snapshotAndClear is ONE atomic Zustand mutation — the operator can't
    // race a new addLine into the gap between snapshot and release fire.
    const snapshot = snapshotAndClear();
    // Der verworfene Korb hinterlaesst seine Spur: AVBelegabbruch an der TSE
    // (siehe vorgangs-uhr.ts). Best-effort, blockiert das Leeren nicht.
    void vorgangVerwerfen(tseKonfiguration ?? null);
    try {
      await releaseCart({ api, lines: snapshot, reason: 'pos_cart_cleared' });
    } finally {
      setClearingCart(false);
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    }
  }, [api, clearingCart, lines.length, qc, snapshotAndClear, webOrderNumber, clearCart, tseKonfiguration]);

  // ────────────────────────────────────────────────────────────────────
  // Graceful window-close release (P1.4)
  // ────────────────────────────────────────────────────────────────────
  // POS reservations are TTL-less server-side, so a closed Tauri window would
  // leak the holds. We fire ONE `navigator.sendBeacon` to the batch-release
  // route — the browser flushes a beacon even as the page unloads (a normal
  // fetch is CANCELLED on teardown, which is what the old per-line loop did
  // despite its keepalive claim). The beacon can't set an Authorization header,
  // so the session token rides in the body; the auth plugin honours it for that
  // route only. `fetch(..., { keepalive: true })` is the fallback.
  //
  // If the OS kills the process (SIGKILL / power loss) the beacon never fires —
  // the server-side `pos_reservation_sweeper` reclaims the abandoned hold, and
  // the persisted cart lets the operator resume + finalize OR release on relaunch.

  useEffect(() => {
    const onBeforeUnload = (): void => {
      const state = useCartStore.getState();
      // Web-Abholung: nichts freigeben. Der Hold gehört dem Storefront (fremder
      // Eigentümer) und hat eine eigene Frist — ein Fensterschluss mitten in
      // einer Übergabe darf die Kundschaft-Reservierung nicht wegräumen.
      if (state.webOrderNumber) return;
      const snapshot = state.lines;
      if (snapshot.length === 0) return;
      beaconReleaseCart({
        baseUrl: api.baseUrl,
        lines: snapshot,
        reason: 'pos_cart_cleared',
        sessionToken: getSessionToken(),
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [api]);

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'grid',
        // Breitbild (26.07.2026): der Korb war `minmax(360px, 1fr)` und wuchs
        // bei 1920 auf ~740 Punkte, die seine schmalen Zeilen nicht brauchen.
        // Gedeckelt auf 460 fließt jede gewonnene Handbreit in den Katalog —
        // dessen auto-fill-Raster macht daraus sofort weitere Kachelspalten
        // (mehr sichtbare Ware, weniger Scrollen). Bei 1280 ändert sich fast
        // nichts: dort bekam der Korb ohnehin ~490 Punkte.
        gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 460px)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <CatalogGrid
        reservingProductIds={reservingProductIds}
        inCart={inCart}
        onSelect={beiKachelwahl}
        focusToken={searchFocusToken}
        searchResetToken={searchResetToken}
      />
      <CartPanel
        lines={lines}
        webOrderNumber={webOrderNumber}
        onRemoveLine={(id) => void onRemoveLine(id)}
        onUndoRemove={onUndoRemove}
        releasingProductIds={releasingProductIds}
        onClearCart={() => void onClearCart()}
        clearingCart={clearingCart}
        onBezahlenOpenChange={setBezahlenOpen}
        onAfterFinalize={() => {
          // Fires only on a genuine finalize-success → dialog close. Refocus the
          // catalog search so the next scan starts the next sale immediately.
          setSearchFocusToken((t) => t + 1);
          addToast({ tone: 'info', title: 'Neue Karte bereit', body: 'weiter mit Scan' });
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function safeRelease(
  api: ReturnType<typeof useApiClient>,
  productId: string,
  sessionId: string,
): Promise<void> {
  try {
    await productsApi.release(api, {
      productId,
      sessionId,
      reason: 'pos_cart_cleared',
    });
  } catch {
    // Swallow — the caller already toasted the operator about the
    // higher-level failure; this release is just defensive cleanup.
  }
}

function VerkaufSplash(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-7)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Verkauf wird vorbereitet…
        </h2>
        <Zwischentitel />
        <p
          style={{
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          Schicht und Katalog werden geladen.
        </p>
      </ParchmentCard>
    </div>
  );
}

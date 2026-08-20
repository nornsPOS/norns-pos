/**
 * CartPanel — right column of Verkauf.
 *
 * Renders the live cart (Zustand `useCartStore`) as a stack of Roman-numbered
 * rows + a sticky footer with subtotal/VAT/total + the Bezahlen button.
 *
 * Math: every line is passed through `computeLineMath` (bigint-cents, HALF_EVEN)
 * with its `taxTreatmentCode`. The header sum is `sumHeader` over the LineMath
 * results — never a JS-number addition. The result lands wire-ready in
 * EUR-decimal strings that the BezahlenDialog forwards to the server.
 *
 * Remove action: returns the line from the store, and the parent (Verkauf.tsx)
 * fires `POST /api/inventory/release` with the cart-line's reservationSessionId.
 * The store removal is optimistic — if the release fails the line stays gone
 * (the reservation will expire on its own via worker sweeper) but a wax-red
 * toast surfaces the network issue.
 *
 * Undo-over-confirm (design-brief §1): removing a line is INSTANT — no modal,
 * no "Sind Sie sicher?". Instead a calm ~8 s `Position entfernt — Rückgängig`
 * snackbar slides in at the foot of the cart column; tapping Rückgängig re-runs
 * the parent's reserve→add path (`onUndoRemove`) to put the piece back. Modal +
 * PIN confirmation is reserved for the fiscally-irreversible acts (finalize,
 * full Storno, Kassenabschluss) — never for a removable cart line.
 *
 * State preservation: lines + totals live in Zustand; switching to Werkstatt
 * and back rehydrates the panel without re-fetching. The cart only clears on
 * (a) finalize-success, (b) explicit "Karte leeren", or (c) sign-out cascade.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  Zwischentitel,
  Icon,
  IconButton,
  MoneyAmount,
  ParchmentCard,
  Percent,
  RomanIndex,
  Tag,
  Trash2,
  X,
} from '@norns/ui-kit';

import {
  type LineMath,
  computeLineMath,
  distributeInvoiceDiscount,
  fromCents,
  harmonisiereUstJeSatz,
  percentToEur,
  sumHeader,
  centsAusEingabe,
  toCents,
} from '../../lib/cart-math.js';
import { formatEur, isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  MIN_DISCOUNT_REASON_LEN,
  discountReasonShortfall,
  isDiscountReasonValid,
} from '../../lib/discount-reason.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { useKurspreise } from '../../hooks/useKurspreise.js';
import { KursHinweis } from './KursHinweis.js';
import { geltenderPreis } from '../../lib/korbpreis.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { Geldschimmer } from '../_shared/SanfteMomente.js';

import { BezahlenDialog } from './BezahlenDialog.js';

export interface CartPanelProps {
  lines: readonly CartLine[];
  /**
   * Abholung einer Web-Reservierung (0099): die Bestellnummer, wenn diese Karte
   * eine geladene Online-Bestellung zur Übergabe ist (sonst null). Im Abhol-
   * Modus zeigt der Kopf einen ruhigen Hinweis, das Papierkorb-Icon je Position
   * entfällt (der Server übergibt die ganze Bestellung, nicht einzelne Stücke),
   * und „Karte leeren" heißt „Übergabe abbrechen".
   */
  webOrderNumber?: string | null;
  /** Triggered by per-row × button. Parent handles release. */
  onRemoveLine: (productId: string) => void;
  /**
   * Undo affordance for a just-removed line — re-runs the parent's
   * reserve→add path (same code as a tile click) with the removed line's
   * snapshot. Drives the `Rückgängig` action on the undo snackbar.
   */
  onUndoRemove?: (line: CartLine) => void;
  /** Set of productIds currently being released (disable row click). */
  releasingProductIds: ReadonlySet<string>;
  /** Wipe-all action — invokes inventory release for every line in parallel. */
  onClearCart: () => void;
  /** True if a clear-cart batch is in progress. */
  clearingCart: boolean;
  /** Fired after a sale finalizes + the dialog closes (parent refocuses search). */
  onAfterFinalize?: () => void;
  /**
   * Notifies the parent when the Bezahlen dialog opens/closes so it can pause
   * the global barcode scanner — the payment step owns Enter + the AmountPad,
   * and a stray scan must not reserve another item mid-checkout.
   */
  onBezahlenOpenChange?: (open: boolean) => void;
}

/** How long the "Position entfernt — Rückgängig" snackbar lingers (brief: 6–10 s). */
const UNDO_WINDOW_MS = 8_000;

export function CartPanel({
  lines,
  webOrderNumber = null,
  onRemoveLine,
  onUndoRemove,
  releasingProductIds,
  onClearCart,
  clearingCart,
  onAfterFinalize,
  onBezahlenOpenChange,
}: CartPanelProps): JSX.Element {
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);
  const isPickup = webOrderNumber != null;

  // Undo snackbar state — the single most-recently-removed line. A new removal
  // supersedes any pending snackbar (the operator only ever cares about the
  // last action; queuing would clutter the calm POS surface).
  const [undoLine, setUndoLine] = useState<CartLine | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const clearUndoTimer = useCallback((): void => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  // Instant remove + arm the undo snackbar. The actual reservation release still
  // runs in the parent via onRemoveLine — this only layers the undo affordance
  // on top; no reservation/finalize logic changes.
  const handleRemove = useCallback(
    (line: CartLine): void => {
      onRemoveLine(line.productId);
      clearUndoTimer();
      setUndoLine(line);
      undoTimerRef.current = window.setTimeout(() => {
        setUndoLine(null);
        undoTimerRef.current = null;
      }, UNDO_WINDOW_MS);
    },
    [onRemoveLine, clearUndoTimer],
  );

  const handleUndo = useCallback((): void => {
    clearUndoTimer();
    const line = undoLine;
    setUndoLine(null);
    if (line) onUndoRemove?.(line);
  }, [undoLine, onUndoRemove, clearUndoTimer]);

  const dismissUndo = useCallback((): void => {
    clearUndoTimer();
    setUndoLine(null);
  }, [clearUndoTimer]);

  // Cleanup on unmount (surface switch / sign-out) so a stray timer can't fire.
  useEffect(() => clearUndoTimer, [clearUndoTimer]);

  // Mirror the dialog's open state up to Verkauf (scanner gate). Effect, not an
  // inline setter call, so it stays correct regardless of how it's toggled.
  useEffect(() => {
    onBezahlenOpenChange?.(bezahlenOpen);
  }, [bezahlenOpen, onBezahlenOpenChange]);

  /*
   * ── DER TAGESPREIS GILT (20.08.2026) ──────────────────────────────────
   *
   * Basels Befund, und er traf einen echten Defekt: die Kasse KANNTE den
   * Tagespreis (der Motor holt alle fünf Minuten Kurse) und buchte trotzdem
   * den gespeicherten. Der Händler sollte ihn von Hand ins Lager übertragen,
   * jeden Morgen, für jedes Stück.
   *
   * Der Motor liefert ihn jetzt laufend; `geltenderPreis` entscheidet an
   * EINER Stelle, welcher gilt. Die Ersetzung steht bewusst HIER, vor der
   * Rechnung: alles darunter — Zeilenbetrag, Summe, Steueraufteilung,
   * Bezahlen-Dialog, Beleg — arbeitet dann mit derselben Zahl, ohne dass
   * eine einzige weitere Stelle davon wissen muss.
   */
  const kurspreisstand = useKurspreise(useMemo(() => lines.map((l) => l.productId), [lines]));

  /** Die Zeilen mit dem Preis, der WIRKLICH gilt. */
  const geltendeZeilen: readonly CartLine[] = useMemo(
    () =>
      lines.map((line) => {
        const p = geltenderPreis(line.listPriceEur, kurspreisstand.auskuenfte.get(line.productId));
        return p.preisEur === line.listPriceEur ? line : { ...line, listPriceEur: p.preisEur };
      }),
    [lines, kurspreisstand.auskuenfte],
  );

  /** Wie viele Zeilen ihren Preis aus dem laufenden Kurs beziehen. */
  const zeilenAusKurs = useMemo(
    () =>
      lines.filter(
        (l) =>
          geltenderPreis(l.listPriceEur, kurspreisstand.auskuenfte.get(l.productId)).herkunft ===
          'tagespreis',
      ).length,
    [lines, kurspreisstand.auskuenfte],
  );

  // Per-line math (kept stable across renders so we don't re-allocate cents).
  const perLine: ReadonlyArray<{ line: CartLine; math: LineMath }> = useMemo(
    () =>
      geltendeZeilen.map((line) => ({
        line,
        math: computeLineMath({
          taxTreatmentCode: line.taxTreatmentCode,
          listPriceEur: line.listPriceEur,
          acquisitionCostEur: line.acquisitionCostEur,
          discountEur: line.discountEur,
        }),
      })),
    [geltendeZeilen],
  );

  // ── Dieselbe Naht wie im Bezahlvorgang (28.07.2026) ────────────────────
  // Sitzung A harmonisiert die USt je Beleg und Satz (§ 14 Abs. 4 Nr. 8:
  // EIN Steuerbetrag je Rechnung und Satz, nicht die Summe je Zeile
  // gerundeter Betraege). Der BezahlenDialog summiert deshalb die
  // harmonisierten Zeilen — dieser Kopf hier summierte noch die rohen.
  // Bei fuenf Margen a 20,00 hiess das: die leise Netto·USt-Zeile der Karte
  // zeigte 15,95, der Dialog daneben 15,97. Zwei Wahrheiten, ein Cent
  // auseinander. Der Bruttobetrag ist von der Harmonisierung per Bauart
  // unberuehrt — nur die Naht zwischen Netto und Steuer wandert.
  const header = useMemo(
    () => sumHeader(harmonisiereUstJeSatz(perLine.map((p) => p.math))),
    [perLine],
  );
  const totalCents = useMemo(
    () => perLine.reduce((acc, p) => acc + p.math.lineTotalCents, 0n),
    [perLine],
  );
  const canPay = lines.length > 0 && !clearingCart && totalCents > 0n;

  return (
    <section
      aria-label="Warenkorb"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        borderLeft: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      {/* Header — title + permanent running-total / item-count anchor.
          The anchor sits at a FROZEN position (top of the column, never behind a
          tap, never scrolls away) so the cashier reads the live total with eyes
          on the customer. Tabular, high-contrast `--w14-ink`. Mirrored by the
          footer Gesamt row so the total is legible top OR bottom of the column. */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-kopf)',
              lineHeight: 1.1,
            }}
          >
            Karte
          </h2>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.08em',
            }}
          >
            {lines.length === 0
              ? 'leer'
              : `${lines.length} Position${lines.length === 1 ? '' : 'en'}`}
          </span>
        </div>
        {lines.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 0,
              flexShrink: 0,
            }}
          >
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: '0.1em',
              }}
            >
              Gesamt
            </span>
            {/* Der Kopfanker ist die STILLE Referenz: er steht an einer
                eingefrorenen Stelle, damit die Summe auch mit langer Karte
                lesbar bleibt. Der Held steht unten neben „Bezahlen". Zwei
                gleich laute Summen wären zwei Wahrheiten ohne Rangordnung —
                darum bleibt dieser hier auf der Zeilenstufe. */}
            <Geldschimmer wert={header.totalEur}>
              <MoneyAmount
                valueEur={header.totalEur}
                emphasis
                style={{ lineHeight: 1.05, color: 'var(--w14-ink)' }}
              />
            </Geldschimmer>
          </div>
        )}
      </header>

      {/* Abhol-Hinweis — nur wenn die Karte eine geladene Web-Bestellung ist.
          Gold als KANTE (Siegelband links), kein Gold-Fill. Er sagt ruhig, was
          hier passiert: eine Übergabe, die das Bezahlen abschließt. */}
      {isPickup && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w14-abstand-2)',
            padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
            // Gold als KANTE (Siegelband links), kein Gold-Fill: der Rahmen ist
            // die ruhige Regel-Linie, nur die linke Kante trägt das Gilt.
            border: '1px solid var(--w14-rule)',
            borderLeftWidth: 3,
            borderLeftColor: 'var(--w14-gilt)',
            borderRadius: 'var(--w14-radius-card)',
            background: 'var(--w14-parchment-2)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.1em',
              color: 'var(--w14-ink-aged)',
            }}
          >
            Abholung
          </span>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-betont)',
              color: 'var(--w14-ink)',
            }}
          >
            {webOrderNumber}
          </span>
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            Übergabe an der Kasse. Bezahlen schließt die Bestellung ab.
          </span>
        </div>
      )}

      {/* Der Zeilen-Eintritt wohnt EINMAL hier am Panel, nicht je Zeile —
          genau so sind anderswo sechs Kopien desselben Keyframes entstanden. */}
      <style>{`
        @keyframes w14-zeile-eintritt {
          from { opacity: 0.35; transform: translateY(6px); }
        }
      `}</style>

      {/* Line list.
          minHeight 96 statt 0 (27.07.2026): Kopf und Fuss sind starr, diese
          Liste ist das EINZIGE nachgiebige Glied der Spalte. Bei knapper
          Fensterhöhe drückte der Fuss sie auf exakt 0 Punkte — die Ware lag
          im DOM, war „sichtbar", und stand doch nirgends im Bild; die
          Fusskarte malte darüber. Live gemessen, nicht vermutet. 96 Punkte
          garantieren mindestens eine volle Zeile plus den Anriss der
          nächsten (der Anriss zeigt: hier lässt sich rollen). */}
      <div
        style={{
          flex: 1,
          minHeight: 96,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        {perLine.length === 0 ? (
          <EmptyCart />
        ) : (
          perLine.map(({ line, math }, idx) => (
            <CartRow
              key={line.productId}
              index={idx + 1}
              line={line}
              math={math}
              locked={isPickup}
              releasing={releasingProductIds.has(line.productId)}
              onRemove={() => handleRemove(line)}
            />
          ))
        )}
      </div>

      {/* Undo snackbar — non-modal, slides in just above the footer. The remove
          already happened (instant); this is the 6–10 s window to take it back. */}
      {undoLine && <UndoSnackbar line={undoLine} onUndo={handleUndo} onDismiss={dismissUndo} />}

      {/* Footer — totals breakdown + the single edge-anchored primary action.
          flexShrink:0 + the fixed header keep Bezahlen at FROZEN coordinates
          regardless of cart size. */}
      <ParchmentCard padding="md" style={{ flexShrink: 0 }}>
        {/* ── DER KURS, DER GERADE GILT (20.08.2026) ──────────────────────
            Nur sichtbar, wenn wirklich Zeilen aus dem Kurs gerechnet werden.
            Sie sagt zwei Dinge, die der Tresen braucht: dass diese Preise vom
            laufenden Kurs kommen (nicht von vorgestern), und wie lange sie
            noch gelten. Eine Kasse, die den Goldpreis benutzt, ohne es zu
            sagen, verlangt vom Kassierer Vertrauen statt Auskunft. */}
        {zeilenAusKurs > 0 && <KursHinweis anzahl={zeilenAusKurs} geholtAm={kurspreisstand.kurseGeholtAm} />}

        {/* Die Zierlinie bleibt, ihr Wort ging: „Summe" und darunter „Gesamt"
            benannten dasselbe zweimal. Die Linie trennt, die Zahl spricht. */}
        <Zwischentitel />
        {/* Die Aufschlüsselung ist Nachweis, nicht Botschaft — EINE leise
            Zeile statt einer Tabelle. Das ist kein Stilzug allein: jeder
            Punkt, den der Fuss niedriger ist, gehört der Warenliste (siehe
            minHeight-Vermerk oben). Netto und USt in voller Tiefe stehen in
            der Belegvorschau und auf dem Papier. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 'var(--space-3)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontVariant: 'all-small-caps',
              letterSpacing: '0.08em',
              color: 'var(--w14-ink-faded)',
              fontSize: 'var(--w14-beschriftung)',
            }}
          >
            Netto · USt
          </span>
          <span
            className="w14-tabular"
            style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-beschriftung)' }}
          >
            <MoneyAmount valueEur={header.subtotalEur} />
            {' · '}
            <MoneyAmount valueEur={header.vatEur} />
          </span>
        </div>

        {/* ── Der Gesamtbetrag (27.07.2026) ──────────────────────────────
            Vorher war er die vierte Zeile derselben Tabelle: Beschriftung
            1,05rem, Zahl 1,15rem — also 18 Punkte für die wichtigste Zahl
            im Laden, kaum grösser als die USt-Zeile darüber. GENAU DAS
            liess die Fläche wie ein Bedienfeld aussehen: nichts sah
            wichtiger aus als alles andere.
            Jetzt ein eigener Block direkt über „Bezahlen", auf der
            Grundlinie ausgerichtet, mit der Spaltenstufe (32 → 44 px).
            Die Beschriftung bleibt klein und zurückgenommen — sie muss nur
            benennen, was die Zahl ohnehin sagt. */}
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--w14-rule)',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-beschriftung)',
              letterSpacing: '0.12em',
              color: 'var(--w14-ink-aged)',
              flexShrink: 0,
            }}
          >
            Gesamt
          </span>
          <Geldschimmer wert={header.totalEur}>
            <MoneyAmount
              valueEur={header.totalEur}
              emphasis
              style={{
                fontSize: 'var(--w14-betrag-spalte)',
                lineHeight: 1,
                color: 'var(--w14-ink)',
              }}
            />
          </Geldschimmer>
        </div>

        {/* Kein Rechnungsrabatt bei einer Abholung — der reservierte Preis gilt. */}
        {!isPickup && <InvoiceDiscount lines={lines} />}

        {/* ONE obvious primary action. Bezahlen owns the full-width, ~80px,
            bottom-anchored slot (Fitts: edge-anchored, the read-from-80cm tile).
            "Karte leeren" is demoted to a quiet underlined link below so it never
            competes for the eye and isn't in the resting thumb's path. */}
        <div
          style={{
            marginTop: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => setBezahlenOpen(true)}
            disabled={!canPay}
            style={{ minHeight: 80, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600 }}
          >
            Bezahlen
          </Button>
          <button
            type="button"
            onClick={onClearCart}
            disabled={lines.length === 0 || clearingCart}
            style={{
              alignSelf: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-schrift-feld)',
              padding: 'var(--w14-abstand-6) var(--w14-abstand-10)',
              minHeight: 32,
              cursor: lines.length === 0 || clearingCart ? 'default' : 'pointer',
              opacity: lines.length === 0 || clearingCart ? 0.5 : 1,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {/* Im Abhol-Modus verwirft der Knopf die Übergabe (lokal), er leert
                keine frische Kassenkarte — darum ein eigener, ehrlicher Text. */}
            {isPickup
              ? clearingCart
                ? 'Bricht ab…'
                : 'Übergabe abbrechen'
              : clearingCart
                ? 'Räumt…'
                : 'Karte leeren'}
          </button>
        </div>
      </ParchmentCard>

      <BezahlenDialog
        open={bezahlenOpen}
        onClose={() => setBezahlenOpen(false)}
        lines={lines}
        perLineMath={perLine.map((p) => p.math)}
        totals={header}
        onFinalizeSuccess={onAfterFinalize}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Undo snackbar
// ────────────────────────────────────────────────────────────────────────

/**
 * UndoSnackbar — the non-modal "Position entfernt — Rückgängig" affordance.
 * Renders inside the cart column (not a global toast) so the undo lives exactly
 * where the removed line was. Sober ease-out slide-in (POS motion budget,
 * `--w14-dur-medium`/`--w14-ease-curator`, GPU-only transform/opacity), a
 * `--w14-wax-red` accent rule (remove is a danger-class act), and a clearly
 * tappable Rückgängig button ≥48px tall. Honors prefers-reduced-motion via the
 * shared motion tokens.
 */
function UndoSnackbar({
  line,
  onUndo,
  onDismiss,
}: {
  line: CartLine;
  onUndo: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const [entered, setEntered] = useState<boolean>(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    // <output> is the semantic live region (implicit role="status", polite).
    <output
      aria-live="polite"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--w14-abstand-10) var(--w14-abstand-12) var(--w14-abstand-10) var(--w14-abstand-16)',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderLeft: '4px solid var(--w14-wax-red)',
        borderRadius: 'var(--w14-radius-card)',
        boxShadow: 'var(--w14-shadow-modal)',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
        transition:
          'opacity var(--w14-dur-medium) var(--w14-ease-curator),' +
          ' transform var(--w14-dur-medium) var(--w14-ease-curator)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        >
          Position entfernt
        </span>
        <span
          style={{
            fontSize: 'var(--w14-schrift-feld)',
            color: 'var(--w14-ink-faded)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={line.name}
        >
          {line.name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        <Button
          variant="ghost"
          size="md"
          onClick={onUndo}
          style={{ minHeight: 48, color: 'var(--w14-gold)' }}
        >
          Rückgängig
        </Button>
        <IconButton
          icon={X}
          label="Hinweis schließen"
          tone="muted"
          iconSize={16}
          onClick={onDismiss}
        />
      </div>
    </output>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row
// ────────────────────────────────────────────────────────────────────────

function CartRow({
  index,
  line,
  math,
  locked = false,
  releasing,
  onRemove,
}: {
  index: number;
  line: CartLine;
  math: LineMath;
  /** Abhol-Modus: keine Einzelentnahme (die ganze Bestellung wird übergeben). */
  locked?: boolean;
  releasing: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--space-3)',
        alignItems: 'start',
        opacity: releasing ? 0.55 : 1,
        transition: 'opacity var(--w14-dur-short) var(--w14-ease-curator)',
        // Die neue Zeile tritt ein (kleine Hebung + Aufblenden) statt zu
        // ploppen. Der Keyframe definiert nur den Start; der Endzustand ist
        // der natürliche Stil — reduced motion nullt die Dauer, die Zeile
        // steht dann sofort. Beim Rehydrieren (Flächenwechsel) legt sich die
        // Liste einmal ruhig hin, das ist gewollt und kein Gestaffel.
        animation: 'w14-zeile-eintritt var(--w14-dur-fast) var(--w14-ease-curator)',
      }}
    >
      <RomanIndex value={index} tone="gold" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-aged)',
          }}
        >
          {line.sku}
        </span>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-grund)',
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={line.name}
        >
          {line.name}
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-2)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.08em',
            }}
          >
            {TAX_TREATMENT_LABEL[line.taxTreatmentCode]}
          </span>
          {line.taxTreatmentCode === 'MARGIN_25A' && math.marginCents !== null && (
            <span
              style={{
                color: 'var(--w14-ink-aged)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-zeile)',
              }}
            >
              {/* 14.08.2026: `fromCents` ist Leitungsformat mit PUNKT
                  („199.00"). Als einzige Geldstelle der Karte stand sie
                  unformatiert im Bild; alle Nachbarn sprechen deutsches
                  Komma. `formatEur` ist die EINE Anzeigeform des Hauses. */}
              Marge {formatEur(fromCents(math.marginCents))} €
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          alignItems: 'flex-end',
        }}
      >
        {math.lineDiscountCents > 0n ? (
          <>
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-aged)',
                textDecoration: 'line-through',
              }}
            >
              {line.listPriceEur} €
            </span>
            <MoneyAmount valueEur={fromCents(math.lineTotalCents)} emphasis />
            <span
              style={{
                color: 'var(--w14-wax-red)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-zeile)',
              }}
            >
              Rabatt −{fromCents(math.lineDiscountCents)} €
            </span>
          </>
        ) : (
          <MoneyAmount valueEur={line.listPriceEur} emphasis />
        )}
        {/* Abhol-Modus: die Zeile ist reine Anzeige. Keine Einzelentnahme (der
            Server übergibt die ganze Bestellung) und kein Positions-Rabatt — die
            Kundschaft zahlt den reservierten Preis. Verworfen wird die Übergabe
            nur als Ganzes über „Übergabe abbrechen". */}
        {!locked && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <DiscountEditor line={line} disabled={releasing} />
            {/* UX icons: universal delete action → icon-only IconButton (aria-label). */}
            <IconButton
              icon={Trash2}
              label={releasing ? 'Wird freigegeben…' : `Position ${index} entfernen`}
              tone="danger"
              iconSize={18}
              onClick={onRemove}
              disabled={releasing}
            />
          </div>
        )}
      </div>
    </ParchmentCard>
  );
}

/**
 * DiscountEditor — a per-line Rabatt control. Collapsed it's a "Rabatt"/"Rabatt
 * ändern" link; expanded it offers a EUR-off amount + a mandatory reason. The
 * amount is clamped to the list price by the cart math; an empty/zero amount
 * clears the discount. Reason is required (the backend + DB enforce it).
 */
const PCT_PRESETS = [5, 10, 15, 20] as const;
const REASON_PRESETS = [
  'Mitarbeiterrabatt',
  'Mängelnachlass',
  'Stammkunde',
  'Verhandlung',
] as const;

const CHIP_STYLE: CSSProperties = {
  minHeight: 36,
  padding: 'var(--w14-abstand-6) var(--w14-abstand-12)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-pille)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-schrift-feld)',
  cursor: 'pointer',
};
const CHIP_ACTIVE: CSSProperties = {
  background: 'var(--w14-accent)',
  color: 'var(--w14-accent-ink)',
  borderColor: 'var(--w14-accent)',
};

const DISCOUNT_INPUT: CSSProperties = {
  padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-betont)',
  // Basels Befund (30.07.2026): das Wertfeld ragte RECHTS aus dem goldenen
  // Kasten. Zwei Ursachen, beide hier begraben: ohne border-box addieren
  // sich Polster und Rahmen AUSSEN auf die Breite, und als Flex-Kind
  // weigert sich ein <input> unter seine intrinsische Breite zu schrumpfen.
  boxSizing: 'border-box',
  minWidth: 0,
  width: '100%',
};

/** Small icon+label toggle chip (% vs €). */
function ModeChip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Percent;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...CHIP_STYLE,
        minHeight: 40,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--w14-abstand-6)',
        ...(active ? CHIP_ACTIVE : null),
      }}
    >
      <Icon icon={icon} size={16} /> {label}
    </button>
  );
}

function DiscountEditor({ line, disabled }: { line: CartLine; disabled: boolean }): JSX.Element {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const [open, setOpen] = useState<boolean>(false);
  const [mode, setMode] = useState<'pct' | 'eur'>('pct');
  const [pct, setPct] = useState<string>('');
  const [amount, setAmount] = useState<string>(line.discountEur ?? '');
  const [reason, setReason] = useState<string>(line.discountReason ?? '');

  // % is a fast way to set the EUR discount — the stored value stays discountEur
  // (so cart-math + finalize are unchanged); percentToEur does the real math.
  const setPercent = (raw: string): void => {
    setPct(raw);
    const n = Number(normalizeDecimal(raw));
    setAmount(
      Number.isFinite(n) && n > 0 ? fromCents(percentToEur(toCents(line.listPriceEur), n)) : '',
    );
  };

  const amountValid = isMoneyInput(amount);
  const positive = amountValid && Number(normalizeDecimal(amount)) > 0;
  const reasonValid = isDiscountReasonValid(reason);
  const reasonShortfall = discountReasonShortfall(reason);
  const reasonTouched = reason.length > 0;
  const canApply = positive && reasonValid;

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setAmount(line.discountEur ?? '');
          setReason(line.discountReason ?? '');
          setOpen(true);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: line.discountEur ? 'var(--w14-wax-red)' : 'var(--w14-gold)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-zeile)',
          cursor: disabled ? 'default' : 'pointer',
          padding: 0,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        {line.discountEur ? 'Rabatt ändern' : 'Rabatt'}
      </button>
    );
  }

  // Enlarged for the 21" touchscreen: taller hit area + ≥0.9rem text.
  const inputStyle: CSSProperties = {
    padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
    border: '1px solid var(--w14-ink-faded)',
    borderRadius: 'var(--w14-radius-button)',
    background: 'var(--w14-parchment)',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-body)',
    fontSize: 'var(--w14-schrift-betont)',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        alignItems: 'stretch',
        marginTop: 'var(--space-2)',
        padding: 'var(--space-3)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        minWidth: 320,
      }}
    >
      {/* % (default) vs € entry */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <ModeChip
          active={mode === 'pct'}
          icon={Percent}
          label="Prozent"
          onClick={() => setMode('pct')}
        />
        <ModeChip active={mode === 'eur'} icon={Tag} label="Euro" onClick={() => setMode('eur')} />
      </div>

      {mode === 'pct' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)' }}>
          <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap', alignItems: 'center' }}>
            {PCT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(String(p))}
                style={{
                  ...CHIP_STYLE,
                  ...(Number(normalizeDecimal(pct)) === p ? CHIP_ACTIVE : null),
                }}
              >
                {p} %
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="%"
              aria-label="Eigener Prozentsatz"
              style={{
                ...inputStyle,
                width: 72,
                textAlign: 'right',
                fontFamily: 'var(--w14-font-mono)',
              }}
            />
          </div>
          {positive && (
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
              Rabatt {amount} € · neuer Preis{' '}
              {fromCents(toCents(line.listPriceEur) - (centsAusEingabe(amount) ?? 0n))} €
            </span>
          )}
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-6)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>Rabatt €</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            style={{
              ...inputStyle,
              flex: 1,
              textAlign: 'right',
              fontFamily: 'var(--w14-font-mono)',
            }}
          />
        </label>
      )}

      {/* Reason preset chips — prefill an EDITABLE, still-required reason. */}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap' }}>
        {REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} style={CHIP_STYLE}>
            {r}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)' }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Begründung (Pflicht, mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen)`}
          aria-invalid={reasonTouched && !reasonValid}
          style={{
            ...inputStyle,
            border:
              reasonTouched && !reasonValid ? '1px solid var(--w14-wax-red)' : inputStyle.border,
          }}
        />
        {/* Live inline feedback — no more silently-disabled button. */}
        <span
          style={{
            fontSize: 'var(--w14-schrift-zeile)',
            color: reasonTouched && !reasonValid ? 'var(--w14-wax-red)' : 'var(--w14-ink-aged)',
          }}
        >
          {reasonValid
            ? 'Begründung ✓'
            : reasonTouched
              ? `Noch ${reasonShortfall} Zeichen (mind. ${MIN_DISCOUNT_REASON_LEN})`
              : `Pflichtfeld, mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', justifyContent: 'flex-end' }}>
        {line.discountEur && (
          <Button
            variant="ghost"
            size="md"
            style={{ minHeight: 48 }}
            onClick={() => {
              setLineDiscount(line.productId, null, '');
              setOpen(false);
            }}
          >
            Entfernen
          </Button>
        )}
        <Button variant="ghost" size="md" style={{ minHeight: 48 }} onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="md"
          style={{ minHeight: 48 }}
          disabled={!canApply}
          onClick={() => {
            setLineDiscount(line.productId, normalizeDecimal(amount), reason);
            setOpen(false);
          }}
        >
          Übernehmen
        </Button>
      </div>
    </div>
  );
}

/**
 * InvoiceDiscount — a whole-cart Rabatt (UX cashier 2/3 B). A % or € is
 * distributed across the lines (Σ-EXACT, decimal-safe) and LANDS as each line's
 * own `discountEur` via `setLineDiscount` — so the per-line tax math + finalize
 * are entirely unchanged. The reason is required (compliance). Applying it
 * (re)distributes across all lines; "Rabatte entfernen" clears them.
 */
function InvoiceDiscount({ lines }: { lines: readonly CartLine[] }): JSX.Element | null {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const [open, setOpen] = useState<boolean>(false);
  const [mode, setMode] = useState<'pct' | 'eur'>('pct');
  const [value, setValue] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [confirmingOverwrite, setConfirmingOverwrite] = useState<boolean>(false);

  if (lines.length === 0) return null;

  // A cart-wide Rabatt lands as each line's own discountEur, so applying it
  // REPLACES any existing per-line Rabatt + reason. Detect that up front so we
  // can warn before silently discarding the operator's per-line discounts.
  const hasExistingLineDiscounts = lines.some(
    (l) => l.discountEur !== undefined && Number(l.discountEur) > 0,
  );

  const bases = lines.map((l) => toCents(l.listPriceEur));
  const totalBase = bases.reduce((a, b) => a + b, 0n);
  const valueNum = Number(normalizeDecimal(value));
  const rawTotal =
    mode === 'pct'
      ? percentToEur(totalBase, valueNum)
      : isMoneyInput(value)
        ? toCents(normalizeDecimal(value))
        : 0n;
  const cappedTotal = rawTotal > totalBase ? totalBase : rawTotal;
  const canApply = cappedTotal > 0n && isDiscountReasonValid(reason);

  const apply = (): void => {
    if (!canApply) return;
    // Never discard existing per-line Rabatte silently — require one explicit
    // confirmation first (the button turns into "Ersetzen & übernehmen").
    if (hasExistingLineDiscounts && !confirmingOverwrite) {
      setConfirmingOverwrite(true);
      return;
    }
    const shares = distributeInvoiceDiscount(bases, cappedTotal);
    lines.forEach((l, i) => {
      const s = shares[i] ?? 0n;
      if (s > 0n) setLineDiscount(l.productId, fromCents(s), reason);
      else setLineDiscount(l.productId, null, '');
    });
    setOpen(false);
    setValue('');
    setReason('');
    setConfirmingOverwrite(false);
  };

  const clearAll = (): void => {
    for (const l of lines) setLineDiscount(l.productId, null, '');
  };

  if (!open) {
    return (
      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            ...CHIP_STYLE,
            minHeight: 40,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon icon={Percent} size={16} /> Rechnungsrabatt
        </button>
        <button
          type="button"
          onClick={clearAll}
          style={{ ...CHIP_STYLE, minHeight: 40, color: 'var(--w14-wax-red)' }}
        >
          Rabatte entfernen
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: 'var(--w14-abstand-12)',
        border: '1px solid var(--w14-gold)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-8)',
      }}
    >
      <strong style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-betont)' }}>
        Rabatt auf die ganze Rechnung
      </strong>
      {/* Art in einer Zeile, Wert in der eigenen: drei Teilnehmer in einer
          schmalen Kartenspalte quetschten das Feld aus dem Kasten. */}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', alignItems: 'center' }}>
        <ModeChip
          active={mode === 'pct'}
          icon={Percent}
          label="Prozent"
          onClick={() => setMode('pct')}
        />
        <ModeChip active={mode === 'eur'} icon={Tag} label="Euro" onClick={() => setMode('eur')} />
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === 'pct' ? '%' : '€'}
        aria-label={mode === 'pct' ? 'Prozent' : 'Euro'}
        style={{
          ...DISCOUNT_INPUT,
          textAlign: 'right',
          fontFamily: 'var(--w14-font-mono)',
        }}
      />
      {cappedTotal > 0n && (
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
          Verteilter Rabatt: −{fromCents(cappedTotal)} € auf {lines.length} Position
          {lines.length === 1 ? '' : 'en'}
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap' }}>
        {REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} style={CHIP_STYLE}>
            {r}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`Begründung (Pflicht, mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen)`}
        style={DISCOUNT_INPUT}
      />
      {confirmingOverwrite && (
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-wax-red)', fontWeight: 600 }}>
          Bestehende Positions-Rabatte werden durch den Rechnungsrabatt ersetzt.
        </span>
      )}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="md"
          style={{ minHeight: 48 }}
          onClick={() => {
            setOpen(false);
            setConfirmingOverwrite(false);
          }}
        >
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="md"
          style={{ minHeight: 48 }}
          disabled={!canApply}
          onClick={apply}
        >
          {confirmingOverwrite ? 'Ersetzen & übernehmen' : 'Übernehmen'}
        </Button>
      </div>
    </div>
  );
}

function EmptyCart(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ maxWidth: 280 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '1px solid var(--w14-rule)',
            background: 'var(--w14-parchment-2)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <Icon icon={Tag} size={22} color="var(--w14-gold)" />
        </span>
        <Zwischentitel />
        <p
          style={{
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
            lineHeight: 1.5,
          }}
        >
          Wählen Sie ein Stück aus dem Katalog
          <br />
          oder scannen Sie das Etikett.
          <br />
          Es wird sofort für den Beleg reserviert.
        </p>
      </div>
    </div>
  );
}


/**
 * BezahlenDialog, der komplette Kassen-Abschluss des Verkaufs.
 *
 * 27.07.2026: der alte Kopf behauptete noch „V1, CASH only" und schickte
 * damit jede Sitzung in die Irre. Wahr ist, was die Datei heute trägt:
 *
 *   • Barzahlung mit live gerechnetem Rückgeld (bigint-Cents, HALF_EVEN,
 *     `cart-math.ts`).
 *   • Kartenzahlung über das ZVT-Terminal, mit Doppelbelastungs-Schutz und
 *     dem Sonderweg „Autorisierung gelungen, finalize gescheitert" (§19.3
 *     C-3: das Geld lag schon auf dem Tisch, repariert 26.07.2026).
 *   • `STRIPE_TERMINAL`, die eine Geste am Stripe-Leser (Zustandsautomat in
 *     `stripe-leser-ablauf.ts`, seit 27.07.2026). Der Chip existiert nur,
 *     wenn die Leser-Abfrage mindestens einen registrierten Leser meldet.
 *   • Gutschein: deckt bis zur vollen Summe, der Rest läuft bar oder als
 *     Teilzahlung weiter; die Einlösung wird nach dem finalize verbucht und
 *     offline ehrlich als „später" gemeldet.
 *   • Teilzahlung bar plus Karte (`computeSplitPayment`), gerechnet auf der
 *     Summe NACH dem Gutschein-Bein.
 *   • B2B Reverse Charge und §10-Käufer: der Käufer wird VOR dem fiskalischen
 *     Abschnitt mit einem begrenzten Aufruf aufgelöst, USt-IdNr. gegen VIES.
 *   • Step-up (403 auf dem finalize öffnet die PIN-Stufe im Interceptor),
 *     Offline-Warteschlange, TSE-Siegel je Beleg, Belegvorschau, Thermodruck
 *     und Storno mit wörtlicher Erstattungs-Auskunft (27.07.2026).
 *
 * Meilensteine aus dem git-Verlauf: die aufgezeichnete Historie beginnt am
 * 24.07.2026, und schon dort konnte der Dialog Bar, ZVT-Karte, Gutschein und
 * Teilzahlung. 26.07.2026 kam `STRIPE_TERMINAL` als eigene Zahlart durch alle
 * Exporte, 27.07.2026 die eine Geste am Leser in diesen Dialog.
 *
 * Der Ablauf bleibt zweiphasig: INPUT (Zahlart wählen, Betrag erfassen) und
 * RESULT (Beleg-Kennung, Rückgeld, „Neue Karte"). Nach dem finalize leert der
 * Dialog den Korb und invalidiert Dashboard- und Produktlisten-Abfragen.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CustomerDetail,
  type FinalizeBody,
  type FinalizeLineItem,
  type FinalizeResponse,
  type PaymentMethod,
  type TerminalZahlungStand,
  type TerminalZahlungView,
  customersApi,
  stripeTerminalApi,
  transactionsApi,
} from '@norns/api-client';

import { Fensterboden,
  ParchmentCard,
} from '@norns/ui-kit';

import { ZvtSpinner } from '../../components/hardware/ZvtSpinner.js';
import { currentShiftQueryKey, useCurrentShift } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { useReceiptFooterLines } from '../../hooks/useReceiptFooter.js';
import { useSteuermodus } from '../../hooks/useSteuermodus.js';
import { pruefeUhr } from '../../lib/uhrenabgleich.js';
import {
  RECEIPT_VAT_LOCK_REASON,
  isReceiptShopValid,
  resolveShopInfo,
  useShopInfo,
} from '../../hooks/useShopInfo.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { resolveDeviceId, useApiClient } from '../../lib/api-context.js';
import { posIntentsStore, sealFiscalRequest } from '../../lib/pos-intents-store.js';
import {
  type HeaderTotals,
  type LineMath,
  computeLineMath,
  computeTender,
  fromCents,
  harmonisiereUstJeSatz,
  sumHeader,
  centsAusEingabe,
  toCents,
} from '../../lib/cart-math.js';
import { centsAlsBetrag, steuerausweisFuerBeleg } from '../../lib/beleg-steuerausweis.js';
import { isMoneyInput } from '../../lib/decimal.js';
import { PAYMENT_METHOD_LABEL, describeError, dezimalAlsDeutsch } from '@norns/i18n-de';
import {
  LESER_POLL_FEHLER_DECKEL,
  LESER_POLL_TAKT_MS,
  STAND_UNBEKANNT_MELDUNG,
  beschreibeStartFehler,
  deuteStand,
  positionenDeckenBetrag,
  stripeZahlartSichtbar,
  terminalPositionen,
  waehleLeser,
} from '../../lib/stripe-leser-ablauf.js';
import {
  type ThermalReceiptData,
  type ZvtResult,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  thermalClient,
  zvtClient,
} from '../../lib/hardware-client.js';
import { notePrintOutcome } from '../../lib/hardware-reprobe.js';
import {
  type TseSessionResult,
  closeTseSession,
  enqueueSignatureRecordOnly,
  newIntentionId,
  openTseSession,
} from '../../lib/tse-service.js';
import { vorgangUebernehmen } from '../../lib/vorgangs-uhr.js';
import type { TseIntention, TsePaymentKind } from '../../lib/hardware-client.js';
// Der Ausfallweg: dauerhaft sichern und EHRLICH sagen, ob es gelang.
import { OHNE_EROEFFNUNG, ausfallSichern, meldungNachAusfall } from '../../lib/tse-queue-store.js';
import { computeAmountsPerVatRate } from '../../lib/tse-vat.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { KaeuferPicker } from './KaeuferPicker.js';
import { ReceiptPreview } from './ReceiptPreview.js';
import { grundOhneSignatur, hinweisOhneSignatur } from '../../lib/ohne-signatur-hinweis.js';
import { amNetz, pruefeGutscheinBrauchtNetz } from '../../lib/gutschein-braucht-netz.js';
import type { AppliedVoucher } from './VoucherField.js';
import { computeSplitPayment } from './split-payment.js';
import { reverseChargeGiltJetzt } from './reverse-charge-spiegel.js';
import { istSicherEingereiht } from '../../lib/eingereiht.js';
import { formatPaymentError, isKycRequiredError } from './zahlungsfehler.js';
import { alsTag } from '@norns/domain';
import { PaymentInput } from './PaymentInput.js';
import { ReceiptResult } from './ReceiptResult.js';
import { steuerhinweiseFuerBeleg } from './steuertexte.js';
import type { StripeSchritt, Zahlwahl } from './zahlwege.js';
import { type Fiskalzustand, zustandAusAusfall } from '../../lib/fiskalzustand-satz.js';

/**
 * Smart-denomination quick-tender chips (design-brief §1).
 *
 * PRESENTATION ONLY — every value is derived from the already-computed
 * `dueCents` via the canonical `fromCents`/`toCents` primitives. No rounding,
 * VAT or tender math is introduced here; the chips merely pre-fill the same
 * `cashReceivedEur` string the keypad and keyboard already write, so the cash
 * math downstream (computeTender) is byte-identical to a manual entry.
 *
 * The first chip is always "Passend" (exact due). The remaining chips are the
 * smallest standard German note/coin denominations that are STRICTLY greater
 * than the due — the realistic "what the customer hands over" set — capped at
 * five chips total so the row never wraps (Hick: cap visible choices).
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BezahlenDialogProps {
  open: boolean;
  onClose: () => void;
  lines: readonly CartLine[];
  perLineMath: readonly LineMath[];
  totals: HeaderTotals;
  /** Fired ONLY on the genuine finalize-success → "Neue Karte" close path. */
  onFinalizeSuccess?: (() => void) | undefined;
}

export function BezahlenDialog({
  open,
  onClose,
  lines,
  perLineMath,
  totals: _totals,
  onFinalizeSuccess,
}: BezahlenDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  // Post-finalize the server has already transitioned RESERVED → SOLD,
  // so the cart-store reservations are obsolete. We clear without
  // calling release (server-side those holds no longer exist).
  const clearCart = useCartStore((s) => s.clearCart);
  // Abholung einer Web-Reservierung (0099): ist die Karte eine geladene
  // Bestellung, muss diese Nummer in den Finalize-Body, sonst bleibt die
  // Bestellung RESERVED und wird nie als abgeholt verbucht.
  const webOrderNumber = useCartStore((s) => s.webOrderNumber);
  const addToast = useToastStore((s) => s.addToast);
  const hardwareCfg = useHardwareStore((s) => s.config);
  const sessionActor = useSessionStore((s) => s.actor);
  const { data: shopApi } = useShopInfo();
  const customFooter = useReceiptFooterLines();
  const setLastReceipt = useLastReceiptStore((s) => s.setLastReceipt);

  const [paymentChoice, setPaymentChoice] = useState<Zahlwahl>('CASH');
  const [cashReceivedEur, setCashReceivedEur] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<FinalizeResponse | null>(null);
  /** Set while the ZVT terminal owns the cardholder's attention. */
  const [zvtBusy, setZvtBusy] = useState<boolean>(false);
  /** Der sichtbare Schritt der einen Geste am Stripe-Leser. */
  const [stripeSchritt, setStripeSchritt] = useState<StripeSchritt>({ art: 'RUHT' });
  /** Die laufende Leser-Zahlung — Ziel des Abbrechen-Knopfes während WARTEN. */
  const [stripeZahlungId, setStripeZahlungId] = useState<string | null>(null);
  /**
   * Die ERFOLGREICH belastete Leser-Zahlung des gebuchten Belegs — damit der
   * Sofort-Storno die Erstattung anbieten kann (girocard erstattet per SEPA,
   * die Server-Auskunft dazu gehört wörtlich auf die Fläche).
   */
  const [stripeErstattbareZahlungId, setStripeErstattbareZahlungId] = useState<string | null>(null);
  /** The finalized receipt awaiting the operator's print confirmation (preview). */
  const [previewData, setPreviewData] = useState<ThermalReceiptData | null>(null);
  const [printing, setPrinting] = useState<boolean>(false);
  /** Applied gift voucher (Phase C2) — covers up to the full total; rest in cash. */
  const [appliedVoucher, setAppliedVoucher] = useState<AppliedVoucher | null>(null);
  /**
   * Split payment (Phase C1) — when on, the operator's entered cash amount is a
   * PARTIAL cash leg and the remainder is charged to the card. Off = the cash
   * field is full payment (the classic single-method cash path).
   */
  const [splitCard, setSplitCard] = useState<boolean>(false);

  /**
   * § 10 GwG buyer — a KYC-verified Käufer attached to a high-value (≥ €2.000)
   * sale. `null` for the common anonymous Tafelgeschäft under the threshold.
   * Set via the KaeuferPicker; its `customerId` rides on the finalize body so
   * the server's `transactions_validate_kyc` trigger is satisfied.
   */
  const [selectedBuyer, setSelectedBuyer] = useState<CustomerDetail | null>(null);
  const [buyerPickerOpen, setBuyerPickerOpen] = useState<boolean>(false);

  // B2B state
  const [isB2b, setIsB2b] = useState<boolean>(false);
  const [vatId, setVatId] = useState<string>('');
  const [viesStatus, setViesStatus] = useState<
    'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable' | 'timeout'
  >('idle');
  const [viesCompany, setViesCompany] = useState<string>('');
  const [viesAddress, setViesAddress] = useState<string>('');
  /**
   * Der Belegvermerk zur USt-IdNr.-Abfrage, wie ihn der Server formuliert.
   *
   * ⚠️ 27.07.2026. Vorher gab es ihn hier nicht, und `steuerausweisFuerBeleg`
   * wurde OHNE zweites Argument gerufen. Also druckte JEDER § 13b-Beleg
   * „USt-IdNr.: Nachweis der EU-Abfrage FEHLT." — auch bei durchgeführter,
   * gültiger Prüfung. Der Wortlaut wird NICHT hier gebaut: er kommt fertig
   * vom Server (`belegvermerkFuerVatPruefung`), damit es nicht zwei Fassungen
   * gibt, die auseinanderlaufen.
   */
  const [viesBelegvermerk, setViesBelegvermerk] = useState<string | null>(null);
  const [manualCompany, setManualCompany] = useState<string>('');
  const [manualAddress, setManualAddress] = useState<string>('');

  const cleanVatId = useMemo(() => vatId.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), [vatId]);
  const companyName = useMemo(() => {
    return viesCompany && viesCompany !== '---' ? viesCompany : manualCompany;
  }, [viesCompany, manualCompany]);

  // ⚠️ 30.07.2026. Hier stand `viesStatus === 'valid' || 'unavailable' ||
  // 'timeout'`: eine nicht erreichbare EU galt als BESTÄTIGTE USt-IdNr. Die
  // Summe fiel dann sichtbar um 19 %, der Kassierer nannte dem Kunden diesen
  // Betrag, und der Server wies den Vorgang danach zurück — er behandelt
  // NICHT_ERREICHBAR wie „nie geprüft" (`darfReverseCharge`). Die Regel liegt
  // jetzt in EINER geprüften Datei, damit Anzeige und Freigabe unten nie
  // wieder auseinanderlaufen.
  const b2bActive = reverseChargeGiltJetzt(isB2b, viesStatus);

  const adjustedPerLineMath = useMemo(() => {
    return lines.map((line, idx) => {
      const actualTaxCode =
        b2bActive && line.taxTreatmentCode === 'STANDARD_19'
          ? 'REVERSE_CHARGE_13B'
          : line.taxTreatmentCode;
      const originalMath = perLineMath[idx];
      if (!originalMath) throw new Error('cart-math/lines length mismatch');
      if (actualTaxCode === line.taxTreatmentCode) {
        return originalMath;
      }
      return computeLineMath({
        taxTreatmentCode: actualTaxCode,
        listPriceEur: line.listPriceEur,
        acquisitionCostEur: line.acquisitionCostEur,
        discountEur: line.discountEur,
      });
    });
  }, [lines, perLineMath, b2bActive]);

  /**
   * ⚠️ Die Umsatzsteuer wird EINMAL je Beleg und Satz gerundet, dann verteilt.
   *
   * `computeLineMath` rundet je Zeile. Fünf Stücke mit je 20,00 EUR Marge
   * ergaben so 5 × 3,19 = 15,95, während der Buchungsstapel dieselben Zeilen zu
   * EINER Buchung über 100,00 EUR zusammenfasst und daraus 15,97 rechnet.
   *
   * Ein Prüfer stellt genau das gegenüber: den Stapel je Erlöskonto gegen die
   * DSFinV-K je Steuerbehandlung. Auf der Produktion gemessen 0,05 EUR über
   * 8 Belege.
   *
   * § 14 Abs. 4 Nr. 8 UStG verlangt den Steuerbetrag für die RECHNUNG je
   * Steuersatz, nicht je Position — die zusammengefasste Zahl ist also die
   * massgebliche. Der Bruttobetrag jeder Zeile bleibt unberührt; nur die Naht
   * zwischen Netto und Steuer wandert.
   */
  const harmonisiertePerLineMath = useMemo(
    () => harmonisiereUstJeSatz(adjustedPerLineMath),
    [adjustedPerLineMath],
  );

  const adjustedTotals = useMemo(
    () => sumHeader(harmonisiertePerLineMath),
    [harmonisiertePerLineMath],
  );

  /*
   * ── Die Signatur-Aufteilung, EINMAL gerechnet, VOR dem Geld (19.08.2026) ─
   *
   * `ohneSatznamen` war ein Vertrag („der Aufrufer muss das MELDEN"), den
   * dieser Dialog nie erfuellt hat: Zeilen ohne Satznamen fielen still aus
   * dem signierten `amounts_per_vat_rate`, und die TSE unterschrieb weniger
   * Umsatz als Zahlung — auf ~87 % der Belege (§ 25a; inzwischen im
   * 0-Prozent-Container beantwortet). Sollte je wieder ein Schluessel ohne
   * Satznamen auftauchen, sperrt dieser Wert den Bezahlen-Knopf, BEVOR eine
   * Karte belastet oder ein Beleg gebucht ist — nicht erst mitten in
   * Schritt 3, wo der Verkauf schon gebucht waere.
   */
  const vatAufteilung = useMemo(
    () =>
      computeAmountsPerVatRate(
        lines.map((line, idx) => ({
          // Dieselbe Ableitung wie der Finalize-Rumpf weiter unten: unter
          // B2B wird STANDARD_19 zur Steuerschuldumkehr, alles andere
          // behaelt seinen Zeilenschluessel.
          appliedTaxTreatmentCode:
            b2bActive && line.taxTreatmentCode === 'STANDARD_19'
              ? 'REVERSE_CHARGE_13B'
              : line.taxTreatmentCode,
          lineTotalCents: Number(harmonisiertePerLineMath[idx]?.lineTotalCents ?? 0n),
        })),
      ),
    [lines, b2bActive, harmonisiertePerLineMath],
  );

  const verifyVat = useCallback(async () => {
    if (!vatId.trim()) return;
    setViesStatus('checking');
    try {
      // ⚠️ Bis zum 26.07.2026 wurde hier OHNE `customerId` gefragt, also hielt
      // die Route nichts fest. Der Kunde entstand erst danach, und `create`
      // schrieb nur `vat_id`. Ergebnis: `darfReverseCharge` antwortete immer
      // „nie geprueft", finalize warf 403, und der Kartenweg hatte das Geld
      // dann schon gezogen.
      //
      // Der Hauptriegel sitzt jetzt im Server (jede Stelle, die `vat_id`
      // schreibt, loest die Pruefung aus). Hier wird sie zusaetzlich
      // mitgegeben, damit ein SCHON bestehender Kunde beim erneuten Pruefen
      // seinen frischen Satz bekommt, ohne dass jemand ihn erst aendern muss.
      const bekannterKunde = resolvedCustomerIdRef.current;
      const res = await api.request<{
        valid: boolean;
        ergebnis?: string;
        gespeichert?: boolean;
        name?: string;
        address?: string;
        error?: string;
        belegvermerk?: string | null;
      }>(
        'GET',
        `/api/customers/verify-vat?vatId=${encodeURIComponent(vatId)}` +
          (bekannterKunde ? `&customerId=${encodeURIComponent(bekannterKunde)}` : ''),
      );

      // Der Vermerk gilt nur zu DIESER Antwort. Ein stehengebliebener Satz
      // aus einer frueheren, anderen Nummer waere schlimmer als keiner.
      setViesBelegvermerk(res.belegvermerk ?? null);

      if (res.valid) {
        setViesStatus('valid');
        setViesCompany(res.name || '---');
        setViesAddress(res.address || '---');
        setManualCompany(res.name && res.name !== '---' ? res.name : '');
        setManualAddress(res.address && res.address !== '---' ? res.address : '');
      } else {
        if (res.error === 'VIES_TIMEOUT') {
          setViesStatus('timeout');
        } else if (res.error === 'VIES_UNAVAILABLE') {
          setViesStatus('unavailable');
        } else {
          setViesStatus('invalid');
        }
      }
    } catch {
      setViesStatus('unavailable');
      setViesBelegvermerk(null);
    }
  }, [api, vatId]);

  /**
   * §19.3 W-1/W-2 — synchronous mutex.
   *
   * `useState(submitting)` is async — React doesn't commit the
   * `setSubmitting(true)` until after the event handler yields, so a
   * fast double-click CAN re-enter `submit`/`submitCard` and trigger
   * TWO ZVT authorizations. A `useRef.current = true` is visible
   * immediately on the next synchronous read, killing the race.
   *
   * The ref is reset in the `finally` of both submit paths AND when
   * the dialog re-opens (operator dismissed and re-opened).
   */
  const inFlightRef = useRef<boolean>(false);

  /**
   * §19.2 C-4 — idempotency key for at-most-once finalize.
   *
   * Generated ONCE per dialog open and held in a ref so retries (e.g.
   * step-up cancel-then-resume, or network error retry) send the SAME
   * key. The server's partial UNIQUE INDEX deduplicates on this value.
   */
  const idempotencyKeyRef = useRef<string>(newIntentionId());

  /**
   * 0118 — die Schicht, auf der WIRKLICH kassiert wird.
   *
   * ⚠️ Bis zum 26.07.2026 stand im Rumpf keine Schicht. Der Server suchte
   * sich beim EINGANG „irgendeine offene Schicht dieses Geraets". War die
   * Schicht beim Nachspielen schon geschlossen, hing der Verkauf an der
   * NEUEN Schicht oder an gar keiner, und der Kassensturz der Schicht, in
   * der wirklich kassiert wurde, stimmte nicht.
   *
   * Dieselbe zwischengespeicherte Abfrage, die `Verkauf.tsx` ohnehin haelt
   * (gleicher Abfrageschluessel) — also keine zusaetzliche Anfrage. Die
   * Kennung wandert in den gesiegelten Rumpf, deshalb traegt auch ein
   * nachgespielter Beleg die richtige Schicht.
   */
  const { data: aktuelleSchicht } = useCurrentShift();
  // 20.08.2026: der Steuerstatus des BETRIEBS. Unter § 19 UStG traegt der
  // Beleg den Pflichthinweis und KEINEN Steuerausweis (§ 14c Abs. 2 UStG:
  // ausgewiesene Steuer wird geschuldet, auch wenn sie nie kassiert wurde).
  const betriebsmodus = useSteuermodus();

  /**
   * Die Leser-Abfrage mit ruhigem Zwischenspeicher (gleicher Schlüssel wie
   * der Gerätemanager, also KEINE zweite Wahrheit). Meldet sie keinen Leser
   * oder scheitert sie (NOT_CONFIGURED, Netz weg, offline), zeigt der Wähler
   * die Zahlart GAR NICHT — kein Fehlerrot, Roman sieht schlicht nichts
   * Neues. Ohne Netz kann der servergesteuerte Weg ohnehin nichts.
   */
  const stripeLeserQuery = useQuery({
    queryKey: ['stripe-terminal', 'leser'],
    queryFn: () => stripeTerminalApi.leserListe(api),
    staleTime: 30_000,
    enabled: open,
    retry: false,
  });
  const stripeLeser = stripeLeserQuery.isError ? null : (stripeLeserQuery.data?.leser ?? null);
  const stripeVerfuegbar = stripeZahlartSichtbar(stripeLeser);

  // Verschwindet der letzte Leser, während die Zahlart gewählt ist (Abmeldung
  // im Gerätemanager, Netzverlust), fällt der Wähler ruhig auf Bar zurück —
  // nie mitten in einem laufenden Vorgang (submitting hält ihn fest).
  useEffect(() => {
    if (open && paymentChoice === 'STRIPE_TERMINAL' && !stripeVerfuegbar && !submitting) {
      setPaymentChoice('CASH');
    }
  }, [open, paymentChoice, stripeVerfuegbar, submitting]);

  /**
   * §19.3 C-3 — a SUCCESSFUL ZVT authorization whose finalize then failed.
   *
   * The card is already debited. Re-running `submitCard` must NOT re-authorize
   * (that double-charges); it must retry ONLY the finalize against THIS
   * authorization. We stash the winning `ZvtResult` here on auth-success and
   * clear it once finalize succeeds (or the dialog re-opens). While set, the
   * card path skips the terminal and goes straight to finalize.
   */
  const pendingAuthRef = useRef<ZvtResult | null>(null);

  /**
   * Die Kennung der GESTE am Stripe-Leser (Doppelbelastungs-Riegel des
   * Servers): dieselbe Kennung eröffnet nie eine zweite Zahlung. Sie bleibt
   * bei einem Netz-Wackler stehen (erneut senden setzt DENSELBEN Vorgang
   * fort) und wird erst verworfen, wenn der Server ein ENDGÜLTIGES Scheitern
   * gemeldet hat — dann ist ein neuer Versuch bewusst eine neue Zahlung.
   */
  const stripeStartKeyRef = useRef<string | null>(null);

  /**
   * Spiegel von `pendingAuthRef` für den Leser-Weg (§19.3 C-3): eine
   * ERFOLGREICHE Leser-Belastung, deren finalize danach scheiterte. Die Karte
   * ist belastet — der nächste Versuch bucht NUR nach, er startet nie eine
   * zweite Sammlung am Leser.
   */
  const stripeErfolgRef = useRef<{ zahlungId: string; providerIntentId: string } | null>(null);

  /**
   * P1.3 — the B2B company customer resolved ONCE per checkout (by VAT id), so
   * a finalize-retry after a card charge never re-resolves / re-creates. Cleared
   * on dialog open. `null` = not yet resolved this session.
   */
  const resolvedCustomerIdRef = useRef<string | null>(null);

  /**
   * §19.3 W-7 — TSE signature captured from the FINISH call so the
   * thermal print step can include the KassenSichV-mandated signature
   * block + QR. `null` when TSE is offline or unconfigured (the print
   * still fires; the operator sees a "TSE-Signatur fehlt" line on the
   * paper receipt and the queue picks up the sync later).
   */
  const lastTseSignatureRef = useRef<{
    signatureValue: string;
    signatureCounter: string;
    transactionNumber: string;
    qrPayload: string;
  } | null>(null);

  /**
   * Der fiskalische Zustand DIESES Belegs, festgehalten in dem Augenblick, in
   * dem er entsteht.
   *
   * ── WARUM ES DIESEN MERKER BRAUCHT (13.08.2026) ─────────────────────────
   *
   * Beim Bau des Belegs weiss dieser Weg nur noch, OB eine Signatur da ist
   * (`lastTseSignatureRef`), nicht mehr WARUM keine da ist. Die Vorschau
   * schloss aus der leeren Signatur auf „wird nachgereicht" — ein Versprechen,
   * das für einen dauerhaft vermerkten Ausfall und für eine Kasse ohne
   * hinterlegte Sicherungseinrichtung schlicht falsch ist.
   *
   * Der Grund ist an den vier Ausgängen unten bekannt. Hier wird er gemerkt,
   * damit der Beleg ihn mitnehmen kann.
   */
  const fiskalzustandRef = useRef<Fiskalzustand>('signiert');

  // Reset on open.
  useEffect(() => {
    if (open) {
      setPaymentChoice('CASH');
      setCashReceivedEur('');
      setSubmitting(false);
      setError(null);
      setFinalized(null);
      setZvtBusy(false);
      setPreviewData(null);
      setPrinting(false);
      setAppliedVoucher(null);
      setSplitCard(false);
      setSelectedBuyer(null);
      setBuyerPickerOpen(false);
      inFlightRef.current = false;
      idempotencyKeyRef.current = newIntentionId();
      pendingAuthRef.current = null;
      resolvedCustomerIdRef.current = null;
      setStripeSchritt({ art: 'RUHT' });
      setStripeZahlungId(null);
      setStripeErstattbareZahlungId(null);
      stripeStartKeyRef.current = null;
      stripeErfolgRef.current = null;

      setIsB2b(false);
      setVatId('');
      setViesStatus('idle');
      setViesCompany('');
      setViesAddress('');
      setManualCompany('');
      setManualAddress('');
    }
  }, [open]);

  // Esc closes (unless mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const totalCents = useMemo(() => toCents(adjustedTotals.totalEur), [adjustedTotals.totalEur]);
  const cashCents = useMemo(() => {
    if (cashReceivedEur.length === 0) return 0n;
    try {
      return centsAusEingabe(cashReceivedEur) ?? 0n;
    } catch {
      return 0n;
    }
  }, [cashReceivedEur]);
  const validCash = isMoneyInput(cashReceivedEur);

  // Voucher + cash split: the voucher covers up to the full total, the cash leg
  // pays the remainder, and change is computed on that remainder.
  const voucherBalanceCents = useMemo(
    () => (appliedVoucher ? toCents(appliedVoucher.balanceEur) : null),
    [appliedVoucher],
  );
  const tender = useMemo(
    () => computeTender({ totalCents, voucherBalanceCents, cashCents }),
    [totalCents, voucherBalanceCents, cashCents],
  );
  const dueCents = tender.dueCents;
  // When the voucher covers the whole sale (due === 0) no cash entry is needed.
  const enoughCash = dueCents === 0n ? true : validCash && tender.cashCovered;
  const changeCents = tender.changeCents;

  // Phase C1 — cash+card split. The entered cash amount becomes a PARTIAL cash
  // leg; the remainder rides on the card. Pure, tested math (split-payment.ts).
  const split = useMemo(
    () => computeSplitPayment(dueCents, cashReceivedEur),
    [dueCents, cashReceivedEur],
  );
  // A split sale is ready when the math is valid (0 < cash < due, exact remainder).
  // Card hardware must be configured (the remainder runs through the ZVT terminal).
  const canSubmitSplit = split.valid && lines.length > 0 && !submitting;

  // Dieselbe Regel wie oben, aus derselben Datei: was die Summe zeigt, muss
  // auch abschickbar sein.
  const b2bValid =
    !isB2b ||
    (reverseChargeGiltJetzt(isB2b, viesStatus) &&
      companyName.trim().length > 0 &&
      cleanVatId.length >= 4);

  /**
   * § 10 GwG buyer gate (UI-surfacing only — the server trigger is the real
   * gate). A VERKAUF total ≥ €2.000 needs a KYC-verified buyer attached. The
   * selected buyer satisfies it only once their `kycVerifiedAt` is stamped.
   */
  const kycGate = useMemo(
    () =>
      evaluateKycGate({
        direction: 'VERKAUF',
        totalCents,
        customer: selectedBuyer ? { kycVerifiedAt: selectedBuyer.kycVerifiedAt } : null,
      }),
    [totalCents, selectedBuyer],
  );
  // A verified buyer is required when the threshold is reached and we don't yet
  // have one attached. (`required` only flips true once a customer is selected
  // but unverified; the "no buyer at all" case is captured by thresholdReached.)
  const buyerVerified = selectedBuyer != null && selectedBuyer.kycVerifiedAt != null;
  // A B2B reverse-charge sale identifies the buyer via the company's VAT id +
  // name + address (resolved/created at finalize) — that satisfies the §10
  // identity requirement on its own, so we must NOT also force a private KYC
  // buyer (which finalize would then discard anyway).
  const needsBuyer = kycGate.thresholdReached && !buyerVerified && !b2bActive;

  // 19.08.2026: kein Bezahlen, solange eine Zeile keinen Signatur-Steuersatz
  // hat — sonst unterschriebe die TSE weniger Umsatz als Zahlung (Anhang I
  // S. 116). Nach Schema und Waechtertest kann das nur bei einem kuenftigen,
  // hier vergessenen Schluessel passieren; DANN steht der Verkauf, statt
  // etwas Unausloeschliches zu erzeugen.
  const signaturVollstaendig = vatAufteilung.ohneSatznamen.length === 0;

  const canSubmit =
    enoughCash && !submitting && finalized === null && lines.length > 0 && b2bValid && !needsBuyer &&
    signaturVollstaendig;
  const canSubmitCard =
    lines.length > 0 && !submitting && b2bValid && !needsBuyer && signaturVollstaendig;

  /**
   * Run the TSE INTENTION → finalize → FINISH sandwich. Returns the
   * server's FinalizeResponse so the caller can render the receipt.
   *
   * TSE failures DO NOT block the sale (V1 — KassenSichV permits a
   * short outage window). Failed signatures land in the offline queue;
   * a future worker job (Phase 1.5 #I-23) drains them back.
   */
  /**
   * Resolve the customer id for the finalize body — the §10 GwG buyer for a
   * high-value private sale, or the B2B company customer. P1.3: resolved with a
   * SINGLE bounded `findByVatId` (was a customer LIST + a serial GET per row on
   * the checkout path — an N+1 that also hit the ADMIN-only by-id route, so a
   * cashier till would 403 mid-sale). The result is cached in a ref so a
   * finalize-retry after a card charge never re-resolves or re-creates.
   *
   * MUST be called BEFORE the TSE intention / card charge — a throw here then
   * aborts the sale with the card untouched.
   */
  const resolveB2bCustomerId = useCallback(async (): Promise<string | null> => {
    if (!isB2b) return selectedBuyer?.id ?? null;
    if (resolvedCustomerIdRef.current) return resolvedCustomerIdRef.current;

    const existing = await customersApi.findByVatId(api, cleanVatId);
    if (existing) {
      resolvedCustomerIdRef.current = existing.id;
      return existing.id;
    }

    const companyAddress = viesAddress && viesAddress !== '---' ? viesAddress : manualAddress;
    const created = await customersApi.create(api, {
      fullName: companyName,
      vatId: cleanVatId,
      // ⚠️ DIESE NOTIZ BEHAUPTETE EINE PRUEFUNG, DIE OFT NICHT STATTFAND.
      //
      // Hier stand bedingungslos „(VIES verified)". Geschrieben wurde sie aber
      // auch dann, wenn die EU-Pruefung `unavailable` oder `timeout` meldete
      // und die Kassiererin Firmenname und Anschrift von Hand eingetragen hat.
      //
      // Der Beleg traegt dann 19 Prozent weniger Steuer nach § 13b, und im
      // Kundensatz steht, das sei geprueft worden. Bei einer Betriebspruefung
      // ist genau diese Zeile der Nachweis, und ein Nachweis, der etwas
      // Falsches behauptet, ist schlimmer als gar keiner: er verhindert die
      // Nachfrage, die den Fall geklaert haette.
      //
      // Der Steuerbeleg konnte geprueft und ungeprueft nicht unterscheiden.
      // Jetzt kann er es.
      notes:
        viesStatus === 'valid'
          ? 'Automatische B2B-Anlage an der Kasse. USt-IdNr. gegen VIES geprueft: bestaetigt.'
          : `Automatische B2B-Anlage an der Kasse. USt-IdNr. NICHT gegen VIES geprueft (${viesStatus}); Firmenname und Anschrift stammen aus manueller Eingabe.`,
      ...(companyAddress?.trim() ? { address: companyAddress.trim() } : {}),
    });
    resolvedCustomerIdRef.current = created.id;
    return created.id;
  }, [api, isB2b, cleanVatId, companyName, viesAddress, manualAddress, selectedBuyer]);

  /**
   * DER TROCKENLAUF: fragt den Server, ob dieser Vorgang durchginge.
   *
   * ⚠️ Er existiert wegen einer gemessenen Reihenfolge: die Kartenautorisierung
   * lag VOR dem finalize. Wurde der Vorgang danach abgelehnt — § 13b, § 10 GwG,
   * § 259 StGB oder ein Rechenfehler — war die Karte belastet, jeder
   * Wiederholversuch scheiterte identisch, und die Kassiererin hatte keinen
   * Ausweg.
   *
   * Absichtlich derselbe Rumpf wie der echte Aufruf, nur mit `dryRun` und OHNE
   * die TSE-Klammer und ohne den Absichtsspeicher: eine zweite, vereinfachte
   * Nutzlast waere eine zweite Wahrheit, die beim naechsten neuen Riegel
   * auseinanderliefe.
   *
   * Wirft bei Ablehnung — der Aufrufer bricht dann ab, BEVOR er das Terminal
   * anfasst.
   */
  const trockenlauf = useCallback(
    async (
      customerId: string | null,
      // Die ECHTE Zahlart des Vorgangs. Der GwG-Riegel des Servers fragt nach
      // ihr (bar 2.000 / unbar 15.000) — ein Trockenlauf mit erfundener Barzahl
      // prüfte sonst einen Riegel, den der echte Aufruf gar nicht trifft.
      // Ohne Angabe bleibt der bisherige Bar-Rumpf (ZVT-Weg unverändert).
      zahlarten?: FinalizeBody['payments'],
    ): Promise<void> => {
      const headTreatment = b2bActive
        ? 'REVERSE_CHARGE_13B'
        : lines[0]?.taxTreatmentCode || 'STANDARD_19';

      const items = lines.map((line, idx) => {
        const math = harmonisiertePerLineMath[idx];
        if (!math) throw new Error('cart-math/lines length mismatch');
        return {
          productId: line.productId,
          reservationSessionId: line.reservationSessionId,
          lineSubtotalEur: fromCents(math.lineSubtotalCents),
          lineVatEur: fromCents(math.lineVatCents),
          lineTotalEur: fromCents(math.lineTotalCents),
          appliedTaxTreatmentCode: (b2bActive && line.taxTreatmentCode === 'STANDARD_19'
            ? 'REVERSE_CHARGE_13B'
            : line.taxTreatmentCode) as never,
          appliedVatRate: math.appliedVatRate,
          acquisitionCostEurSnapshot: line.acquisitionCostEur ?? null,
          marginEur: math.marginCents === null ? null : fromCents(math.marginCents),
          displayOrder: idx + 1,
        };
      });

      await api.request('POST', '/api/transactions/finalize', {
        direction: 'VERKAUF',
        customerId,
        subtotalEur: adjustedTotals.subtotalEur,
        vatEur: adjustedTotals.vatEur,
        totalEur: adjustedTotals.totalEur,
        taxTreatmentCode: headTreatment,
        items,
        payments: zahlarten ?? [
          { paymentMethod: 'CASH' as const, amountEur: adjustedTotals.totalEur },
        ],
        // Ein EIGENER Schluessel. Wuerde hier der echte stehen, koennte der
        // Trockenlauf den spaeteren Vorgang als Wiederholung erscheinen lassen.
        idempotencyKey: newIntentionId(),
        // 0118: dieselben zwei Angaben wie im echten Aufruf. Der Server prueft
        // Erfassungszeit und Schichtzugehoerigkeit VOR dem Trockenlauf-Tor —
        // fehlten sie hier, sagte der Trockenlauf „ginge durch" zu einem Rumpf,
        // den der echte Aufruf danach ablehnt, und die Karte waere schon
        // belastet.
        erfasstAm: new Date().toISOString(),
        ...(aktuelleSchicht?.id ? { shiftId: aktuelleSchicht.id } : {}),
        dryRun: true,
      });
    },
    [api, b2bActive, lines, harmonisiertePerLineMath, adjustedTotals, aktuelleSchicht?.id],
  );

  const finalizeWithTse = useCallback(
    async (
      payments: NonNullable<FinalizeBody['payments']>,
      paymentKind: TsePaymentKind,
      customerId: string | null,
    ): Promise<FinalizeResponse> => {
      // ── 0118: DIE ERFASSUNGSZEIT ──────────────────────────────────────
      //
      // ⚠️ Hier, ganz oben, und nicht spaeter: das ist der Augenblick des
      // Kassierens. Der Wert wandert unveraendert in `body`, und `body` ist
      // genau das, was `sealFiscalRequest` unten versiegelt und
      // `posIntentsStore.create` VOR dem Netz auf Platte schreibt. Der
      // Wiedereinspieler schickt den gesiegelten Rumpf woertlich weiter
      // (`sealedToOutboxRecord`), also traegt auch ein am naechsten Morgen
      // nachgespielter Beleg diese Zeit — und landet im Z-Bon von GESTERN.
      //
      // Wuerde die Zeit stattdessen erst der Server setzen, faellt sie auf
      // `DEFAULT now()` zurueck, und genau das war der Fehler.
      const erfasstAm = new Date().toISOString();

      // `customerId` is resolved by the caller (resolveB2bCustomerId) BEFORE any
      // charge — never inside this finalize sandwich, where a lookup throw would
      // reject AFTER the card is debited.
      const headTreatment = b2bActive
        ? 'REVERSE_CHARGE_13B'
        : lines[0]?.taxTreatmentCode || 'STANDARD_19';

      // 1. TSE INTENTION — best-effort; failure logs a toast but doesn't block.
      //
      // ── 19.08.2026: der Vorgang ist meist SCHON offen ────────────────────
      //
      // Die Vorgangs-Uhr (lib/vorgangs-uhr.ts) hat die TSE-Transaktion beim
      // ERSTEN Stueck im Korb geoeffnet — zeitgerecht im Sinne von § 146a AO,
      // mit dem echten Vorgangsbeginn in <start-zeit> des QR. Hier wird sie
      // UEBERNOMMEN und nur noch FINISHed. Nur wenn keine offen ist (TSE war
      // beim Scannen aus, Web-Abholung, Wiederanlauf), oeffnet der Dialog wie
      // frueher selbst — der Beginn ist dann ehrlich spaeter.
      const offenerVorgangBeimBezahlen = vorgangUebernehmen();
      const vorgangBegonnenAm = offenerVorgangBeimBezahlen?.begonnenAm ?? null;
      vorgangBeginnRef.current = vorgangBegonnenAm;
      const intentionId = offenerVorgangBeimBezahlen?.intentionId ?? newIntentionId();
      const intentionRes: { intention: TseIntention } | { error: string } =
        offenerVorgangBeimBezahlen?.intention
          ? { intention: offenerVorgangBeimBezahlen.intention }
          : await openTseSession({
              config: hardwareCfg.tse,
              receiptLocator: null,
              intentionId,
              paymentKind,
            });

      const items = lines.map((line, idx) => {
        const math = harmonisiertePerLineMath[idx];
        if (!math) throw new Error('cart-math/lines length mismatch');
        const item: FinalizeLineItem = {
          productId: line.productId,
          reservationSessionId: line.reservationSessionId,
          lineSubtotalEur: fromCents(math.lineSubtotalCents),
          lineVatEur: fromCents(math.lineVatCents),
          lineTotalEur: fromCents(math.lineTotalCents),
          appliedTaxTreatmentCode:
            b2bActive && line.taxTreatmentCode === 'STANDARD_19'
              ? 'REVERSE_CHARGE_13B'
              : line.taxTreatmentCode,
          appliedVatRate: math.appliedVatRate,
          acquisitionCostEurSnapshot:
            math.acquisitionCostSnapshotCents !== null
              ? fromCents(math.acquisitionCostSnapshotCents)
              : null,
          marginEur: math.marginCents !== null ? fromCents(math.marginCents) : null,
          ...(math.lineDiscountCents > 0n
            ? {
                lineDiscountEur: fromCents(math.lineDiscountCents),
                lineDiscountReason: line.discountReason ?? 'Rabatt',
              }
            : {}),
          displayOrder: idx + 1,
        };
        return item;
      });

      // 2. Finalize on the API. The idempotency key is held in a ref so
      //    every retry path (step-up, network blip) sends the SAME value
      //    — server's partial UNIQUE INDEX dedupes (§19.2 C-4).
      const body: FinalizeBody = {
        direction: 'VERKAUF',
        customerId,
        subtotalEur: adjustedTotals.subtotalEur,
        // `vatEur` bleibt für die interne Aufzeichnung; GEDRUCKT wird
        // ausschliesslich `vatDisclosableEur`. Siehe beleg-steuerausweis.ts:
        // bei Differenzbesteuerung ist der gesonderte Ausweis verboten.
        vatEur: adjustedTotals.vatEur,
        ...(() => {
          const a = steuerausweisFuerBeleg(
            harmonisiertePerLineMath.map((m, i) => ({
              taxTreatmentCode: (m.appliedVatRate === null
                ? (lines[i]?.taxTreatmentCode ?? 'MARGIN_25A')
                : b2bActive && lines[i]?.taxTreatmentCode === 'STANDARD_19'
                  ? 'REVERSE_CHARGE_13B'
                  : (lines[i]?.taxTreatmentCode ?? 'STANDARD_19')) as never,
              lineVatCents: m.lineVatCents,
              appliedVatRate: m.appliedVatRate,
            })),
            viesBelegvermerk,
            betriebsmodus,
          );
          return {
            vatDisclosableEur:
              a.ausweisbareVatCents === null ? null : centsAlsBetrag(a.ausweisbareVatCents),
            specialSchemeNotices: a.hinweise,
          };
        })(),
        totalEur: adjustedTotals.totalEur,
        taxTreatmentCode: headTreatment,
        items,
        payments,
        idempotencyKey: idempotencyKeyRef.current,
        // 0118 — Zeit und Schicht des KASSIERENS, mit im gesiegelten Rumpf.
        // Beides ist optional im Schema, damit aeltere Kassen weiterlaufen;
        // fehlt die Schicht, faellt der Server auf die alte Suche zurueck.
        erfasstAm,
        // 19.08.2026: der WAHRE Vorgangsbeginn (erstes Stueck im Korb) aus
        // der Vorgangs-Uhr — § 6 Satz 1 Nr. 2 KassenSichV will Beginn UND
        // Ende. Fehlt er (Wiederanlauf, Web-Abholung), bleibt das Feld weg
        // und der Server nimmt ehrlich die Erfassungszeit.
        ...(vorgangBegonnenAm ? { vorgangBegonnenAm } : {}),
        ...(aktuelleSchicht?.id ? { shiftId: aktuelleSchicht.id } : {}),
        // Abholung: der Server finalisiert damit die web-gehaltenen Stücke und
        // knüpft den Warenkorb (CONVERTED + ABGEHOLT) im selben BEGIN an diesen
        // Beleg. Fehlt es, ist es ein normaler Kassenverkauf. Der Wert wird mit
        // dem gesiegelten Intent + Idempotency-Key mitgeschrieben, also trägt
        // auch ein offline nachgespielter Beleg die Bindung.
        ...(webOrderNumber ? { webOrderNumber } : {}),
      };
      // Phase 1.4: crystallize the intent to disk BEFORE the network call, so a
      // crash between here and the server leaves a recoverable pos_intents row —
      // the startup reconcile funnels it into the outbox on this SAME key (the
      // server's partial-UNIQUE dedups → no double-finalize). Best-effort: a
      // store-write failure must NEVER block the sale.
      try {
        await posIntentsStore.create({
          key: idempotencyKeyRef.current,
          intentType: 'sale',
          sealedRequestJson: JSON.stringify(
            sealFiscalRequest({
              baseUrl: api.baseUrl,
              path: '/api/transactions/finalize',
              body,
              idempotencyKey: idempotencyKeyRef.current,
              deviceId: resolveDeviceId(),
            }),
          ),
          createdAt: Date.now(),
        });
      } catch {
        /* best-effort — the sale proceeds even if the intent write fails */
      }
      const result = await transactionsApi.finalize(api, body);
      // The request reached the server — resolve the intent (no reconcile needed).
      try {
        await posIntentsStore.markResolved(idempotencyKeyRef.current, result);
      } catch {
        /* best-effort */
      }

      // 3. TSE FINISH — only if INTENTION succeeded. Capture the signature
      //    in a ref so the thermal-print step (W-7) can render the
      //    KassenSichV signature block on the paper receipt.
      lastTseSignatureRef.current = null;
      fiskalzustandRef.current = 'signiert';
      const totalCents = Number(toCents(adjustedTotals.totalEur));
      // DSFinV-K per-VAT gross breakdown for the signed body (§146a): group the
      // applied per-line treatments by USt-Schlüssel (same canonical mapping the
      // server's DSFinV-K export uses), so the signed receipt carries the real
      // decomposition instead of an empty amounts_per_vat_id.
      //
      // ⚠️ Steht seit dem 13.08.2026 VOR der Verzweigung, nicht darin: der
      // Ausfallzweig unten braucht dieselbe Aufteilung fuer seine Zeile, und
      // eine zweite Rechnung an anderer Stelle waere eine zweite Wahrheit.
      // Die Aufteilung kommt aus dem Memo oben — EINE Wahrheit, vor dem Geld
      // geprueft (der Bezahlen-Knopf ist gesperrt, solange ohneSatznamen
      // nicht leer ist).
      if ('intention' in intentionRes) {
        const finishRes: TseSessionResult = await closeTseSession({
          config: hardwareCfg.tse,
          intentionId,
          receiptLocator: result.receiptLocator,
          paymentKind,
          intention: intentionRes.intention,
          amountCents: totalCents,
          serverTransactionId: result.id,
          amountsPerVatRate: vatAufteilung.buckets,
        });
        if (finishRes.kind === 'signed') {
          const sig = finishRes.signature;
          lastTseSignatureRef.current = {
            signatureValue: sig.signatureValue,
            signatureCounter: String(sig.signatureCounter),
            transactionNumber: String(sig.transactionNumber),
            qrPayload: sig.qrCodePayload,
          };
          fiskalzustandRef.current = 'signiert';

          // GoBD / BSI TR-03153 — durably persist the TSE signature server-side,
          // linked to the transaction. Previously the signature lived ONLY on the
          // thermal receipt + the offline-queue localStorage; the fiscal record
          // was lost if the receipt or this workstation went away. This POST is
          // idempotent (one signature row per transaction) and best-effort: a
          // failure NEVER blocks the sale — the operator still gets a printed,
          // signed receipt, and the value survives in the offline queue.
          try {
            await transactionsApi.recordTseSignature(api, result.id, {
              fiskalyTssId: hardwareCfg.tse.tssId,
              fiskalyClientId: hardwareCfg.tse.clientId,
              fiskalyTransactionId: intentionRes.intention.fiskalyTransactionId,
              fiskalyTransactionNumber: String(sig.transactionNumber),
              signatureValue: sig.signatureValue,
              signatureCounter: String(sig.signatureCounter),
              signatureAlgorithm: sig.signatureAlgorithm,
              tssSerialNumber: sig.tssSerialNumber,
              signaturePublicKey: sig.signaturePublicKey,
              qrCodeData: sig.qrCodePayload,
              tseStartTime: sig.startedAt,
              tseEndTime: sig.finishedAt,
            });

            /*
             * ── DIE UHR DES GERAETS, EINMAL NACHGESEHEN (20.08.2026) ──────
             *
             * Der Bon und die Tageszuordnung folgen der GERAETEUHR, die
             * Signatur der Uhr des Signaturdienstes. Gehen die beiden
             * auseinander, stehen im Prueferpaket zwei verschiedene Zeiten
             * nebeneinander — und genau das faellt auf.
             *
             * Nur eine Meldung, kein Riegel: eine schiefe Uhr ist ein Grund
             * zum Stellen, nie ein Grund, einen bezahlten Verkauf zu
             * verweigern. Die Schwelle ist grob (zwei Minuten), damit die
             * Netzreise keinen Fehlalarm ausloest.
             */
            const uhr = pruefeUhr(sig.finishedAt);
            if (uhr?.auffaellig) {
              addToast({ tone: 'warn', title: 'Die Uhr dieser Kasse geht falsch', body: uhr.satz ?? '' }); // tse-zweig-frei: die Signatur liegt vor und ist gemeldet; gewarnt wird vor der schiefen Geraeteuhr, nicht vor einem Ausfall
            }
          } catch (err) {
            // Record-failed (path b): we HOLD the signature but the server POST
            // failed. Enqueue the SIGNED entry to the durable queue so the drain
            // re-POSTs it — never re-FINISH. Previously this was lost after the
            // toast; now it survives crash + sign-out.
            const queued = await enqueueSignatureRecordOnly({
              config: hardwareCfg.tse,
              intention: intentionRes.intention,
              serverTransactionId: result.id,
              amountCents: totalCents,
              paymentKind,
              amountsPerVatRate: vatAufteilung.buckets,
              receiptLocator: result.receiptLocator,
              signature: sig,
              error: err,
            });
            // Honest surface: if the durable queue write ALSO failed, the signature
            // survives only on the printed receipt — tell the operator to keep it.
            addToast({ tone: 'alert', ...meldungNachAusfall('melden', queued, 'Verkauf') });
            // eslint-disable-next-line no-console
            console.warn('recordTseSignature failed (non-blocking)', err);
          }
        } else {
          /**
           * ⚠️ 13.08.2026 — HIER STAND `else if (finishRes.kind === 'queued_offline')`
           * MIT DEM SATZ „Signatur wird später nachgereicht".
           *
           * Zwei Messungen dagegen:
           *
           *  1. `closeTseSession` faengt einen Fehlschlag SEINES eigenen
           *     Korbschreibers ab (`lib/tse-service.ts:135`) und meldet trotzdem
           *     `queued_offline`. Der Satz versprach dann eine Nachreichung, zu
           *     der keine Zeile existierte.
           *  2. `kind === 'unavailable'` traf gar keinen Zweig — kein Wort auf
           *     dem Schirm, kein Eintrag, nichts.
           *
           * Jetzt wird NACHGESEHEN statt geglaubt: liegt keine Zeile, schreibt
           * der Bezahlweg sie selbst. Der Vorgang ist eroeffnet, also traegt die
           * Zeile die echte Vorgangsnummer und ist voll nachreichbar
           * (Signatur NULL, Weg a des Nachreichers).
           */
          const gesichert = await ausfallSichern(
            {
              intentionId,
              fiskalyTransactionId: intentionRes.intention.fiskalyTransactionId,
              tssId: hardwareCfg.tse.tssId,
              clientId: hardwareCfg.tse.clientId,
              serverTransactionId: result.id,
              amountCents: totalCents,
              paymentKind,
              amountsPerVatRate: vatAufteilung.buckets,
              receiptType: 'RECEIPT',
              processType: 'Kassenbeleg-V1',
              receiptLocator: result.receiptLocator,
              signature: null,
              createdAt: Date.now(),
              lastError: finishRes.reason,
            },
            // Der Vorgang ist bei der Sicherungseinrichtung EROEFFNET — nur der
            // Abschluss kam nicht durch. Genau das ist nachreichbar, also geht
            // diese Zeile in die Warteschlange und der Satz darf es versprechen.
            'abschluss',
          );
          fiskalzustandRef.current = zustandAusAusfall('abschluss', gesichert);
          addToast({ tone: 'alert', ...meldungNachAusfall('abschluss', gesichert, 'Verkauf') });
        }
      } else if (grundOhneSignatur(hardwareCfg.tse.tssId) === 'keine_tse_hinterlegt') {
        /**
         * ⛔ 08.08.2026 — HIER STAND `else if (hardwareCfg.tse.tssId.length > 0)`.
         *
         * Der Hinweis hing daran, dass ÖRTLICH etwas eingetragen war. War das
         * Feld leer, gab es keinen Zweig und KEINEN Hinweis: der Verkauf wurde
         * gebucht, keine Zeile ging in die Warteschlange, der Beleg druckte
         * „TSE Ausfall" — und der Kassierer sah nichts.
         *
         * Leer kann es sein, ohne dass jemand etwas falsch macht: Zweitkasse,
         * geleerter Webview-Speicher, oder `validateSection` wirft das ganze
         * `tse`-Teilobjekt auf die Vorgabe zurück.
         *
         * ── ⚠️ 13.08.2026: DER WIDERSPRUCH, DEN DIESE STELLE MIT SICH TRUG ──
         *
         * Hier stand als Begründung, es werde BEWUSST keine Zeile geschrieben,
         * weil „der Nachreicher ewig ins Leere liefe und der Gerätemanager
         * dauerhaft rot stünde". Genau dieser Zustand war ab demselben Tag im
         * Zweig darunter eingebaut: der Eröffnungs-Ausfall schrieb eine Zeile,
         * die für immer auf „wartend" stand.
         *
         * ── DIE ENTSCHEIDUNG UND IHR WARUM ────────────────────────────────
         *
         * BEIDE Zweige halten den Ausfall fest, und KEINER von beiden stellt
         * ihn zum Nachreichen. Das ist der einzige Stand, der zweimal wahr ist:
         *
         *  1. FESTHALTEN IST PFLICHT. Ein Beleg ohne Signatur ist nach
         *     § 146a AO als Ausfall zu dokumentieren — und ob die
         *     Sicherungseinrichtung fehlt oder nur nicht antwortet, ändert
         *     daran nichts. Nichts zu schreiben hiess: der Vorgang war
         *     nirgends belegt ausser auf dem Papier in der Hand des Kunden.
         *
         *  2. NACHREICHEN IST UNMÖGLICH. Was die Sicherungseinrichtung nie
         *     gesehen hat, kann sie nicht rückwirkend signieren; eine später
         *     eröffnete Aufzeichnung trüge die Zeit von DANN, nicht die des
         *     Kassierens (`tse_start_transaction` setzt `Utc::now()`). Deshalb
         *     entsteht die Zeile direkt als dauerhafter Ausfall
         *     (`istNachreichbar` in `tse-queue-store.ts` ist die eine Stelle,
         *     die das entscheidet) — und der Nachreicher sieht sie nie.
         *
         * Der Gerätemanager steht damit auf „Störung" statt auf „wird
         * automatisch nachgereicht". Das ist lauter als vorher, aber es ist
         * die Wahrheit: diese Signaturen kommen nicht mehr.
         */
        const gesichert = await ausfallSichern(
          {
            intentionId,
            fiskalyTransactionId: OHNE_EROEFFNUNG,
            tssId: hardwareCfg.tse.tssId,
            clientId: hardwareCfg.tse.clientId,
            serverTransactionId: result.id,
            amountCents: totalCents,
            paymentKind,
            amountsPerVatRate: vatAufteilung.buckets,
            receiptType: 'RECEIPT',
            processType: 'Kassenbeleg-V1',
            receiptLocator: result.receiptLocator,
            signature: null,
            createdAt: Date.now(),
            lastError: intentionRes.error,
          },
          'keine_tse',
        );
        fiskalzustandRef.current = zustandAusAusfall('keine_tse', gesichert);
        /**
         * ── ⚠️ 15.08.2026: DIE ERMAHNUNG DER GNADENFRIST IST WEG ───────────
         *
         * Hier stand die vom Server gerechnete Staffel („Beleg 3 von 10"). Die
         * Gnadenfrist ist gestrichen: ohne eingerichtete Sicherungseinrichtung
         * weist der Motor jeden Verkauf ab, es entsteht gar kein Beleg mehr,
         * den man ermahnen könnte.
         *
         * ⚠️ Dieser Zweig bleibt trotzdem stehen, und das ist wichtig: er
         * greift beim AUSFALL einer eingerichteten TSE. Der ist erlaubt
         * (AEAO 1.14.3), der Beleg trägt „TSE-Ausfall", der Verkauf läuft
         * weiter. Wer ihn mit abräumt, hält den Laden bei jedem Netzwackler an.
         */
        addToast({
          tone: 'alert',
          // Der Wortlaut kommt aus der EINEN Quelle, die auch der Ankauf
          // benutzt — sonst lesen zwei Masken für denselben Zustand zwei
          // Erklärungen. Ging nicht einmal das örtliche Vermerken, sagt
          // der Satz stattdessen den Verlust an, und zwar gemessen.
          ...(gesichert
            ? hinweisOhneSignatur('keine_tse_hinterlegt', 'Verkauf')
            : meldungNachAusfall('keine_tse', gesichert, 'Verkauf')),
        });
      } else {
        /**
         * ⛔ DER SCHWERSTE BEFUND VOM 13.08.2026 — DIE STILLE LUECKE.
         *
         * Faellt das Netz aus, scheitert schon der ERSTE TSE-Schritt: die
         * Eroeffnung (`openTseSession`, oben). Beide Schreiber der
         * Nachreiche-Warteschlange haengen aber am Abschluss
         * (`tse-service.ts:119`) und am Melden (`tse-service.ts:170`) — also
         * entstand hier NIRGENDS eine Zeile, waehrend der Kassierer las, die
         * Signatur werde nachgeholt. Sie wurde nie nachgeholt: ein verlorener
         * fiskalischer Datensatz UND eine Luege auf dem Bildschirm.
         *
         * Jetzt wird der Ausfall dauerhaft festgehalten. Die Vorgangsnummer
         * bleibt leer (`OHNE_EROEFFNUNG`), weil es keine gibt — Naeheres dort.
         * Der Satz verspricht dafuer auch keine Nachreichung: was die
         * Sicherungseinrichtung nie gesehen hat, kann sie nicht nachtraeglich
         * signieren. Der Haendler sieht den vermerkten Ausfall im
         * Geraetemanager, und wenn nicht einmal das gelang, sagt der Satz es.
         *
         * ⚠️ NACHGEMESSEN: die Zeile stand hier zuerst auf „wartend". Der
         * Nachreicher waehlte sie, schickte einen Abschluss OHNE Vorgangsnummer
         * an die Bruecke, deren Ablehnung (`{kind, details}`) niemand als
         * endgueltig erkannte — und sie fiel zurueck auf „wartend", fuer immer.
         * Der Geraetemanager versprach solange „werden automatisch
         * nachgereicht". Deshalb steht hier `'eroeffnung'`: dieser Schritt ist
         * NICHT nachreichbar, die Zeile entsteht sofort als dauerhafter Ausfall
         * und wird nie zum Nachreichen ausgewaehlt.
         */
        const gesichert = await ausfallSichern(
          {
            intentionId,
            fiskalyTransactionId: OHNE_EROEFFNUNG,
            tssId: hardwareCfg.tse.tssId,
            clientId: hardwareCfg.tse.clientId,
            serverTransactionId: result.id,
            amountCents: totalCents,
            paymentKind,
            amountsPerVatRate: vatAufteilung.buckets,
            receiptType: 'RECEIPT',
            processType: 'Kassenbeleg-V1',
            receiptLocator: result.receiptLocator,
            signature: null,
            createdAt: Date.now(),
            lastError: intentionRes.error,
          },
          'eroeffnung',
        );
        fiskalzustandRef.current = zustandAusAusfall('eroeffnung', gesichert);
        addToast({ tone: 'alert', ...meldungNachAusfall('eroeffnung', gesichert, 'Verkauf') });
      }
      return result;
    },
    [
      addToast,
      api,
      hardwareCfg.tse,
      lines,
      adjustedTotals,
      b2bActive,
      harmonisiertePerLineMath,
      webOrderNumber,
      aktuelleSchicht?.id,
      // Ohne diese Abhaengigkeit haelt der Abschluss den Vermerk von VORHER
      // fest — also den einer anderen Nummer, oder gar keinen.
      viesBelegvermerk,
    ],
  );

  /**
   * §19.3 W-7 — fire-and-forget thermal print after a successful
   * finalize. The print happens AFTER `setFinalized(result)` so the UI
   * doesn't wait on paper — any failure surfaces as a toast and the
   * operator can re-print from a future Belege screen.
   *
   * Skipped silently when:
   *   • thermal printer IP is unset (operator hasn't configured it)
   *   • running outside Tauri (e.g. Vitest)
   */
  /**
   * Der Vorgangsbeginn des ZULETZT abgeschlossenen Verkaufs — von
   * finalizeWithTse gesetzt, vom Bon-Bau gelesen. Ein Ref wie
   * lastTseSignatureRef daneben: beide gehoeren zum selben Beleg.
   */
  const vorgangBeginnRef = useRef<string | null>(null);

  const buildReceiptData = useCallback(
    (
      result: FinalizeResponse,
      payments: NonNullable<FinalizeBody['payments']>,
    ): ThermalReceiptData => {
      const tse = lastTseSignatureRef.current;
      const cashPayment = payments.find((p) => p.paymentMethod === 'CASH');
      const cardPayment = payments.find((p) => p.paymentMethod === 'ZVT_CARD');
      const stripePayment = payments.find((p) => p.paymentMethod === 'STRIPE_TERMINAL');
      const voucherPayment = payments.find((p) => p.paymentMethod === 'VOUCHER');
      const labelParts: string[] = [];
      if (cashPayment) labelParts.push('Bar');
      if (cardPayment) labelParts.push(`Karte ${cardPayment.zvtCardBrand ?? ''}`.trim());
      // Exakt das i18n-Wort der Zahlart — der Beleg nennt den Weg beim Namen.
      if (stripePayment) labelParts.push(PAYMENT_METHOD_LABEL.STRIPE_TERMINAL);
      if (voucherPayment) labelParts.push('Gutschein');
      const paymentLabel = labelParts.join(' + ') || 'Zahlung';

      const activeTaxCodes = Array.from(
        new Set(
          lines.map((line) =>
            b2bActive && line.taxTreatmentCode === 'STANDARD_19'
              ? 'REVERSE_CHARGE_13B'
              : line.taxTreatmentCode,
          ),
        ),
      );

      /*
       * ⚠️ 20.08.2026: die Hinweise nannten „19 %" als FESTEN Text. Seit die
       * Sätze am Tag hängen, hätte auf demselben Zettel eine Steuer von 16
       * Prozent und ein Rechtshinweis mit 19 gestanden. § 14 Abs. 4 UStG
       * verlangt den zutreffenden Satz. Die Prozentzahl wird jetzt aus dem
       * Geschäftstag gerechnet (`steuertexte.ts`).
       */
      const legalFooters = steuerhinweiseFuerBeleg(activeTaxCodes, alsTag(new Date()));

      // Shop identity: Owner-editable via GET /api/shop-info (system_settings,
      // migration 0044), with the bundled SHOP_INFO constant as the fallback.
      const shop = resolveShopInfo(shopApi);
      const data: ThermalReceiptData = {
        shopName: shop.name,
        shopAddress: [shop.tagline, ...shop.address].filter((l) => l.trim().length > 0),
        shopVatId: shop.vatId,
        shopTaxNumber: shop.taxNumber,
        shopPhone: shop.phone,
        receiptLocator: result.receiptLocator,
        printedAt: new Date(result.finalizedAt).toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
        }),
        // § 6 Nr. 2: der Vorgangsbeginn aus der Vorgangs-Uhr, gleich
        // formatiert. Sichtbar wird er nur auf dem Ausfall-Bon; auf dem
        // gesunden traegt ihn der QR (die TSE kennt ihn seit dem START beim
        // ersten Stueck).
        ...(vorgangBeginnRef.current
          ? {
              vorgangBeginn: new Date(vorgangBeginnRef.current).toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin',
              }),
            }
          : {}),
        // The customer receipt must not carry machine text: a UUID slice
        // ("Bediener 5f3a2c") is a raw id fragment, not a name (doctrine a), and
        // SessionActor exposes no display name. Show the honest role instead; the
        // real per-operator identity lives in the server-side fiscal ledger
        // (actorUserId). Named operators on the receipt would need the server to
        // expose the user's name — a separate enhancement.
        cashierName: sessionActor?.isOwner ? 'Inhaber' : 'Bediener',
        shiftId: null,
        items: lines.map((line, idx) => {
          const math = harmonisiertePerLineMath[idx];
          const discountSuffix =
            math && math.lineDiscountCents > 0n
              ? ` (Rabatt −${fromCents(math.lineDiscountCents)} €)`
              : '';
          return {
            name: `${line.name}${discountSuffix}`,
            quantity: 1,
            unitPriceEur: dezimalAlsDeutsch(math ? fromCents(math.lineTotalCents) : line.listPriceEur),
            lineTotalEur: dezimalAlsDeutsch(math ? fromCents(math.lineTotalCents) : line.listPriceEur),
            vatLabel: math
              ? math.appliedVatRate !== null
                ? `${Math.round(Number(math.appliedVatRate) * 100)}%`
                : ''
              : '',
          };
        }),
        subtotalEur: dezimalAlsDeutsch(adjustedTotals.subtotalEur),
        // `vatEur` bleibt für die interne Aufzeichnung; GEDRUCKT wird
        // ausschliesslich `vatDisclosableEur`. Siehe beleg-steuerausweis.ts:
        // bei Differenzbesteuerung ist der gesonderte Ausweis verboten.
        vatEur: dezimalAlsDeutsch(adjustedTotals.vatEur),
        ...(() => {
          const a = steuerausweisFuerBeleg(
            harmonisiertePerLineMath.map((m, i) => ({
              taxTreatmentCode: (m.appliedVatRate === null
                ? (lines[i]?.taxTreatmentCode ?? 'MARGIN_25A')
                : b2bActive && lines[i]?.taxTreatmentCode === 'STANDARD_19'
                  ? 'REVERSE_CHARGE_13B'
                  : (lines[i]?.taxTreatmentCode ?? 'STANDARD_19')) as never,
              lineVatCents: m.lineVatCents,
              appliedVatRate: m.appliedVatRate,
            })),
            viesBelegvermerk,
            betriebsmodus,
          );
          return {
            vatDisclosableEur:
              a.ausweisbareVatCents === null ? null : dezimalAlsDeutsch(centsAlsBetrag(a.ausweisbareVatCents)),
            specialSchemeNotices: a.hinweise,
          };
        })(),
        totalEur: dezimalAlsDeutsch(adjustedTotals.totalEur),
        paymentMethodLabel: paymentLabel,
        cashReceivedEur: cashPayment ? dezimalAlsDeutsch(cashReceivedEur || cashPayment.amountEur) : null,
        changeEur: cashPayment && cashReceivedEur ? dezimalAlsDeutsch(fromCents(changeCentsForPrint())) : null,
        tseSignatureValue: tse?.signatureValue ?? 'TSE Ausfall',
        tseSignatureCounter: tse?.signatureCounter ?? 'TSE Ausfall',
        tseTransactionNumber: tse?.transactionNumber ?? 'TSE Ausfall',
        tseQrPayload: tse?.qrPayload ?? 'TSE Ausfall',
        fiskalzustand: fiskalzustandRef.current,
        footerLines: [
          ...(voucherPayment ? [`Gutschein eingelöst: −${voucherPayment.amountEur} €`] : []),
          ...(customFooter && customFooter.length > 0
            ? customFooter
            : ['Vielen Dank für Ihren Besuch.', 'Beleg auf Wunsch elektronisch.']),
          ...legalFooters,
        ],
      };
      // Remember it so the operator can re-print after closing the preview.
      setLastReceipt(data);
      return data;
    },
    [
      cashReceivedEur,
      lines,
      harmonisiertePerLineMath,
      adjustedTotals,
      b2bActive,
      sessionActor,
      shopApi,
      customFooter,
      dueCents,
      setLastReceipt,
      viesBelegvermerk,
    ],
  );

  /** Whether a thermal print can actually be attempted right now. USB mode is
   *  ready once a printer queue is picked; network mode needs an IP. */
  const canPrint =
    isRunningInTauri() &&
    (hardwareCfg.thermal.mode === 'usb'
      ? hardwareCfg.thermal.printerName.length > 0
      : hardwareCfg.thermal.ip.length > 0);

  // Phase 7.2 — a receipt must NEVER print a fake or blank USt-IdNr. (GoBD/§14
  // UStG). If the shop VAT id isn't configured server-side, HARD-LOCK the print
  // with an honest reason pointing the operator to the settings.
  const receiptLockReason = isReceiptShopValid(resolveShopInfo(shopApi))
    ? null
    : RECEIPT_VAT_LOCK_REASON;

  /**
   * Send an already-built receipt to the thermal printer. Called from the
   * preview's "Drucken" button. On success the preview closes; on failure a
   * toast surfaces and the operator can retry or hand over a digital copy.
   */
  const printReceipt = useCallback(
    async (data: ThermalReceiptData): Promise<void> => {
      if (!canPrint) {
        addToast({
          tone: 'info',
          title: 'Kein Drucker',
          body: 'Beleg nur als Vorschau. Drucker unter „Geräte" einrichten.',
        });
        return;
      }
      setPrinting(true);
      try {
        // USB mode → raw ESC/POS to the OS queue (no IP); network → ip:port.
        const endpoint =
          hardwareCfg.thermal.mode === 'usb'
            ? { ip: '', port: 9100, printerName: hardwareCfg.thermal.printerName }
            : { ip: hardwareCfg.thermal.ip, port: hardwareCfg.thermal.port };
        await thermalClient.print(endpoint, data);
        // FUND (26.07.2026): Der Ausgang dieses Drucks wurde nirgends
        // festgehalten. Rutschte um 11:00 das Kabel heraus, blieb der
        // Geraetepunkt bis zum Feierabend gruen — obwohl die Kasse es zehnmal
        // schwarz auf weiss erlebt hatte. Beide Druckstellen melden jetzt ueber
        // DENSELBEN Weg, was sie gemessen haben.
        notePrintOutcome('thermal', null);
        setPreviewData(null);
      } catch (err) {
        notePrintOutcome('thermal', err);
        addToast({
          tone: 'alert',
          title: 'Druck fehlgeschlagen',
          body: isHardwareError(err)
            ? describeHardwareError(err)
            : 'Drucker prüfen. Beleg digital ausgegeben.',
        });
      } finally {
        setPrinting(false);
      }
    },
    [
      addToast,
      canPrint,
      hardwareCfg.thermal.mode,
      hardwareCfg.thermal.printerName,
      hardwareCfg.thermal.ip,
      hardwareCfg.thermal.port,
    ],
  );

  /** Helper for the print path — change is cash minus the post-voucher due. */
  function changeCentsForPrint(): bigint {
    try {
      const cash = centsAusEingabe(cashReceivedEur) ?? 0n;
      return cash >= dueCents ? cash - dueCents : 0n;
    } catch {
      return 0n;
    }
  }

  /**
   * ⛔ DER GUTSCHEIN-RIEGEL — VOR JEDEM Abschlussweg.
   *
   * Befund vom 12.08.2026: fiel das Netz aus, während ein Gutschein angewandt
   * war, ging der Beleg samt VOUCHER-Bein in den Ausgangskorb und die Fläche
   * versprach, der Gutschein werde „beim Synchronisieren verbucht". Nichts
   * bucht ihn: der Abzug geschieht NUR in der redeem-Route, und die braucht
   * eine Vorgangskennung, die es offline nicht gibt. Der Kunde zahlte mit dem
   * Gutschein, das Guthaben blieb voll — Geldverlust in Gutscheinhöhe.
   *
   * Die Regel steht in `lib/gutschein-braucht-netz.ts` und wird HIER an genau
   * einer Stelle gerufen, damit kein Weg sie umgehen kann. Vier Wege führen
   * zum Abschluss (bar, geteilt, Karte, Leser); ein Riegel je Weg wäre die
   * Hausklasse „der halbe Fix an derselben Ampel".
   *
   * Gibt `true` zurück, wenn abgeschlossen werden darf.
   */
  const gutscheinRiegelHaelt = useCallback((): boolean => {
    const urteil = pruefeGutscheinBrauchtNetz({
      gutscheinAngewandt: appliedVoucher !== null,
      gutscheinCents: tender.appliedVoucherCents,
      amNetz: amNetz(),
    });
    if (!urteil.erlaubt) {
      setError(urteil.satz);
      addToast({ tone: 'alert', title: 'Gutschein braucht Verbindung', body: urteil.satz });
      return false;
    }
    return true;
  }, [appliedVoucher, tender.appliedVoucherCents, addToast]);

  /**
   * CASH path — runs the TSE sandwich + invalidates dependent queries.
   *
   * §19.3 W-1 mutex: `inFlightRef.current` is read+set SYNCHRONOUSLY.
   * A double-click that fires before React commits the `setSubmitting`
   * state would re-enter this callback; the ref guard catches it
   * before any side-effect runs.
   */
  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!canSubmit) return;
    if (!gutscheinRiegelHaelt()) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Resolve the B2B/§10 customer BEFORE the fiscal sandwich — a lookup throw
      // here aborts cleanly (cash, no charge yet).
      const resolvedCustomerId = await resolveB2bCustomerId();
      // Voucher leg (if any) first, then the cash remainder — Σ = total.
      const payments: FinalizeBody['payments'] = [];
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        payments.push({
          paymentMethod: 'VOUCHER',
          amountEur: fromCents(tender.appliedVoucherCents),
          externalRef: appliedVoucher.code,
        });
      }
      if (tender.dueCents > 0n) {
        payments.push({ paymentMethod: 'CASH', amountEur: fromCents(tender.dueCents) });
      }
      const result = await finalizeWithTse(
        payments,
        tender.dueCents > 0n ? 'CASH' : 'NON_CASH',
        resolvedCustomerId,
      );
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Beleg ausgegeben',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });
      // Redeem the voucher against the now-finalized transaction (decrements its
      // balance). A failure here doesn't undo the sale — surface it for manual fix.
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        try {
          await api.request(
            'POST',
            `/api/vouchers/${encodeURIComponent(appliedVoucher.code)}/redeem`,
            {
              transactionId: result.id,
              amountEur: fromCents(tender.appliedVoucherCents),
            },
          );
        } catch {
          addToast({
            tone: 'alert',
            title: 'Gutschein-Verbuchung',
            body: 'Beleg ausgegeben, aber der Gutschein konnte nicht verbucht werden. Bitte manuell prüfen.',
          });
        }
      }
      // §19.3 W-7 — pop the receipt preview; the operator confirms the print.
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (istSicherEingereiht(err)) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });

        const payments: FinalizeBody['payments'] = [];
        if (appliedVoucher && tender.appliedVoucherCents > 0n) {
          payments.push({
            paymentMethod: 'VOUCHER',
            amountEur: fromCents(tender.appliedVoucherCents),
            externalRef: appliedVoucher.code,
          });
          // Offline: the voucher can't be redeemed now (no transaction id yet).
          addToast({
            tone: 'alert',
            title: 'Gutschein offline',
            body:
              'Der Beleg wird nachgereicht, sobald die Verbindung steht. Ein Gutschein war nicht dabei: ohne Netz nimmt die Kasse keinen an.',
          });
        }
        if (tender.dueCents > 0n) {
          payments.push({ paymentMethod: 'CASH', amountEur: fromCents(tender.dueCents) });
        }
        setPreviewData(buildReceiptData(dummyResult, payments));

        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // § 10 GwG — if the server refused for a missing buyer ID, drive the
        // operator straight to the KaeuferPicker instead of a dead error.
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(formatPaymentError(err));
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    canSubmit,
    finalizeWithTse,
    resolveB2bCustomerId,
    trockenlauf,
    buildReceiptData,
    qc,
    api,
    appliedVoucher,
    tender,
    adjustedTotals.totalEur,
  ]);

  /**
   * CARD (ZVT) path — opens spinner, authorises on the terminal, then
   * runs the same TSE sandwich + finalize.
   *
   * §19.3 W-1/W-2 mutex: `inFlightRef.current` is the FIRST line of
   * defence against a double-click. The original guard
   * (`lines.length === 0 || submitting || finalized !== null`) reads
   * stale state from the React closure — by the time it runs, a fast
   * second click MAY have already passed the same check. The ref is
   * synchronous and immediately visible to the second invocation.
   *
   * Without this guard, a double-click on "Karte autorisieren" runs
   * `zvtClient.authorize` TWICE → customer's card is debited twice.
   */
  const submitCard = useCallback(async () => {
    if (inFlightRef.current) return;
    if (lines.length === 0 || finalized !== null) return;
    if (!hardwareCfg.zvt.ip) {
      addToast({
        tone: 'alert',
        title: 'Terminal nicht konfiguriert',
        body: 'Bitte IP-Adresse unter Einstellungen → Hardware setzen.',
      });
      return;
    }
    if (!gutscheinRiegelHaelt()) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    // Resolve the B2B/§10 customer BEFORE touching the terminal — a lookup throw
    // must NOT happen after the card is charged. Cached in a ref, so the
    // finalize-retry branch below reuses it without re-resolving.
    let resolvedCustomerId: string | null;
    try {
      resolvedCustomerId = await resolveB2bCustomerId();
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
      inFlightRef.current = false;
      return;
    }

    // ⚠️ DER TROCKENLAUF, VOR JEDER BELASTUNG.
    //
    // Am 26.07.2026 gemessen: die Autorisierung lag VOR dem finalize. Wurde der
    // Vorgang danach abgelehnt — § 13b, § 10 GwG, § 259 StGB oder ein
    // Rechenfehler — war die Karte belastet, jeder Wiederholversuch scheiterte
    // identisch, und die Kassiererin hatte keinen Ausweg.
    //
    // Derselbe Weg, dieselben Riegel, nur ohne Schreiben. Nur wenn er zusagt,
    // wird das Terminal ueberhaupt angefasst.
    //
    // Scheitert der Trockenlauf am NETZ statt an einem Riegel, wird trotzdem
    // abgebrochen: eine Belastung ohne die Gewissheit, sie auch buchen zu
    // koennen, ist genau der Zustand, den das hier beendet.
    if (!pendingAuthRef.current) {
      try {
        await trockenlauf(resolvedCustomerId);
      } catch (err) {
        setError(describeError(err));
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }
    }

    // §19.3 C-3 — if a PRIOR authorization succeeded but its finalize failed,
    // REUSE that authorization. Re-authorizing here would debit the card a
    // second time. We only touch the terminal when there's no pending auth.
    let zvt: ZvtResult;
    if (pendingAuthRef.current) {
      zvt = pendingAuthRef.current;
    } else {
      setZvtBusy(true);
      try {
        const totalCents = Number(toCents(adjustedTotals.totalEur));
        zvt = await zvtClient.authorize(
          { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
          totalCents,
        );
      } catch (err) {
        setError(
          isHardwareError(err) ? describeHardwareError(err) : 'Karten-Terminal nicht erreichbar.',
        );
        // No charge happened — release the mutex + UI flags so the operator
        // can re-attempt (this WILL re-authorize, which is correct here).
        setZvtBusy(false);
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      } finally {
        setZvtBusy(false);
      }

      if (!zvt.success) {
        setError(zvt.errorMessage ?? 'Karte wurde abgelehnt.');
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }

      // Authorization captured — from here on, the card IS charged. Stash it
      // so any finalize failure retries finalize-only, never re-authorizes.
      pendingAuthRef.current = zvt;
    }

    try {
      const payments: FinalizeBody['payments'] = [
        {
          paymentMethod: 'ZVT_CARD' as PaymentMethod,
          amountEur: adjustedTotals.totalEur,
          ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
          ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
          ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
        },
      ];
      const result = await finalizeWithTse(payments, 'NON_CASH', resolvedCustomerId);
      // Finalize succeeded — the authorization is consumed; clear it so a fresh
      // sale can't accidentally replay this card charge.
      pendingAuthRef.current = null;
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Karte autorisiert · Beleg ausgegeben',
        body: `Auth ${zvt.authorizationCode ?? '-'}`,
      });
      // §19.3 W-7 — pop the receipt preview; the operator confirms the print.
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (istSicherEingereiht(err)) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        // §19.3 C-3 — card AUTHORIZED + finalize QUEUED offline. The sale is
        // safely captured for replay (GoBD §146); telling the cashier to Storno
        // would wrongly reverse a booked charge. Advance to the receipt phase.
        pendingAuthRef.current = null;
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Karte autorisiert · offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });
        const payments: FinalizeBody['payments'] = [
          {
            paymentMethod: 'ZVT_CARD' as PaymentMethod,
            amountEur: adjustedTotals.totalEur,
            ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
            ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
            ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
          },
        ];
        setPreviewData(buildReceiptData(dummyResult, payments));
        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // §19.3 C-3 — the card was already charged but finalize failed for a
        // genuine reason (validation, reservation, step-up cancel). We KEEP
        // `pendingAuthRef` so the next "Karte autorisieren" click retries the
        // finalize against the SAME authorization instead of charging again.
        //
        // § 10 GwG — if it failed for a missing buyer ID, open the KaeuferPicker
        // so the operator can attach + verify a buyer; the retry then finalizes
        // against the same authorization (no second charge).
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(
          `Buchung fehlgeschlagen NACH Karten-Autorisierung. Bitte erneut „Karte autorisieren". Die Zahlung wird ohne erneute Belastung gebucht. Details: ${formatPaymentError(err)}`,
        );
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    finalized,
    finalizeWithTse,
    resolveB2bCustomerId,
    trockenlauf,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    adjustedTotals.totalEur,
    buildReceiptData,
  ]);

  /**
   * SPLIT path (Phase C1) — cash + card in ONE sale.
   *
   * The operator entered a PARTIAL cash leg; the remainder is authorized on the
   * card terminal and BOTH legs are posted on the same finalize (Σ legs ===
   * total, server-validated). This reuses `submitCard`'s double-charge guard:
   *   • `inFlightRef` mutex — a double-click can never run two authorizations.
   *   • `pendingAuthRef` — a SUCCESSFUL card auth whose finalize then failed is
   *     stashed; a retry finalizes against the SAME auth (no second charge).
   *
   * The card leg is authorized for EXACTLY `split.cardCents` — not the gross
   * total — so the cardholder is debited only the remainder.
   */
  const submitSplit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (lines.length === 0 || finalized !== null) return;
    if (!split.valid) return;
    if (!hardwareCfg.zvt.ip) {
      addToast({
        tone: 'alert',
        title: 'Terminal nicht konfiguriert',
        body: 'Kartenanteil benötigt ein Terminal. Bitte unter Einstellungen, Hardware einrichten.',
      });
      return;
    }
    if (!gutscheinRiegelHaelt()) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    // Resolve the B2B/§10 customer BEFORE touching the terminal — a lookup throw
    // must NOT happen after the card is charged.
    let resolvedCustomerId: string | null;
    try {
      resolvedCustomerId = await resolveB2bCustomerId();
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
      inFlightRef.current = false;
      return;
    }

    // §19.3 C-3 — reuse a prior successful authorization; never re-authorize.
    let zvt: ZvtResult;
    if (pendingAuthRef.current) {
      zvt = pendingAuthRef.current;
    } else {
      setZvtBusy(true);
      try {
        zvt = await zvtClient.authorize(
          { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
          Number(split.cardCents),
        );
      } catch (err) {
        setError(
          isHardwareError(err) ? describeHardwareError(err) : 'Karten-Terminal nicht erreichbar.',
        );
        setZvtBusy(false);
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      } finally {
        setZvtBusy(false);
      }
      if (!zvt.success) {
        setError(zvt.errorMessage ?? 'Karte wurde abgelehnt.');
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }
      pendingAuthRef.current = zvt;
    }

    // Build the legs: VOUCHER (if any) + CASH (the partial) + ZVT_CARD (remainder).
    // The split math runs on the POST-voucher due, so voucher + cash + card === total.
    const buildSplitPayments = (): FinalizeBody['payments'] => {
      const payments: FinalizeBody['payments'] = [];
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        payments.push({
          paymentMethod: 'VOUCHER',
          amountEur: fromCents(tender.appliedVoucherCents),
          externalRef: appliedVoucher.code,
        });
      }
      payments.push({ paymentMethod: 'CASH', amountEur: fromCents(split.cashCents) });
      payments.push({
        paymentMethod: 'ZVT_CARD' as PaymentMethod,
        amountEur: fromCents(split.cardCents),
        ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
        ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
        ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
      });
      return payments;
    };

    try {
      const payments = buildSplitPayments();
      const result = await finalizeWithTse(payments, 'NON_CASH', resolvedCustomerId);
      pendingAuthRef.current = null;
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Bar + Karte · Beleg ausgegeben',
        body: `Bar ${fromCents(split.cashCents)} € · Karte ${fromCents(split.cardCents)} €`,
      });
      // Redeem the voucher against the finalized transaction (decrements balance).
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        try {
          await api.request(
            'POST',
            `/api/vouchers/${encodeURIComponent(appliedVoucher.code)}/redeem`,
            {
              transactionId: result.id,
              amountEur: fromCents(tender.appliedVoucherCents),
            },
          );
        } catch {
          addToast({
            tone: 'alert',
            title: 'Gutschein-Verbuchung',
            body: 'Beleg ausgegeben, aber der Gutschein konnte nicht verbucht werden. Bitte manuell prüfen.',
          });
        }
      }
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (istSicherEingereiht(err)) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        // Card AUTHORIZED + finalize QUEUED offline — the sale is safely captured
        // for replay (GoBD §146). Advance to the receipt phase; a Storno would
        // wrongly reverse a booked charge.
        pendingAuthRef.current = null;
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Bar + Karte · offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });
        if (appliedVoucher && tender.appliedVoucherCents > 0n) {
          addToast({
            tone: 'alert',
            title: 'Gutschein offline',
            body:
              'Der Beleg wird nachgereicht, sobald die Verbindung steht. Ein Gutschein war nicht dabei: ohne Netz nimmt die Kasse keinen an.',
          });
        }
        setPreviewData(buildReceiptData(dummyResult, buildSplitPayments()));
        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // §19.3 C-3 — card already charged but finalize failed. KEEP pendingAuthRef
        // so a retry finalizes against the SAME auth (no second charge).
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(
          `Buchung fehlgeschlagen NACH Karten-Autorisierung. Bitte erneut bestätigen. Die Zahlung wird ohne erneute Belastung gebucht. Details: ${formatPaymentError(err)}`,
        );
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    appliedVoucher,
    tender,
    split,
    finalized,
    finalizeWithTse,
    resolveB2bCustomerId,
    trockenlauf,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    adjustedTotals.totalEur,
    buildReceiptData,
  ]);

  /**
   * DIE EINE GESTE am Stripe-Leser: Betrag und Posten kommen aus dem
   * Warenkorb, niemand tippt eine Summe ab. Reihenfolge (Basels
   * Doppelbelastungs-Albtraum verbietet jede andere):
   *
   *   a) TROCKENLAUF (`dryRun: true`) — fällt er durch, erscheint der echte
   *      Grund und KEINE Karte wird belastet;
   *   b) STARTEN — der Server schickt die ECHTEN Warenkorbzeilen auf den
   *      Kundenschirm des Lesers und stößt die Sammlung an;
   *   c) STAND im ruhigen Takt, bis er nicht mehr PROCESSING ist;
   *   d) ERFOLG → finalize mit `STRIPE_TERMINAL` und der Intent-Kennung als
   *      externe Referenz → der bestehende Siegel-Moment;
   *   e) Abbrechen jederzeit über `stripeAbbrechen` (die Schleife sieht dann
   *      CANCELED vom Server und endet ehrlich).
   *
   * Doppelbelastungs-Riegel, dreifach:
   *   • `inFlightRef` — kein zweiter Lauf durch Doppelklick;
   *   • `stripeStartKeyRef` — dieselbe Gesten-Kennung setzt bei einem
   *     Netz-Wackler DENSELBEN Vorgang fort, nie einen zweiten;
   *   • `stripeErfolgRef` — nach erfolgreicher Belastung wird NUR noch
   *     gebucht, nie erneut gesammelt (Spiegel von `pendingAuthRef`).
   */
  const submitStripe = useCallback(async () => {
    if (inFlightRef.current) return;
    if (lines.length === 0 || finalized !== null) return;
    const leser = waehleLeser(stripeLeser);
    if (!leser) {
      // Sollte nie erscheinen (ohne Leser zeigt der Wähler die Zahlart nicht),
      // aber der Wettlauf Abmeldung-gegen-Klick wird ehrlich benannt.
      setError('Kein registrierter Stripe-Leser gefunden. Bitte im Gerätemanager prüfen.');
      return;
    }
    if (!gutscheinRiegelHaelt()) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    // Kunde VOR jeder Belastung auflösen — ein Wurf hier bricht sauber ab.
    let resolvedCustomerId: string | null;
    try {
      resolvedCustomerId = await resolveB2bCustomerId();
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
      inFlightRef.current = false;
      return;
    }

    // Die Zahlungszeile des Vorgangs — Trockenlauf und echter Aufruf tragen
    // dieselbe Zahlart, damit der GwG-Riegel (bar 2.000 / unbar 15.000) im
    // Trockenlauf GENAU das prüft, was der echte Aufruf danach trifft.
    const stripeZahlarten = (referenz: string | null): FinalizeBody['payments'] => [
      {
        paymentMethod: 'STRIPE_TERMINAL' as PaymentMethod,
        amountEur: adjustedTotals.totalEur,
        ...(referenz ? { externalRef: referenz } : {}),
      },
    ];

    let erfolg = stripeErfolgRef.current;

    if (!erfolg) {
      // a) TROCKENLAUF — vor jeder Belastung. Scheitert er (auch am Netz),
      // wird abgebrochen, BEVOR der Leser überhaupt angefasst wird.
      setStripeSchritt({ art: 'TROCKENLAUF' });
      try {
        await trockenlauf(resolvedCustomerId, stripeZahlarten(null));
      } catch (err) {
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(formatPaymentError(err));
        setStripeSchritt({ art: 'RUHT' });
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }

      // b) STARTEN — die echten Zeilen auf den Kundenschirm des Lesers.
      const positionen = terminalPositionen(
        lines.map((line, idx) => ({
          name: line.name,
          lineTotalCents: harmonisiertePerLineMath[idx]?.lineTotalCents ?? 0n,
        })),
      );
      const amountCents = Number(totalCents);
      const steuerCents = Number(toCents(adjustedTotals.vatEur));
      if (!positionenDeckenBetrag(positionen, amountCents)) {
        // Der Leser ist das Kundendisplay: er zeigt nur Zeilen, die aufgehen.
        // Lieber ehrlich ablehnen als dem Kunden eine falsche Rechnung zeigen.
        setError(
          'Die Positionen ergeben den Betrag nicht exakt. Der Vorgang wurde nicht gestartet, bitte die Karte neu aufbauen.',
        );
        setStripeSchritt({ art: 'RUHT' });
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }
      setStripeSchritt({ art: 'STARTEN' });
      if (!stripeStartKeyRef.current) stripeStartKeyRef.current = newIntentionId();
      let view: TerminalZahlungView;
      try {
        view = await stripeTerminalApi.zahlungStarten(api, {
          readerId: leser.id,
          amountCents,
          steuerCents,
          positionen,
          idempotencyKey: stripeStartKeyRef.current,
        });
      } catch (err) {
        // Nichts belastet. Der Gesten-Schlüssel bleibt stehen: ein erneuter
        // Versuch setzt DENSELBEN Vorgang fort, eröffnet nie einen zweiten.
        setError(beschreibeStartFehler(err));
        setStripeSchritt({ art: 'RUHT' });
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }
      setStripeZahlungId(view.zahlungId);

      // Der Start kann schon die Antwort tragen (z. B. Leser offline).
      let deutung = deuteStand({
        status: view.status,
        fehlerbild: view.fehlerbild,
        fehlerMeldung: view.fehlerMeldung,
      });
      if (deutung.art === 'WARTEN') setStripeSchritt({ art: 'WARTEN', hinweis: null });

      // c) STAND im ruhigen Takt, bis er nicht mehr PROCESSING ist. Eine
      // weiche girocard-Ablehnung ändert den Stand NICHT — kein zweiter
      // Anlauf durch die Kasse, nur der Hinweis auf der Fläche.
      let fehlerInFolge = 0;
      while (deutung.art === 'WARTEN') {
        await pause(LESER_POLL_TAKT_MS);
        let stand: TerminalZahlungStand;
        try {
          stand = await stripeTerminalApi.zahlungStand(api, view.zahlungId);
          fehlerInFolge = 0;
        } catch {
          // Ein Netz-Wackler beendet keinen laufenden Kartenvorgang. Erst
          // nach anhaltender Funkstille wird ehrlich „unbekannt" gesagt —
          // NICHT „nicht belastet", denn das wüssten wir nicht.
          fehlerInFolge += 1;
          if (fehlerInFolge >= LESER_POLL_FEHLER_DECKEL) {
            setError(STAND_UNBEKANNT_MELDUNG);
            setStripeSchritt({ art: 'RUHT' });
            setSubmitting(false);
            inFlightRef.current = false;
            return;
          }
          continue;
        }
        deutung = deuteStand(stand);
        if (deutung.art === 'WARTEN') {
          setStripeSchritt({ art: 'WARTEN', hinweis: deutung.hinweis });
        }
      }

      if (deutung.art === 'GESCHEITERT') {
        // Endgültig für DIESEN Vorgang (abgelehnt, Zeitüberschreitung,
        // abgebrochen): der Gesten-Schlüssel wird verworfen — ein neuer
        // Versuch ist bewusst eine NEUE Zahlung. Der Weg zurück ist offen.
        stripeStartKeyRef.current = null;
        setStripeZahlungId(null);
        // `technik` ist Stripes englischer Originaltext. Er gehört ins
        // Protokoll für die Fehlersuche, nicht auf den Schirm des Kassierers.
        if (deutung.technik !== null) console.warn('Stripe-Leser:', deutung.technik);
        setError(deutung.meldung);
        setStripeSchritt({ art: 'RUHT' });
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }

      // ERFOLG — ab hier IST die Karte belastet. Jeder weitere Fehler darf
      // nur noch die BUCHUNG wiederholen, nie die Belastung.
      erfolg = { zahlungId: view.zahlungId, providerIntentId: view.providerIntentId };
      stripeErfolgRef.current = erfolg;
    }

    // d) BUCHEN — derselbe Siegel-Weg wie Bar und ZVT, die Intent-Kennung
    // als externe Referenz auf der Zahlungszeile.
    setStripeSchritt({ art: 'BUCHEN' });
    try {
      const payments = stripeZahlarten(erfolg.providerIntentId);
      const result = await finalizeWithTse(payments, 'NON_CASH', resolvedCustomerId);
      stripeErfolgRef.current = null;
      stripeStartKeyRef.current = null;
      // Für den Sofort-Storno: DIESE Zahlung kann erstattet werden.
      setStripeErstattbareZahlungId(erfolg.zahlungId);
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Kartenzahlung erfolgreich · Beleg ausgegeben',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (istSicherEingereiht(err)) {
        // Karte BELASTET + finalize sicher eingereiht (GoBD §146): der Wille
        // ist gerettet, ein Storno würde eine gebuchte Belastung umkehren.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        stripeErfolgRef.current = null;
        stripeStartKeyRef.current = null;
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Kartenzahlung erfolgreich · offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });
        setPreviewData(buildReceiptData(dummyResult, stripeZahlarten(erfolg.providerIntentId)));
        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // Karte belastet, Buchung gescheitert: `stripeErfolgRef` bleibt
        // stehen, der nächste Versuch bucht NUR nach (keine zweite Belastung).
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(
          `Buchung fehlgeschlagen NACH erfolgreicher Kartenzahlung. Bitte erneut bestätigen, die Zahlung wird ohne erneute Belastung gebucht. Details: ${formatPaymentError(err)}`,
        );
      }
    } finally {
      setStripeSchritt({ art: 'RUHT' });
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    finalized,
    finalizeWithTse,
    resolveB2bCustomerId,
    trockenlauf,
    stripeLeser,
    lines,
    harmonisiertePerLineMath,
    totalCents,
    qc,
    adjustedTotals.totalEur,
    adjustedTotals.vatEur,
    buildReceiptData,
  ]);

  /**
   * Abbrechen-Knopf während WARTEN: der Server storniert den Intent am
   * Leser; die laufende Stand-Schleife sieht danach CANCELED und beendet den
   * Vorgang ehrlich („abgebrochen, keine Belastung"). Kommt der Abbruch zu
   * spät (Karte war schneller), meldet die Schleife den Erfolg — dann wird
   * regulär gebucht, nie stillschweigend verworfen.
   */
  const stripeAbbrechen = useCallback(() => {
    if (!stripeZahlungId) return;
    void stripeTerminalApi.zahlungAbbrechen(api, stripeZahlungId).catch(() => {
      addToast({
        tone: 'alert',
        title: 'Abbruch nicht bestätigt',
        body: 'Der Server hat den Abbruch noch nicht bestätigt. Der Stand wird weiter abgefragt.',
      });
    });
  }, [api, stripeZahlungId, addToast]);

  const closeAfterFinalize = useCallback(() => {
    // Genuine finalize-SUCCESS close only (the result phase's "Neue Karte" CTA).
    // Cancel/Esc go through onClose directly; an error keeps the dialog open —
    // so this fires exactly when a sale really completed.
    if (finalized !== null) onFinalizeSuccess?.();
    clearCart();
    onClose();
  }, [clearCart, finalized, onClose, onFinalizeSuccess]);

  // Submit dispatcher — picks CASH vs ZVT_CARD based on toggle.
  //
  // § 10 GwG: a high-value sale (≥ €2.000) with no KYC-verified buyer attached
  // CANNOT finalize — the server trigger refuses it. Rather than let the
  // operator hit a dead 403, the primary action first opens the KaeuferPicker
  // so they can attach + verify a buyer; finalize runs on the next click.
  const dispatchSubmit = useCallback(() => {
    if (needsBuyer) {
      setBuyerPickerOpen(true);
      return;
    }
    if (paymentChoice === 'CASH') {
      // Phase C1 — when the split toggle is on the cash field is a PARTIAL leg
      // and the remainder is charged to the card; otherwise it's full cash.
      if (splitCard) void submitSplit();
      else void submit();
    } else if (paymentChoice === 'STRIPE_TERMINAL') void submitStripe();
    else void submitCard();
  }, [needsBuyer, paymentChoice, splitCard, submit, submitCard, submitSplit, submitStripe]);

  /**
   * One-tap full-amount card (design-brief §1): from the cash panel the cashier
   * taps `Karte` and goes STRAIGHT to the ZVT terminal for the full total — no
   * intermediate amount screen. It flips the visible method to card (so the UI
   * state stays coherent) and fires `submitCard` directly; routing through the
   * dispatcher would read the not-yet-committed `paymentChoice`. The double-pay
   * idempotency guard inside `submitCard` (inFlightRef) is untouched.
   */
  const payCardFull = useCallback(() => {
    if (needsBuyer) {
      setBuyerPickerOpen(true);
      return;
    }
    setPaymentChoice('ZVT_CARD');
    void submitCard();
  }, [needsBuyer, submitCard]);

  // ── Keyboard-first cash finalize (Wave 1) ──────────────────────────────
  // With NO text field focused (Kundensuche / USt-IdNr / Gutschein keep their own
  // Enter), Enter drives the most-repeated sale of the day — exact cash — with no
  // aiming: an empty cash entry → prefill "Passend" (exact due); once cash covers
  // → finalize. So a plain cash sale is Enter, Enter. This is a pure focus/keydown
  // layer on top of the existing, untouched tender + fiscal math (computeTender /
  // dispatchSubmit are byte-identical). Placed after dispatchSubmit so the deps
  // array is out of its temporal dead zone.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Enter') return;
      if (submitting || finalized !== null) return;
      // Card + split run their own deliberate flow (terminal round-trip).
      if (paymentChoice !== 'CASH' || splitCard) return;
      if (lines.length === 0) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName ?? '').toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (el?.isContentEditable ?? false)
      ) {
        return; // a real text field is focused — let it keep its own Enter.
      }
      ev.preventDefault();
      if (canSubmit) {
        dispatchSubmit();
      } else if (dueCents > 0n && cashCents < dueCents && b2bValid && !needsBuyer) {
        setCashReceivedEur(fromCents(dueCents)); // prefill Passend; a second Enter finalizes.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    submitting,
    finalized,
    paymentChoice,
    splitCard,
    lines.length,
    canSubmit,
    dueCents,
    cashCents,
    b2bValid,
    needsBuyer,
    dispatchSubmit,
  ]);

  if (!open) return null;

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Bezahlen"
      onClick={() => {
        // §19.3 W-2 — backdrop dismiss must NOT win against an in-flight
        // mutation. We check the synchronous mutex ref AND the React state
        // flags. The ref protects against the same React-commit-window
        // race that submit/submitCard guard against.
        if (inFlightRef.current || submitting || zvtBusy) return;
        if (finalized === null) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 'var(--w14-z-fenster)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          // Cashier-confirm fix: during the input phase bound the card to the
          // viewport and make it a flex column so the payment body can scroll
          // while the action footer stays pinned + reachable (the tall AmountPad
          // used to push the confirm button below the fold). The receipt phase
          // keeps its natural sizing.
          ...(finalized === null
            ? {
                maxHeight: 'calc(100vh - 48px)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }
            : {}),
        }}
      >
        {finalized === null ? (
          <PaymentInput
            paymentChoice={paymentChoice}
            setPaymentChoice={setPaymentChoice}
            totalEur={adjustedTotals.totalEur}
            dueEur={fromCents(dueCents)}
            appliedVoucher={appliedVoucher}
            onApplyVoucher={setAppliedVoucher}
            cashReceivedEur={cashReceivedEur}
            setCashReceivedEur={setCashReceivedEur}
            changeEur={fromCents(changeCents)}
            enoughCash={enoughCash}
            cardConfigured={hardwareCfg.zvt.ip.length > 0}
            canSubmitCash={canSubmit}
            canSubmitCard={canSubmitCard}
            stripeVerfuegbar={stripeVerfuegbar}
            stripeSchritt={stripeSchritt}
            stripeLeserName={waehleLeser(stripeLeser)?.bezeichnung ?? null}
            stripeAbbrechenMoeglich={stripeZahlungId !== null}
            onStripeAbbrechen={stripeAbbrechen}
            splitCard={splitCard}
            setSplitCard={setSplitCard}
            canSubmitSplit={canSubmitSplit}
            splitCardEur={split.valid ? fromCents(split.cardCents) : null}
            needsBuyer={needsBuyer}
            selectedBuyer={selectedBuyer}
            onOpenBuyerPicker={() => setBuyerPickerOpen(true)}
            submitting={submitting}
            error={error}
            onSubmit={dispatchSubmit}
            onPayCardFull={payCardFull}
            onCancel={onClose}
            isB2b={isB2b}
            setIsB2b={setIsB2b}
            vatId={vatId}
            setVatId={setVatId}
            viesStatus={viesStatus}
            viesCompany={viesCompany}
            viesAddress={viesAddress}
            manualCompany={manualCompany}
            setManualCompany={setManualCompany}
            manualAddress={manualAddress}
            setManualAddress={setManualAddress}
            verifyVat={verifyVat}
          />
        ) : (
          <ReceiptResult
            finalized={finalized}
            cashReceivedEur={cashReceivedEur}
            changeEur={fromCents(changeCents)}
            stripeZahlungId={stripeErstattbareZahlungId}
            onDismiss={closeAfterFinalize}
          />
        )}
      </ParchmentCard>

      {/* § 10 GwG buyer step — attach + ID-verify a buyer for a ≥ €2.000 sale. */}
      {buyerPickerOpen && (
        <KaeuferPicker
          totalEur={adjustedTotals.totalEur}
          initialCustomerId={selectedBuyer?.id ?? null}
          onConfirm={(customer) => {
            setSelectedBuyer(customer);
            setBuyerPickerOpen(false);
            setError(null);
          }}
          onCancel={() => setBuyerPickerOpen(false)}
        />
      )}

      {/* ZVT terminal owns the cardholder's attention — block the UI. */}
      {zvtBusy && <ZvtSpinner amountEur={adjustedTotals.totalEur} />}

      {/* Receipt preview — pops up after finalize; operator confirms the print. */}
      {previewData && (
        <ReceiptPreview
          data={previewData}
          printing={printing}
          canPrint={canPrint}
          lockedReason={receiptLockReason}
          onPrint={() => void printReceipt(previewData)}
          onClose={() => setPreviewData(null)}
        />
      )}
    </div></Fensterboden>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Input phase
// ────────────────────────────────────────────────────────────────────────


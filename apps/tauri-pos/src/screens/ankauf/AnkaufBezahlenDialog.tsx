/**
 * AnkaufBezahlenDialog, die letzte Bestätigung des Ankaufs samt KYC- und
 * GwG-Pflichten und dem gedruckten, TSE-gesiegelten Ankaufbeleg.
 *
 * 27.07.2026: der alte Kopf stammte aus „Day 8" und kannte weder den
 * Ankaufbeleg noch die GwG-Schwelle. Was die Datei heute trägt:
 *
 *   1. REVIEW: Kunde, Summe, Auszahlungsweg, KYC-Stand. JEDER Ankauf
 *      verlangt den Ausweis (§259 StGB, ab 0,01 EUR): ohne KYC-Stempel
 *      ersetzt „KYC bestätigen" den Bezahlen-Knopf (Step-up). Ab der
 *      GwG-Schwelle bestätigt der Kassierer die verstärkte Sorgfaltspflicht
 *      (§15 GwG) bewusst per eigenem Haken.
 *   2. RECEIPT: der Ankauf ist ein Kassenbeleg wie ein Verkauf (KassenSichV,
 *      §146a AO). Nach der TSE-Signatur (bei Ausfall druckt der Beleg
 *      ehrlich „TSE Ausfall") wird der druckbare Ankaufbeleg gebaut, für
 *      den Nachdruck der Kasse gemerkt und thermogedruckt; ohne
 *      konfigurierte USt-IdNr. bleibt der Druck ehrlich gesperrt
 *      (§14 UStG, GoBD). Etiketten der Stücke drucken mit.
 *
 * Ein Doppelklick-Riegel verhindert zwei Auszahlungen für dieselbe Ware,
 * und das Step-up auf dem finalize arbeitet wie im Verkauf (403 öffnet die
 * PIN-Stufe im Interceptor).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AnkaufBody,
  type AnkaufLineItem,
  type AnkaufResponse,
  type AnkaufResponseProduct,
  ApiError,
  type CustomerDetail,
  customersApi,
  transactionsApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';
import type { LabelData } from '../../lib/hardware-client.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import type { IntakeItem } from '../../state/ankauf-cart-store.js';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import {
  NACHDRUCK_NACH_DRUCKFEHLER,
  NACHDRUCK_ZUSAGE,
  NACHDRUCK_ZUSAGE_GESPERRT,
} from '../../lib/belegarchiv.js';
import { resolveDeviceId, useApiClient } from '../../lib/api-context.js';
import { posIntentsStore, sealFiscalRequest } from '../../lib/pos-intents-store.js';
import { fromCents, sumNegotiatedCents } from '../../lib/intake-math.js';
import { type AnkaufReceiptTse, buildAnkaufReceipt } from '../../lib/ankauf-receipt.js';
import { type ThermalReceiptData, thermalClient } from '../../lib/hardware-client.js';
import {
  type TseSessionResult,
  closeTseSession,
  enqueueSignatureRecordOnly,
  newIntentionId,
  openTseSession,
} from '../../lib/tse-service.js';
import type { TsePaymentKind } from '../../lib/hardware-client.js';
import { OHNE_EROEFFNUNG, ausfallSichern } from '../../lib/tse-queue-store.js';
import {
  type Fiskalzustand,
  TONLAGE_ALS_MELDUNGSTON,
  fiskalzustandSatz,
  zustandAusAusfall,
} from '../../lib/fiskalzustand-satz.js';
import { computeAmountsPerVatRate } from '../../lib/tse-vat.js';
import { isReceiptShopValid, resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import {
  selectAnkaufCustomerId,
  selectAnkaufItems,
  useAnkaufCartStore,
} from '../../state/ankauf-cart-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { notePrintOutcome } from '../../lib/hardware-reprobe.js';
import { grundOhneSignatur, hinweisOhneSignatur } from '../../lib/ohne-signatur-hinweis.js';
import { istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export interface AnkaufBezahlenDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ⛔ 13.08.2026 — IN DIESER DATEI ENTSTEHT KEIN WORTLAUT MEHR.
 *
 * Der Satz „die Signatur wird nachgereicht" stand an fünf Stellen unabhängig
 * voneinander getippt, und der Ankaufweg war eine davon. Drei Reparaturrunden
 * haben die Lüge jedes Mal nur verschoben: eine Fläche wurde richtiggestellt,
 * die anderen versprachen weiter eine Nachreichung, die es für diesen Beleg
 * nie geben wird.
 *
 * Deshalb baut diese Maske ihre Meldung nicht mehr selbst zusammen. Ton,
 * Überschrift, Satz und nächster Schritt kommen vollständig aus
 * `lib/fiskalzustand-satz.ts`. Der Ton ist dort an die vier echten Töne der
 * Meldungsleiste gebunden: nur der Fall echten Verlusts bekommt den bleibenden
 * Alarm, ein Beleg, den die Kasse selbst nachreicht, bekommt ihn NICHT — sonst
 * quittiert der Kassierer den ganzen Tag Meldungen über Dinge, um die er sich
 * nicht kümmern muss, und übersieht die eine, die zählt.
 */
function meldungFuerAnkauf(zustand: Fiskalzustand): {
  tone: 'info' | 'success' | 'warn' | 'alert';
  title: string;
  body: string;
} {
  const satz = fiskalzustandSatz(zustand, 'Ankauf');
  return {
    tone: TONLAGE_ALS_MELDUNGSTON[satz.tonlage],
    title: satz.titel,
    body: `${satz.satz} ${satz.naechsterSchritt.text}`,
  };
}

export function AnkaufBezahlenDialog({
  open,
  onClose,
}: AnkaufBezahlenDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const printer = useLabelPrinter();
  const hardwareCfg = useHardwareStore((s) => s.config);
  const { data: shopApi } = useShopInfo();
  const sessionActor = useSessionStore((s) => s.actor);
  const setLastReceipt = useLastReceiptStore((s) => s.setLastReceipt);
  const items = useAnkaufCartStore(selectAnkaufItems);
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const payoutMethod = useAnkaufCartStore((s) => s.payoutMethod);
  const payoutExternalRef = useAnkaufCartStore((s) => s.payoutExternalRef);
  const notesInternal = useAnkaufCartStore((s) => s.notesInternal);
  const setPayoutMethod = useAnkaufCartStore((s) => s.setPayoutMethod);
  const setPayoutExternalRef = useAnkaufCartStore((s) => s.setPayoutExternalRef);
  const setNotesInternal = useAnkaufCartStore((s) => s.setNotesInternal);
  const reset = useAnkaufCartStore((s) => s.reset);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [stampingKyc, setStampingKyc] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<AnkaufResponse | null>(null);
  /** The printable Ankaufbeleg, built once the buy-in + TSE resolve. */
  const [ankaufReceipt, setAnkaufReceipt] = useState<ThermalReceiptData | null>(null);

  /**
   * Der fiskalische Zustand DIESES Ankaufbelegs, festgehalten dort, wo er
   * entsteht. Der Belegbau kennt sonst nur, OB eine Signatur da ist — nicht,
   * warum keine da ist. Genau daraus wurde bis zum 13.08.2026 auf dem
   * gedruckten Beleg ein Versprechen, das für ihn nicht galt.
   */
  const fiskalzustandRef = useRef<Fiskalzustand>('signiert');

  /**
   * §19.3 W-1 — synchronous mutex (mirrors Verkauf BezahlenDialog).
   *
   * `useState(submitting)` is async — React doesn't commit `setSubmitting(true)`
   * until after the handler yields, so a fast double-click on "Auszahlen &
   * Beleg" CAN re-enter `submit` and post TWO payouts for the same goods. A
   * `useRef.current = true` is visible immediately on the next synchronous read,
   * killing the race. Reset in `submit`'s finally AND on dialog re-open.
   */
  const inFlightRef = useRef<boolean>(false);

  /**
   * §19.2 C-4 — idempotency key for at-most-once Ankauf. Generated ONCE per
   * dialog open, held in a ref so every retry (step-up cancel-resume, network
   * blip) sends the SAME key. The server's partial UNIQUE INDEX dedupes on it.
   */
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  /** §15 GwG: der Kassierer bestätigt die verstärkte Sorgfaltspflicht bewusst. */
  const [pepAcknowledged, setPepAcknowledged] = useState(false);

  const customerQ = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId!),
    enabled: customerId !== null,
    staleTime: 5_000,
  });
  const customer: CustomerDetail | undefined = customerQ.data;

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setStampingKyc(false);
      setError(null);
      setFinalized(null);
      setPepAcknowledged(false);
      inFlightRef.current = false;
      idempotencyKeyRef.current = crypto.randomUUID();
    }
  }, [open]);

  // Esc closes when not mid-submit.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting && !stampingKyc) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting, stampingKyc]);

  const totalCents = useMemo(() => sumNegotiatedCents(items), [items]);
  const totalEur = fromCents(totalCents);
  // Single source of truth shared with the early IntakeList banner. ANKAUF =
  // ID always required (§259 StGB), so the gate trips from €0,01.
  const kycGate = evaluateKycGate({ direction: 'ANKAUF', totalCents, customer: customer ?? null });
  const triggersGwgGate = kycGate.thresholdReached;
  const kycVerified = kycGate.kycVerified;
  const blocked = customer?.sanctionsMatch === true || customer?.trustLevel === 'BANNED';
  const needsKycStamp = triggersGwgGate && !kycVerified;
  // Eine politisch exponierte Person darf verkaufen, aber nur unter verstärkter
  // Sorgfaltspflicht. Kein stiller Durchlauf: der Kassierer bestätigt sie.
  const needsPepAcknowledgement = kycGate.enhancedDueDiligence && !pepAcknowledged;

  const payoutValid =
    payoutMethod === 'CASH' ||
    (payoutMethod === 'BANK_TRANSFER' && payoutExternalRef.trim().length > 0);

  const canSubmit =
    !submitting &&
    !stampingKyc &&
    finalized === null &&
    !blocked &&
    !needsKycStamp &&
    !needsPepAcknowledgement &&
    payoutValid &&
    items.length > 0 &&
    customerId !== null;

  // ── KYC stamp ──
  const stampKyc = useCallback(async (): Promise<void> => {
    if (!customer || stampingKyc) return;
    setStampingKyc(true);
    setError(null);
    try {
      // The PATCH route requires step-up — interceptor opens the modal.
      // documentType is a required backend audit enum: PERSONALAUSWEIS is the
      // honest default ID inspected at a German Ankauf counter (metadata only).
      await customersApi.stampKyc(
        api,
        customer.id,
        customer.trustLevel === 'NEW'
          ? { documentType: 'PERSONALAUSWEIS', promoteTrustLevelTo: 'VERIFIED' }
          : { documentType: 'PERSONALAUSWEIS' },
      );
      addToast({ tone: 'success', title: 'KYC bestätigt', body: customer.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
    } catch (err) {
      if (isStepUpCancelled(err)) {
        setError('PIN-Bestätigung wurde abgebrochen.');
      } else if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else {
          setError(describeError(err));
        }
      } else {
        // Was NICHT geschehen ist, bleibt stehen; die Ursache wird gemessen
        // statt behauptet. Ohne bestätigte Ausweisprüfung darf der Ankauf
        // über der Schwelle nicht weiterlaufen (§ 10 GwG).
        setError(`${ohneApiFehlerSatz(err)} Die Ausweisprüfung ist nicht bestätigt.`);
      }
    } finally {
      setStampingKyc(false);
    }
  }, [addToast, api, customer, qc, stampingKyc]);

  // ── Finalize Ankauf ──
  /**
   * Build the Ankaufbeleg from the finalized buy-in + the client TSE result,
   * remember it for reprint, and return it so the ReceiptPhase can print it.
   * The buy-in is already a TSE-signed fiscal transaction; this only renders it.
   *
   * ⚠️ 13.08.2026: hier stand „(Kasse „letzten Beleg drucken")". Dieser Knopf
   * konnte nur den EINEN Beleg im Arbeitsspeicher drucken. Gemerkt wird jetzt
   * in den dauerhaften Nachdruckvorrat (`lib/belegarchiv.ts`), nachgedruckt
   * wird je Zeile unter „Dokumente".
   */
  const buildAndStoreReceipt = useCallback(
    (result: AnkaufResponse, tse: AnkaufReceiptTse | null): ThermalReceiptData => {
      const receipt = buildAnkaufReceipt({
        shop: resolveShopInfo(shopApi),
        receiptLocator: result.receiptLocator,
        finalizedAtIso: result.finalizedAt,
        cashierName: sessionActor?.isOwner ? 'Inhaber' : 'Bediener',
        sellerName: customer?.fullName ?? null,
        payoutMethod,
        items: items.map((it) => ({
          name: it.name,
          negotiatedPriceEur: it.negotiatedPriceEur,
          // 0143: die Nummer steht auf der Verkaeuferkopie — dem GwG-Beleg,
          // den beide Seiten in der Hand haben.
          seriennummer: it.seriennummer || null,
          gravur: it.gravur || null,
        })),
        totalEur: result.totalEur,
        tse,
        fiskalzustand: fiskalzustandRef.current,
      });
      setAnkaufReceipt(receipt);
      setLastReceipt(receipt);
      return receipt;
    },
    [shopApi, sessionActor, customer, payoutMethod, items, setLastReceipt],
  );

  // A Beleg must never print a blank/fake USt-IdNr. (§14 UStG / GoBD): if the
  // shop VAT id is unconfigured, lock the print with an honest reason.
  const receiptLocked = !isReceiptShopValid(resolveShopInfo(shopApi));
  const canPrintReceipt =
    hardwareCfg.thermal.mode === 'usb'
      ? hardwareCfg.thermal.printerName.length > 0
      : hardwareCfg.thermal.ip.length > 0;

  const printAnkaufReceipt = useCallback(async (): Promise<void> => {
    if (!ankaufReceipt) return;
    if (receiptLocked) {
      addToast({
        tone: 'alert',
        title: 'USt-IdNr. fehlt',
        body: 'Bitte die USt-IdNr. des Ladens unter „Einstellungen" hinterlegen.',
      });
      return;
    }
    if (!canPrintReceipt) {
      addToast({
        tone: 'info',
        title: 'Kein Drucker',
        body: 'Beleg nur als Vorschau. Drucker unter „Geräte" einrichten.',
      });
      return;
    }
    try {
      const endpoint =
        hardwareCfg.thermal.mode === 'usb'
          ? { ip: '', port: 9100, printerName: hardwareCfg.thermal.printerName }
          : { ip: hardwareCfg.thermal.ip, port: hardwareCfg.thermal.port };
      // Siehe useReceiptPrinter: ein echter Druckversuch bewegt die Marke.
      await thermalClient.print(endpoint, ankaufReceipt);
      notePrintOutcome('thermal', null);
      addToast({ tone: 'success', title: 'Ankaufbeleg gedruckt' });
    } catch (err) {
      notePrintOutcome('thermal', err);
      // ⚠️ 13.08.2026: hier stand „Der Beleg bleibt über die Kasse
      // nachdruckbar." Gemessen falsch: der Belegspeicher hielt EINEN Beleg,
      // nur im Arbeitsspeicher, und der nächste Verkauf überschrieb ihn. Der
      // Händler las eine Zusage, die der Speicher nicht halten konnte. Der Satz
      // hat jetzt EINE Quelle (`lib/belegarchiv.ts`) und nennt die Fläche, auf
      // der der Nachdruck wirklich liegt.
      addToast({
        tone: 'alert',
        title: 'Druck fehlgeschlagen',
        body: NACHDRUCK_NACH_DRUCKFEHLER,
      });
    }
  }, [ankaufReceipt, receiptLocked, canPrintReceipt, hardwareCfg.thermal, addToast]);

  const submit = useCallback(async (): Promise<void> => {
    // §19.3 W-1 mutex: read+set SYNCHRONOUSLY, BEFORE the canSubmit guard,
    // so a double-click that beats React's state commit can't post twice.
    if (inFlightRef.current) return;
    if (!canSubmit || !customerId) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    const wireItems: AnkaufLineItem[] = items.map((it) => {
      const item: AnkaufLineItem = {
        sku: it.sku,
        itemType: it.itemType,
        hallmarkStamps: it.hallmarkStamps,
        condition: it.condition,
        taxTreatmentCode: it.taxTreatmentCode,
        name: it.name,
        listPriceEur: it.listPriceEur,
        negotiatedPriceEur: it.negotiatedPriceEur,
        publishImmediately: it.publishImmediately,
      };
      if (it.barcode.length > 0) item.barcode = it.barcode;
      if (it.metal !== null) item.metal = it.metal;
      if (it.karatCode.length > 0) item.karatCode = it.karatCode;
      if (it.finenessDecimal.length > 0) item.finenessDecimal = it.finenessDecimal;
      if (it.weightGrams.length > 0) item.weightGrams = it.weightGrams;
      if (it.descriptionDe.length > 0) item.descriptionDe = it.descriptionDe;
      // 0143: Nummer und Gravur wandern auf den Draht (GwG-Zuordnung).
      if (it.seriennummer.length > 0) item.seriennummer = it.seriennummer;
      if (it.gravur.length > 0) item.gravur = it.gravur;
      return item;
    });

    const body: AnkaufBody = {
      customerId,
      payoutMethod,
      totalEur,
      items: wireItems,
      // §19.2 C-4 — stable across retries; server dedups on the partial UNIQUE.
      idempotencyKey: idempotencyKeyRef.current,
    };
    if (payoutMethod === 'BANK_TRANSFER') body.payoutExternalRef = payoutExternalRef.trim();
    if (notesInternal.trim().length > 0) body.notesInternal = notesInternal.trim();

    // TSE INTENTION — an Ankauf is a Kassenbeleg like a sale (KassenSichV §146a),
    // so it MUST be TSE-signed. Open the fiscal transaction the moment the payout
    // is committed, using the identical INTENTION→FINISH sandwich BezahlenDialog
    // uses for a sale. Best-effort: a failure logs but NEVER blocks the buy-in.
    const tseIntentionId = newIntentionId();
    // fiskaly `payment_type`. Am 08.08.2026 gegen die Live-Spezifikation
    // gemessen: das enum lautet CASH / NON_CASH; „Bar" und „Unbar" kommen
    // darin null Mal vor und wurden abgewiesen.
    const paymentKind: TsePaymentKind = payoutMethod === 'CASH' ? 'CASH' : 'NON_CASH';
    const tseIntentionRes = await openTseSession({
      config: hardwareCfg.tse,
      receiptLocator: null,
      intentionId: tseIntentionId,
      paymentKind,
    });

    try {
      // Phase 1.4: crystallize the intent to disk BEFORE the network call, so a
      // crash between here and the server leaves a recoverable pos_intents row
      // (the startup reconcile funnels it into the outbox on this SAME key →
      // no double-booking). Best-effort — never blocks the buy-in.
      try {
        await posIntentsStore.create({
          key: idempotencyKeyRef.current,
          intentType: 'ankauf',
          sealedRequestJson: JSON.stringify(
            sealFiscalRequest({
              baseUrl: api.baseUrl,
              path: '/api/transactions/ankauf',
              body,
              idempotencyKey: idempotencyKeyRef.current,
              deviceId: resolveDeviceId(),
            }),
          ),
          createdAt: Date.now(),
        });
      } catch {
        /* best-effort */
      }
      const result = await transactionsApi.ankauf(api, body);
      // Reached the server — resolve the intent (no reconcile needed).
      try {
        await posIntentsStore.markResolved(idempotencyKeyRef.current, result);
      } catch {
        /* best-effort */
      }
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Ankauf abgeschlossen',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });

      // TSE FINISH — only if the INTENTION opened. Sign the amount, then durably
      // persist the signature against the finalized transaction (GoBD / BSI
      // TR-03153). Both steps are best-effort: a failure NEVER unwinds the booked
      // Ankauf — the signature falls into the offline queue and is nachgereicht.
      // The TSE result the printed Ankaufbeleg carries; null until the FINISH
      // signs (or stays null on a TSE outage → the Beleg prints „TSE Ausfall").
      let tseForReceipt: AnkaufReceiptTse | null = null;
      // Ein Ankaufkorb trägt EINE Steuerbehandlung (der MIXED-Riegel erzwingt
      // es), die signierte Aufteilung ist also ein einziger Eimer.
      //
      // ⚠️ Steht seit dem 13.08.2026 VOR der Verzweigung, nicht darin: die
      // Ausfallzweige unten brauchen dieselbe Aufteilung für ihre Zeile, und
      // eine zweite Rechnung an anderer Stelle wäre eine zweite Wahrheit.
      /*
       * ── 19.08.2026: ein Ankauf ist ein ABFLUSS, auch in der Signatur ─────
       *
       * Hier wurde der Auszahlungsbetrag POSITIV signiert: der QR eines
       * 500-EUR-Goldankaufs behauptete 500 EUR ZUFLUSS, waehrend die
       * DSFinV-K-Ausfuhr denselben Vorgang (richtig) als −500 fuehrt —
       * 1.000 EUR Widerspruch je Ankauf, zwischen zwei Aufzeichnungen, die
       * beide unveraenderbar sind. Der Storno hatte denselben Fehler und
       * wurde repariert (StornoDialog signiert negativ); der Ankauf nicht.
       * Jetzt tragen Betrag UND Steuercontainer dasselbe Minus wie die
       * Ausfuhr — die Summenregel (Anhang I S. 116) gilt fuer beide Seiten.
       */
      const vatAufteilung =
        items.length > 0
          ? computeAmountsPerVatRate([
              {
                appliedTaxTreatmentCode: items[0]!.taxTreatmentCode,
                lineTotalCents: -Number(totalCents),
              },
            ])
          : { buckets: [], ohneSatznamen: [] };
      if ('intention' in tseIntentionRes) {
        const finishRes: TseSessionResult = await closeTseSession({
          config: hardwareCfg.tse,
          intentionId: tseIntentionId,
          receiptLocator: result.receiptLocator,
          paymentKind,
          intention: tseIntentionRes.intention,
          amountCents: -Number(totalCents),
          serverTransactionId: result.transactionId,
          amountsPerVatRate: vatAufteilung.buckets,
        });
        if (finishRes.kind === 'signed') {
          const sig = finishRes.signature;
          tseForReceipt = {
            signatureValue: sig.signatureValue,
            signatureCounter: sig.signatureCounter,
            transactionNumber: sig.transactionNumber,
            qrPayload: sig.qrCodePayload,
          };
          try {
            await transactionsApi.recordTseSignature(api, result.transactionId, {
              fiskalyTssId: hardwareCfg.tse.tssId,
              fiskalyClientId: hardwareCfg.tse.clientId,
              fiskalyTransactionId: tseIntentionRes.intention.fiskalyTransactionId,
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
          } catch (sigErr) {
            // Record-failed (path b): hold the signature, enqueue it for a
            // re-POST-only replay (never re-FINISH). Durable — survives crash.
            const queued = await enqueueSignatureRecordOnly({
              config: hardwareCfg.tse,
              intention: tseIntentionRes.intention,
              serverTransactionId: result.transactionId,
              amountCents: -Number(totalCents),
              paymentKind,
              amountsPerVatRate: vatAufteilung.buckets,
              receiptLocator: result.receiptLocator,
              signature: sig,
              error: sigErr,
            });
            // `queued` IST die Messung: die Zeile liegt, oder sie liegt nicht.
            // Nur daraus darf ein Satz werden, nie aus der Absicht.
            fiskalzustandRef.current = zustandAusAusfall('melden', queued);
            addToast(meldungFuerAnkauf(fiskalzustandRef.current));
            // eslint-disable-next-line no-console
            console.warn('recordTseSignature failed (non-blocking)', sigErr);
          }
        } else {
          /**
           * ⚠️ 13.08.2026 — HIER STAND `else if (finishRes.kind === 'queued_offline')`
           * MIT DEM SATZ „Signatur wird später nachgereicht".
           *
           * Zwei Messungen dagegen, genau wie im Verkaufsweg:
           *
           *  1. `closeTseSession` fängt einen Fehlschlag SEINES eigenen
           *     Korbschreibers ab (`lib/tse-service.ts:135`) und meldet trotzdem
           *     Erfolg. Der Satz versprach dann eine Nachreichung, zu der keine
           *     Zeile existierte.
           *  2. `kind === 'unavailable'` traf gar keinen Zweig — kein Wort auf
           *     dem Schirm, kein Eintrag, nichts. Genau dieser Wert kommt aber
           *     zurück, sobald die Kasse nicht in der Tauri-Hülle läuft.
           *
           * Jetzt wird NACHGESEHEN statt geglaubt: liegt keine Zeile, schreibt
           * der Ankaufweg sie selbst. Der Vorgang ist eröffnet, also trägt die
           * Zeile die echte Vorgangsnummer und ist voll nachreichbar
           * (Signatur NULL, Weg a des Nachreichers).
           */
          const gesichert = await ausfallSichern(
            {
              intentionId: tseIntentionId,
              fiskalyTransactionId: tseIntentionRes.intention.fiskalyTransactionId,
              tssId: hardwareCfg.tse.tssId,
              clientId: hardwareCfg.tse.clientId,
              serverTransactionId: result.transactionId,
              amountCents: -Number(totalCents),
              paymentKind,
              amountsPerVatRate: vatAufteilung.buckets,
              receiptType: 'RECEIPT',
              processType: 'Kassenbeleg-V1',
              receiptLocator: result.receiptLocator,
              signature: null,
              createdAt: Date.now(),
              lastError: finishRes.reason,
            },
            // Der Vorgang ist bei der Sicherungseinrichtung ERÖFFNET — nur der
            // Abschluss kam nicht durch. Genau das ist nachreichbar, also geht
            // diese Zeile in die Warteschlange und der Satz darf es versprechen.
            'abschluss',
          );
          fiskalzustandRef.current = zustandAusAusfall('abschluss', gesichert);
          addToast(meldungFuerAnkauf(fiskalzustandRef.current));
        }
      } else if (grundOhneSignatur(hardwareCfg.tse.tssId) === 'keine_tse_hinterlegt') {
        /**
         * ⛔ 08.08.2026 — HIER STAND `else if (hardwareCfg.tse.tssId.length > 0)`.
         *
         * Wie im Verkauf, und hier war es schärfer: die einzige Rückmeldung war
         * sonst der GRÜNE Erfolgshinweis „Ankauf abgeschlossen".
         *
         * Diese Kasse hat gar keine Sicherungseinrichtung hinterlegt. Der
         * Ausfall wird festgehalten — § 146a AO verlangt die Dokumentation —,
         * aber NICHT zum Nachreichen gestellt: was die Sicherungseinrichtung
         * nie gesehen hat, kann sie nicht rückwirkend signieren. Das entscheidet
         * `istNachreichbar` an EINER Stelle, nicht diese Maske.
         */
        const gesichert = await ausfallSichern(
          {
            intentionId: tseIntentionId,
            fiskalyTransactionId: OHNE_EROEFFNUNG,
            tssId: hardwareCfg.tse.tssId,
            clientId: hardwareCfg.tse.clientId,
            serverTransactionId: result.transactionId,
            amountCents: -Number(totalCents),
            paymentKind,
            amountsPerVatRate: vatAufteilung.buckets,
            receiptType: 'RECEIPT',
            processType: 'Kassenbeleg-V1',
            receiptLocator: result.receiptLocator,
            signature: null,
            createdAt: Date.now(),
            lastError: tseIntentionRes.error,
          },
          'keine_tse',
        );
        fiskalzustandRef.current = zustandAusAusfall('keine_tse', gesichert);
        const meldung = meldungFuerAnkauf(fiskalzustandRef.current);
        addToast(
          // Der Wortlaut kommt über dieselbe Brücke wie im Verkaufsweg, damit
          // nicht zwei Masken für denselben Zustand zwei Erklärungen zeigen.
          // Ging nicht einmal das örtliche Vermerken, sagt der Satz stattdessen
          // den Verlust an — und zwar gemessen, nicht vermutet.
          gesichert
            ? { tone: meldung.tone, ...hinweisOhneSignatur('keine_tse_hinterlegt', 'Ankauf') }
            : meldung,
        );
      } else {
        /**
         * ⛔ DER BEFUND VOM 13.08.2026 — DIE URSPRÜNGLICHE LÜCKE, HIER NOCH GANZ.
         *
         * Fällt das Netz aus, scheitert schon der ERSTE TSE-Schritt: die
         * Eröffnung (`openTseSession`, oben). Beide Schreiber der Nachreiche-
         * Warteschlange hängen aber am Abschluss (`tse-service.ts:119`) und am
         * Melden (`tse-service.ts:170`) — hier entstand also NIRGENDS eine
         * Zeile, während der Kassierer las, die Signatur werde nachgeholt.
         *
         * Der Verkaufsweg wurde dafür repariert, dieser hier blieb stehen: der
         * halbe Fix an derselben Ampel. Ein verlorener fiskalischer Datensatz
         * UND eine Lüge auf dem Bildschirm, auf der zweiten Bezahlmaske.
         *
         * Jetzt wird der Ausfall dauerhaft festgehalten. Die Vorgangsnummer
         * bleibt leer (`OHNE_EROEFFNUNG`), weil es keine gibt — eine plausibel
         * aussehende Nummer wäre eine unrichtige Angabe nach § 146a AO. Und der
         * Schritt heisst `'eroeffnung'`, ist damit nicht nachreichbar: die Zeile
         * entsteht sofort als dauerhafter Ausfall und wird nie zum Nachreichen
         * ausgewählt. Der Satz verspricht entsprechend keine Nachreichung.
         */
        const gesichert = await ausfallSichern(
          {
            intentionId: tseIntentionId,
            fiskalyTransactionId: OHNE_EROEFFNUNG,
            tssId: hardwareCfg.tse.tssId,
            clientId: hardwareCfg.tse.clientId,
            serverTransactionId: result.transactionId,
            amountCents: -Number(totalCents),
            paymentKind,
            amountsPerVatRate: vatAufteilung.buckets,
            receiptType: 'RECEIPT',
            processType: 'Kassenbeleg-V1',
            receiptLocator: result.receiptLocator,
            signature: null,
            createdAt: Date.now(),
            lastError: tseIntentionRes.error,
          },
          'eroeffnung',
        );
        fiskalzustandRef.current = zustandAusAusfall('eroeffnung', gesichert);
        addToast(meldungFuerAnkauf(fiskalzustandRef.current));
      }

      // Build the printable + reprintable Ankaufbeleg now that the buy-in +
      // TSE have resolved (with or without a signature).
      buildAndStoreReceipt(result, tseForReceipt);

      if (result.createdProducts.length > 0) {
        const bySkuMap = new Map(items.map((it) => [it.sku, it]));
        const labelsToPrint = result.createdProducts.map((p) => {
          const it = bySkuMap.get(p.sku);
          return {
            sku: p.sku,
            productName: it?.name ?? p.sku,
            weightGrams: it?.weightGrams ?? null,
            karat: it?.karatCode ?? null,
            storageLocation: null,
          } satisfies LabelData;
        });
        void printer.print(labelsToPrint);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        qc.invalidateQueries({ queryKey: ['customers', customerId] }),
        qc.invalidateQueries({ queryKey: ['customers', 'list'] }),
      ]);
    } catch (err) {
      if (istSicherEingereiht(err)) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        // The buy-in is SAFELY captured for replay (GoBD §146) — this is a
        // success from the cashier's point of view, NOT a failure. Mirror the
        // cash-sale offline path: advance to the receipt phase with a synthetic
        // locator, print labels from the LOCAL items (the server hasn't created
        // products yet), and invalidate the same queries.
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const offlineResult: AnkaufResponse = {
          transactionId: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          totalEur,
          payoutMethod,
          // Synthesize from the local intake so the ReceiptPhase + label print
          // have rows to work with. The real product ids land on sync.
          createdProducts: items.map((it) => ({
            id: it.sku,
            sku: it.sku,
            status: it.publishImmediately ? ('AVAILABLE' as const) : ('DRAFT' as const),
            clientReferenceId: null,
          })),
        };
        setFinalized(offlineResult);
        addToast({
          tone: 'info',
          title: 'Ankauf offline gespeichert',
          body: `Wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });

        if (offlineResult.createdProducts.length > 0) {
          const bySkuMap = new Map(items.map((it) => [it.sku, it]));
          const labelsToPrint = offlineResult.createdProducts.map((p) => {
            const it = bySkuMap.get(p.sku);
            return {
              sku: p.sku,
              productName: it?.name ?? p.sku,
              weightGrams: it?.weightGrams ?? null,
              karat: it?.karatCode ?? null,
              storageLocation: null,
            } satisfies LabelData;
          });
          void printer.print(labelsToPrint);
        }

        // Offline: the signature is nachgereicht on sync, so the Beleg prints
        // „TSE Ausfall" for now (honest) but is fully reprintable.
        buildAndStoreReceipt(offlineResult, null);

        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
          qc.invalidateQueries({ queryKey: ['customers', customerId] }),
          qc.invalidateQueries({ queryKey: ['customers', 'list'] }),
        ]);
      } else if (isStepUpCancelled(err)) {
        // A cancelled PIN modal rejects with a plain StepUpCancelledError (the
        // step-up middleware propagates it as-is), so it must be caught before
        // the network `else` — otherwise a deliberate cancel reads as a failure.
        setError('PIN-Bestätigung wurde abgebrochen.');
      } else if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else if (err.code === 'SANCTIONS_BLOCK') {
          setError('Sanktionslisten-Treffer. Der Ankauf wurde abgewiesen.');
        } else if (err.code === 'CLOSING_DAY_FINALIZED') {
          setError('Heutiger Tagesabschluss ist bereits geschlossen.');
        } else {
          setError(describeError(err));
        }
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    canSubmit,
    customerId,
    hardwareCfg,
    items,
    notesInternal,
    payoutExternalRef,
    payoutMethod,
    qc,
    totalCents,
    totalEur,
    printer,
  ]);

  const dismissAfterFinalize = useCallback((): void => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!open) return null;

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Ankauf bezahlen"
      onClick={() => {
        // §19.3 W-2 — backdrop dismiss must NOT win against an in-flight
        // payout. The synchronous mutex ref closes the same React-commit-window
        // race the submit guard protects against; the state flags cover the
        // KYC-stamp + already-finalized cases.
        if (inFlightRef.current || submitting || stampingKyc) return;
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
        style={{ width: 'min(560px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
      >
        {finalized !== null ? (
          <ReceiptPhase
            finalized={finalized}
            customerName={customer?.fullName ?? ''}
            items={items}
            hasReceipt={ankaufReceipt !== null}
            receiptLocked={receiptLocked}
            onPrintReceipt={() => void printAnkaufReceipt()}
            onDismiss={dismissAfterFinalize}
          />
        ) : (
          <ReviewPhase
            customer={customer}
            items={items}
            totalEur={totalEur}
            payoutMethod={payoutMethod}
            payoutExternalRef={payoutExternalRef}
            notesInternal={notesInternal}
            setPayoutMethod={setPayoutMethod}
            setPayoutExternalRef={setPayoutExternalRef}
            setNotesInternal={setNotesInternal}
            triggersGwgGate={triggersGwgGate}
            needsKycStamp={needsKycStamp}
            blocked={blocked}
            enhancedDueDiligence={kycGate.enhancedDueDiligence}
            pepAcknowledged={pepAcknowledged}
            onPepAcknowledge={setPepAcknowledged}
            error={error}
            canSubmit={canSubmit}
            submitting={submitting}
            stampingKyc={stampingKyc}
            onStampKyc={() => void stampKyc()}
            onSubmit={() => void submit()}
            onCancel={onClose}
          />
        )}
      </ParchmentCard>
    </div></Fensterboden>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Review phase
// ────────────────────────────────────────────────────────────────────────

function ReviewPhase(props: {
  customer: CustomerDetail | undefined;
  items: ReadonlyArray<{ name: string; negotiatedPriceEur: string }>;
  totalEur: string;
  payoutMethod: 'CASH' | 'BANK_TRANSFER';
  payoutExternalRef: string;
  notesInternal: string;
  setPayoutMethod: (m: 'CASH' | 'BANK_TRANSFER') => void;
  setPayoutExternalRef: (v: string) => void;
  setNotesInternal: (v: string) => void;
  triggersGwgGate: boolean;
  needsKycStamp: boolean;
  blocked: boolean;
  /** §15 GwG — the selected seller is a politically exposed person. */
  enhancedDueDiligence: boolean;
  pepAcknowledged: boolean;
  onPepAcknowledge: (next: boolean) => void;
  error: string | null;
  canSubmit: boolean;
  submitting: boolean;
  stampingKyc: boolean;
  onStampKyc: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const {
    customer,
    items,
    totalEur,
    payoutMethod,
    payoutExternalRef,
    notesInternal,
    setPayoutMethod,
    setPayoutExternalRef,
    setNotesInternal,
    triggersGwgGate,
    needsKycStamp,
    blocked,
    enhancedDueDiligence,
    pepAcknowledged,
    onPepAcknowledge,
    error,
    canSubmit,
    submitting,
    stampingKyc,
    onStampKyc,
    onSubmit,
    onCancel,
  } = props;

  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-summe)',
          textAlign: 'center',
        }}
      >
        Ankauf abschließen
      </h2>
      <p
        style={{
          margin: '6px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-betont)',
          textAlign: 'center',
        }}
      >
        Bestätigen Sie Verkäufer, Stücke und Auszahlung.
      </p>
      <Zwischentitel label="Verkäufer" />

      <div
        style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--w14-abstand-8)', alignItems: 'baseline' }}
      >
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
        >
          Name
        </span>
        <span
          style={{ textAlign: 'right', fontFamily: 'var(--w14-font-display)', fontWeight: 500 }}
        >
          {customer?.fullName ?? 'wird geladen…'}
        </span>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
        >
          KYC
        </span>
        <span
          style={{
            textAlign: 'right',
            color: customer?.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          }}
        >
          {customer?.kycVerifiedAt
            ? `bestätigt ${new Date(customer.kycVerifiedAt).toLocaleDateString('de-DE')}`
            : 'noch nicht bestätigt'}
        </span>
      </div>

      {blocked && (
        <ParchmentCard
          padding="md"
          style={{ marginTop: 12, border: '2px solid var(--w14-wax-red)' }}
        >
          <p style={{ margin: 0, color: 'var(--w14-wax-red)', fontWeight: 500 }}>
            Geschäft mit diesem Verkäufer nicht zulässig. Sanktion oder Sperre.
          </p>
        </ParchmentCard>
      )}

      {!blocked && enhancedDueDiligence && (
        <ParchmentCard padding="md" style={{ marginTop: 12, border: '2px solid var(--w14-gold)' }}>
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-text)', lineHeight: 1.55 }}
          >
            <strong style={{ color: 'var(--w14-gold)' }}>
              Politisch exponierte Person.
            </strong>{' '}
            Der Ankauf ist zulässig, verlangt aber die verstärkte Sorgfaltspflicht: Herkunft der
            Ware und der Mittel prüfen, den Vorgang festhalten und die Ladenleitung informieren.
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-8)',
              marginTop: 10,
              cursor: 'pointer',
              fontSize: 'var(--w14-schrift-text)',
              color: 'var(--w14-ink)',
            }}
          >
            <input
              type="checkbox"
              checked={pepAcknowledged}
              onChange={(e) => onPepAcknowledge(e.target.checked)}
              style={{ accentColor: 'var(--w14-gold)', width: 18, height: 18 }}
            />
            Verstärkte Sorgfaltspflicht beachtet
          </label>
        </ParchmentCard>
      )}

      {triggersGwgGate && (
        <p
          style={{
            margin: '12px 0 0',
            color: needsKycStamp ? 'var(--w14-wax-red)' : 'var(--w14-ink-aged)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
            textAlign: 'center',
          }}
        >
          Jeder Ankauf verlangt eine persönliche Ausweisprüfung des Verkäufers (§ 259 StGB). Ab dem
          ersten Euro.
        </p>
      )}

      <Zwischentitel label="Auszahlung" />

      <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', marginBottom: 10 }}>
        <PayoutChip
          active={payoutMethod === 'CASH'}
          onClick={() => setPayoutMethod('CASH')}
          label="Bar"
        />
        <PayoutChip
          active={payoutMethod === 'BANK_TRANSFER'}
          onClick={() => setPayoutMethod('BANK_TRANSFER')}
          label="Überweisung"
        />
      </div>

      {payoutMethod === 'BANK_TRANSFER' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', marginBottom: 10 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
          >
            Verwendungszweck / Überweisungs-Ref
          </span>
          <input
            type="text"
            value={payoutExternalRef}
            onChange={(ev) => setPayoutExternalRef(ev.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-feldlinie)',
              background: 'transparent',
              padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-betont)',
              color: 'var(--w14-ink)',
            }}
          />
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', marginBottom: 10 }}>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
        >
          Notiz (optional)
        </span>
        <input
          type="text"
          value={notesInternal}
          maxLength={1024}
          onChange={(ev) => setNotesInternal(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      </label>

      {/* Permanent money anchor (design-brief §1) — the payout is the single
          largest type on the screen, .w14-tabular, high contrast for the 80cm
          read. Wax-red because this is money LEAVING the till (a payout), the
          same colour the receipt phase uses for the Auszahlung. */}
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-12)',
          padding: 'var(--w14-abstand-14) var(--w14-abstand-16)',
          background: 'var(--w14-parchment-3)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <span
          className="w14-smallcaps"
          style={{
            fontSize: 'var(--w14-schrift-text)',
            letterSpacing: '0.08em',
            color: 'var(--w14-ink-aged)',
          }}
        >
          Auszahlung · {items.length} Stück{items.length === 1 ? '' : 'e'}
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-anschlag)',
            fontWeight: 700,
            lineHeight: 1,
            color: 'var(--w14-wax-red)',
          }}
        >
          <MoneyAmount valueEur={totalEur} />
        </span>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: '14px 0 0',
            fontSize: 'var(--w14-schrift-betont)',
            textAlign: 'center',
          }}
        >
          {error}
        </p>
      )}

      {/* Action footer (design-brief §1) — the primary action is a 72–88px
          brass, bottom-right-anchored target (effectively-infinite Fitts); the
          ghost Abbrechen stays compact to its left so it can't be mis-tapped for
          the payout. The disabled state is driven by `canSubmit`, which already
          encodes the §19.3 mutex + KYC + payout-valid guards — pressing it
          disables it immediately (reinforces the existing double-pay guard). */}
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          gap: 'var(--w14-abstand-12)',
          alignItems: 'stretch',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={submitting || stampingKyc}
          style={{ flex: 'none' }}
        >
          Abbrechen
        </Button>
        {needsKycStamp ? (
          <Button
            variant="destructive"
            size="lg"
            onClick={onStampKyc}
            disabled={blocked || stampingKyc}
            style={{ flex: 1, minHeight: 78, fontSize: 'var(--w14-schrift-lead)', fontWeight: 600 }}
          >
            {stampingKyc ? 'Bestätigt…' : 'KYC bestätigen'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              flex: 1,
              minHeight: 78,
              fontSize: 'var(--w14-schrift-lead)',
              fontWeight: 600,
              // Solid brass once the payout can be recorded — an unmistakable
              // "ready to finalize" affordance (matches the Verkauf footer).
              ...(canSubmit
                ? {
                    backgroundColor: 'var(--w14-accent)',
                    borderColor: 'var(--w14-accent)',
                    color: 'var(--w14-accent-ink)',
                  }
                : {}),
            }}
          >
            {submitting ? 'Schließt ab…' : 'Auszahlen & Beleg'}
            {!submitting ? (
              <>
                {' · '}
                <MoneyAmount valueEur={totalEur} />
              </>
            ) : null}
          </Button>
        )}
      </div>
    </>
  );
}

function PayoutChip({
  active,
  onClick,
  label,
}: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        // ≥48px hot-path target (design-brief §1 / WCAG 2.5.5).
        minHeight: 48,
        padding: '0 var(--w14-abstand-14)',
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
        fontFamily: 'var(--w14-font-display)',
        fontVariant: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 'var(--w14-schrift-text)',
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
      }}
    >
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Receipt phase
// ────────────────────────────────────────────────────────────────────────

function ReceiptPhase({
  finalized,
  customerName,
  items,
  hasReceipt,
  receiptLocked,
  onPrintReceipt,
  onDismiss,
}: {
  finalized: AnkaufResponse;
  customerName: string;
  items: readonly IntakeItem[];
  hasReceipt: boolean;
  receiptLocked: boolean;
  onPrintReceipt: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const printer = useLabelPrinter();
  const bySku = new Map(items.map((it) => [it.sku, it]));
  const labelFor = (p: AnkaufResponseProduct): LabelData => {
    const it = bySku.get(p.sku);
    return {
      sku: p.sku,
      productName: it?.name ?? p.sku,
      weightGrams: it?.weightGrams ?? null,
      karat: it?.karatCode ?? null,
      storageLocation: null, // Lagerort is assigned later in Lager
    };
  };
  const allLabels = finalized.createdProducts.map(labelFor);

  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-summe)',
          textAlign: 'center',
        }}
      >
        Ankaufbeleg ausgegeben
      </h2>
      <Zwischentitel />

      <table
        className="w14-tabular"
        style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--w14-font-mono)' }}
      >
        <tbody>
          <ReceiptRow
            label="Beleg-Nr."
            value={
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-grund)',
                  color: 'var(--w14-ink-aged)',
                }}
              >
                {finalized.receiptLocator}
              </span>
            }
            emphasised
          />
          <ReceiptRow
            label="Verkäufer"
            value={<span style={{ fontFamily: 'var(--w14-font-display)' }}>{customerName}</span>}
          />
          <ReceiptRow
            label="Stücke neu im Lager"
            value={<span className="w14-tabular">{finalized.createdProducts.length}</span>}
          />
          <ReceiptRow
            label="Auszahlung"
            value={<MoneyAmount valueEur={finalized.totalEur} emphasis />}
            emphasised
            valueColor="var(--w14-wax-red)"
          />
        </tbody>
      </table>

      <p
        style={{
          margin: '14px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-text)',
          textAlign: 'center',
        }}
      >
        {new Date(finalized.finalizedAt).toLocaleString('de-DE')}
        {' · ID '}
        {finalized.transactionId.slice(0, 8)}…
      </p>

      {finalized.createdProducts.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span
              className="w14-smallcaps"
              style={{
                letterSpacing: '0.08em',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-aged)',
              }}
            >
              Etiketten
            </span>
            <Button variant="ghost" size="sm" onClick={() => void printer.print(allLabels)}>
              Alle Etiketten drucken
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--w14-abstand-4)' }}>
            {finalized.createdProducts.map((p) => (
              <li
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', fontSize: 'var(--w14-schrift-text)' }}
              >
                <span style={{ fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink-aged)' }}>
                  {p.sku}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {bySku.get(p.sku)?.name ?? '-'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void printer.print([labelFor(p)])}>
                  Drucken
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasReceipt && (
        <div style={{ marginTop: 18 }}>
          <Zwischentitel label="Ankaufbeleg" />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <Button variant="primary" size="md" onClick={onPrintReceipt}>
              Ankaufbeleg drucken
            </Button>
          </div>
          <p
            style={{
              margin: '8px 0 0',
              textAlign: 'center',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-aged)',
              lineHeight: 1.5,
            }}
          >
            {/*
              ⚠️ 13.08.2026: DIE ZUSAGE, DIE DIE FLÄCHE NICHT HALTEN KONNTE.

              Hier stand: „Auch später über die Kasse nachdruckbar („letzten
              Beleg drucken")." Der genannte Knopf konnte nur den EINEN Beleg
              drucken, den `last-receipt-store` hielt — überschrieben vom
              nächsten Verkauf, gelöscht vom Neustart. Der gesperrte Zweig war
              noch schlechter: er versprach Nachdruck, obwohl der Nachdruck
              denselben Riegel prüft und damit ebenfalls gesperrt ist.

              Beide Sätze kommen jetzt aus `lib/belegarchiv.ts`, halten was der
              Speicher hält und sagen, was GEHT.
            */}
            {receiptLocked ? NACHDRUCK_ZUSAGE_GESPERRT : NACHDRUCK_ZUSAGE}
          </p>
        </div>
      )}

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" size="lg" onClick={onDismiss}>
          Neue Aufnahme
        </Button>
      </div>
    </>
  );
}

function ReceiptRow({
  label,
  value,
  emphasised = false,
  valueColor,
}: {
  label: string;
  value: JSX.Element;
  emphasised?: boolean;
  valueColor?: string;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: 'var(--w14-abstand-8) 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-feld)',
        }}
      >
        {label}
      </td>
      <td style={{ padding: 'var(--w14-abstand-8) 0', textAlign: 'right', color: valueColor }}>{value}</td>
    </tr>
  );
}

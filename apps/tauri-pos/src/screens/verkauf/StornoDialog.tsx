/**
 * StornoDialog — reverse a just-finalized sale (Sofort-Storno).
 *
 * Self-contained: POSTs /api/transactions/storno with the original transaction
 * id + a reason (≥ 8 chars). Storno is fiscally mandatory PIN step-up (the
 * api-client middleware opens the PIN modal). It creates a mirror transaction
 * with negated amounts so the Z-Bon balances; it does NOT auto-return the item
 * to stock (V1) — surfaced as a note so the operator re-lists it from Lager.
 *
 * UX (design-ux-brief §1 "Dangerous-proximity / reverse-Fitts"): Storno is
 * fiscally irreversible, so a modal confirm is the CORRECT pattern here — the
 * goal is to make the danger *unmistakable* and the destructive button *hard to
 * hit by accident*, not to remove the friction:
 *   • Redundant danger coding — red warning glyph + a red danger strip + the
 *     wax-red header (color + icon + distinct alignment), so meaning survives
 *     colour-blindness / shop glare (WCAG 1.4.1).
 *   • Reverse-Fitts — the destructive "Storno bestätigen" button is exiled to
 *     the LEFT, OUT of the bottom-right thumb cluster where the eye/finger rests
 *     after a sale; the safe "Abbrechen" escape sits in the easy primary slot.
 *   • An explicit acknowledgement checkbox gates the destructive button (a
 *     second deliberate act in front of the existing PIN step-up).
 * None of the fiscal storno logic, the request payload, error mapping, or query
 * invalidations are changed.
 */

import { useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { type ApiClient, ApiError, stripeTerminalApi, transactionsApi } from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { useApiClient } from '../../lib/api-context.js';
import { beschreibeStartFehler } from '../../lib/stripe-leser-ablauf.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import {
  closeTseSession,
  enqueueSignatureRecordOnly,
  newIntentionId,
  openTseSession,
} from '../../lib/tse-service.js';
import {
  stornoSignaturHinweis,
  stornoSignaturSichern,
} from '../../lib/storno-signatur-sichern.js';
import { computeAmountsPerVatRate } from '../../lib/tse-vat.js';

import { useToastStore } from '../../state/toast-store.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';
import { describeError } from '@norns/i18n-de';

/**
 * Einen Geldbetrag der Leitung in ganze Cent, ohne Gleitkomma. `-119.00`
 * ergibt `-11900`. Ein `Number(x) * 100` macht aus 0,29 EUR eine 28.
 */
function eurZuCent(eur: string): number {
  const negativ = eur.startsWith('-');
  const [ganz = '0', rest = '00'] = (negativ ? eur.slice(1) : eur).split('.');
  const cent = Number(ganz) * 100 + Number(rest.padEnd(2, '0').slice(0, 2));
  return negativ ? -cent : cent;
}

/** Single canonical Storno glyph (outlined-2px, 24-grid) — a reversal arrow over
 *  a document, reused identically wherever Storno is surfaced. */
function StornoGlyph({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14h4.5a2 2 0 0 0 0-4H10" />
      <path d="M10 12l-1.6-1.6M10 12l-1.6 1.6" />
    </svg>
  );
}

/**
 * Der Erstattungs-Zweig des Sofort-Stornos (nur beim Weg über den
 * Stripe-Leser): das Geld muss ZURÜCK zum Kunden, und der Kassierer muss dem
 * wartenden Kunden sagen können, WANN es ankommt. Die Antwort des Servers
 * (`hinweis`) trägt genau diesen Satz — girocard erstattet per
 * SEPA-Überweisung in ein bis zwei Tagen, nicht sofort — und wird WÖRTLICH
 * gezeigt, nie umformuliert.
 */
type ErstattungsPhase =
  | { art: 'KEINE' }
  | { art: 'LAEUFT' }
  | { art: 'FERTIG'; hinweis: string }
  /** Storno ist GEBUCHT, das Geld aber noch nicht zurück — mit offenem Wiederholen. */
  | { art: 'GESCHEITERT'; text: string };

export function StornoDialog({
  transactionId,
  receiptLocator,
  stripeTerminalZahlungId = null,
  onClose,
  onStornoed,
}: {
  transactionId: string;
  receiptLocator: string;
  /**
   * Gesetzt, wenn der Beleg über den Stripe-Leser bezahlt wurde: nach dem
   * Storno wird DIESE Zahlung erstattet und die Server-Auskunft über den Weg
   * (sofort oder SEPA) wörtlich angezeigt.
   */
  stripeTerminalZahlungId?: string | null;
  onClose: () => void;
  onStornoed: () => void;
}): JSX.Element {
  const api = useApiClient() as ApiClient;
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const hardwareCfg = useHardwareStore((s) => s.config);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [erstattung, setErstattung] = useState<ErstattungsPhase>({ art: 'KEINE' });

  /**
   * ⚠️ EIN SCHLÜSSEL JE FENSTER, NICHT JE VERSUCH
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── DER BEFUND ────────────────────────────────────────────────────────
   * Der Storno-POST ging bis heute OHNE eigenen Idempotenzschlüssel hinaus.
   * Ohne Netz erfindet das Offline-Mittelstück deshalb je Versuch einen
   * frischen (`uuidv7`), und jeder Versuch legt eine EIGENE Zeile in den
   * Ausgangskorb. Beim Abspielen geht die erste durch; die zweite fällt in
   * den Riegel „höchstens ein Storno je Beleg" (partieller UNIQUE der
   * Datenbank). Ein solcher Widerspruch HÄLT den Ausgangskorb an
   * (`drainOutbox` → `markConflict`), und weil die Reihenfolge streng ist,
   * steht danach JEDER fiskalische Vorgang dahinter still, bis ein Mensch
   * ihn auflöst.
   *
   * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ─────────────────────────────
   * „Den Knopf nach dem ersten Versuch sperren" hilft nicht: ohne Netz ist
   * das Einreihen ein ERFOLG, das Fenster schliesst, und die Kassiererin
   * öffnet den Storno später erneut. Der Schlüssel muss den Vorgang
   * benennen, nicht den Klick. Ein Schlüssel je Fenster-Öffnung ist genau
   * das, und die örtliche Ablage sammelt Wiederholungen desselben
   * Schlüssels zu EINER Zeile ein (`INSERT OR IGNORE`).
   */
  const stornoSchluesselRef = useRef<string>(newIntentionId());

  // DER SCHWERWIEGENDSTE FUND DIESER ETAPPE — hier stand nur ein
  // Escape-Lauscher, und das Fenster lag auf der nackten Zahl 1100.
  //
  // Storno verlangt eine Zweitbestätigung mit dem Gerätecode. Diese Nachfrage
  // ist der `Dialog` aus dem Baukasten und liegt auf `--w14-z-fenster`, also
  // 1050. 1100 ist mehr als 1050, folglich malte sich AUSGERECHNET DAS
  // FENSTER, das gerade auf die Antwort wartet, ÜBER die Zahlentastatur, nach
  // der es fragt. Die Nachfrage holt sich aber trotzdem den Fokus, denn sie
  // bringt einen eigenen Fokusfang mit.
  //
  // Was die Kassiererin also sah: das Storno-Fenster mit „Storniert…", nichts
  // sonst. Was sie tat: den Gerätecode in eine Tastatur tippen, die unter dem
  // Fenster lag und die sie nicht sehen konnte. Jeder Tippfehler zählte gegen
  // die Sperre nach zehn Fehlversuchen, ohne dass irgendetwas davon sichtbar
  // war. Genau das ist gemeint mit „das Design überlagert sich".
  //
  // Die Behebung ist die benannte Ebene statt der erfundenen Zahl. Auf
  // gleicher Ebene entscheidet die Reihenfolge im Dokument, und die Nachfrage
  // hängt als eigenes Portal am Ende des Körpers, also NACH diesem Fenster —
  // sie gewinnt damit verlässlich, genauso wie beim bereits umgebauten
  // Kassenbewegungs-Fenster.
  //
  // Der gemeinsame Rahmen bringt zusätzlich den Vergleich auf „schon
  // behandelt" mit: ohne ihn schloss ein einziger Escape die Nachfrage UND
  // dieses Fenster, und der eingetippte Grund war verloren.
  // Nach GEBUCHTEM Storno (Phase FERTIG) führt jedes Schließen über
  // `onStornoed` — der Beleg ist umgekehrt, die Ergebnisfläche dahinter darf
  // nicht mehr wie ein offener Verkauf wirken.
  const schliessen = erstattung.art === 'FERTIG' ? onStornoed : onClose;
  const rahmenRef = useFensterRahmen({
    offen: true,
    aufSchliessen: schliessen,
    gesperrt: busy || erstattung.art === 'LAEUFT',
  });

  const valid = reason.trim().length >= 8;
  const canSubmit = valid && acknowledged;

  /**
   * Die Erstattung der Leser-Zahlung — NACH dem gebuchten Storno. Die
   * Server-Antwort (`hinweis`) benennt den Weg wörtlich (sofort auf die
   * Karte, oder SEPA in ein bis zwei Tagen bei girocard); genau dieser Satz
   * gehört auf die Fläche, damit der Kassierer ihn dem Kunden sagen kann,
   * BEVOR der den Laden verlässt.
   */
  async function erstatten(): Promise<void> {
    if (!stripeTerminalZahlungId) return;
    setErstattung({ art: 'LAEUFT' });
    try {
      const res = await stripeTerminalApi.zahlungErstatten(api, stripeTerminalZahlungId);
      setErstattung({ art: 'FERTIG', hinweis: res.hinweis });
    } catch (err) {
      // Der Storno IST gebucht, das Geld aber noch nicht zurück. Der Weg ist
      // flüchtig (nie eingereiht), darum ist Wiederholen hier gefahrlos —
      // eine schon erfolgte Erstattung weist Stripe selbst ab (CONFLICT,
      // Server-Satz wörtlich).
      setErstattung({ art: 'GESCHEITERT', text: beschreibeStartFehler(err) });
    }
  }

  async function submit(): Promise<void> {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      // ═══════════════════════════════════════════════════════════════
      //  DER STORNO IST EIN GESCHÄFTSVORFALL — und wird signiert
      // ═══════════════════════════════════════════════════════════════
      //
      // Bis zum 28.07.2026 lief hier nur der POST. Der Storno bekam KEINE
      // TSE-Signatur, und auf der Produktion gemessen war das kein
      // Einzelfall: 1 Storno, 1 ohne Signatur — also ausnahmslos.
      //
      // § 146a AO kennt aber keine Ausnahme für die Rücknahme. Ein Storno
      // ist ein aufzeichnungspflichtiger Vorgang wie der Verkauf, den er
      // aufhebt: ohne Signatur fehlt genau bei der Buchung der Nachweis,
      // die einen Erlös wieder verschwinden lässt. Das ist die Buchung,
      // die ein Prüfer ZUERST ansieht.
      //
      // Dieselbe Kette wie beim Verkauf: Vorgangsbeginn VOR dem Schreiben,
      // Signatur danach, und die Aufzeichnung auf dem Server.
      const stornoIntention = await openTseSession({
        config: hardwareCfg.tse,
        receiptLocator,
        intentionId: newIntentionId(),
        // Der Vorgangsbeginn kennt die Zahlart noch nicht; sie steht erst in
        // der Antwort des Servers. Die Zahlart, die SIGNIERT wird, ist die
        // aus dem FINISH weiter unten.
        paymentKind: 'NON_CASH',
      });

      const stornoRes = await api.request<{
        id: string;
        receiptLocator: string;
        totalEur: string;
        ustAufteilung: Array<{ taxTreatmentCode: string; bruttoCents: number }>;
        zahlartTse: 'CASH' | 'NON_CASH';
        /**
         * Gesetzt, wenn der Tag des Ursprungsbelegs schon abgeschlossen war.
         * Der Storno faellt dann in den HEUTIGEN Abschluss und traegt den
         * Urtag als Verweis. `null` heisst: gewoehnlicher Storno.
         */
        nachtragBezugstag: string | null;
      }>(
        'POST',
        '/api/transactions/storno',
        {
          originalTransactionId: transactionId,
          reason: reason.trim(),
          // 0118, seit 28.07. auch hier: die Zeit des GERÄTS. Sonst fiele ein
          // nachgespielter Verkauf und sein Storno in zwei Geschäftstage.
          erfasstAm: new Date().toISOString(),
        },
        {
          // Der eingefrorene Schlüssel, siehe `stornoSchluesselRef`. Ohne ihn
          // erfindet das Mittelstück je Versuch einen neuen, und zwei Klicks
          // ohne Netz halten später den ganzen Ausgangskorb an.
          custom: { idempotencyKey: stornoSchluesselRef.current, gobdRelevant: true },
        },
      );

      // ⚠️ Bester Wille, kein Riegel: der Storno IST gebucht. Ein Fehlschlag
      // hier darf ihn nicht rückgängig machen — er wandert in die dauerhafte
      // Warteschlange und wird nachgereicht, genau wie beim Verkauf.
      if ('intention' in stornoIntention && stornoRes?.id) {
        try {
          // ═══════════════════════════════════════════════════════════════
          //  ⚠️ HIER STAND `amountCents: 0`
          // ═══════════════════════════════════════════════════════════════
          //
          // Jeder Storno wurde mit 0,00 EUR, ohne Steueraufteilung und fest
          // als „Unbar" an die TSE gegeben, auch der Storno eines
          // Barverkaufs über 500 EUR. Der Grund war kein Leichtsinn: dieser
          // Dialog kannte nur die Kennung des Ursprungsbelegs, und der Typ
          // auf der Rust-Seite war vorzeichenlos, konnte den negativen
          // Betrag also gar nicht tragen.
          //
          // Beides ist behoben. Der Server gibt jetzt zurück, was er ohnehin
          // in der Hand hat: den negierten Betrag, die Bruttoaufteilung je
          // Steuerbehandlung und die Zahlart des Ursprungsbelegs.
          const aufteilung = computeAmountsPerVatRate(
            (stornoRes.ustAufteilung ?? []).map((e) => ({
              appliedTaxTreatmentCode: e.taxTreatmentCode as never,
              lineTotalCents: e.bruttoCents,
            })),
          );
          const fertig = await closeTseSession({
            config: hardwareCfg.tse,
            receiptLocator,
            intentionId: stornoIntention.intention.intentionId,
            // Bar bleibt bar. Wer bar gekauft hat, bekommt bar zurück.
            paymentKind: stornoRes.zahlartTse ?? 'NON_CASH',
            intention: stornoIntention.intention,
            // Negativ, wie der gebuchte Storno selbst.
            amountCents: eurZuCent(stornoRes.totalEur),
            /*
             * ── 19.08.2026: RECEIPT, nicht ANNULATION ────────────────────
             *
             * Hier stand ANNULATION („AVBelegstorno") — und genau den
             * verbietet die Norm fuer TSE-Kassen woertlich: DSFinV-K 2.4,
             * Anhang I S. 113: „Der Vorgangstyp AVBelegstorno kann bei
             * Systemen, die mit einer TSE abgesichert werden, nicht
             * verwendet werden." Tz. 4.2.2: der Stornobeleg ist ein
             * SEPARATER Beleg, BON_TYP „Beleg", mit BON_STORNO = 1 —
             * exakt so schreibt es unsere Ausfuhr laengst
             * (dsfinvk-schluessel.ts). Die Signatur sagte bis heute das
             * GEGENTEIL der Ausfuhr, unausloeschlich im QR jedes
             * Storno-Bons. fiskaly: RECEIPT = BON_TYP „Beleg"; das Minus
             * traegt der Betrag.
             */
            receiptType: 'RECEIPT',
            amountsPerVatRate: aufteilung.buckets,
            serverTransactionId: stornoRes.id,
          });
          if (fertig.kind === 'signed') {
            const sig = fertig.signature;
            // ═══════════════════════════════════════════════════════════════
            //  ⚠️ HIER STAND EIN LEERES `catch {}`
            // ═══════════════════════════════════════════════════════════════
            //
            // Sein Kommentar lautete „Der Storno steht. Die Signatur holt die
            // Warteschlange nach" — und `grep -c "enqueueSignatureRecordOnly"`
            // ergab 0. Es gab keine Warteschlange, die hier etwas nachholt.
            // Lehnte der Server die Aufzeichnung ab, existierte die
            // AVBelegstorno-Signatur nur noch im Speicher dieses Fensters und
            // verschwand beim nächsten Klick: keine Zeile in
            // `tse_signature_queue`, kein Zähler im Gerätemanager, kein Wort an
            // den Menschen. Und dieser Dialog druckt NICHTS, es gab also nicht
            // einmal eine Papierkopie.
            //
            // Verkauf und Ankauf tun an derselben Stelle beides. Jetzt auch der
            // Storno — der Vorgang, den ein Prüfer ZUERST ansieht. Die
            // Entscheidung selbst liegt rein in `storno-signatur-sichern.ts`,
            // damit sie fahrbar ist, ohne einen Bildschirm zu bauen.
            const ausgang = await stornoSignaturSichern({
              aufzeichnen: () =>
                transactionsApi
                  .recordTseSignature(api, stornoRes.id, {
                    fiskalyTssId: hardwareCfg.tse.tssId,
                    fiskalyClientId: hardwareCfg.tse.clientId,
                    fiskalyTransactionId: stornoIntention.intention.fiskalyTransactionId,
                    fiskalyTransactionNumber: String(sig.transactionNumber),
                    signatureValue: sig.signatureValue,
                    signatureCounter: String(sig.signatureCounter),
                    signatureAlgorithm: sig.signatureAlgorithm,
                    tssSerialNumber: sig.tssSerialNumber,
                    signaturePublicKey: sig.signaturePublicKey,
                    qrCodeData: sig.qrCodePayload,
                    tseStartTime: sig.startedAt,
                    tseEndTime: sig.finishedAt,
                  })
                  .then(() => undefined),
              einreihen: (fehler) =>
                enqueueSignatureRecordOnly({
                  config: hardwareCfg.tse,
                  intention: stornoIntention.intention,
                  serverTransactionId: stornoRes.id,
                  amountCents: eurZuCent(stornoRes.totalEur),
                  paymentKind: stornoRes.zahlartTse ?? 'NON_CASH',
                  amountsPerVatRate: aufteilung.buckets,
                  // DSFinV-K BON_TYP „AVBelegstorno" — dieselbe Angabe wie im
                  // FINISH oben, sonst trüge die nachgereichte Zeile einen
                  // anderen Belegtyp als der signierte Vorgang.
                  receiptType: 'RECEIPT', // 19.08.2026: AVBelegstorno ist fuer TSE-Kassen verboten (Anhang I S. 113)
                  receiptLocator,
                  signature: sig,
                  error: fehler,
                }),
            });
            const hinweis = stornoSignaturHinweis(ausgang);
            if (hinweis) addToast({ tone: 'alert', ...hinweis });
          } else {
            // `queued_offline`: der FINISH selbst kam nicht durch, die Zeile
            // liegt aber im dauerhaften Korb. Auch das gehört gesagt — sonst
            // liest der Kassierer nur „Storniert" und hält den Beleg für
            // vollständig signiert.
            addToast({
              tone: 'alert',
              title: 'TSE-Signatur in Warteschlange',
              body: 'Storno gebucht. Die Signatur wird später nachgereicht.',
            });
          }
        } catch (err) {
          // ⚠️ Kein leeres Fangwerk mehr. Hierher kommt nur noch, was VOR der
          // Aufzeichnung schiefging (der FINISH selbst). Der Storno IST
          // gebucht und bleibt es; der Mensch erfährt trotzdem davon.
          addToast({
            tone: 'alert',
            title: 'TSE-Signatur nicht erzeugt',
            body: 'Storno gebucht, aber die Sicherungseinrichtung hat den Vorgang nicht abgeschlossen. Bitte die Belegnummer notieren und den Inhaber verständigen.',
          });
          // eslint-disable-next-line no-console
          console.warn('Storno-Signatur fehlgeschlagen', err);
        }
      }
      /*
       * ── DER NACHTRAG WIRD GESAGT, NICHT VERSCHWIEGEN ──────────────────
       *
       * War der Tag des Ursprungsbelegs schon abgeschlossen, faellt der
       * Storno in den HEUTIGEN Abschluss. Der Kassierer muss das wissen: er
       * sucht den Betrag sonst im Abschluss von gestern und findet ihn nicht.
       * Der Beleg ist vollstaendig aufgezeichnet, nur eben mit Verweis.
       */
      const urtag = stornoRes?.nachtragBezugstag ?? null;
      addToast({
        tone: 'alert',
        title: 'Storniert',
        body:
          urtag === null
            ? `Beleg ${receiptLocator} wurde storniert.`
            : `Beleg ${receiptLocator} wurde storniert. Der Tag ${urtag} war ` +
              `bereits abgeschlossen, deshalb faellt der Storno in den heutigen ` +
              `Abschluss und verweist auf ${urtag}.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
      // Beim Leser-Beleg fließt jetzt das Geld zurück — der Dialog bleibt
      // offen und zeigt die wörtliche Server-Auskunft über den Weg.
      if (stripeTerminalZahlungId) {
        setBusy(false);
        await erstatten();
        return;
      }
      onStornoed();
    } catch (err) {
      // Sicher eingereiht ist ein ERFOLG, kein Fehler. Siehe
      // src/lib/eingereiht.ts: ApiOfflineQueuedError erbt von `Error`
      // und NICHT von `ApiError`, deshalb fiel dieser Zweig bisher
      // durch und die Kassiererin las „Netzwerk pruefen" — worauf
      // sie folgerichtig erneut drueckte.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Storno'));
        // Leser-Beleg: die Erstattung wird trotzdem sofort versucht — ohne
        // Netz scheitert sie EHRLICH (flüchtiger Weg, nie eingereiht) und
        // die Fläche zeigt den Wiederholen-Knopf statt still zu schließen.
        if (stripeTerminalZahlungId) {
          setBusy(false);
          await erstatten();
          return;
        }
        onClose();
        return;
      }
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'STEP_UP_REQUIRED':
            setError('PIN-Bestätigung wurde abgebrochen.');
            break;
          case 'CONFLICT':
            setError('Dieser Beleg wurde bereits storniert.');
            break;
          case 'DEVICE_NOT_AUTHORIZED':
            setError('Storno erfordert ein gekoppeltes Gerät (mTLS).');
            break;
          default:
            setError(describeError(err));
        }
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc handled by the window listener.
    <Fensterboden><div
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Beleg stornieren"
      tabIndex={-1}
      onClick={() => {
        if (!busy && erstattung.art !== 'LAEUFT') schliessen();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 'var(--w14-z-fenster)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          /* Redundant danger coding #1 — a wax-red edge marks the whole surface
             as a destructive context the moment it appears. */
          borderTop: '3px solid var(--w14-wax-red)',
          ...FENSTER_ROLLRAHMEN,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {/* Redundant danger coding #2 — a wax-red warning glyph, never used
              decoratively elsewhere. */}
          <span
            aria-hidden="true"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              borderRadius: '50%',
              color: 'var(--w14-wax-red)',
              backgroundColor: 'color-mix(in srgb, var(--w14-wax-red) 12%, transparent)',
            }}
          >
            <StornoGlyph size={22} />
          </span>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-kopf)',
              textAlign: 'center',
              color: 'var(--w14-wax-red)',
            }}
          >
            Beleg stornieren
          </h2>
          <p
            className="w14-tabular"
            style={{
              margin: 0,
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontSize: 'var(--w14-schrift-text)',
            }}
          >
            Beleg-Nr. {receiptLocator}
          </p>
        </div>
        <Zwischentitel />

        {erstattung.art !== 'KEINE' ? (
          /* ── Der Erstattungs-Zweig (Leser-Zahlung) ─────────────────────────
             Der Storno ist gebucht; jetzt zählt nur noch: kommt das Geld
             zurück, und WANN. Die Server-Auskunft steht wörtlich hier. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {erstattung.art === 'LAEUFT' && (
              <p
                role="status"
                style={{
                  margin: 0,
                  color: 'var(--w14-ink-aged)',
                  fontSize: 'var(--w14-schrift-betont)',
                  lineHeight: 1.5,
                  textAlign: 'center',
                }}
              >
                Die Kartenzahlung wird erstattet…
              </p>
            )}
            {erstattung.art === 'FERTIG' && (
              <>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--w14-ink-aged)',
                    fontSize: 'var(--w14-schrift-betont)',
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  Erstattung veranlasst.
                </p>
                {/* Die Server-Auskunft WÖRTLICH — diesen Satz sagt der
                    Kassierer dem wartenden Kunden (girocard: SEPA, ein bis
                    zwei Tage; sonst sofort auf die Karte). */}
                <p
                  role="status"
                  style={{
                    margin: 0,
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--w14-radius-button)',
                    border: '1px solid var(--w14-gold)',
                    color: 'var(--w14-ink)',
                    fontSize: 'var(--w14-schrift-betont)',
                    lineHeight: 1.5,
                  }}
                >
                  {erstattung.hinweis}
                </p>
                <Button variant="primary" size="lg" onClick={onStornoed} autoFocus>
                  Verstanden
                </Button>
              </>
            )}
            {erstattung.art === 'GESCHEITERT' && (
              <>
                <p
                  role="alert"
                  style={{
                    margin: 0,
                    color: 'var(--w14-wax-red)',
                    fontSize: 'var(--w14-schrift-betont)',
                    lineHeight: 1.5,
                  }}
                >
                  Der Beleg ist storniert, die Erstattung der Kartenzahlung ist aber noch NICHT
                  erfolgt: {erstattung.text}
                </p>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--w14-ink-faded)',
                    fontSize: 'var(--w14-schrift-feld)',
                    lineHeight: 1.45,
                    fontStyle: 'italic',
                  }}
                >
                  Wiederholen ist gefahrlos, eine bereits erfolgte Erstattung weist Stripe selbst
                  ab. Ohne Erstattung hier kann der Inhaber sie später über Stripe veranlassen.
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-4)',
                    justifyContent: 'space-between',
                  }}
                >
                  <Button variant="ghost" size="lg" onClick={onStornoed}>
                    Später über Stripe klären
                  </Button>
                  <Button variant="primary" size="lg" onClick={() => void erstatten()} autoFocus>
                    Erstattung erneut versuchen
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
        {/* Redundant danger coding #3 — a plain-German danger strip stating the
            irreversibility, icon + colour + text together. */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--w14-radius-button)',
            backgroundColor: 'color-mix(in srgb, var(--w14-wax-red) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--w14-wax-red) 35%, transparent)',
          }}
        >
          <span style={{ color: 'var(--w14-wax-red)', flexShrink: 0, marginTop: 1 }}>
            <StornoGlyph size={20} />
          </span>
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              lineHeight: 1.45,
            }}
          >
            Achtung. Endgültiger Vorgang. Es wird ein Gegenbeleg mit negierten Beträgen erstellt
            (Z-Bon gleicht aus). Eine Stornierung lässt sich fiskalisch nicht zurücknehmen.
          </p>
        </div>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-4)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
          >
            Grund (mind. 8 Zeichen) *
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="z. B. Falsch erfasst, doppelt gebucht"
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-feldlinie)',
              background: 'transparent',
              padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
              resize: 'vertical',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-schrift-betont)',
              color: 'var(--w14-ink)',
            }}
          />
        </label>

        <p
          style={{
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-zeile)',
            fontStyle: 'italic',
          }}
        >
          Der Artikel wird NICHT automatisch zurück in den Bestand gebucht. Bei Bedarf im Lager neu
          freigeben.
        </p>

        {/* Deliberate acknowledgement — a second conscious act gating the
            destructive button, in front of the existing PIN step-up. */}
        <label
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            marginTop: 'var(--space-4)',
            cursor: busy ? 'not-allowed' : 'pointer',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-text)',
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              marginTop: 1,
              accentColor: 'var(--w14-wax-red)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          />
          <span>Ich bestätige, dass dieser Beleg endgültig storniert wird.</span>
        </label>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: 'var(--space-4) 0 0',
              fontSize: 'var(--w14-schrift-betont)',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}

        {/* Reverse-Fitts layout: the destructive action is exiled LEFT — out of
            the bottom-right thumb cluster where the finger rests after a sale —
            while the safe "Abbrechen" escape takes the easy primary slot.
            `space-between` keeps a wide dead gap between the two so an overshoot
            toward Storno lands on empty space, not the other button. */}
        <div
          style={{
            marginTop: 'var(--space-5)',
            display: 'flex',
            gap: 'var(--space-7)',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {/* Die kleine Grösse bringt nur 40 Pixel Höhe mit und lag damit unter
              der Grenze von 44. Sie ist hier bewusst gewählt, damit die
              gefährliche Schaltfläche kleiner wirkt als der sichere Ausweg —
              das bleibt so, nur darf sie dabei nicht untastbar werden. Die
              Breite und das Gewicht ändern sich nicht, allein die Höhe steigt
              auf das erlaubte Mindestmass. */}
          <Button
            variant="destructive"
            size="sm"
            style={{ minHeight: 'var(--w14-touch-min)' }}
            iconLeft={<StornoGlyph size={16} />}
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
          >
            {busy ? 'Storniert…' : 'Storno bestätigen'}
          </Button>
          <Button variant="primary" size="lg" onClick={onClose} disabled={busy} autoFocus>
            Abbrechen
          </Button>
        </div>
          </>
        )}
      </ParchmentCard>
    </div></Fensterboden>
  );
}

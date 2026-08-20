/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PaymentInput — die Zahlfläche selbst
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM DAS EIN EIGENES STÜCK IST (20.08.2026) ──────────────────────────
 *
 * Basel, mehrfach und deutlich: „nicht die Welt ineinanderstopfen."
 * `BezahlenDialog.tsx` trug 4018 Zeilen — die Zahlfläche selbst (2414 Zeilen
 * in EINER Funktion), fünf Bauteile, die Rechtshinweise, die Scheinstückelung
 * und zwei Fehlerhelfer, alles in einer Datei.
 *
 * ⚠️ Ausgezogen wird ZEILE FÜR ZEILE, ohne eine Ziffer am Verhalten zu
 * ändern. Der Zahlweg ist der fiskalische Kern der Kasse; ein Umbau, der
 * „bei der Gelegenheit" auch noch etwas verbessert, wäre an dieser Stelle
 * leichtsinnig. Was hier steht, stand vorher genauso weiter unten.
 *
 * Mit ihm ziehen seine drei Begleiter um, die nur er benutzt:
 * `MethodChip`, `StripeLeserPanel` und `TenderChipButton`.
 */

import { Row } from './Row.js';
import { type TenderChip, computeTenderChips } from './tender-stueckelung.js';
import type { StripeSchritt, Zahlwahl } from './zahlwege.js';
import { AmountPad, Button, Check, Icon, MoneyAmount, Zwischentitel } from '@norns/ui-kit';
import { PAYMENT_METHOD_LABEL } from '@norns/i18n-de';
import { VoucherField, type AppliedVoucher } from './VoucherField.js';
import { ZAHLART_ZIEL } from '../../lib/bedienziele.js';
import { centsAusEingabe, fromCents, toCents } from '../../lib/cart-math.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { isMoneyInput } from '../../lib/decimal.js';
import { type CustomerDetail } from '@norns/api-client';
import { useToastStore } from '../../state/toast-store.js';
import { warumKeinReverseCharge } from './reverse-charge-spiegel.js';

export function PaymentInput({
  paymentChoice,
  setPaymentChoice,
  totalEur,
  dueEur,
  appliedVoucher,
  onApplyVoucher,
  cashReceivedEur,
  setCashReceivedEur,
  changeEur,
  enoughCash,
  cardConfigured,
  canSubmitCash,
  canSubmitCard,
  stripeVerfuegbar,
  stripeSchritt,
  stripeLeserName,
  stripeAbbrechenMoeglich,
  onStripeAbbrechen,
  splitCard,
  setSplitCard,
  canSubmitSplit,
  splitCardEur,
  needsBuyer,
  selectedBuyer,
  onOpenBuyerPicker,
  submitting,
  error,
  onSubmit,
  onPayCardFull,
  onCancel,
  isB2b,
  setIsB2b,
  vatId,
  setVatId,
  viesStatus,
  viesCompany,
  viesAddress,
  manualCompany,
  setManualCompany,
  manualAddress,
  setManualAddress,
  verifyVat,
}: {
  paymentChoice: Zahlwahl;
  setPaymentChoice: (next: Zahlwahl) => void;
  totalEur: string;
  dueEur: string;
  appliedVoucher: AppliedVoucher | null;
  onApplyVoucher: (v: AppliedVoucher | null) => void;
  cashReceivedEur: string;
  setCashReceivedEur: (v: string) => void;
  changeEur: string;
  enoughCash: boolean;
  cardConfigured: boolean;
  canSubmitCash: boolean;
  canSubmitCard: boolean;
  /** Nur mit registriertem Leser wahr — sonst existiert die Zahlart im Wähler nicht. */
  stripeVerfuegbar: boolean;
  stripeSchritt: StripeSchritt;
  stripeLeserName: string | null;
  /** Erst wahr, wenn eine Zahlung läuft (es gibt etwas abzubrechen). */
  stripeAbbrechenMoeglich: boolean;
  onStripeAbbrechen: () => void;
  splitCard: boolean;
  setSplitCard: (v: boolean) => void;
  canSubmitSplit: boolean;
  /** Card remainder to show on the confirm button (null when split invalid). */
  splitCardEur: string | null;
  needsBuyer: boolean;
  selectedBuyer: CustomerDetail | null;
  onOpenBuyerPicker: () => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  /** One-tap full-amount card from the cash panel → straight to the terminal. */
  onPayCardFull: () => void;
  onCancel: () => void;
  isB2b: boolean;
  setIsB2b: (v: boolean) => void;
  vatId: string;
  setVatId: (v: string) => void;
  viesStatus: 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable' | 'timeout';
  viesCompany: string;
  viesAddress: string;
  manualCompany: string;
  setManualCompany: (v: string) => void;
  manualAddress: string;
  setManualAddress: (v: string) => void;
  verifyVat: () => void;
}): JSX.Element {
  const buttonLabel = (() => {
    if (submitting) return 'Schließt ab…';
    // § 10 GwG — when a verified buyer is still missing the primary action
    // routes to the KaeuferPicker, not to finalize. Label it as that step.
    if (needsBuyer) return 'Käufer zuordnen';
    // Explicit "this RECORDS the sale" wording — the old "Beleg ausgeben" read
    // like a print action, not a finalize.
    // Phase C1 — split routes through the card terminal for the remainder.
    if (paymentChoice === 'CASH') return splitCard ? 'Restbetrag Karte' : 'Zahlung abschließen';
    if (paymentChoice === 'STRIPE_TERMINAL') return 'Kartenzahlung starten';
    return 'Karte autorisieren';
  })();

  // The button stays clickable while a buyer is required (it opens the picker);
  // otherwise it follows the per-method finalize guard. In split mode the cash
  // panel uses the split guard (valid partial cash + card remainder).
  const canSubmit = needsBuyer
    ? !submitting
    : paymentChoice === 'CASH'
      ? splitCard
        ? canSubmitSplit
        : canSubmitCash
      : paymentChoice === 'STRIPE_TERMINAL'
        ? canSubmitCard && stripeVerfuegbar
        : canSubmitCard;

  // Smart-denomination quick-tender chips — presentation only, derived from the
  // post-voucher `dueEur` via the canonical cents primitives (no math change).
  // Hidden in split mode (the cash leg there is a deliberate partial amount).
  const dueCents = (() => {
    try {
      return toCents(dueEur);
    } catch {
      return 0n;
    }
  })();
  const tenderChips = splitCard ? [] : computeTenderChips(dueCents);

  // Live "Noch zu zahlen" — outstanding cash (due minus entered cash, floored
  // at 0). Presentation only; the authoritative gate stays `canSubmit`.
  const cashOutstandingBasisCents = dueCents;
  const cashOutstandingCents = (() => {
    if (dueCents <= 0n) return 0n;
    let entered = 0n;
    if (isMoneyInput(cashReceivedEur)) {
      try {
        entered = centsAusEingabe(cashReceivedEur) ?? 0n;
      } catch {
        entered = 0n;
      }
    }
    return entered >= dueCents ? 0n : dueCents - entered;
  })();

  return (
    <>
      {/* Scrollable payment body — overflows independently so the pinned footer
          below stays reachable no matter how tall the AmountPad is. Plain block
          flow inside, so the existing spacing is unchanged. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-summe)',
            textAlign: 'center',
          }}
        >
          {/*
            ── EIN WORT, ZWEI BEDEUTUNGEN (26.07.2026) ──────────────────────
            An der laufenden Kasse gesehen: der Warenkorb heisst „Karte" (die
            Ladenkarte, auf der der Verkauf entsteht — die Sprache dieses
            Hauses), und hier hiess die ZAHLART ebenfalls „Karte". Derselbe
            Kassierer las im selben Vorgang zweimal dasselbe Wort für zwei
            verschiedene Dinge, und beim Bezahlen ist das die teuerste Stelle
            dafür.

            Die Ladenkarte behält ihren Namen; die Zahlart heisst jetzt, was
            sie ist. „Kartenzahlung" ist eindeutig und im Handel üblich.
          */}
          Bezahlen ·{' '}
          {paymentChoice === 'CASH'
            ? 'Bar'
            : paymentChoice === 'STRIPE_TERMINAL'
              ? PAYMENT_METHOD_LABEL.STRIPE_TERMINAL
              : 'Kartenzahlung'}
        </h2>

        {/* GwG §10: a sale ≥ €2.000 needs a KYC-verified buyer. The server
            (transactions_validate_kyc) is the authoritative gate; this block is
            the UX that lets the cashier satisfy it — open the KaeuferPicker to
            attach + ID-verify a buyer, or show the verified buyer once chosen. */}
        {evaluateKycGate({ direction: 'VERKAUF', totalCents: toCents(totalEur), customer: null })
          .thresholdReached && (
          <div
            style={{
              margin: '12px 0 0',
              padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
              borderRadius: 'var(--w14-radius-button)',
              border: `1px solid ${needsBuyer ? 'var(--w14-wax-red)' : 'var(--w14-gold)'}`,
              background: 'var(--w14-parchment-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w14-abstand-8)',
            }}
          >
            {selectedBuyer && !needsBuyer ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-10)',
                }}
              >
                <span
                  style={{
                    color: 'var(--w14-ink-aged)',
                    fontFamily: 'var(--w14-font-display)',
                    fontSize: 'var(--w14-schrift-text)',
                  }}
                >
                  Käufer:{' '}
                  <strong style={{ color: 'var(--w14-gold)' }}>{selectedBuyer.fullName}</strong> ·
                  Ausweis geprüft ✓
                </span>
                <button
                  type="button"
                  onClick={onOpenBuyerPicker}
                  disabled={submitting}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--w14-ink-faded)',
                    fontFamily: 'var(--w14-font-display)',
                    fontStyle: 'italic',
                    fontSize: 'var(--w14-schrift-feld)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  ändern
                </button>
              </div>
            ) : (
              <>
                <p
                  role="note"
                  style={{
                    margin: 0,
                    color: 'var(--w14-ink-aged)',
                    fontSize: 'var(--w14-schrift-feld)',
                    lineHeight: 1.4,
                  }}
                >
                  Käufer zuordnen. Ausweis erforderlich (ab 2.000&nbsp;€, § 10 GwG). Ohne geprüften
                  Käufer lehnt das System den Verkauf ab.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onOpenBuyerPicker}
                  disabled={submitting}
                >
                  Käufer zuordnen
                </Button>
              </>
            )}
          </div>
        )}

        {/* Payment-method toggle */}
        <div
          role="tablist"
          aria-label="Zahlungsart"
          style={{ display: 'flex', justifyContent: 'center', gap: 'var(--w14-abstand-8)', marginTop: 10 }}
        >
          <MethodChip
            active={paymentChoice === 'CASH'}
            label="Barzahlung"
            onClick={() => setPaymentChoice('CASH')}
            disabled={submitting}
          />
          <MethodChip
            active={paymentChoice === 'ZVT_CARD'}
            label="Kartenzahlung"
            onClick={() => setPaymentChoice('ZVT_CARD')}
            disabled={submitting || !cardConfigured}
            {...(!cardConfigured
              ? { disabledReason: 'Terminal nicht konfiguriert (Einstellungen → Hardware)' }
              : {})}
          />
          {/* Die eine Geste am Stripe-Leser: der Chip EXISTIERT nur, wenn die
              Leser-Abfrage mindestens einen registrierten Leser meldet. Kein
              ausgegrauter Platzhalter, kein Fehlerrot — ohne Einrichtung
              sieht der Laden hier schlicht nichts Neues. Beschriftung ist
              exakt das i18n-Wort der Zahlart. */}
          {stripeVerfuegbar && (
            <MethodChip
              active={paymentChoice === 'STRIPE_TERMINAL'}
              label={PAYMENT_METHOD_LABEL.STRIPE_TERMINAL}
              onClick={() => setPaymentChoice('STRIPE_TERMINAL')}
              disabled={submitting}
            />
          )}
        </div>

        {/* B2B Reverse Charge Toggle & Panel */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-8)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-schrift-text)',
              color: 'var(--w14-ink-aged)',
            }}
          >
            <input
              type="checkbox"
              checked={isB2b}
              onChange={(e) => setIsB2b(e.target.checked)}
              disabled={submitting}
              style={{
                accentColor: 'var(--w14-gold)',
                cursor: submitting ? 'not-allowed' : 'pointer',
                width: 16,
                height: 16,
              }}
            />
            <span>B2B Reverse Charge (§ 13b UStG)</span>
          </label>

          {isB2b && (
            <div
              style={{
                padding: 'var(--w14-abstand-12)',
                borderRadius: 6,
                backgroundColor: 'var(--w14-parchment-2)',
                border: '1px dashed var(--w14-rule)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--w14-abstand-10)',
              }}
            >
              <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    placeholder="USt-IdNr. (z.B. DE123456789)"
                    value={vatId}
                    onChange={(e) => setVatId(e.target.value)}
                    disabled={submitting || viesStatus === 'checking'}
                    style={{
                      width: '100%',
                      padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
                      borderRadius: 'var(--w14-radius-fein)',
                      border: '1px solid var(--w14-feldlinie)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: 'var(--w14-schrift-text)',
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={verifyVat}
                  disabled={submitting || viesStatus === 'checking' || !vatId.trim()}
                  style={{ alignSelf: 'stretch', padding: '0 var(--w14-abstand-16)' }}
                >
                  {viesStatus === 'checking' ? 'Prüft...' : 'Prüfen'}
                </Button>
              </div>

              {/* VIES Status display */}
              {viesStatus !== 'idle' && (
                <div style={{ fontSize: 'var(--w14-schrift-text)', fontFamily: 'var(--w14-font-display)' }}>
                  {viesStatus === 'checking' && (
                    <span style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
                      USt-IdNr. wird über EU-VIES validiert…
                    </span>
                  )}
                  {viesStatus === 'valid' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
                      <span style={{ color: 'var(--w14-gold)', fontWeight: 600 }}>
                        ✓ USt-IdNr. gültig
                      </span>
                      {viesCompany && viesCompany !== '---' && (
                        <div style={{ color: 'var(--w14-ink-aged)' }}>
                          <strong>Firma:</strong> {viesCompany}
                        </div>
                      )}
                      {viesAddress && viesAddress !== '---' && (
                        <div style={{ color: 'var(--w14-ink-faded)' }}>
                          <strong>Adresse:</strong> {viesAddress}
                        </div>
                      )}
                    </div>
                  )}
                  {viesStatus === 'invalid' && (
                    <span style={{ color: 'var(--w14-wax-red)', fontWeight: 600 }}>
                      ✗ Ungültige USt-IdNr. laut EU-VIES-Datenbank.
                    </span>
                  )}
                  {viesStatus === 'unavailable' && (
                    <span style={{ color: 'var(--w14-wax-red)' }}>
                      ⚠ VIES-Dienst nicht erreichbar. Manuelle Prüfung erforderlich.
                    </span>
                  )}
                  {viesStatus === 'timeout' && (
                    <span style={{ color: 'var(--w14-wax-red)' }}>
                      ⚠ Zeitüberschreitung bei VIES-Prüfung. Manuelle Prüfung erforderlich.
                    </span>
                  )}

                  {/* Was das für den PREIS bedeutet. Die Zeilen darüber sagen,
                      was die EU geantwortet hat; erst dieser Satz sagt, was
                      dieser Verkauf jetzt kostet. Ohne ihn sah der Kassierer
                      „nicht erreichbar", während die Summe still um 19 % fiel —
                      und genau diesen Betrag nannte er dem Kunden. */}
                  {warumKeinReverseCharge(isB2b, viesStatus) !== null && (
                    <p
                      style={{
                        margin: 'var(--w14-abstand-8) 0 0',
                        padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
                        borderRadius: 'var(--w14-radius-button)',
                        background: 'var(--w14-parchment)',
                        color: 'var(--w14-ink)',
                        lineHeight: 1.55,
                        textWrap: 'pretty',
                      }}
                    >
                      {warumKeinReverseCharge(isB2b, viesStatus)}
                    </p>
                  )}
                </div>
              )}

              {/* Manual fallback fields if name/address is masked or VIES is down/timeout */}
              {(viesStatus === 'unavailable' ||
                viesStatus === 'timeout' ||
                (viesStatus === 'valid' && (!viesCompany || viesCompany === '---'))) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)', marginTop: 4 }}>
                  <div
                    style={{
                      fontSize: 'var(--w14-schrift-feld)',
                      color: 'var(--w14-ink-faded)',
                      fontStyle: 'italic',
                    }}
                  >
                    {viesStatus === 'valid'
                      ? 'Daten durch EU-Datenschutz ausgeblendet. Bitte manuell ergänzen:'
                      : 'Bitte Firmenname und Adresse manuell eintragen:'}
                  </div>
                  <input
                    type="text"
                    placeholder="Firmenname"
                    value={manualCompany}
                    onChange={(e) => setManualCompany(e.target.value)}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: 'var(--w14-abstand-6) var(--w14-abstand-10)',
                      borderRadius: 'var(--w14-radius-fein)',
                      border: '1px solid var(--w14-feldlinie)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: 'var(--w14-schrift-text)',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Adresse (z.B. Str, PLZ, Ort)"
                    value={manualAddress}
                    onChange={(e) => setManualAddress(e.target.value)}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: 'var(--w14-abstand-6) var(--w14-abstand-10)',
                      borderRadius: 'var(--w14-radius-fein)',
                      border: '1px solid var(--w14-feldlinie)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: 'var(--w14-schrift-text)',
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <Zwischentitel label="Beleg" />

        {/* Permanent money anchor (design-brief §1) — the amount due is the
            single largest type on the payment screen, .w14-tabular, high
            contrast for the 80cm read. It never hides behind a tap.
            FONT RULE (cross-app): the single biggest money figure is TABULAR
            MONO (--w14-font-mono) in BOTH apps — this matches the mobile money
            hero in apps/mobile sell/FiscalConfirmSheet (font-mono-medium).
            Serif is reserved for titles; precise money stays column-aligned. */}
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
              fontSize: 'var(--w14-schrift-betont)',
              letterSpacing: '0.08em',
              color: 'var(--w14-ink-aged)',
            }}
          >
            Zu zahlen
          </span>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-anschlag)',
              fontWeight: 700,
              lineHeight: 1,
              color: 'var(--w14-ink)',
            }}
          >
            <MoneyAmount valueEur={totalEur} />
          </span>
        </div>

        {paymentChoice === 'CASH' ? (
          <>
            {/* Gift voucher — covers up to the full total; the rest is paid in cash. */}
            <VoucherField
              applied={appliedVoucher}
              onApplied={onApplyVoucher}
              disabled={submitting}
            />
            {appliedVoucher && (
              <table
                className="w14-tabular"
                style={{
                  marginTop: 12,
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--w14-font-mono)',
                }}
              >
                <tbody>
                  <Row
                    label="Gutschein"
                    value={
                      <MoneyAmount
                        valueEur={`-${fromCents(toCents(totalEur) - toCents(dueEur))}`}
                      />
                    }
                    valueColor="var(--w14-gold)"
                  />
                  <Row
                    label="Zu zahlen (bar)"
                    value={<MoneyAmount valueEur={dueEur} emphasis />}
                    emphasised
                  />
                </tbody>
              </table>
            )}

            {/* Phase C1 — Bar + Karte split. When on, the entered cash is a
                PARTIAL leg and the remainder is charged to the card terminal.
                Hidden when no card terminal is configured (a split needs it). */}
            {toCents(dueEur) > 0n && cardConfigured && (
              <label
                style={{
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-8)',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: 'var(--w14-schrift-text)',
                  color: 'var(--w14-ink-aged)',
                }}
              >
                <input
                  type="checkbox"
                  checked={splitCard}
                  onChange={(e) => setSplitCard(e.target.checked)}
                  disabled={submitting}
                  style={{
                    accentColor: 'var(--w14-gold)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    width: 16,
                    height: 16,
                  }}
                />
                <span>Betrag aufteilen, Restbetrag per Karte</span>
              </label>
            )}

            {/* Smart-denomination quick-tender (design-brief §1) — chips
                computed from the due via money-core; one tap pre-fills the
                exact cash field so the dominant cash sale needs zero keypad
                entry, and the live Rückgeld below updates instantly. Plus a
                one-tap full-amount Karte that goes straight to the terminal. */}
            {tenderChips.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    display: 'block',
                    marginBottom: 8,
                    fontSize: 'var(--w14-schrift-zeile)',
                    letterSpacing: '0.08em',
                    color: 'var(--w14-ink-aged)',
                  }}
                >
                  Schnellzahlung
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-8)' }}>
                  {tenderChips.map((chip) => (
                    <TenderChipButton
                      key={chip.valueEur + chip.label}
                      chip={chip}
                      active={isMoneyInput(cashReceivedEur) && cashReceivedEur === chip.valueEur}
                      disabled={submitting}
                      onClick={() => setCashReceivedEur(chip.valueEur)}
                    />
                  ))}
                  {cardConfigured && (
                    <button
                      type="button"
                      onClick={onPayCardFull}
                      disabled={submitting}
                      style={{
                        minHeight: 52,
                        padding: '0 var(--w14-abstand-16)',
                        flex: '1 1 auto',
                        background: 'var(--w14-parchment-2)',
                        border: '1px solid var(--w14-accent)',
                        borderRadius: 'var(--w14-radius-button)',
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        opacity: submitting ? 0.5 : 1,
                        fontFamily: 'var(--w14-font-display)',
                        fontSize: 'var(--w14-schrift-betont)',
                        fontWeight: 600,
                        color: 'var(--w14-accent)',
                        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
                      }}
                    >
                      Kartenzahlung
                    </button>
                  )}
                </div>
              </div>
            )}

            {toCents(dueEur) > 0n && (
              <div style={{ marginTop: 16 }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    display: 'block',
                    marginBottom: 8,
                    fontSize: 'var(--w14-schrift-zeile)',
                    letterSpacing: '0.08em',
                    color: 'var(--w14-ink-aged)',
                  }}
                >
                  {splitCard ? 'Barbetrag (Teilzahlung)' : 'Erhaltener Betrag (bar)'}
                </span>
                {/* On-screen keypad — feeds the SAME cashReceivedEur the keyboard did. */}
                <div
                  style={{
                    opacity: submitting ? 0.5 : 1,
                    pointerEvents: submitting ? 'none' : 'auto',
                  }}
                >
                  <AmountPad
                    value={cashReceivedEur}
                    onChange={setCashReceivedEur}
                    dueEur={dueEur}
                  />
                </div>
                {!splitCard && (
                  <p
                    style={{
                      margin: '0.45rem 0 0',
                      fontSize: 'var(--w14-schrift-zeile)',
                      textAlign: 'center',
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    Tipp: <strong>Enter</strong> füllt „Passend“ und schließt ab
                  </p>
                )}
              </div>
            )}

            {/* Prominent live money readout (design-brief §1). Three live
                states, all presentation-only (derived from the entered cash vs
                the post-voucher due via cents primitives):
                  • split mode → the exact card remainder ("Restbetrag (Karte)");
                  • cash short → "Noch zu zahlen" (the outstanding amount that
                    keeps the Bezahlen button disabled until it hits €0,00);
                  • cash covers → "Rückgeld" in verdigris (zero-change = €0,00). */}
            {(() => {
              // Outstanding = how much cash is still owed (0 once covered).
              const outstandingCents = (() => {
                if (cashOutstandingBasisCents <= 0n) return 0n;
                return cashOutstandingCents;
              })();
              const isShort = !splitCard && outstandingCents > 0n;
              const label = splitCard
                ? 'Restbetrag (Karte)'
                : isShort
                  ? 'Noch zu zahlen'
                  : 'Rückgeld';
              const valueColor = splitCard
                ? splitCardEur !== null
                  ? 'var(--w14-gold)'
                  : 'var(--w14-ink-faded)'
                : isShort
                  ? 'var(--w14-ink-aged)'
                  : enoughCash
                    ? 'var(--w14-verdigris)'
                    : 'var(--w14-ink-faded)';
              const displayValue = splitCard
                ? (splitCardEur ?? '0.00')
                : isShort
                  ? fromCents(outstandingCents)
                  : enoughCash
                    ? changeEur
                    : '0.00';
              return (
                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 'var(--w14-abstand-12)',
                    padding: 'var(--w14-abstand-12) var(--w14-abstand-16)',
                    background: 'var(--w14-parchment-2)',
                    border: '1px solid var(--w14-rule)',
                    borderRadius: 'var(--w14-radius-card)',
                  }}
                >
                  <span
                    className="w14-smallcaps"
                    style={{
                      fontSize: 'var(--w14-schrift-betont)',
                      letterSpacing: '0.08em',
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    {label}
                  </span>
                  {/* Das Rückgeld ist der zweite Held des Dialogs: die Zahl,
                      die die Hand zurückgibt, auf Armlänge lesbar. Darum die
                      Spaltenstufe — dieselbe wie das Gesamt der Karte. Die
                      Grösse steht an der Aufrufstelle, nicht im Bauteil. */}
                  <MoneyAmount
                    valueEur={displayValue}
                    emphasis
                    style={{
                      fontSize: 'var(--w14-betrag-spalte)',
                      lineHeight: 1,
                      color: valueColor,
                    }}
                  />
                </div>
              );
            })()}
          </>
        ) : paymentChoice === 'ZVT_CARD' ? (
          <p
            style={{
              margin: '18px 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-betont)',
              textAlign: 'center',
            }}
          >
            Bei Klick wird das Karten-Terminal angesprochen. Der Kunde bestätigt am Terminal.
          </p>
        ) : (
          <StripeLeserPanel
            schritt={stripeSchritt}
            leserName={stripeLeserName}
            abbrechenMoeglich={stripeAbbrechenMoeglich}
            onAbbrechen={onStripeAbbrechen}
          />
        )}

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
      </div>

      {/* Pinned action footer — never scrolls, stays reachable no matter how
          tall the body is. Serves BOTH panels: CASH (finalize once cash ≥ due)
          and ZVT_CARD (authorize). canSubmit already encodes the per-panel
          guard, so the wiring is unchanged — only its position + the label. */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 'var(--w14-abstand-12)',
          alignItems: 'stretch',
          marginTop: 14,
          paddingTop: 'var(--w14-abstand-14)',
          borderTop: '1px solid var(--w14-rule)',
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={submitting}
          style={{ flex: 'none', alignSelf: 'stretch' }}
        >
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="lg"
          iconLeft={<Icon icon={Check} size={18} />}
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            flex: 1,
            // Bezahlen = effectively-infinite Fitts target (design-brief §1):
            // 72–88px tall, brass, bottom-right-anchored. The largest, most
            // dominant action in the dialog — survives the squint test.
            minHeight: 78,
            fontSize: 'var(--w14-schrift-lead)',
            fontWeight: 600,
            // Goes solid brass the moment it can record the sale — an
            // unmistakable "ready to finalize" affordance (matches the active
            // brass treatment used elsewhere).
            ...(canSubmit
              ? {
                  backgroundColor: 'var(--w14-accent)',
                  // Volle Kurzschrift statt nur borderColor: der ui-kit-Knopf
                  // setzt `border` als Kurzschrift, und React warnt beim
                  // Neuzeichnen, wenn Lang- und Kurzform gemischt werden
                  // (gemessen am 26.07.2026 im lebenden Durchlauf — der
                  // einzige rote Konsoleneintrag im ganzen Geldweg).
                  border: '1px solid var(--w14-accent)',
                  color: 'var(--w14-accent-ink)',
                }
              : {}),
          }}
        >
          {buttonLabel}
          {paymentChoice === 'CASH' && !submitting && !needsBuyer ? (
            <>
              {' · '}
              {/* Collect the POST-voucher amount, not the gross total — when a
                  voucher covers part of the sale the cashier takes `dueEur` in
                  cash, so the button must read that (else it overstates).
                  In split mode the card covers the remainder, so the button
                  reads the CARD leg (what the terminal will authorize). */}
              <MoneyAmount valueEur={splitCard ? (splitCardEur ?? dueEur) : dueEur} />
            </>
          ) : null}
          {paymentChoice === 'STRIPE_TERMINAL' && !submitting && !needsBuyer ? (
            <>
              {' · '}
              {/* Die eine Geste: der Betrag kommt aus dem Warenkorb, niemand
                  tippt eine Summe ab — der Knopf zeigt genau, was der Leser
                  gleich vom Kunden verlangt (den vollen Warenkorb-Betrag). */}
              <MoneyAmount valueEur={totalEur} />
            </>
          ) : null}
        </Button>
      </div>
    </>
  );
}

function MethodChip({
  active,
  label,
  onClick,
  disabled,
  disabledReason,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  // ── DER FINGER SIEHT KEIN title= (27.07.2026, Tast-Auskünfte) ──────────
  // Auf der Theke gibt es keinen Mauszeiger. Ein Chip, der einen GRUND für
  // seine Sperre kennt, bleibt deshalb drückbar und nennt den Grund in der
  // Meldungsblase (aria-disabled statt disabled). Nur eine Sperre OHNE
  // Grund (etwa während des Sendens) bleibt ein echtes disabled.
  const gesperrtMitGrund = Boolean(disabled) && disabledReason !== undefined;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled && disabledReason !== undefined) {
          addToast({ tone: 'warn', title: `${label} nicht verfügbar`, body: disabledReason });
          return;
        }
        if (disabled) return;
        onClick();
      }}
      disabled={disabled === true && !gesperrtMitGrund}
      title={disabled ? disabledReason : undefined}
      className="w14-smallcaps"
      style={{
        // ── DAS KLEINSTE ZIEL WAR DIE WICHTIGSTE ENTSCHEIDUNG (26.07.2026) ──
        // Gemessen: dieser Chip war 24 Punkte hoch, waehrend die Schein-Chips
        // darunter laengst 52 tragen. Bar oder Karte ist die teuerste
        // Fehlberuehrung des Dialogs; jetzt gilt das gemeinsame 44er-Touchziel
        // aus bedienziele.ts. Der Korpus scrollt eigenstaendig, nichts wird
        // verdraengt.
        minHeight: ZAHLART_ZIEL,
        padding: 'var(--w14-abstand-10) var(--w14-abstand-20)',
        fontFamily: 'var(--w14-font-display)',
        letterSpacing: '0.08em',
        fontSize: 'var(--w14-schrift-text)',
        backgroundColor: active ? 'var(--w14-accent)' : 'var(--w14-parchment-2)',
        color: active ? 'var(--w14-accent-ink)' : 'var(--w14-ink-faded)',
        border: `1px solid ${active ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-pille)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * Die sichtbaren Schritte der einen Geste am Stripe-Leser.
 *
 * Jeder Schrittwechsel tritt ruhig ein (nur opacity/transform, Dauer und
 * Kurve aus den frischen Haus-Marken `--w14-dur-press`/`--w14-ease-curator`;
 * der `key` auf dem Kasten lässt den Eintritt je Schritt neu laufen, reduced
 * motion nullt die Marken-Dauer global). Der Abbrechen-Knopf steht während
 * des Wartens IM Panel — erreichbar, ≥ 44 pt (`ZAHLART_ZIEL`), und sagt, was
 * er tut: die Zahlung am Leser stoppen, nicht den Dialog schließen.
 */
function StripeLeserPanel({
  schritt,
  leserName,
  abbrechenMoeglich,
  onAbbrechen,
}: {
  schritt: StripeSchritt;
  leserName: string | null;
  abbrechenMoeglich: boolean;
  onAbbrechen: () => void;
}): JSX.Element {
  const leserWort = leserName ? `„${leserName}"` : 'Der Leser';
  const text = (() => {
    switch (schritt.art) {
      case 'RUHT':
        return `${leserWort} zeigt dem Kunden beim Start die echten Positionen aus dem Warenkorb, niemand tippt eine Summe ab. Der Kunde hält dann seine Karte an den Leser.`;
      case 'TROCKENLAUF':
        return 'Der Vorgang wird geprüft, bevor eine Karte belastet wird…';
      case 'STARTEN':
        return `${leserWort} wird angesprochen…`;
      case 'WARTEN':
        return 'Der Leser zeigt dem Kunden die Positionen … warten auf Karte.';
      case 'BUCHEN':
        return 'Zahlung erfolgt. Der Beleg wird gebucht…';
    }
  })();
  return (
    <div
      key={schritt.art}
      style={{
        marginTop: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--w14-abstand-12)',
        animation: 'w14-leserschritt-ein var(--w14-dur-press) var(--w14-ease-curator)',
      }}
    >
      <p
        role="status"
        style={{
          margin: 0,
          color: schritt.art === 'RUHT' ? 'var(--w14-ink-faded)' : 'var(--w14-ink-aged)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: schritt.art === 'RUHT' ? 'italic' : 'normal',
          fontSize: 'var(--w14-schrift-betont)',
          lineHeight: 1.5,
          textAlign: 'center',
        }}
      >
        {text}
      </p>
      {schritt.art === 'WARTEN' && schritt.hinweis && (
        <p
          role="status"
          style={{
            margin: 0,
            color: 'var(--w14-gold)',
            fontFamily: 'var(--w14-font-display)',
            fontSize: 'var(--w14-schrift-text)',
            lineHeight: 1.45,
            textAlign: 'center',
            animation: 'w14-leserschritt-ein var(--w14-dur-exit) var(--w14-ease-exit)',
          }}
        >
          {schritt.hinweis}
        </p>
      )}
      {schritt.art === 'WARTEN' && (
        <Button
          variant="ghost"
          size="lg"
          onClick={onAbbrechen}
          disabled={!abbrechenMoeglich}
          style={{ minHeight: ZAHLART_ZIEL, alignSelf: 'stretch' }}
        >
          Zahlung am Leser abbrechen
        </Button>
      )}
      {/* Haus-Regel „Inhalte starten nie unsichtbar": nur der STARTZUSTAND
          steht im Keyframe; ohne Animation (reduced motion nullt die Dauer)
          steht der Schritt sofort fertig da. */}
      <style>{`
        @keyframes w14-leserschritt-ein {
          from { opacity: 0; transform: translateY(4px); }
        }
      `}</style>
    </div>
  );
}

/**
 * Smart-denomination quick-tender chip (design-brief §1). A ≥48px touch target
 * (hot-path / WCAG 2.5.5) that pre-fills the cash field with a single tap. The
 * exact-tender chip ("Passend") reads brass to flag the zero-change happy path;
 * the note chips render their euro value in tabular figures.
 */
function TenderChipButton({
  chip,
  active,
  disabled,
  onClick,
}: {
  chip: TenderChip;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        minHeight: 52,
        padding: '0 var(--w14-abstand-16)',
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--w14-abstand-2)',
        background: active ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
        border: `1px solid ${chip.exact ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-button)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
      }}
    >
      {chip.exact ? (
        <span
          className="w14-smallcaps"
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 600,
            fontSize: 'var(--w14-schrift-feld)',
            letterSpacing: '0.06em',
            color: active ? 'var(--w14-ink-aged)' : 'var(--w14-accent)',
          }}
        >
          Passend
        </span>
      ) : null}
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: chip.exact ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-grund)',
          fontWeight: 600,
          color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink)',
        }}
      >
        <MoneyAmount valueEur={chip.valueEur} />
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Result phase
// ────────────────────────────────────────────────────────────────────────

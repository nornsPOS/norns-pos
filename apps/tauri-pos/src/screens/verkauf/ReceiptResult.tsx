/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ReceiptResult — was nach dem Bezahlen dasteht
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
 */

import { Row } from './Row.js';
import { Button, MoneyAmount, Seal, Zwischentitel } from '@norns/ui-kit';
import { StornoDialog } from './StornoDialog.js';
import { type FinalizeResponse } from '@norns/api-client';
import { useState } from 'react';

export function ReceiptResult({
  finalized,
  cashReceivedEur,
  changeEur,
  stripeZahlungId,
  onDismiss,
}: {
  finalized: FinalizeResponse;
  cashReceivedEur: string;
  changeEur: string;
  /**
   * Die erfolgreich belastete Leser-Zahlung dieses Belegs (nur beim Weg über
   * den Stripe-Leser). Der Sofort-Storno bietet damit die Erstattung an und
   * zeigt die Server-Auskunft über den Weg (sofort oder SEPA) wörtlich.
   */
  stripeZahlungId: string | null;
  onDismiss: () => void;
}): JSX.Element {
  const [stornoOpen, setStornoOpen] = useState(false);
  // Offline-queued sales have no server-side transaction yet (locator OFFLINE-…)
  // — storno would 404, so it's only offered once the sale is really finalized.
  const canStorno = !finalized.receiptLocator.startsWith('OFFLINE-');
  return (
    <>
      {/* Der wichtigste Moment des Tages: das Siegel setzt sich auf das Papier
          (1.06 → 1, einmal, Haus-Ausklang), ein feiner Gold-Ring verklingt.
          Kein Konfetti — ein Stempel.

          Bauart nach der Haus-Regel „Inhalte starten nie unsichtbar": der
          Siegel-Keyframe definiert nur den STARTZUSTAND (from), der Endzustand
          ist der natürliche Stil — ohne Animation (reduced motion nullt die
          Dauer) steht das Siegel sofort fertig da. Der Ring ist von Natur aus
          unsichtbar (opacity 0) und leuchtet NUR während der Animation auf. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Seal
            size="md"
            tone="gold"
            // Die Raute des Hauses, ausdrücklich gesetzt. Ohne sie fiel das
            // Siegel auf seine Vorgabe zurück, und die war bis zum 04.08.2026
            // ein N: ein GOLDENES N über jedem gebuchten Verkauf.
            label="◊"
            title="Verkauf gebucht"
            style={{
              animation: 'w14-siegel-setzen var(--w14-dur-base) var(--w14-ease-curator)',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: -6,
              borderRadius: '50%',
              border: '1px solid var(--w14-gilt)',
              opacity: 0,
              animation: 'w14-siegel-ring var(--w14-dur-base) var(--w14-ease-exit)',
            }}
          />
        </span>
        <style>{`
          @keyframes w14-siegel-setzen {
            from { opacity: 0.4; transform: scale(1.06); }
          }
          @keyframes w14-siegel-ring {
            0% { opacity: 0.55; transform: scale(0.92); }
            100% { opacity: 0; transform: scale(1.12); }
          }
        `}</style>
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-summe)',
          textAlign: 'center',
        }}
      >
        Beleg ausgegeben
      </h2>
      <Zwischentitel />

      <table
        className="w14-tabular"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--w14-font-mono)',
        }}
      >
        <tbody>
          <Row
            label="Beleg-Nr."
            value={
              <span
                className="w14-tabular"
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
          <Row
            label="Summe"
            value={<MoneyAmount valueEur={finalized.totalEur} emphasis />}
            emphasised
          />
          <Row label="Bar erhalten" value={<MoneyAmount valueEur={cashReceivedEur || '0.00'} />} />
          <Row
            label="Wechselgeld"
            value={<MoneyAmount valueEur={changeEur} emphasis />}
            emphasised
            valueColor="var(--w14-gold)"
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
        {finalized.id.slice(0, 8)}…
      </p>

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center', gap: 'var(--w14-abstand-12)' }}>
        {canStorno && (
          <Button variant="ghost" size="lg" onClick={() => setStornoOpen(true)}>
            Stornieren
          </Button>
        )}
        <Button variant="primary" size="lg" onClick={onDismiss}>
          Neue Karte
        </Button>
      </div>

      {stornoOpen && (
        <StornoDialog
          transactionId={finalized.id}
          receiptLocator={finalized.receiptLocator}
          stripeTerminalZahlungId={stripeZahlungId}
          onClose={() => setStornoOpen(false)}
          onStornoed={() => {
            setStornoOpen(false);
            onDismiss();
          }}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Shared row
// ────────────────────────────────────────────────────────────────────────

/** True when the server refused the sale for a missing § 10 GwG buyer ID. */

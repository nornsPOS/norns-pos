/**
 * KassenbuchPanel — the Kasse "open shift" sub-view.
 *
 * Reads the shift snapshot + the dashboard summary (for `currentShiftRevenueEur`,
 * which the Werkstatt also surfaces). The expected drawer balance is computed
 * client-side from the opening float + the shift's cash sales — the
 * server's final number lands inside the Schichtschluss. We label the
 * client-side estimate as such so the operator never confuses it with the
 * authoritative close-out result.
 *
 * ── ⚠️ ZWEI SCHRITTE, DIE HIER LANGE EINER WAREN (13.08.2026) ──────────────
 *
 * Diese Fläche trug die Überschrift „Tagesabschluss" über einem Knopf „Tag
 * abschließen", und der Infopunkt daneben behauptete, der Z-Bon sei „der
 * gesetzliche Tagesabschluss nach KassenSichV". Gerufen wurde aber
 * `shiftsApi.close` — der Schichtschluss.
 *
 * Es sind ZWEI Schritte, und sie gehören in dieser Reihenfolge:
 *   1. SCHICHTSCHLUSS — die Lade blind zählen, Differenz feststellen, Schicht
 *      schliessen. Das ist der Schritt, der von HIER aus geht.
 *   2. TAGESABSCHLUSS — den Kassentag als Ganzes abschliessen
 *      (`closingsApi.finalize`). Er verlangt, dass KEINE Schicht mehr offen
 *      ist (`closings-finalize.ts:289`), lebt deshalb auf der Fläche ohne
 *      offene Schicht (`ShiftOpenPanel.tsx`) und wird hier nur angekündigt.
 */

import { useMemo, useState } from 'react';

import type { ShiftView } from '@norns/api-client';
import { InfoPunkt,
  ArrowDownToLine,
  ArrowUpFromLine,
  Button,
  Zwischentitel,
  Icon,
  MoneyAmount,
  ParchmentCard,
} from '@norns/ui-kit';

import { useDashboardSummary } from '../../hooks/useDashboardSummary.js';
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter.js';
import { RECEIPT_VAT_LOCK_REASON, fehlendeBelegangabenAufNutzlast } from '../../lib/shop-info.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';

import { ReceiptPreview } from '../verkauf/ReceiptPreview.js';

import { CashMovementDialog, type MovementKind } from './CashMovementDialog.js';
import { RecentSalesPanel } from './RecentSalesPanel.js';
import { SchichtschlussDialog } from './ZBonDialog.js';

export interface KassenbuchPanelProps {
  shift: ShiftView;
}

function openedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export function KassenbuchPanel({ shift }: KassenbuchPanelProps): JSX.Element {
  const { data: dashboard } = useDashboardSummary();
  const [cashKind, setCashKind] = useState<MovementKind | null>(null);
  const [schichtschlussOffen, setSchichtschlussOffen] = useState<boolean>(false);
  const [reprintOpen, setReprintOpen] = useState<boolean>(false);
  const lastReceipt = useLastReceiptStore((s) => s.lastReceipt);
  const { canPrint, printing, print } = useReceiptPrinter();

  /**
   * ⚠️ 09.08.2026: hier stand `currentShiftRevenueEur` — der GESAMTE Umsatz
   * der Schicht, Kartenzahlung inbegriffen. Die Grösse hiess schon damals
   * `cashRevenueEur`, hielt aber etwas anderes.
   *
   * Folge: nach einem Kartentag von 2.000 EUR sagte das Kassenbuch einen
   * erwarteten Bestand von 2.000 EUR mehr, als in der Lade liegen kann, und
   * der Kassierer suchte Geld, das nie da war.
   *
   * Jetzt die Zahl, die WIRKLICH in die Lade ging.
   */
  const cashRevenueEur = dashboard?.currentShiftBarEur ?? '0.00';

  const estimatedExpectedEur = useMemo(
    () => addEur(shift.openingFloatEur, cashRevenueEur),
    [shift.openingFloatEur, cashRevenueEur],
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'start center',
        padding: 'var(--space-7)',
      }}
    >
      <div style={{ width: 'min(680px, 100%)' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 'var(--space-5)',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: 'var(--w14-schrift-kachel)',
              }}
            >
              Kassentag
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-text)',
              }}
            >
              Schicht <span className="w14-tabular">{shift.id.slice(0, 8)}…</span>
              {' · seit '}
              {openedAtLabel(shift.openedAt)}
            </p>
          </div>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-gold)',
              fontSize: 'var(--w14-schrift-feld)',
              padding: 'var(--space-1) var(--space-3)',
              border: '1px solid var(--w14-gold)',
              borderRadius: 'var(--w14-radius-button)',
            }}
          >
            Schicht offen
          </span>
        </header>

        <ParchmentCard padding="lg">
          <Zwischentitel label="Erwarteter Kassenbestand" />
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
                label="Startgeld (Tagesbeginn)"
                value={<MoneyAmount valueEur={shift.openingFloatEur} />}
              />
              {/* 14.08.2026: Hier stand „aus Verkauf", und die Zahl dahinter
                  kannte auch nur Verkäufe: nach Ankauf 120 bar stand hier
                  440 statt 320. 15.08.2026: dann fehlten noch Einlagen und
                  Entnahmen. Jetzt rechnet der Motor dieselben Bein-Familien
                  wie der Kassensturz. */}
              <Row
                label="+ Barbewegung (Verkauf, Ankauf, Einlagen, Entnahmen)"
                value={<MoneyAmount valueEur={cashRevenueEur} />}
              />
              <RowSeparator />
              <Row
                label="= Erwarteter Kassenbestand"
                value={<MoneyAmount valueEur={estimatedExpectedEur} emphasis />}
                emphasised
              />
            </tbody>
          </table>
          <p
            style={{
              margin: 'var(--space-3) 0 0',
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-schrift-feld)',
              lineHeight: 1.4,
            }}
          >
            Barverkäufe, Ankauf-Auszahlungen, Einlagen und Entnahmen landen automatisch hier.
          </p>
          <p
            style={{
              margin: 'var(--space-1) 0 0',
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-zeile)',
            }}
          >
            Geschätzt. Verbindlich wird die Zahl erst mit der Blindzählung beim Schichtschluss.
          </p>
        </ParchmentCard>

        {/* The Kassenbuch in plain language: today's money in / out (UX §4.3 D). */}
        <Zwischentitel label="Heute · Ein- und Auszahlungen" />

        <div
          style={{
            marginTop: 'var(--space-1)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-3)',
          }}
        >
          <Button
            variant="ghost"
            size="lg"
            iconLeft={<Icon icon={ArrowDownToLine} size={18} />}
            onClick={() => setCashKind('einlage')}
            style={{ border: '1px solid var(--w14-rule)' }}
          >
            Einlage (Geld rein)
          </Button>
          <Button
            variant="ghost"
            size="lg"
            iconLeft={<Icon icon={ArrowUpFromLine} size={18} />}
            onClick={() => setCashKind('entnahme')}
            style={{ border: '1px solid var(--w14-rule)' }}
          >
            Entnahme (Geld raus)
          </Button>
        </div>

        <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setReprintOpen(true)}
            disabled={lastReceipt === null}
          >
            Letzten Beleg erneut drucken
          </Button>
        </div>

        <RecentSalesPanel />

        <Zwischentitel label="Schichtschluss" />

        <ParchmentCard padding="md">
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
              textAlign: 'center',
            }}
          >
            Zählt die Lade und schließt diese Schicht · PIN erforderlich{' '}
            <InfoPunkt
              ariaLabel="Was ist der Schichtschluss?"
              text="Beim Schichtschluss zählen Sie das Bargeld blind, bevor das System den erwarteten Betrag zeigt. Daraus entsteht die Differenz. Der Abschluss des Kassentags ist ein eigener Schritt danach."
            />
          </p>
          <div
            style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <Button variant="destructive" size="lg" onClick={() => setSchichtschlussOffen(true)}>
              Schicht abschließen
            </Button>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-aged)',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
              }}
            >
              Kassensturz · Blindzählung
            </span>
          </div>
        </ParchmentCard>

        {/*
          ── DER ZWEITE SCHRITT, DER HIER NUR ANGEKÜNDIGT WIRD ───────────────
          Solange diese Schicht offen ist, weist der Server jeden Tagesabschluss
          ab (`closings-finalize.ts:289` — 409 mit deutschem Satz). Ein Knopf,
          der sicher in einen Fehler läuft, ist keine Hilfe. Also steht hier,
          was noch aussteht und woran es hängt; der Knopf selbst wartet auf der
          Fläche ohne offene Schicht.
        */}
        <ParchmentCard padding="md" style={{ marginTop: 'var(--space-3)' }}>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              letterSpacing: '0.08em',
            }}
          >
            Danach: Tagesabschluss
          </span>
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              lineHeight: 1.5,
            }}
          >
            Der Kassentag wird erst mit dem Tagesabschluss abgeschlossen. Aus ihm entstehen
            Kassenbericht, DATEV und DSFinV-K. Er ist möglich, sobald keine Schicht mehr offen ist,
            also gleich nach diesem Schichtschluss, hier in der Tageskasse.
          </p>
        </ParchmentCard>
      </div>

      <CashMovementDialog
        open={cashKind !== null}
        kind={cashKind ?? 'einlage'}
        shiftId={shift.id}
        onClose={() => setCashKind(null)}
      />
      <SchichtschlussDialog
        open={schichtschlussOffen}
        shiftId={shift.id}
        onClose={() => setSchichtschlussOffen(false)}
      />

      {reprintOpen && lastReceipt && (
        <ReceiptPreview
          data={lastReceipt}
          printing={printing}
          canPrint={canPrint}
          // Die Sperre gilt auch beim NACHDRUCK. Sie fragt bewusst die
          // GEMEINSAME Regel statt selbst zu vergleichen: die frühere Fassung
          // prüfte hier `shopVatId.trim()` von Hand und war damit von der Regel
          // abgekoppelt. Als die Steuernummer als zweite zulässige Kennung
          // dazukam, hätte dieser Pfad weiter gesperrt, ohne Grund und ohne
          // dass ein Test es bemerkt hätte.
          // ⚠️ 05.08.2026: HIER STAND NUR DIE STEUERKENNUNG.
          //
          // Der Erstdruck sperrt seit heute auch bei fehlendem Firmennamen und
          // fehlender Anschrift, denn § 14 UStG verlangt beides. Der NACHDRUCK
          // prüfte weiterhin allein `receiptPayloadTaxIdentifier`. Ein
          // gespeicherter Beleg ohne Absender liess sich also weiter drucken,
          // obwohl derselbe Beleg beim ersten Mal gesperrt gewesen wäre.
          //
          // Die passende Prüfung lag fertig daneben und war an KEINER Stelle
          // gerufen: gebaut und nie angeschlossen, die Klasse Fehler, die
          // dieses Haus am teuersten bezahlt. Hier ist der Anschluss.
          lockedReason={
            fehlendeBelegangabenAufNutzlast(lastReceipt).length === 0
              ? null
              : RECEIPT_VAT_LOCK_REASON
          }
          onPrint={() => {
            void print(lastReceipt).then((ok) => {
              if (ok) setReprintOpen(false);
            });
          }}
          onClose={() => setReprintOpen(false)}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasised = false,
}: {
  label: string;
  value: JSX.Element;
  emphasised?: boolean;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: 'var(--space-3) 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-text)',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: 'var(--space-3) 0',
          textAlign: 'right',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function RowSeparator(): JSX.Element {
  return (
    <tr>
      <td colSpan={2} style={{ padding: 0 }}>
        <div
          style={{
            height: 1,
            background: 'var(--w14-rule)',
            opacity: 0.55,
            margin: '4px 0',
          }}
        />
      </td>
    </tr>
  );
}

/** Add two decimal EUR strings without float drift. */
function addEur(a: string, b: string): string {
  const toCents = (s: string): bigint => {
    const [whole = '0', frac = ''] = s.split('.');
    return BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2) || '0');
  };
  const total = toCents(a) + toCents(b);
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

/**
 * BelegeDieserKasse — die Belegliste mit einem Weg zum Nachdruck JE ZEILE.
 *
 * ── WARUM ES DIESE FLÄCHE GIBT (13.08.2026) ────────────────────────────────
 *
 * Der Nachdruck lag bis heute an einem einzigen Knopf im Kassenbuch: „Letzten
 * Beleg erneut drucken". Er konnte nur den EINEN Beleg drucken, den der
 * Belegspeicher hielt — und der wurde vom nächsten Verkauf überschrieben und
 * vom Neustart gelöscht. Ein Kunde, der eine halbe Stunde später mit seinem Bon
 * zurückkam, bekam nichts, sobald zwischendurch ein einziges Mal kassiert wurde.
 *
 * Seit `lib/belegarchiv.ts` hält die Kasse die letzten Belege dauerhaft. Damit
 * hat der Nachdruck eine LISTE verdient statt eines Knopfes: der Kassierer
 * sucht die Belegnummer vom Bon des Kunden und drückt in DIESER Zeile.
 *
 * ── WAS DIESE FLÄCHE NICHT BEHAUPTET ───────────────────────────────────────
 *
 * Sie ist kein Archiv des Betriebs. Sie zeigt, was DIESE Kasse AUSGESTELLT hat,
 * begrenzt auf die letzten `BELEGARCHIV_HOECHSTZAHL`. Eine Route, die einen
 * älteren Beleg vom Server zurückholt, gibt es nicht (gesucht in
 * `packages/api-client`: zu Belegen existiert nur Schreibverkehr, und
 * `/api/transactions/recent` liefert weder Warenkorb noch Signatur). Der Kopf
 * dieser Fläche sagt das, statt mehr zu versprechen.
 *
 * ⚠️ „ausgestellt", nicht „gedruckt": in den Vorrat kommt ein Beleg beim
 * ABSCHLUSS (`BezahlenDialog.tsx:1259`, `AnkaufBezahlenDialog.tsx:257`), und
 * zwar auch im Offline-Zweig, in dem gar kein Drucker beteiligt ist. Eine Kasse
 * ohne eingerichteten Drucker füllt diese Liste vollständig. Der Kopfsatz stand
 * bis zum 13.08.2026 auf „gedruckt" und war damit schlicht falsch; er wird
 * jetzt in `belegvorratSatz` gebildet und dort geprüft.
 *
 * Der Steuerriegel ist derselbe wie beim Erstdruck: `fehlendeBelegangaben-
 * AufNutzlast`. Ein gespeicherter Beleg ohne vollständigen Belegkopf bleibt
 * gesperrt — sonst wäre der Nachdruck die offene Hintertür zum Erstdruck.
 */

import { useMemo, useState } from 'react';

import { Button, Zwischentitel, MoneyAmount, ParchmentCard, ZustandLeer } from '@norns/ui-kit';

import { SuchFeld } from '../../components/SuchFeld.js';
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter.js';
import { BELEGVORRAT_LEER, belegZeile, belegvorratSatz } from '../../lib/belegarchiv.js';
import { filtereBelege } from '../../lib/belegsuche.js';
import type { ThermalReceiptData } from '../../lib/hardware-client.js';
import { RECEIPT_VAT_LOCK_REASON, fehlendeBelegangabenAufNutzlast } from '../../lib/shop-info.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';

import { ReceiptPreview } from '../verkauf/ReceiptPreview.js';

/**
 * Die Suchspur einer Zeile.
 *
 * `filtereBelege` ist die EINE Suchregel des Hauses (letzte Stellen, mit oder
 * ohne Bindestrich, auch der Betrag). Sie erwartet `finalizedAt`; die
 * Belegnutzlast nennt dasselbe `printedAt`. Deshalb wird hier umbenannt statt
 * eine zweite Suche zu schreiben — zwei Suchregeln laufen auseinander.
 *
 * ⚠️ Diese Fläche RECHNET NICHTS MEHR SELBST. Betrag, Zeitspalte und Art kommen
 * fertig aus `belegZeile` (lib/belegarchiv.ts). Genau die zwei Rechnungen, die
 * hier einmal von Hand standen, waren die beiden gemessenen Defekte vom
 * 13.08.2026: ein `new Date` auf schon deutsch formatiertem Text (zeigte den
 * 3. August als 08.03.) und ein roher Ankaufbetrag an `MoneyAmount` (zeigte
 * einen Gedankenstrich statt des Geldes). Beide sind dort beschrieben und dort
 * geprüft.
 */
interface Suchzeile {
  receiptLocator: string;
  /** Was die Suche nach dem Betrag durchsucht. */
  totalEur: string;
  finalizedAt: string;
  betragEur: string;
  zeitpunkt: string;
  art: string;
  nutzlast: ThermalReceiptData;
}

export function BelegeDieserKasse(): JSX.Element {
  const belege = useLastReceiptStore((s) => s.belege);
  // Gemessen, nicht vermutet: der Speicher meldet, ob die Platte den Vorrat
  // wirklich angenommen hat. Der Kopfsatz verspricht nur dann Dauerhaftigkeit.
  const ueberlebtNeustart = useLastReceiptStore((s) => s.ueberlebtNeustart);
  const { canPrint, printing, print } = useReceiptPrinter();
  const [suche, setSuche] = useState('');
  const [offen, setOffen] = useState<ThermalReceiptData | null>(null);

  const alle = useMemo<Suchzeile[]>(
    () =>
      belege.map((b) => {
        const zeile = belegZeile(b);
        return {
          receiptLocator: zeile.receiptLocator,
          // Die Suche bekommt die vereinheitlichte Schreibweise, damit sie am
          // Ankauf- und am Verkaufsbeleg gleich trifft.
          totalEur: zeile.betragEur ?? zeile.rohbetrag,
          finalizedAt: b.printedAt,
          betragEur: zeile.betragEur ?? zeile.rohbetrag,
          zeitpunkt: zeile.zeitpunkt,
          art: zeile.art,
          nutzlast: b,
        };
      }),
    [belege],
  );
  const zeilen = useMemo(() => filtereBelege(alle, suche), [alle, suche]);

  const gesperrt = offen === null ? [] : fehlendeBelegangabenAufNutzlast(offen);

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label="Belege dieser Kasse" />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--w14-abstand-12)',
          flexWrap: 'wrap',
        }}
      >
        <p
          style={{
            margin: 0,
            maxWidth: '46ch',
            fontSize: 'var(--w14-schrift-zeile)',
            lineHeight: 1.5,
            color: 'var(--w14-ink-aged)',
          }}
        >
          {belegvorratSatz(alle.length, ueberlebtNeustart)}
        </p>
        {alle.length > 0 && (
          <SuchFeld
            wert={suche}
            setzen={setSuche}
            name="Beleg suchen"
            platzhalter="Belegnummer oder Betrag"
            breite={260}
          />
        )}
      </div>

      <div style={{ marginTop: 'var(--w14-abstand-10)' }}>
        {alle.length === 0 ? (
          <ZustandLeer
            satz={BELEGVORRAT_LEER}
            wegweiser="Sobald ein Verkauf oder ein Ankauf abgeschlossen ist, steht der Beleg hier zum Nachdruck bereit."
          />
        ) : zeilen.length === 0 ? (
          <ZustandLeer
            satz={`Zu „${suche.trim()}" liegt hier kein Beleg. ${
              alle.length === 1 ? 'Ein Beleg liegt bereit.' : `${alle.length} Belege liegen bereit.`
            }`}
            handlung={{ text: 'Suche zurücksetzen', onTun: () => setSuche('') }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w14-abstand-6)',
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {zeilen.map((z) => (
              <div
                key={z.receiptLocator}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto 1fr auto auto',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-10)',
                  padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
                  borderBottom: '1px solid var(--w14-rule)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-zeile)',
                    color: 'var(--w14-ink-aged)',
                  }}
                >
                  {z.zeitpunkt}
                </span>
                <span
                  className="w14-smallcaps"
                  style={{
                    fontSize: 'var(--w14-schrift-kuerzel)',
                    letterSpacing: '0.08em',
                    padding: 'var(--w14-abstand-2) var(--w14-abstand-8)',
                    border: '1px solid var(--w14-rule)',
                    borderRadius: 'var(--w14-radius-button)',
                    color: 'var(--w14-ink-aged)',
                  }}
                >
                  {z.art}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-feld)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={z.receiptLocator}
                >
                  {z.receiptLocator}
                </span>
                <MoneyAmount valueEur={z.betragEur} />
                <Button variant="ghost" size="sm" onClick={() => setOffen(z.nutzlast)}>
                  Nachdrucken
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {offen && (
        <ReceiptPreview
          data={offen}
          printing={printing}
          canPrint={canPrint}
          // Derselbe Riegel wie beim Erstdruck, gefragt über die GEMEINSAME
          // Regel statt über einen eigenen Vergleich. Ein eigener Vergleich an
          // dieser Stelle war schon einmal der Grund, warum der Nachdruckweg
          // milder war als der Erstdruck.
          lockedReason={gesperrt.length === 0 ? null : RECEIPT_VAT_LOCK_REASON}
          onPrint={() => {
            void print(offen).then((ok) => {
              if (ok) setOffen(null);
            });
          }}
          onClose={() => setOffen(null)}
        />
      )}
    </ParchmentCard>
  );
}

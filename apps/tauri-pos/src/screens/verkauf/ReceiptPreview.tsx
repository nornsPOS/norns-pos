/**
 * ReceiptPreview — the floating receipt preview that pops up after a sale, so
 * the operator SEES the Kassenbon before it goes to the thermal printer.
 *
 * Renders the exact `ThermalReceiptData` the printer will receive, styled like
 * thermal paper (narrow, monospace, ink on near-white) with the engraved shop
 * seal at the top. "Drucken" sends it to the printer; "Schließen" dismisses
 * without printing (the sale is already finalized — the receipt can be
 * re-printed later).
 *
 * Der TSE-QR wird hier ECHT gezeichnet (`lib/qr.ts`, eigener Zeichner, keine
 * fremde Abhaengigkeit) — aus demselben Bezug, den gleich der Drucker kodiert.
 * Vorher stand hier ein leerer Kasten mit „QR-Code (wird gedruckt)", und
 * niemand konnte VOR dem Druck sehen, ob er passt.
 */

import { Fensterboden, Button } from '@norns/ui-kit';

import {
  type InvoiceData,
  pdfBytesToObjectUrl,
  useInvoicePdf,
} from '../../hooks/useInvoicePdf.js';
import { describeHardwareError, isHardwareError, pdfClient } from '../../lib/hardware-client.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useState } from 'react';
import { QrBild } from '../../components/QrBild.js';
import type { ThermalReceiptData } from '../../lib/hardware-client.js';
import { logoLaden } from '../../lib/logo-lager.js';
import { LOGO_STUFEN, istLogoStufe, logoMime } from '../../lib/logo-werk.js';
import { receiptPayloadTaxIdentifier } from '../../lib/shop-info.js';
import { fiskalzustandSatz } from '../../lib/fiskalzustand-satz.js';

/**
 * Map the thermal receipt to the Typst invoice input. Both describe the SAME
 * finalized sale; the PDF is just a second rendering of it. The VAT rate is
 * pulled from the per-line label ("19%" → "19"); a margin/§25c line carries no
 * rate and stays empty. Any §-paragraph line in the footer becomes the legal
 * tax note printed on the PDF.
 */
function thermalToInvoiceData(data: ThermalReceiptData): InvoiceData {
  const taxNote = data.footerLines.find((l) => l.includes('§'));
  /*
   * Dasselbe Logo wie oben in der Papiervorschau: die Nutzlast gewinnt (ein
   * Nachdruck traegt ihren Stand), sonst das Offline-Lager — exakt die Regel
   * des Bon-Druckwegs. Bis zum 18.08.2026 bekam die Rechnung GAR KEIN Logo.
   */
  const lokal = data.logoBytesBase64 === undefined ? logoLaden() : null;
  const logoBytes = data.logoBytesBase64 ?? lokal?.datenBase64 ?? null;
  const logoFormat = data.logoBytesBase64 !== undefined ? (data.logoFormat ?? null) : (lokal?.format ?? null);
  const logoSize = istLogoStufe(data.logoSize) ? data.logoSize : (lokal?.stufe ?? null);
  /*
   * § 14 Abs. 4: die Bon-Nutzlast traegt Anschrift, USt-IdNr./Steuernummer
   * und Telefon seit jeher — ab hier erreichen sie auch die A4-Rechnung.
   * Die Steuerzeile beschriftet die Kasse selbst: die IdNr. hat Vorrang.
   */
  const steuerzeile =
    data.shopVatId.trim() !== ''
      ? `USt-IdNr.: ${data.shopVatId.trim()}`
      : data.shopTaxNumber.trim() !== ''
        ? `Steuernummer: ${data.shopTaxNumber.trim()}`
        : null;
  return {
    shopName: data.shopName,
    sellerAddressLines: data.shopAddress,
    sellerTaxLine: steuerzeile,
    sellerPhone: data.shopPhone,
    vatDisclosableEur: data.vatDisclosableEur ?? null,
    specialSchemeNotices: data.specialSchemeNotices ?? [],
    logoBytesBase64: logoBytes,
    logoFormat: logoBytes === null ? null : logoFormat,
    logoSize: logoBytes === null ? null : logoSize,
    invoiceNumber: data.receiptLocator,
    date: new Date(data.printedAt).toLocaleDateString('de-DE'),
    sellerName: data.shopName,
    items: data.items.map((it) => ({
      description: it.name,
      quantity: it.quantity,
      unitPriceEur: it.unitPriceEur,
      vatRate: it.vatLabel.replace(/[^\d]/g, ''),
      totalEur: it.lineTotalEur,
    })),
    subtotalEur: data.subtotalEur,
    vatTotalEur: data.vatEur,
    totalEur: data.totalEur,
    ...(taxNote ? { taxNote } : {}),
  };
}

// Physical thermal-paper cream — kept as a literal (not a theme token) so the
// printed-preview stays paper-white regardless of light/dark. Aligned to the
// parchment-2 cream (#faf8f2) so it no longer drifts off the palette.
const PAPER = '#faf8f2';
const INK = '#1c1814';
const FADED = '#6b6354';

/**
 * Mirror the Rust thermal layer's `is_tse_down`: during a TSE outage / test mode
 * the app sends the "TSE Ausfall" sentinel (or empty) for every TSE field. The
 * printed receipt already shows ONE clean Ausfall note then (thermal.rs); the
 * preview must do the same instead of rendering the sentinel four times + a
 * meaningless QR placeholder (honesty — no fake fiscal fields).
 */
function isTsePreviewDown(signatureValue: string, qrPayload: string): boolean {
  const down = (s: string): boolean => {
    const t = s.trim();
    return t.length === 0 || t === 'TSE Ausfall';
  };
  return down(signatureValue) || down(qrPayload);
}

/**
 * Eine Zeile des Belegs: Wort links, Zahl rechts.
 *
 * ── WARUM EIN GITTER UND KEIN `space-between` ───────────────────────────────
 * Vorher war jede Zeile ein Flex mit `space-between`. Das drückt die Zahl an
 * den rechten Rand, ja — aber die BREITE der Zahlenspalte wechselt dann von
 * Zeile zu Zeile mit dem Inhalt. „9,90 €" und „1.512,50 €" beginnen an
 * verschiedenen Stellen, das Eurozeichen wandert, und die Spalte franst aus.
 * Auf einem Kassenbon ist genau diese Spalte das, was ein Mensch von oben nach
 * unten abliest.
 *
 * Ein Gitter mit fester rechter Spur hält sie senkrecht. `tabular-nums` sorgt
 * zusätzlich dafür, dass eine 1 so breit ist wie eine 8 — ohne das rutschen
 * die Dezimalstellen selbst in einer Monospace-Umgebung, sobald eine Ziffer
 * aus einer Proportionalschrift einspringt.
 */
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'baseline',
  gap: 12,
  fontFamily: 'var(--w14-font-mono, monospace)',
  fontSize: '0.8rem',
  color: INK,
};

/** Die rechte Spur: rechtsbündig, gleich breite Ziffern, nie umbrechend. */
const amountStyle: React.CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

function Rule(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{ borderTop: '1px dashed #b9ad97', margin: '8px 0', height: 0 }}
    />
  );
}

export function ReceiptPreview({
  data,
  onPrint,
  onClose,
  printing,
  canPrint,
  lockedReason,
}: {
  data: ThermalReceiptData;
  onPrint: () => void;
  onClose: () => void;
  printing: boolean;
  canPrint: boolean;
  /**
   * When set, printing is HARD-BLOCKED for a compliance reason (e.g. no USt-IdNr.
   * configured — a receipt must never print a fake or blank VAT id, GoBD). Shown
   * as a distinct wax-red banner, separate from the "printer not configured" note.
   */
  lockedReason?: string | null;
}): JSX.Element {
  const pdf = useInvoicePdf();

  // Same finalized sale, second rendering. The GoBD USt-IdNr. lock that blocks
  // printing blocks the PDF too: a receipt must never carry a fake or blank VAT
  // id, on paper or in a file.
  const a4Drucker = useHardwareStore((s) => s.config.a4.printerName);
  const [a4Laeuft, setA4Laeuft] = useState(false);
  const [a4Hinweis, setA4Hinweis] = useState<string | null>(null);

  /*
   * ── DER GETEILTE KNOPF (Basels Anweisung, 18.08.2026) ────────────────────
   *
   * Beim Bezahlen gibt es ZWEI Papiere: den Bon (58 mm, der Regelfall) und
   * die A4-Rechnung (die Ausnahme, wenn ein Kunde eine Rechnung verlangt).
   * Vorher war die A4 nur eine PDF-Vorschau in einem zweiten Fenster — der
   * Kunde wartete, waehrend der Haendler im Betrachter den Druckdialog
   * suchte.
   *
   * Jetzt: EIN geteilter Knopf. Die grosse Haelfte druckt den Bon, die
   * schmale Haelfte die A4-Rechnung — bewusst ungleich, damit der Daumen im
   * Tagesgeschaeft nicht versehentlich eine A4 anstoesst. Die A4 geht DIREKT
   * an den eingerichteten Dokumentendrucker; ohne eingerichteten Drucker
   * faellt sie ehrlich auf die Vorschau zurueck und sagt das.
   */
  async function handleA4(): Promise<void> {
    if (lockedReason || a4Laeuft) return;
    setA4Laeuft(true);
    setA4Hinweis(null);
    try {
      if (a4Drucker !== '') {
        // EIN Aufruf: der Kern setzt, rastert (Windows) oder reicht das PDF
        // an die Warteschlange (macOS/Linux). Kein Betrachter dazwischen.
        await pdfClient.printInvoiceDirect(a4Drucker, thermalToInvoiceData(data));
        setA4Hinweis('A4-Rechnung gedruckt.');
        return;
      }
      // Kein Dokumentendrucker eingerichtet: Vorschau statt stillem Nichts.
      const bytes = await pdf.generatePdf(thermalToInvoiceData(data));
      const url = pdfBytesToObjectUrl(bytes);
      window.open(url, '_blank', 'noopener');
      setA4Hinweis('Kein Dokumentendrucker eingerichtet, Vorschau geoeffnet. Geraete: Einstellungen.');
    } catch (err) {
      // generatePdf befuellt pdf.error selbst; der Direktdruck nicht — sein
      // deutscher Satz kommt als HardwareError und gehoert dem Haendler gesagt.
      setA4Hinweis(isHardwareError(err) ? describeHardwareError(err) : null);
    } finally {
      setA4Laeuft(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; the dialog has explicit buttons + the parent handles Esc.
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Belegvorschau"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--w14-overlay)',
        zIndex: 'var(--w14-z-vorhang)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        // Der Schleier blendet ruhig ein statt hart zu erscheinen — dieselbe
        // Haus-Einblendung wie im ui-kit-Dialog. Die globale reduced-motion-
        // Regel in tokens.css nullt die Dauer (keine Verzögerung im Spiel).
        animation: 'w14-modal-overlay-in var(--w14-dur-fast) var(--w14-ease-curator) both',
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: non-interactive content guard — stops backdrop-dismiss from firing when clicking the receipt; keyboard dismiss is handled by the parent dialog. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
          maxHeight: '92vh',
        }}
      >
        {/* The paper */}
        <div
          style={{
            width: 340,
            maxHeight: '74vh',
            overflowY: 'auto',
            background: PAPER,
            color: INK,
            borderRadius: 6,
            boxShadow: 'var(--w14-shadow-modal, 0 12px 40px rgba(0,0,0,0.45))',
            padding: '22px 20px 26px',
            // Das Papier legt sich auf (8px-Senkung + Aufblenden, Haus-Ausklang)
            // statt hart dazustehen — wie ein Bon, der auf den Tresen gelegt
            // wird. Wiederverwendet den Haus-Keyframe, keine siebte Kopie.
            animation: 'w14-dialog-in var(--w14-dur-base) var(--w14-ease-curator) both',
          }}
        >
          {/* BASELS DEKRET (26.07.2026): das eingebrannte Warehouse-14-Zeichen
              ist vom Bon verschwunden. Der Kopf ist jetzt: die norns.de-Zeile
              klein und dezent ganz oben (Systemzeile auf JEDEM Bon), darunter
              das HOCHGELADENE Logo des Haendlers (falls gesetzt — aus der
              Nutzlast oder dem Offline-Lager) und der Ladenname als Text.
              Derselbe Kopf wie im Belegdesigner und im Bytestrom. */}
          <div style={{ display: 'grid', placeItems: 'center', gap: 8, textAlign: 'center' }}>
            <div
              style={{
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontSize: 'var(--w14-schrift-fussnote)',
                letterSpacing: '0.18em',
                color: FADED,
              }}
            >
              norns.de
            </div>
            {(() => {
              // Die Nutzlast gewinnt (ein Nachdruck traegt ggf. IHREN Stand);
              // fehlt das Feld (aeltere gespeicherte Belege), gilt das lokal
              // gespeicherte Logo — dasselbe, das der Druckweg anhaengt.
              const lokal = data.logoBytesBase64 === undefined ? logoLaden() : null;
              const bytes = data.logoBytesBase64 ?? lokal?.datenBase64 ?? null;
              if (bytes === null) return null;
              const roh = data.logoBytesBase64 !== undefined ? data.logoFormat : lokal?.format;
              const format = roh === 'svg' || roh === 'png' || roh === 'jpeg' ? roh : 'png';
              const stufe = istLogoStufe(data.logoSize)
                ? data.logoSize
                : (lokal?.stufe ?? 'mittel');
              const prozent = LOGO_STUFEN.find((s) => s.stufe === stufe)?.prozent ?? 60;
              return (
                <img
                  src={`data:${logoMime(format)};base64,${bytes}`}
                  alt={`Logo ${data.shopName}`}
                  style={{
                    width: `${prozent}%`,
                    maxWidth: '100%',
                    height: 'auto',
                    filter: 'grayscale(1) contrast(1.6)',
                  }}
                />
              );
            })()}
            <div
              style={{
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontWeight: 700,
                fontSize: '0.95rem',
                letterSpacing: '0.04em',
                color: INK,
              }}
            >
              {data.shopName}
            </div>
            <div
              style={{
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontSize: 'var(--w14-schrift-zeile)',
                lineHeight: 1.5,
                color: INK,
              }}
            >
              {data.shopAddress.map((line) => (
                <div key={line}>{line}</div>
              ))}
              {data.shopPhone && <div>Tel. {data.shopPhone}</div>}
              {(() => {
                // Die Beschriftung folgt der Kennung, nicht umgekehrt. Eine
                // Steuernummer unter "USt-IdNr." zu drucken wäre eine falsche
                // Angabe auf einem steuerlichen Beleg.
                const kennung = receiptPayloadTaxIdentifier(data);
                return kennung ? <div>{kennung.label} {kennung.value}</div> : null;
              })()}
            </div>
          </div>

          <Rule />

          {/* Document kind — an Ankaufbeleg names itself and its seller. */}
          {data.documentKind === 'ANKAUF' && (
            <div
              className="w14-smallcaps"
              style={{
                textAlign: 'center',
                letterSpacing: '0.1em',
                fontSize: '0.82rem',
                color: INK,
                padding: '2px 0',
              }}
            >
              Ankaufbeleg
            </div>
          )}

          {/* Meta */}
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={rowStyle}>
              <span>Beleg-Nr.</span>
              <span style={amountStyle}>{data.receiptLocator}</span>
            </div>
            <div style={rowStyle}>
              <span>Datum</span>
              <span style={amountStyle}>{data.printedAt}</span>
            </div>
            <div style={rowStyle}>
              <span>Kassierer</span>
              <span>{data.cashierName}</span>
            </div>
            {data.counterpartyLabel && (
              <div style={rowStyle}>
                <span>Verkäufer</span>
                <span>{data.counterpartyLabel.replace(/^Verkäufer:\s*/, '')}</span>
              </div>
            )}
          </div>

          <Rule />

          {/*
           * DIE POSITIONEN — dreimal umgebaut gegenüber vorher:
           *
           * 1. „1 ×" verschwindet. Dieses Haus verkauft Einzelstücke; ein „1 ×"
           *    vor jedem Namen ist Rauschen auf einem schmalen Bon und stahl
           *    dem Namen Platz, den er braucht.
           * 2. Der EINZELPREIS steht jetzt da, sobald die Menge grösser als
           *    eins ist. Vorher zeigte der Bon „3 × Silbergroschen" und eine
           *    Summe — wer nachrechnen wollte, konnte es nicht.
           * 3. Der Name darf UMBRECHEN statt bei 200 Pixeln abgeschnitten zu
           *    werden. `minmax(0, 1fr)` im Gitter ist der Teil, der das
           *    wirklich erlaubt: ohne die 0 als Minimum weigert sich eine
           *    Gitterspalte, schmaler als ihr Inhalt zu werden, und schiebt
           *    stattdessen den Preis aus dem Papier.
           */}
          <div style={{ display: 'grid', gap: 7 }}>
            {data.items.map((it, i) => (
              <div key={`${it.name}-${i}`} style={{ display: 'grid', gap: 1 }}>
                <div style={{ ...rowStyle, fontSize: '0.82rem' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.name}</span>
                  <span style={amountStyle}>{it.lineTotalEur} €</span>
                </div>
                {(it.quantity > 1 || it.vatLabel) && (
                  <div
                    style={{
                      ...rowStyle,
                      fontSize: 'var(--w14-schrift-kuerzel)',
                      color: FADED,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>{it.vatLabel ? `USt ${it.vatLabel}` : ''}</span>
                    <span style={amountStyle}>
                      {it.quantity > 1 ? `${it.quantity} × ${it.unitPriceEur} €` : ''}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Rule />

          {/* Totals */}
          <div style={{ display: 'grid', gap: 2 }}>
            {/*
             * ⚠️ 14.08.2026 (0.6.0-Begehung): Die Zwischensumme ist das NETTO
             * und stand bedingungslos da — direkt über dem Satz „Umsatzsteuer
             * ist nicht gesondert ausweisbar". Wer Summe minus Zwischensumme
             * rechnet, hat die Margensteuer, die § 14a Abs. 6 Satz 2 UStG
             * verbirgt. Sie erscheint deshalb nur noch, wenn auch die
             * Steuerzeile erscheinen darf: EIN Schalter, eine Wahrheit.
             */}
            {data.vatDisclosableEur != null && (
              <div style={rowStyle}>
                <span>Zwischensumme</span>
                <span style={amountStyle}>{data.subtotalEur} €</span>
              </div>
            )}
            {/*
             * ⚠️ Die Steuerzeile erscheint NUR, wenn sie erscheinen DARF.
             *
             * Bis zum 26.07.2026 stand hier bedingungslos `data.vatEur`, also
             * bei Differenzbesteuerung die Margensteuer. § 14a Abs. 6 Satz 2
             * UStG verbietet genau diesen gesonderten Ausweis, und die Folge
             * ist die zusätzlich geschuldete Steuer nach § 14c.
             *
             * `vatDisclosableEur` ist `null`, wenn nichts ausgewiesen werden
             * darf; dann bleibt der Platz leer und der Hinweis unten sagt
             * warum. Fehlt das Feld ganz (ältere Nutzlast), wird ebenfalls
             * nichts gedruckt: im Zweifel eine Angabe zu wenig statt eines
             * verbotenen Ausweises.
             */}
            {data.vatDisclosableEur != null && (
              <div style={rowStyle}>
                <span>MwSt.</span>
                <span style={amountStyle}>{data.vatDisclosableEur} €</span>
              </div>
            )}
            {/*
             * Die SUMME ist die EINE Zahl, die ein Mensch am Tresen prüft.
             * Vorher war sie 0,95rem gegen 0,8rem der Zeilen darüber — ein
             * Unterschied, den man messen muss, um ihn zu sehen. Jetzt trägt
             * sie einen eigenen Strich über sich und deutlich mehr Grösse.
             */}
            <div
              style={{
                ...rowStyle,
                fontWeight: 700,
                fontSize: '1.16rem',
                marginTop: 6,
                paddingTop: 7,
                borderTop: '1px solid #b9ad97',
              }}
            >
              <span>SUMME</span>
              <span style={amountStyle}>{data.totalEur} €</span>
            </div>
          </div>

          <Rule />

          {/* Payment */}
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={rowStyle}>
              <span>Zahlung</span>
              <span>{data.paymentMethodLabel}</span>
            </div>
            {data.cashReceivedEur && (
              <div style={rowStyle}>
                <span>Bar erhalten</span>
                <span style={amountStyle}>{data.cashReceivedEur} €</span>
              </div>
            )}
            {data.changeEur && (
              <div style={rowStyle}>
                <span>Wechselgeld</span>
                <span style={amountStyle}>{data.changeEur} €</span>
              </div>
            )}
          </div>

          <Rule />

          {/* TSE block */}
          <div
            style={{
              display: 'grid',
              gap: 3,
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              color: INK,
            }}
          >
            {isTsePreviewDown(data.tseSignatureValue, data.tseQrPayload) ? (
              <>
                <div style={{ color: FADED, letterSpacing: '0.08em' }}>TSE</div>
                {/*
                 * ⛔ 13.08.2026 — HIER STAND EIN VERSPRECHEN, DAS DIE VORSCHAU
                 * NICHT PRÜFEN KANN.
                 *
                 * Der Satz lautete „TSE momentan nicht erreichbar, Signatur
                 * wird nachgereicht." Er wurde allein daraus gefolgert, dass
                 * das Signaturfeld LEER ist. Leer ist es aber auch, wenn der
                 * Ausfall dauerhaft vermerkt wurde (dann kommt NIE eine
                 * Signatur) und wenn die Kasse gar keine Sicherungseinrichtung
                 * hinterlegt hat (dann ist auch nie eine entstanden). Der
                 * Kunde am Tresen las eine Zusage, die für seinen Beleg nicht
                 * galt.
                 *
                 * Jetzt bringt der Beleg seinen Zustand mit, und der Satz
                 * kommt aus der EINEN Quelle. Fehlt der Zustand (ältere
                 * Belege im Nachdruck), sagt die Vorschau nur das Gemessene:
                 * dieser Beleg trägt keine Signatur.
                 */}
                <div style={{ wordBreak: 'break-word' }}>
                  {data.fiskalzustand
                    ? fiskalzustandSatz(
                        data.fiskalzustand,
                        data.documentKind === 'ANKAUF' ? 'Ankauf' : 'Verkauf',
                      ).satz
                    : 'Dieser Beleg trägt keine TSE-Signatur.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ color: FADED, letterSpacing: '0.08em' }}>TSE-SIGNATUR</div>
                <div style={{ wordBreak: 'break-all' }}>{data.tseSignatureValue}</div>
                <div>Signatur-Zähler: {data.tseSignatureCounter}</div>
                <div>Trans-Nr.: {data.tseTransactionNumber}</div>
                {/*
                 * DER ECHTE QR-Code, nicht mehr ein leerer Kasten mit dem Wort
                 * „QR-Code (wird gedruckt)". Bis zum 25.07.2026 entstand er
                 * erst im Drucker (ESC/POS `GS ( k`), also konnte niemand VOR
                 * dem Druck sehen, ob er sitzt, ob er zu gross ist, ob er das
                 * Papier sprengt. Jetzt steht in der Vorschau, was gleich auf
                 * dem Bon steht — aus DEMSELBEN Bezug.
                 *
                 * Er wird NUR hier gezeichnet, im Zweig „echte Signatur". Im
                 * Ausfall-Zweig darüber steht ein Satz und kein Bild: ein
                 * QR-Code, wo keine Signatur ist, wäre eine gedruckte
                 * Behauptung.
                 */}
                <div style={{ marginTop: 8, alignSelf: 'center' }}>
                  <QrBild inhalt={data.tseQrPayload} groesse={104} />
                </div>
              </>
            )}
          </div>

          <Rule />

          {/*
           * Die gesetzlich vorgeschriebenen Hinweise zu den Sonderregelungen.
           *
           * § 14a Abs. 6 Satz 1 UStG verlangt sie ZUSÄTZLICH zum Weglassen der
           * Steuer, mit vorgeschriebenem Wortlaut („Gebrauchtgegenstände/
           * Sonderregelung"). Sie stehen bewusst ÜBER den freien Fusszeilen
           * und in normaler Schrift: es ist eine Pflichtangabe, kein Beiwerk.
           */}
          {(data.specialSchemeNotices?.length ?? 0) > 0 && (
            <div
              style={{
                display: 'grid',
                gap: 2,
                textAlign: 'center',
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontSize: 'var(--w14-schrift-zeile)',
                marginBottom: 6,
              }}
            >
              {data.specialSchemeNotices?.map((z) => <div key={z}>{z}</div>)}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'grid', gap: 3, textAlign: 'center' }}>
            {data.footerLines.map((line) => (
              <div
                key={line}
                style={{
                  fontFamily: 'var(--w14-font-mono, monospace)',
                  fontSize: 'var(--w14-schrift-kuerzel)',
                  color: FADED,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button variant="ghost" size="md" onClick={onClose} disabled={printing || a4Laeuft}>
            Schließen
          </Button>
          {/* Der geteilte Druckknopf: links gross der Bon, rechts schmal die
              A4-Rechnung. EIN Rahmen, EINE Handlung „drucken", zwei Papiere. */}
          <div
            role="group"
            aria-label="Drucken: Bon oder A4-Rechnung"
            style={{
              display: 'flex',
              alignItems: 'stretch',
              borderRadius: 'var(--w14-radius-fein, 8px)',
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgb(var(--w14-tabellenlinie-rgb) / 0.55)',
            }}
          >
            <Button
              variant="primary"
              size="md"
              onClick={onPrint}
              disabled={printing || !canPrint || Boolean(lockedReason)}
              style={{ borderRadius: 0, minWidth: 170 }}
            >
              {printing ? 'Druckt…' : 'Bon drucken'}
            </Button>
            <span aria-hidden="true" style={{ width: 1, background: 'rgba(255,255,255,0.35)' }} />
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleA4()}
              disabled={a4Laeuft || pdf.loading || Boolean(lockedReason)}
              aria-label="A4-Rechnung drucken"
              title="A4-Rechnung drucken"
              style={{ borderRadius: 0, minWidth: 64, opacity: 0.92 }}
            >
              {a4Laeuft ? '…' : 'A4'}
            </Button>
          </div>
        </div>
        {a4Hinweis && (
          <div style={{ color: 'var(--w14-parchment-1)', fontSize: 'var(--w14-schrift-zeile)', opacity: 0.9 }}>
            {a4Hinweis}
          </div>
        )}
        {pdf.error && (
          <div
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              fontSize: '0.82rem',
              marginTop: 4,
            }}
          >
            {pdf.error}
          </div>
        )}
        {lockedReason && (
          <div
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              fontSize: '0.82rem',
              fontWeight: 600,
              background: 'rgba(0,0,0,0.25)',
              borderRadius: 'var(--w14-radius-fein)',
              padding: '6px 10px',
            }}
          >
            {lockedReason}
          </div>
        )}
        {!lockedReason && !canPrint && (
          <div style={{ color: 'var(--w14-parchment-1)', fontSize: 'var(--w14-schrift-zeile)', opacity: 0.85 }}>
            Drucker nicht konfiguriert. Vorschau ohne Druck. (Geräte einrichten)
          </div>
        )}
      </div>
    </div></Fensterboden>
  );
}

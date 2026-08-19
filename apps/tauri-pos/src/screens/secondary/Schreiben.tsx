/**
 * Schreiben — an A4 document studio for contracts, invoices and letters.
 *
 * The same idea as the receipt designer, but for a full A4 sheet: the shop logo
 * + identity sit in the header, and every field (recipient, subject, body,
 * signature) is click-to-edit right on the page (WYSIWYG, contentEditable).
 * Pick a template (Ankaufvertrag · Rechnung · Brief · Leeres Blatt) to pre-fill
 * the structure, then type. "Drucken" prints the sheet at true A4.
 *
 * Die KI-Hilfe („Text verbessern", „Text generieren") wurde am 11.08.2026 auf
 * Basels Anordnung ENTFERNT: der Fokus liegt auf dem Kern der Kasse, und ein
 * Knopf, der ohne Schluessel nur eine Fehlermeldung zeigt, traegt nichts.
 * Mit ihr fiel die Route POST /api/ai/compose im Motor.
 *
 * (Distinct from `Dokumente`, which is the uploaded-file archive.)
 */

import { useEffect, useRef, useState } from 'react';

import { InfoPunkt, Button, Zwischentitel } from '@norns/ui-kit';

import { resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import { useBelegLogo } from '../../hooks/useBelegLogo.js';
import { logoMime } from '../../lib/logo-werk.js';
import { receiptTaxIdentifier } from '../../lib/shop-info.js';
import { useSessionStore } from '../../state/session-store.js';

type TemplateKind = 'ankaufvertrag' | 'rechnung' | 'brief' | 'leer';

interface TemplateDef {
  key: TemplateKind;
  label: string;
  betreff: string;
  body: string;
  showSignature: boolean;
}

const TEMPLATES: readonly TemplateDef[] = [
  {
    key: 'ankaufvertrag',
    label: 'Ankaufvertrag',
    betreff: 'Ankaufvertrag',
    body:
      'Zwischen dem oben genannten Geschäft (Ankäufer) und dem unten genannten ' +
      'Verkäufer wird folgender Ankauf vereinbart:\n\n' +
      'Gegenstand:\nGewicht / Feinheit:\nVereinbarter Ankaufspreis:\n\n' +
      'Der Verkäufer versichert, rechtmäßiger Eigentümer des Gegenstands zu sein. ' +
      'Die Identität wurde gemäß Geldwäschegesetz (GwG) anhand eines amtlichen ' +
      'Lichtbildausweises geprüft.\n\nAusweisart / Nummer:',
    showSignature: true,
  },
  {
    key: 'rechnung',
    label: 'Rechnung',
    betreff: 'Rechnung Nr. -',
    body:
      'Sehr geehrte Damen und Herren,\n\nwir berechnen Ihnen wie folgt:\n\n' +
      'Pos.   Bezeichnung                          Menge   Einzelpreis   Gesamt\n' +
      '1                                            1\n\n' +
      'Gesamtbetrag:\n\nDie Ware wurde nach § 25a UStG (Differenzbesteuerung) ' +
      'verkauft; die Umsatzsteuer wird nicht gesondert ausgewiesen.\n\n' +
      'Bitte begleichen Sie den Betrag innerhalb von 14 Tagen.',
    showSignature: false,
  },
  {
    key: 'brief',
    label: 'Brief',
    betreff: '',
    body: 'Sehr geehrte Damen und Herren,\n\n\n\nMit freundlichen Grüßen',
    showSignature: true,
  },
  { key: 'leer', label: 'Leeres Blatt', betreff: '', body: '', showSignature: false },
];

const FALLBACK_TEMPLATE = TEMPLATES[2] as TemplateDef;


/**
 * Die Ortszeile über dem Datum.
 *
 * ── WAS HIER STAND UND WARUM ES FALSCH WAR (25.07.2026) ────────────────────
 *
 *     (shop.address[1] ?? 'Schorndorf') ohne führende Hausnummer, dann das Datum
 *
 * Der Rückfall erfand einen ORT. Zwei Wege führten wirklich dorthin:
 *
 *   • Ein Laden, der nur `addressLine1` gepflegt hat: `resolveShopInfo` baut
 *     die Anschrift aus den NICHT leeren Zeilen, `address[1]` ist dann
 *     `undefined`. Der Briefkopf zeigte Hamburg, die Datumszeile darunter
 *     „Schorndorf, den …".
 *   • Solange die Ladendaten noch laden oder ihr Abruf gescheitert ist,
 *     liefert `resolveShopInfo` die eingebauten Werte — dann steht dort der
 *     Ort eines fremden Ladens, und das Blatt ist druckbar.
 *
 * Dieselbe Datei begründet ausführlich, warum die USt-IdNr. NIEMALS
 * vorbelegt werden darf. Der Ort ist auf einem Geschäftsbrief eine ebenso
 * rechtlich gemeinte Angabe — und wurde genau so vorbelegt.
 *
 * Jetzt gilt: kein Ort bekannt, keine Ortsangabe. Nur das Datum.
 */
export function ortszeile(anschrift: readonly string[]): string {
  const heute = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  // Die Zeile mit der Postleitzahl ist die Ortszeile: „73614 Schorndorf".
  const mitPlz = anschrift.find((z) => /^\s*\d{4,5}\s+\S/.test(z));
  const ort = mitPlz?.replace(/^\s*\d+\s*/, '').trim();
  return ort ? `${ort}, den ${heute}` : `Den ${heute}`;
}

export function Schreiben(): JSX.Element {
  const actor = useSessionStore((s) => s.actor);
  const { data: shopApi } = useShopInfo();
  const shop = resolveShopInfo(shopApi);
  // Dasselbe Logo, das der Kassenbon druckt — eine Quelle, kein zweiter Pfad.
  const briefLogo = useBelegLogo().abruf?.logo ?? null;

  const empfaengerRef = useRef<HTMLDivElement | null>(null);
  const betreffRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const [template, setTemplate] = useState<TemplateKind>('brief');

  const applyTemplate = (kind: TemplateKind): void => {
    const t = TEMPLATES.find((x) => x.key === kind) ?? FALLBACK_TEMPLATE;
    setTemplate(kind);
    if (betreffRef.current) betreffRef.current.innerText = t.betreff;
    if (bodyRef.current) bodyRef.current.innerText = t.body;
  };

  // Seed the default template once on mount.
  useEffect(() => {
    const t = TEMPLATES.find((x) => x.key === 'brief') ?? FALLBACK_TEMPLATE;
    if (betreffRef.current) betreffRef.current.innerText = t.betreff;
    if (bodyRef.current) bodyRef.current.innerText = t.body;
  }, []);

  const currentDef = TEMPLATES.find((x) => x.key === template) ?? FALLBACK_TEMPLATE;

  return (
    <div
      style={{ display: 'flex', height: '100%', minHeight: 0, background: 'var(--w14-parchment)' }}
    >
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .w14-a4, .w14-a4 * { visibility: visible !important; }
        .w14-a4 { position: absolute; left: 0; top: 0; margin: 0 !important; box-shadow: none !important;
                  width: 210mm !important; min-height: 297mm !important; }
        .w14-noprint { display: none !important; }
        .w14-a4 [contenteditable]:empty::before { content: "" !important; }
      }
      .w14-a4 [contenteditable] { outline: none; }
      .w14-a4 [contenteditable]:focus { background: #f4f1ff; border-radius: 3px; }
      .w14-a4 [contenteditable]:empty::before { content: attr(data-ph); color: #b9b3a6; }`}</style>

      {/* ── Controls (no-print) ───────────────────────────────────────────── */}
      <nav
        className="w14-noprint"
        style={{
          width: 280,
          flex: '0 0 auto',
          borderRight: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
          padding: 16,
          overflowY: 'auto',
        }}
      >
        {/* Weniger Zeitung (27.07.2026): der Vorspann wohnt im Fragezeichen. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)', margin: '2px 0 10px' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600 }}>Schreiben</h1>
          <InfoPunkt
            ariaLabel="Was ist Schreiben?"
            text="Verträge, Rechnungen und Briefe auf A4. Felder direkt anklicken und schreiben, dann drucken."
          />
        </div>
        <Zwischentitel label="Vorlage" />
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {TEMPLATES.map((t) => {
            const active = t.key === template;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t.key)}
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  borderRadius: 'var(--w14-radius-button)',
                  border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                  background: active ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-1)',
                  color: active ? 'var(--w14-ink)' : 'var(--w14-ink-aged)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 18 }}>
          <Zwischentitel />
          <Button
            variant="primary"
            size="md"
            onClick={() => window.print()}
            style={{ width: '100%', marginTop: 10 }}
          >
            Drucken (A4)
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => applyTemplate(template)}
            style={{ width: '100%', marginTop: 8 }}
          >
            Felder zurücksetzen
          </Button>
        </div>
      </nav>

      {/* ── A4 sheet ───────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'grid',
          placeItems: 'start center',
          padding: 24,
        }}
      >
        <article
          className="w14-a4"
          style={{
            width: '210mm',
            minHeight: '297mm',
            background: '#fff',
            color: '#15181d',
            // Haus-Schatten statt eines kalten Blautons: das Blatt liegt auf
            // Pergament, also faellt sein Schatten in warmer Tinte.
            boxShadow: 'var(--w14-shadow-lift)',
            padding: '20mm 18mm',
            fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif',
            fontSize: '11pt',
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
        >
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
            }}
          >
            {/* ── EIN LOGO, ÜBERALL (30.07.2026, Basels Ordnung) ────────────
                Hier stand `/shop-logo.svg`: die in die Anwendung GEBACKENE
                Marke von Warehouse 14. Wer sein eigenes Logo unter
                „Beleg & Shop" hochlud, sah es auf dem Kassenbon, aber der
                Briefkopf trug weiter die fremde Marke. Jetzt liest auch das
                Papier die EINE hochgeladene Datei; ohne Logo bleibt der Platz
                leer und der Name trägt den Kopf. */}
            {briefLogo ? (
              <img
                src={`data:${logoMime(briefLogo.format)};base64,${briefLogo.datenBase64}`}
                alt={shop.name}
                style={{ height: '22mm', width: 'auto' }}
              />
            ) : (
              <div style={{ height: '22mm' }} />
            )}
            <div
              style={{ textAlign: 'right', fontSize: '9.5pt', color: '#3c424b', lineHeight: 1.45 }}
            >
              <div style={{ fontWeight: 700, color: '#15181d' }}>{shop.name}</div>
              {shop.tagline && <div style={{ fontStyle: 'italic' }}>{shop.tagline}</div>}
              {shop.address.map((l) => (
                <div key={l}>{l}</div>
              ))}
              {shop.phone && <div>Tel.: {shop.phone}</div>}
              {/* Die GEMEINSAME Regel statt einer eigenen halben (27.07.2026):
                  vorher stand hier `shop.vatId && …` — ein Haendler, der nur
                  eine Steuernummer fuehrt (§ 14 UStG laesst eine von beiden
                  zu), verlor auf JEDEM Brief und JEDER Rechnung seine
                  Kennung, waehrend der Kassenbon sie laengst richtig trug.
                  Dieselbe Wurzel wie der alte Beleg-Fehler; darum dieselbe
                  Funktion und keine Kopie davon. */}
              {(() => {
                const kennung = receiptTaxIdentifier(shop);
                return kennung && (
                  <div>
                    {kennung.label}: {kennung.value}
                  </div>
                );
              })()}
            </div>
          </header>

          {/* Eine Rechnung OHNE Steuernummer und ohne USt-IdNr. ist nach
              § 14 Abs. 4 UStG unvollstaendig. Der Brief-Editor sperrt nicht
              (der Mensch sieht das Blatt und darf frei schreiben), aber er
              sagt es LAUT, solange die Vorlage „Rechnung" gewaehlt ist und
              keine Kennung hinterlegt wurde — bevor das Blatt den Drucker
              erreicht, nicht danach. */}
          {template === 'rechnung' && receiptTaxIdentifier(shop) === null && (
            <div
              role="alert"
              style={{
                margin: '4mm 0 0',
                padding: '3mm 4mm',
                border: '1px solid #b23a48',
                background: '#faf1f2',
                color: '#7c2d38',
                fontSize: '10pt',
                lineHeight: 1.45,
              }}
            >
              Weder Steuernummer noch USt-IdNr. hinterlegt. Diese Rechnung wäre nach
              § 14 UStG unvollständig. Bitte zuerst in den Einstellungen ergänzen.
            </div>
          )}

          <div style={{ borderTop: '1.5px solid #b8902f', margin: '6mm 0 8mm' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <Editable
              refEl={empfaengerRef}
              ph="Empfänger: Name und Anschrift…"
              ariaLabel="Empfänger"
              style={{ minHeight: '24mm', minWidth: '80mm', fontSize: '11pt' }}
            />
            <div
              style={{
                textAlign: 'right',
                fontSize: '10.5pt',
                color: '#3c424b',
                whiteSpace: 'nowrap',
              }}
            >
              {ortszeile(shop.address)}
            </div>
          </div>

          <Editable
            refEl={betreffRef}
            ph="Betreff…"
            ariaLabel="Betreff"
            style={{ fontWeight: 700, fontSize: '12pt', margin: '8mm 0 5mm' }}
          />

          <Editable
            refEl={bodyRef}
            ph="Hier klicken und den Text schreiben…"
            ariaLabel="Inhalt"
            style={{ minHeight: '120mm', whiteSpace: 'pre-wrap', fontSize: '11pt' }}
          />

          {currentDef.showSignature && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '18mm',
                fontSize: '10pt',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #15181d', width: '60mm', marginBottom: 4 }} />
                {shop.name}
                {actor ? ` · ${actor.role === 'ADMIN' ? 'Inhaber' : 'Mitarbeiter'}` : ''}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #15181d', width: '60mm', marginBottom: 4 }} />
                Kunde / Verkäufer
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function Editable({
  refEl,
  ph,
  ariaLabel,
  style,
}: {
  refEl: React.RefObject<HTMLDivElement>;
  ph: string;
  ariaLabel: string;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div
      ref={refEl}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      tabIndex={0}
      data-ph={ph}
      style={style}
    />
  );
}

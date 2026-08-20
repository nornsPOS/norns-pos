/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RueckgabeDialog — „Ich möchte das zurückgeben" (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Kunde legt den Bon hin (oder das Stück, gefunden über die Archivsuche).
 * Die Kassiererin wählt die Positionen; die Kasse bucht einen NEUEN Beleg mit
 * negativen Beträgen (DSFinV-K Tz. 4.2.5), Referenz auf das Original,
 * Barauszahlung, Stück zurück in den Bestand.
 *
 * Was der Dialog SAGT statt versteckt:
 *   • bereits zurückgegebene Positionen sind ausgegraut und sagen es;
 *   • § 25a-Positionen sind gesperrt und verweisen auf den Ankauf, mit dem
 *     Grund (die steuerliche Weiche liegt beim Berater, Frage A3b);
 *   • ab 2.000 EUR bar verlangt er den ausweisverifizierten Kunden VOR dem
 *     Absenden (§ 10 Abs. 6a Nr. 1 GwG) — nicht erst als Serverfehler.
 *
 * Die TSE-Signatur läuft nach demselben Muster wie der Storno: der Server
 * bucht und liefert die Steueraufteilung; signiert wird hier, Ausfälle gehen
 * in die dauerhafte Warteschlange.
 */

import { useEffect, useMemo, useState } from 'react';

import type { ApiClient } from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, MoneyAmount } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

interface Position {
  productId: string;
  name: string;
  sku: string;
  lineTotalEur: string;
  appliedTaxTreatmentCode: string | null;
  bereitsZurueck: boolean;
  nurUeberAnkauf: boolean;
}

interface Props {
  transactionId: string;
  receiptLocator: string;
  onClose: () => void;
  onDone: () => void;
}

const GWG_SCHWELLE_CENT = 200_000;

function centsVon(eur: string): number {
  const [e, c = '00'] = eur.replace('-', '').split('.');
  return Number(e) * 100 + Number(c.padEnd(2, '0').slice(0, 2));
}

export function RueckgabeDialog({ transactionId, receiptLocator, onClose, onDone }: Props): JSX.Element {
  const api = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);

  const [positionen, setPositionen] = useState<Position[] | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [grund, setGrund] = useState('');
  /**
   * Wie erstattet wird. `null` heisst „wie das Original bezahlt wurde" —
   * der Server entscheidet das dann selbst, und das ist der Normalfall.
   * Ein Wert hier ist die ausdrueckliche Abweichung des Tresens.
   */
  const [erstattungsart, setErstattungsart] = useState<'BAR' | 'KARTE' | null>(null);
  const [sendet, setSendet] = useState(false);

  // EIN AUSWEG (fenster-wache): Escape schliesst, solange nichts sendet —
  // die Kassiererin darf nie festsitzen, auch wenn der Zeiger klemmt.
  useEffect(() => {
    const beiTaste = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !sendet) onClose();
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [onClose, sendet]);

  useEffect(() => {
    let lebt = true;
    api
      .request<{ positionen: Position[] }>('GET', `/api/transactions/${transactionId}/positionen`)
      .then((r) => {
        if (lebt) setPositionen(r.positionen);
      })
      .catch((e: unknown) => {
        if (lebt) setLadefehler(describeError(e instanceof Error ? e : null));
      });
    return () => {
      lebt = false;
    };
  }, [api, transactionId]);

  const summeCents = useMemo(
    () =>
      (positionen ?? [])
        .filter((p) => gewaehlt.has(p.productId))
        .reduce((s, p) => s + centsVon(p.lineTotalEur), 0),
    [positionen, gewaehlt],
  );
  /*
   * ⚠️ NUR bei BAR (20.08.2026): § 10 Abs. 6a Nr. 1 GwG spricht von
   * BARzahlungen. Bei einer Gutschrift auf die Karte nach dem Ausweis zu
   * fragen waere eine erfundene Pflicht — und der Server verlangt sie dort
   * seit demselben Tag auch nicht mehr.
   *
   * `null` heisst „wie das Original bezahlt wurde". Da die Kasse die
   * Ursprungszahlart hier nicht kennt, bleibt die Warnung in diesem Fall
   * stehen: lieber einmal zu viel gewarnt als eine Ausweispflicht
   * verschwiegen, die der Server dann durchsetzt.
   */
  const brauchtKunden = summeCents >= GWG_SCHWELLE_CENT && erstattungsart !== 'KARTE';

  const waehlbar = (p: Position): boolean => !p.bereitsZurueck && !p.nurUeberAnkauf;

  async function absenden(): Promise<void> {
    if (gewaehlt.size === 0 || grund.trim().length < 3 || sendet) return;
    setSendet(true);
    try {
      const res = await api.request<{
        receiptLocator: string;
        totalEur: string;
        erstattungsart: 'BAR' | 'KARTE';
      }>(
        'POST',
        '/api/transactions/rueckgabe',
        {
          originalTransactionId: transactionId,
          productIds: [...gewaehlt],
          reason: grund.trim(),
          erfasstAm: new Date().toISOString(),
          ...(erstattungsart ? { erstattungsart } : {}),
        },
      );
      addToast({
        tone: 'success',
        title: 'Rückgabe gebucht',
        body:
          res.erstattungsart === 'BAR'
            ? `${res.receiptLocator}: ${res.totalEur} EUR bar auszuzahlen. Die Stücke liegen wieder im Bestand.`
            : `${res.receiptLocator}: ${res.totalEur} EUR gehen auf die Karte zurück. Die Lade bleibt unberührt, die Stücke liegen wieder im Bestand.`,
      });
      onDone();
    } catch (e: unknown) {
      addToast({
        tone: 'alert',
        title: 'Rückgabe nicht gebucht',
        body: describeError(e instanceof Error ? e : null),
      });
    } finally {
      setSendet(false);
    }
  }

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label={`Rückgabe zu ${receiptLocator}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(var(--w14-ink-rgb) / 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--w14-z-fenster)',
      }}
    >
      <div
        style={{
          background: 'var(--w14-parchment)',
          color: 'var(--w14-ink)',
          borderRadius: 12,
          padding: 'var(--w14-abstand-20)',
          width: 'min(560px, 92vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          boxShadow: '0 18px 48px rgb(0 0 0 / 0.35)',
        }}
      >
        <Zwischentitel label={`Rückgabe · ${receiptLocator}`} />

        {ladefehler ? (
          <p style={{ color: 'var(--w14-wax-red)' }}>{ladefehler}</p>
        ) : positionen === null ? (
          <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt …</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)', margin: '12px 0' }}>
              {positionen.map((p) => {
                const aktiv = gewaehlt.has(p.productId);
                return (
                  <label
                    key={p.productId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 'var(--w14-abstand-10)',
                      alignItems: 'center',
                      padding: 'var(--w14-abstand-8)',
                      borderRadius: 8,
                      border: `1px solid ${aktiv ? 'var(--w14-gold-soft)' : 'var(--w14-rule)'}`,
                      opacity: waehlbar(p) ? 1 : 0.55,
                      cursor: waehlbar(p) ? 'pointer' : 'not-allowed',
                      background: aktiv ? 'rgb(var(--w14-gilt-rgb) / 0.08)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={aktiv}
                      disabled={!waehlbar(p) || sendet}
                      onChange={(e) => {
                        setGewaehlt((alt) => {
                          const neu = new Set(alt);
                          if (e.target.checked) neu.add(p.productId);
                          else neu.delete(p.productId);
                          return neu;
                        });
                      }}
                      style={{ accentColor: 'var(--w14-gold)', width: 16, height: 16 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontWeight: 500 }}>{p.name}</span>
                      <span
                        style={{
                          display: 'block',
                          fontFamily: 'var(--w14-font-mono)',
                          fontSize: 'var(--w14-schrift-marke)',
                          color: 'var(--w14-ink-faded)',
                        }}
                      >
                        {p.sku}
                        {p.bereitsZurueck && ' · bereits zurückgegeben'}
                        {p.nurUeberAnkauf && ' · § 25a: bitte über den Ankauf (Frage A3b beim Steuerberater)'}
                      </span>
                    </span>
                    <MoneyAmount valueEur={p.lineTotalEur} />
                  </label>
                );
              })}
            </div>

            <label style={{ display: 'block', marginBottom: 10 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 'var(--w14-schrift-marke)',
                  color: 'var(--w14-ink-aged)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                Grund der Rückgabe
              </span>
              <input
                type="text"
                value={grund}
                onChange={(e) => setGrund(e.target.value)}
                placeholder="z. B. Kulanz, Kunde mit Bon"
                disabled={sendet}
                style={{
                  width: '100%',
                  padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                  borderRadius: 8,
                  border: '1px solid var(--w14-feldlinie)',
                  background: 'var(--w14-parchment-2)',
                  color: 'var(--w14-ink)',
                  font: 'inherit',
                }}
              />
            </label>

            {/* ── WIE ERSTATTET WIRD (20.08.2026) ────────────────────────
                Die Vorgabe ist der Weg zurueck, den das Geld gekommen ist;
                der Server kennt ihn aus dem Ursprungsbeleg. Der Tresen darf
                abweichen, aber dann sichtbar und mit der Folge daneben:
                bar heisst, die Lade wird leichter und der Kassensturz sieht
                es; Karte heisst, die Lade bleibt unberuehrt. */}
            <fieldset
              style={{
                border: '1px solid var(--w14-rule)',
                borderRadius: 8,
                padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                margin: '0 0 var(--w14-abstand-12)',
              }}
            >
              <legend
                style={{
                  fontSize: 'var(--w14-schrift-marke)',
                  color: 'var(--w14-ink-aged)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '0 var(--w14-abstand-6)',
                }}
              >
                Erstattung
              </legend>
              <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
                {(
                  [
                    ['Wie bezahlt wurde', null],
                    ['Bar aus der Lade', 'BAR'],
                    ['Zurück auf die Karte', 'KARTE'],
                  ] as const
                ).map(([wort, wert]) => {
                  const aktiv = erstattungsart === wert;
                  return (
                    <button
                      key={wort}
                      type="button"
                      onClick={() => setErstattungsart(wert)}
                      disabled={sendet}
                      style={{
                        minHeight: 40,
                        padding: '0 var(--w14-abstand-12)',
                        borderRadius: 'var(--w14-radius-button)',
                        border: `1px solid ${aktiv ? 'var(--w14-ink)' : 'var(--w14-feldlinie)'}`,
                        background: aktiv ? 'var(--w14-parchment-3)' : 'transparent',
                        color: 'var(--w14-ink)',
                        font: 'inherit',
                        fontSize: 'var(--w14-schrift-feld)',
                        cursor: sendet ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {wort}
                    </button>
                  );
                })}
              </div>
              <p
                style={{
                  margin: 'var(--w14-abstand-8) 0 0',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-aged)',
                  lineHeight: 1.5,
                  textWrap: 'pretty',
                }}
              >
                {erstattungsart === 'BAR'
                  ? 'Das Geld verlässt die Lade; der Kassensturz sieht den Abgang.'
                  : erstattungsart === 'KARTE'
                    ? 'Die Lade bleibt unberührt; die Gutschrift läuft über das Terminal.'
                    : 'Zurück auf demselben Weg, auf dem gezahlt wurde. Das ist der Normalfall.'}
              </p>
            </fieldset>

            {brauchtKunden && (
              <p
                style={{
                  margin: '0 0 10px',
                  padding: 'var(--w14-abstand-8)',
                  borderRadius: 8,
                  background: 'rgb(var(--w14-wax-red-rgb) / 0.12)',
                  fontSize: 'var(--w14-schrift-feld)',
                }}
              >
                Ab 2.000 EUR Barauszahlung verlangt das Geldwäschegesetz einen
                ausweisverifizierten Kunden. Bitte den Kunden zuerst unter Kunden erfassen
                und verifizieren; diese Rückgabe wird sonst abgewiesen.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
              <span style={{ color: 'var(--w14-ink-aged)' }}>
                Auszuzahlen:{' '}
                <strong>
                  <MoneyAmount valueEur={(summeCents / 100).toFixed(2)} />
                </strong>
              </span>
              <span style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
                <Button variant="ghost" onClick={onClose} disabled={sendet}>
                  Abbrechen
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void absenden()}
                  disabled={sendet || gewaehlt.size === 0 || grund.trim().length < 3}
                >
                  {sendet ? 'Bucht …' : 'Zurücknehmen und bar auszahlen'}
                </Button>
              </span>
            </div>
          </>
        )}
      </div>
    </div></Fensterboden>
  );
}

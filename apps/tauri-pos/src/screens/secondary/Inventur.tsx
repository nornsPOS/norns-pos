/**
 * Inventur — die Stichtagsinventur am Tresen (§ 240 HGB).
 *
 * Der Server konnte die körperliche Bestandsaufnahme seit Tag 21: Sitzung
 * öffnen, jede Position scannen, schließen und den Schwund rechnen. Nur konnte
 * sie niemand bedienen — vier Endpunkte ohne eine einzige Fläche.
 *
 * DER FUND, DER DIESE FLÄCHE ERST BRAUCHBAR MACHT. Vor diesem Stand hätte eine
 * Inventur gelogen: die Suche lief nur über `barcode`, und auf der Live-Datenbank
 * trugen 12 von 38 zählbaren Stücken einen Barcode, aber alle 38 eine eigene SKU.
 * 26 echte Stücke wären als „unbekannt" durchgefallen und am Ende als Schwund
 * gezählt worden. Der Server sucht jetzt Barcode zuerst, SKU danach.
 *
 * WAS EINE PRÜFUNG AM ERSTEN ENTWURF FAND, und warum es zählte:
 *
 *   • EIN globales `busy` sperrte das Erfassen, solange ein Scan unterwegs war,
 *     UND solange danach der Fortschritt neu geladen wurde. Wer mit dem
 *     Handscanner eine Vitrine abgeht, ist schneller als zwei Netzwege. Der
 *     verschluckte Scan hinterließ keine Zeile, keinen Fehler, keinen Ton, und
 *     das Stück landete am Ende als Schwund auf einem Papier, das eine
 *     Betriebsprüfung liest. Jetzt läuft je Code eine eigene Anfrage; nur
 *     derselbe Code doppelt wird abgewiesen.
 *   • Die Tastenanschläge des Scanners liefen ins fokussierte Feld und wurden
 *     nie gelöscht, also stand dort bald `SKU-A00123SKU-A00124…` und der
 *     nächste Druck schickte diesen Klumpen ab.
 *   • Unbekannte Fortschrittszahlen wurden als `0` gezeichnet: „0 Gefunden" in
 *     Grün, während dreißig Stücke erfasst waren.
 *   • Die zweite Kasse erfuhr nie, dass eine Inventur begann oder endete,
 *     obwohl der Text auf dieser Seite genau das verspricht.
 *   • Nach dem Abschluss war die Fläche tot: kein Weg, den nächsten Zählgang zu
 *     eröffnen, außer wegnavigieren und zurückkommen.
 *
 * EHRLICHKEITSREGEL: „offen" ist nicht „Schwund". Solange gezählt wird, ist eine
 * nicht gefundene Position schlicht noch nicht gefunden. Erst das Schließen
 * macht daraus ein Urteil, und deshalb verlangt das Schließen die Zweitbestätigung.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { InfoPunkt, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';
import { inventorySessionsApi } from '@norns/api-client';
import type { InventoryScanResult, InventorySessionView } from '@norns/api-client';

import { useApiClient } from '../../lib/api-context.js';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useSessionStore } from '../../state/session-store.js';

/** Was ein Scan bedeutet, in der Sprache des Tresens. Nie eine Rohmarke. */
const SCAN_MEANING: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  MATCHED: { label: 'Erfasst', tone: 'good' },
  DUPLICATE: { label: 'War schon erfasst', tone: 'warn' },
  UNKNOWN_BARCODE: { label: 'Kein Stück zu diesem Code', tone: 'bad' },
  EXPECTED_BUT_SOLD: { label: 'Bereits verkauft, gehört nicht ins Regal', tone: 'bad' },
  UNEXPECTED: { label: 'Entwurf, zählt noch nicht zum Bestand', tone: 'warn' },
};

function meaningOf(status: string): { label: string; tone: 'good' | 'warn' | 'bad' } {
  return SCAN_MEANING[status] ?? { label: 'Unklares Ergebnis', tone: 'warn' };
}

function toneColor(tone: 'good' | 'warn' | 'bad'): string {
  if (tone === 'good') return 'var(--w14-verdigris)';
  if (tone === 'bad') return 'var(--w14-wax-red)';
  return 'var(--w14-gilt)';
}

/** Ein Zeitpunkt so, wie ihn jemand am Tresen ausspricht. */
function clockLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ScanLine extends InventoryScanResult {
  raw: string;
  at: number;
}

const numeral: React.CSSProperties = {
  fontFamily: 'var(--w14-font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * Eine boxlose Kennzahl. `value` ist bewusst `number | string`: eine noch
 * unbekannte Zahl kommt als „…" herein und wird NICHT als 0 gezeichnet.
 */
function Figure({
  value,
  label,
  color,
}: {
  value: number | string;
  label: string;
  color?: string | undefined;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 96 }}>
      <span style={{ ...numeral, fontSize: 'var(--w14-schrift-kachel)', lineHeight: 1.1, color: color ?? 'var(--w14-ink)' }}>
        {value}
      </span>
      <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>{label}</span>
    </div>
  );
}

/** Eine Zahl, die der Server noch nicht bestätigt hat, sagt das. */
function figureOrUnknown(n: number | null | undefined): number | string {
  return typeof n === 'number' ? n : '…';
}

export function Inventur() {
  const api = useApiClient();
  const qc = useQueryClient();
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);

  const [lines, setLines] = useState<ScanLine[]>([]);
  const [manual, setManual] = useState('');
  // Je Code eine eigene laufende Anfrage. Ein globales Sperrflag verschluckte
  // jeden Scan, der während des vorigen eintraf.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [working, setWorking] = useState(false); // nur für Eröffnen/Schließen
  const [err, setErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [notes, setNotes] = useState('');
  const [closed, setClosed] = useState<InventorySessionView | null>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  const sessionQ = useQuery({
    queryKey: ['inventur', 'current'],
    queryFn: () => inventorySessionsApi.current(api),
    staleTime: 10_000,
    // Damit die zweite Kasse mitbekommt, dass ein Zählgang beginnt oder endet.
    // Ohne das behauptete diese Fläche dort minutenlang das Gegenteil.
    refetchInterval: 30_000,
  });
  const session = sessionQ.data ?? null;

  const progressQ = useQuery({
    queryKey: ['inventur', 'progress', session?.id ?? 'none'],
    queryFn: () => inventorySessionsApi.progress(api, session!.id),
    enabled: session != null,
    refetchInterval: session != null ? 15_000 : false,
    staleTime: 5_000,
  });
  const progress = progressQ.data ?? null;
  const progressUnknown = progressQ.isError && progress == null;

  const record = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      // Nur DERSELBE Code doppelt wird abgewiesen. Verschiedene Codes laufen
      // parallel, so schnell wie der Handscanner sie liefert.
      if (!session || code.length === 0 || inFlight.has(code)) return;
      setInFlight((prev) => new Set(prev).add(code));
      setErr(null);
      try {
        const res = await inventorySessionsApi.scan(api, session.id, code);
        setLines((prev) => [{ ...res, raw: code, at: Date.now() }, ...prev].slice(0, 200));
        // NICHT awaiten: der nächste Scan darf nicht auf diesen Netzweg warten.
        void progressQ.refetch();
      } catch (e) {
        setErr(describeError(e));
      } finally {
        setInFlight((prev) => {
          const next = new Set(prev);
          next.delete(code);
          return next;
        });
      }
    },
    [api, session, inFlight, progressQ],
  );

  // Der Handscanner tippt wie eine Tastatur. Seine Anschläge landen im
  // fokussierten Feld, deshalb wird es nach jedem Scan geleert; sonst wächst
  // dort ein Klumpen aus aneinandergehängten Nummern.
  useBarcodeScanner({
    enabled: session != null && !closing,
    onScan: (code) => {
      setManual('');
      void record(code);
    },
  });

  useEffect(() => {
    if (session != null && !closing) manualRef.current?.focus();
  }, [session, closing]);

  const openSession = useCallback(async () => {
    setWorking(true);
    setErr(null);
    try {
      await inventorySessionsApi.open(api);
      setLines([]);
      setClosed(null);
      await qc.invalidateQueries({ queryKey: ['inventur'] });
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setWorking(false);
    }
  }, [api, qc]);

  const closeSession = useCallback(async () => {
    if (!session) return;
    setWorking(true);
    setErr(null);
    try {
      const result = await inventorySessionsApi.close(api, session.id, notes.trim());
      setClosed(result);
      setClosing(false);
      setNotes('');
      await qc.invalidateQueries({ queryKey: ['inventur'] });
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setWorking(false);
    }
  }, [api, session, notes, qc]);

  const scanning = inFlight.size > 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-16)', padding: 'var(--w14-abstand-16)', maxWidth: 1100, margin: '0 auto' }}>
      <ParchmentCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)' }}>
          <h1 style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-summe)', margin: 0 }}>
            Inventur
          </h1>
          <InfoPunkt
            ariaLabel="Wie läuft die Inventur?"
            text="Jedes Stück einmal scannen: Etikett oder Hersteller-Code, beides wird erkannt. Solange gezählt wird, heißt offen nur: noch nicht gefunden. Erst das Schließen macht daraus Schwund."
          />
        </div>
      </ParchmentCard>

      {err != null && (
        <ParchmentCard>
          <p style={{ color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-text)', margin: 0 }}>{err}</p>
        </ParchmentCard>
      )}

      {/* ── Kein Zählgang läuft ────────────────────────────────────────────── */}
      {session == null && closed == null && (
        <ParchmentCard>
          {sessionQ.isLoading ? (
            <p style={{ color: 'var(--w14-ink-faded)' }}>Wird geprüft …</p>
          ) : sessionQ.isError ? (
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
              <p style={{ color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-text)', margin: 0 }}>
                Ob gerade eine Inventur läuft, konnte nicht geklärt werden.
              </p>
              <div>
                <Button variant="ghost" size="sm" onClick={() => void sessionQ.refetch()}>
                  Erneut versuchen
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 'var(--w14-schrift-betont)' }}>Zurzeit läuft keine Inventur.</p>
              <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)', marginTop: 6, lineHeight: 1.6 }}>
                {isOwner
                  ? 'Beim Öffnen hält der Server fest, wie viele Stücke der Bestand in diesem Moment führt. Es kann immer nur eine Inventur gleichzeitig laufen.'
                  : 'Eine Inventur eröffnet die Inhaberin oder der Inhaber. Sobald sie läuft, kann hier jede und jeder mitzählen.'}
              </p>
              {isOwner && (
                <div style={{ marginTop: '0.9rem' }}>
                  <Button variant="primary" size="md" onClick={() => void openSession()} disabled={working}>
                    {working ? 'Wird geöffnet …' : 'Inventur eröffnen'}
                  </Button>
                </div>
              )}
            </>
          )}
        </ParchmentCard>
      )}

      {/* ── Der abgeschlossene Bericht ─────────────────────────────────────── */}
      {closed != null && (
        <ParchmentCard>
          <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-lead)', margin: 0 }}>
            Inventur abgeschlossen
          </h2>
          <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)', marginTop: 4 }}>
            {closed.closedAt != null ? clockLabel(closed.closedAt) : ''}
          </p>
          <Zwischentitel />
          <div style={{ display: 'flex', gap: 'var(--w14-abstand-32)', flexWrap: 'wrap', paddingTop: 'var(--w14-abstand-8)' }}>
            <Figure value={closed.expectedCount} label="Erwartet" />
            <Figure
              value={figureOrUnknown(closed.matchedCount)}
              label="Gefunden"
              color="var(--w14-verdigris)"
            />
            <Figure
              value={figureOrUnknown(closed.missingCount)}
              label="Schwund"
              color={(closed.missingCount ?? 0) > 0 ? 'var(--w14-wax-red)' : undefined}
            />
            <Figure value={figureOrUnknown(closed.unexpectedCount)} label="Auffällige Scans" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)', marginTop: 'var(--w14-abstand-14)' }}>
            <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
              Festgeschrieben, im Tagebuch.
            </span>
            <InfoPunkt
              ariaLabel="Was heißt Schwund?"
              text="Schwund sind Stücke, die der Bestand führt und die bei dieser Zählung niemand gescannt hat."
            />
          </div>
          {/* Ohne das war die Fläche nach dem Abschluss tot. */}
          {isOwner && (
            <div style={{ marginTop: '0.9rem' }}>
              <Button variant="ghost" size="md" onClick={() => setClosed(null)}>
                Zurück zur Übersicht
              </Button>
            </div>
          )}
        </ParchmentCard>
      )}

      {/* ── Der laufende Zählgang ──────────────────────────────────────────── */}
      {session != null && (
        <>
          <ParchmentCard>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--w14-abstand-16)', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-lead)', margin: 0 }}>
                  Zählgang läuft
                </h2>
                <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)', marginTop: 3 }}>
                  Eröffnet {clockLabel(session.openedAt)}
                </p>
              </div>
              {isOwner && !closing && (
                <Button variant="ghost" size="md" onClick={() => setClosing(true)} disabled={working}>
                  Inventur abschließen
                </Button>
              )}
            </div>

            <Zwischentitel />

            <div style={{ display: 'flex', gap: 'var(--w14-abstand-32)', flexWrap: 'wrap', paddingTop: 'var(--w14-abstand-8)' }}>
              <Figure value={progress?.expectedCount ?? session.expectedCount} label="Erwartet" />
              <Figure
                value={figureOrUnknown(progress?.matchedCount)}
                label="Gefunden"
                color="var(--w14-verdigris)"
              />
              <Figure
                value={figureOrUnknown(progress?.openCount)}
                label="Noch offen"
                color={(progress?.openCount ?? 0) > 0 ? 'var(--w14-gilt)' : 'var(--w14-verdigris)'}
              />
              <Figure value={figureOrUnknown(progress?.scanCount)} label="Scans gesamt" />
            </div>
            <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)', marginTop: '0.8rem', lineHeight: 1.6 }}>
              {progressUnknown
                ? 'Der Zählstand ist gerade nicht erreichbar. Weiterscannen ist trotzdem in Ordnung, der Server nimmt jeden Scan an.'
                : 'Die Zahlen kommen vom Server und zählen auch mit, was an einer zweiten Kasse gescannt wird. „Noch offen" ist noch kein Schwund.'}
            </p>
          </ParchmentCard>

          {/* Abschluss-Bestätigung: boxlos, mit dem, was danach feststeht. */}
          {closing && (
            <ParchmentCard>
              <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-grund)', margin: 0 }}>
                Inventur wirklich abschließen?
              </h2>
              <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)', marginTop: 6, lineHeight: 1.6 }}>
                {progressUnknown
                  ? 'Wie viele Stücke noch fehlen, ist gerade nicht abrufbar. Mit dem Abschluss wird daraus trotzdem ein festes Ergebnis.'
                  : progress != null && progress.openCount > 0
                    ? `${progress.openCount} ${progress.openCount === 1 ? 'Stück ist' : 'Stücke sind'} noch nicht gefunden. Mit dem Abschluss ${progress.openCount === 1 ? 'wird daraus Schwund' : 'werden sie zu Schwund'}. Wer noch eine Vitrine offen hat, zählt besser zuerst zu Ende.`
                    : 'Alle erwarteten Stücke sind gefunden. Der Abschluss hält das fest.'}
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bemerkung zum Zählgang, etwa wer gezählt hat oder was auffiel …"
                rows={3}
                style={{
                  width: '100%',
                  marginTop: '0.7rem',
                  padding: 'var(--w14-abstand-10)',
                  borderRadius: 'var(--w14-radius-button)',
                  border: '1px solid var(--w14-feldlinie)',
                  background: 'var(--w14-parchment)',
                  color: 'var(--w14-ink)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--w14-schrift-text)',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', marginTop: '0.7rem', flexWrap: 'wrap' }}>
                <Button variant="primary" size="md" onClick={() => void closeSession()} disabled={working}>
                  {working ? 'Wird abgeschlossen …' : 'Abschließen'}
                </Button>
                <Button variant="ghost" size="md" onClick={() => setClosing(false)} disabled={working}>
                  Weiterzählen
                </Button>
              </div>
            </ParchmentCard>
          )}

          {/* Zählfeld + der Verlauf dieses Geräts. */}
          <ParchmentCard>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = manual;
                setManual('');
                void record(code);
              }}
              style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}
            >
              <input
                ref={manualRef}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Scannen oder Nummer eintippen"
                autoComplete="off"
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                  borderRadius: 'var(--w14-radius-button)',
                  border: '1px solid var(--w14-feldlinie)',
                  background: 'var(--w14-parchment)',
                  color: 'var(--w14-ink)',
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-betont)',
                }}
              />
              <Button variant="primary" size="md" type="submit" disabled={manual.trim().length === 0}>
                Erfassen
              </Button>
            </form>

            <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', marginTop: '0.6rem' }}>
              Der Handscanner wird erkannt, ohne dass jemand ins Feld klicken muss.
              {scanning ? ` ${inFlight.size} Scan${inFlight.size === 1 ? '' : 's'} unterwegs.` : ''}
            </p>

            {lines.length > 0 && (
              <>
                <Zwischentitel />
                <p style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', margin: '0 0 0.3rem' }}>
                  An diesem Gerät zuletzt erfasst. Der vollständige Zählgang liegt beim Server.
                </p>
                {lines.map((line, i) => {
                  const meaning = meaningOf(line.matchStatus);
                  return (
                    <div key={line.id}>
                      {i > 0 && <Zwischentitel />}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 'var(--w14-abstand-12)',
                          padding: 'var(--w14-abstand-8) 0',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ ...numeral, fontSize: 'var(--w14-schrift-text)' }}>{line.sku ?? line.raw}</span>
                        <span style={{ color: toneColor(meaning.tone), fontSize: 'var(--w14-schrift-text)', flex: 1 }}>
                          {meaning.label}
                        </span>
                        <span style={{ ...numeral, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                          {new Date(line.at).toLocaleTimeString('de-DE', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </ParchmentCard>
        </>
      )}
    </div>
  );
}

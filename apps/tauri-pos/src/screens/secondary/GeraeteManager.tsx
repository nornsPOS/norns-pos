/**
 * Gerätemanager, der Bereich „Geräte & Kasse" in den Einstellungen.
 *
 * 27.07.2026: der alte Kopf zählte vier Abschnitte und versprach „nur lokal
 * gespeichert", beides längst überholt. Wahr sind heute ACHT Gruppen, in der
 * Reihenfolge der Fläche:
 *
 *   1. Thermodrucker (ESC/POS)     Adresse, Port, Testverbindung, Testbeleg
 *   2. A4-Drucker                  Auswahl aus der Systemwarteschlange
 *   3. Etikettendrucker            eigener Abschnitt samt Testetikett
 *   4. ZVT-Kartenterminal          Adresse, Port, Verbindungsprüfung
 *   5. Kartenleser (Stripe)        seit 27.07.2026, SERVERVERWALTET: die
 *      Leser hängen am Stripe-Konto des Ladens, hier wohnt bewusst KEINE
 *      lokale Konfiguration (siehe KartenleserStripe.tsx)
 *   6. Barcode-Scanner
 *   7. Waage (USB)                 gewählter Port wird gemerkt
 *   8. TSE (fiskaly Cloud)         Zugangsdaten plus Warteschlangen-Stand
 *
 * Speicherung der lokalen Gruppen: Zustand plus localStorage, was für die
 * eine Kassenmaschine je Laden reicht und niemanden am Netz scheitern lässt.
 * Testknöpfe rufen die Rust-Brücke; jede Gruppe trägt ihre Statusmarke, und
 * ein echter Druckversuch bewegt die Marke mit (02a20eb, 26.07.2026).
 */

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button, Zwischentitel, Input, ParchmentCard, Select } from '@norns/ui-kit';

import {
  HardwareStatusBadge,
  type HardwareStatusTone,
} from '../../components/hardware/HardwareStatusBadge.js';
import { useHardwareAutoConnect } from '../../hooks/useHardwareAutoConnect.js';
import { useScaleWeight } from '../../hooks/useScaleWeight.js';
import { diagnoseAlsZeile } from '../../lib/drucker-diagnose.js';
// Die EINE Quelle für jeden Satz über den fiskalischen Zustand eines Belegs.
// Diese Fläche bringt nur die Messung mit, die Sätze kommen von dort.
import {
  type Fiskalzustand,
  type KassenEinrichtung,
  type Schrittziel,
  type Tonlage,
  fiskalzustandSatz,
  giltAlsEndgueltig,
  giltAlsWartend,
  zustandAusKorbzeile,
} from '../../lib/fiskalzustand-satz.js';
import { useTseQueueStats } from '../../lib/tse-queue-drain-hook.js';
import type { TseQueueStats, TseQueueStatus } from '../../lib/tse-queue-store.js';
import {
  type LabelConfig,
  type SystemPrinter,
  type ThermalReceiptData,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  labelClient,
  systemClient,
  thermalClient,
  tseClient,
  zvtClient,
} from '../../lib/hardware-client.js';
import {
  type LabelPrinterConfig,
  type ThermalConfig,
  type TseFiskalyConfig,
  type ZvtTerminalConfig,
  useHardwareStore,
} from '../../state/hardware-store.js';
import { DruckerErkennen } from './DruckerErkennen.js';
import { KartenleserStripeSection } from './KartenleserStripe.js';
import { WirtSection } from './WirtSection.js';
import { useScannerStore } from '../../state/scanner-store.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { notePrintOutcome } from '../../lib/hardware-reprobe.js';
import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';

/**
 * Der Zustand, den das Betriebssystem über einen Drucker meldet, auf Deutsch.
 *
 * ⚠️ 01.08.2026: an drei Stellen stand `({p.status})` — der Kassierer las
 * „Bon-Drucker (idle)". Die vier Werte kommen aus `lib/hardware-client.ts:677`
 * und sind dort abschliessend aufgezählt; mehr gibt es nicht.
 *
 * Der Rückfall nennt trotzdem nie das rohe Wort: kommt eines Tages ein
 * fünfter Zustand dazu, steht dort „Unbekannt", nicht englischer Rohtext.
 */
const DRUCKER_ZUSTAND: Record<string, string> = {
  idle: 'bereit',
  printing: 'druckt',
  stopped: 'angehalten',
  unknown: 'Zustand unbekannt',
};

function druckerZustand(status: string): string {
  return DRUCKER_ZUSTAND[status] ?? 'Zustand unbekannt';
}

export function GeraeteManager(): JSX.Element {
  const hydrate = useHardwareStore((s) => s.hydrateFromLocal);
  const addToast = useToastStore((s) => s.addToast);
  const { connectAll } = useHardwareAutoConnect();
  const [connectingAll, setConnectingAll] = useState(false);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const onConnectAll = useCallback(async () => {
    setConnectingAll(true);
    try {
      await connectAll();
      // Read the fresh verdicts straight from the store after the sweep.
      const cfg = useHardwareStore.getState().config;
      const reachable = [cfg.thermal.lastReachable, cfg.label.lastReachable, cfg.zvt.lastReachable];
      const okCount = reachable.filter((r) => r === true).length;
      const configured = reachable.filter((r) => r !== null).length;

      /*
       * DIE ZAHL DARF NICHT MEHR SAGEN, ALS SIE GEPRÜFT HAT (25.07.2026).
       *
       * `connectAll` sondiert genau DREI Geräte: Bondrucker, Etikettendrucker,
       * Terminal. Die Meldung sagte trotzdem „Alle eingerichteten Geräte sind
       * erreichbar" — und der Mensch las das mit der TSE im Kopf.
       *
       * Der Ablauf, der daraus folgt: das Fiskaly-Zertifikat ist abgelaufen,
       * die TSE antwortet nicht. Morgens „Alle Geräte verbinden" antippen, drei
       * Geräte melden sich, grüner Kasten: „3 von 3 verbunden — alle
       * erreichbar." Der Tag beginnt im Glauben, die Sicherheitseinrichtung
       * laufe. Sie fällt erst beim ersten Verkauf auf.
       *
       * Jetzt nennt die Meldung, WAS geprüft wurde, und sagt ausdrücklich,
       * dass die TSE nicht dabei war.
       */
      const tseEingerichtet = cfg.tse.tssId.trim().length > 0;
      addToast({
        tone: okCount > 0 ? 'success' : 'alert',
        title:
          configured === 0
            ? 'Keine Geräte konfiguriert'
            : `${okCount} von ${configured} geprüften Geräten verbunden`,
        body:
          configured === 0
            ? 'Bitte zuerst die Adressen der Geräte eintragen.'
            : [
                okCount === configured
                  ? 'Bondrucker, Etikettendrucker und Terminal antworten.'
                  : 'Bitte die nicht erreichbaren Geräte prüfen (Strom, Netzwerk).',
                tseEingerichtet
                  ? 'Die Sicherheitseinrichtung wurde hier NICHT geprüft, dafür „TSE-Verbindung prüfen".'
                  : null,
              ]
                .filter(Boolean)
                .join(' '),
      });
    } finally {
      setConnectingAll(false);
    }
  }, [connectAll, addToast]);

  return (
    <section
      aria-label="Geräte & Kasse"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-20)',
        gap: 'var(--w14-abstand-14)',
        overflow: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-14)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-summe)',
            }}
          >
            Geräte & Kasse
          </h1>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Drucker · Karten-Terminal · TSE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
          {!isRunningInTauri() && (
            <span
              className="w14-smallcaps"
              style={{ color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-zeile)' }}
            >
              Browser-Modus, Aktionen sind deaktiviert
            </span>
          )}
          <Button
            variant="primary"
            onClick={() => void onConnectAll()}
            disabled={connectingAll || !isRunningInTauri()}
          >
            {connectingAll ? 'Verbindet…' : 'Alle Geräte verbinden'}
          </Button>
        </div>
      </header>
      <Zwischentitel />

      {/* Zuallererst der WIRT: das Geraet selbst, mit gemessenem Speicher-
          und Plattenstand. Bei jedem Stoerungsanruf ist das die erste Frage. */}
      <WirtSection />

      {/* Danach: WAS haengt ueberhaupt dran. Wer ein Geraet einrichten
          will, sucht sonst zuerst in sieben Abschnitten nach dem richtigen. */}
      <DruckerErkennen />

      <ThermalSection />
      <A4Section />
      <LabelSection />
      <ZvtSection />
      {/* Der Stripe-Leser wohnt NEBEN dem ZVT-Terminal, ersetzt es nicht.
          Die Gruppe erscheint nur mit eingerichtetem Konto wirklich als
          Zahlungsweg — ohne Schlüssel steht hier eine ruhige Erklärung. */}
      <KartenleserStripeSection />
      <ScannerSection />
      <WaageSection />
      <ModuleSection />
      <TseSection />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 1 — Thermal Printer (ESC/POS)
// ════════════════════════════════════════════════════════════════════════

function ThermalSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.thermal);
  const setThermal = useHardwareStore((s) => s.setThermal);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState<'test' | 'print' | 'detect' | null>(null);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);

  // Re-hydrate the drafts if the store changes externally.
  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const save = useCallback((patch: Partial<ThermalConfig>) => setThermal(patch), [setThermal]);

  // The endpoint handed to the Rust layer: USB mode carries the queue name (no
  // IP); network mode carries ip:port. The Rust side picks the transport.
  const endpoint =
    cfg.mode === 'usb'
      ? { ip: '', port: 9100, printerName: cfg.printerName }
      : { ip: cfg.ip, port: cfg.port };
  const ready = cfg.mode === 'usb' ? cfg.printerName.length > 0 : cfg.ip.length > 0;

  // Refresh the OS print-queue list (for the USB dropdown).
  const refreshPrinters = useCallback(async () => {
    if (!isRunningInTauri()) return;
    try {
      setPrinters(await systemClient.listPrinters());
    } catch {
      /* listing is best-effort; the auto-detect button is the happy path */
    }
  }, []);
  useEffect(() => {
    if (cfg.mode === 'usb') void refreshPrinters();
  }, [cfg.mode, refreshPrinters]);

  // One-tap "just plug it in": auto-detect the USB receipt printer.
  const autoDetect = useCallback(async () => {
    setBusy('detect');
    try {
      const name = await thermalClient.detectReceiptPrinter();
      if (name) {
        save({
          mode: 'usb',
          printerName: name,
          lastReachable: true,
          lastCheckedAt: new Date().toISOString(),
        });
        void refreshPrinters();
        addToast({ tone: 'success', title: 'USB-Drucker erkannt', body: name });
      } else {
        addToast({
          tone: 'alert',
          title: 'Kein USB-Drucker gefunden',
          body: 'Drucker einschalten und per USB anschließen, dann erneut „Erkennen".',
        });
      }
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Erkennung fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, save, refreshPrinters]);

  const testConnection = useCallback(async () => {
    setBusy('test');
    try {
      // Probe only — opens the socket / checks the queue, sends NO bytes (never
      // wakes the cutter or feeds paper), then marks the badge.
      const ok = await thermalClient.check(endpoint);
      save({ lastReachable: ok, lastCheckedAt: new Date().toISOString() });
      const where = cfg.mode === 'usb' ? cfg.printerName : `${cfg.ip}:${cfg.port}`;
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Drucker verbunden' : 'Drucker nicht erreichbar',
        body: ok ? where : `Keine Antwort von ${where}. Bitte Strom/Anschluss prüfen.`,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Verbindungsfehler',
        body: isHardwareError(err) ? describeHardwareError(err) : 'Unbekannter Fehler',
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, endpoint, cfg.mode, cfg.printerName, cfg.ip, cfg.port, save]);

  const printTestReceipt = useCallback(async () => {
    setBusy('print');
    try {
      // Siehe useReceiptPrinter: ein echter Druckversuch bewegt die Marke.
      await thermalClient.print(endpoint, buildTestReceipt());
      notePrintOutcome('thermal', null);
      addToast({
        tone: 'success',
        title: 'Testbeleg gesendet',
        body: 'Bitte Drucker kontrollieren.',
      });
    } catch (err) {
      notePrintOutcome('thermal', err);
      addToast({
        tone: 'alert',
        title: 'Druck fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, endpoint]);

  return (
    <Card title="Bondrucker (ESC/POS)">
      {/* Anschluss-Art: USB (einfach anstecken) oder Netzwerk (IP). */}
      <Row>
        <span
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          Anschluss
        </span>
        <Button
          variant={cfg.mode === 'usb' ? 'primary' : 'ghost'}
          onClick={() => save({ mode: 'usb' })}
        >
          USB
        </Button>
        <Button
          variant={cfg.mode === 'network' ? 'primary' : 'ghost'}
          onClick={() => save({ mode: 'network' })}
        >
          Netzwerk (LAN)
        </Button>
      </Row>

      {cfg.mode === 'usb' ? (
        <>
          <Row>
            <Button variant="primary" onClick={() => void autoDetect()} disabled={busy !== null}>
              {busy === 'detect' ? 'Sucht…' : 'USB-Drucker automatisch erkennen'}
            </Button>
            <Button variant="ghost" onClick={() => void refreshPrinters()} disabled={busy !== null}>
              Liste aktualisieren
            </Button>
          </Row>
          <Row>
            <label
              htmlFor="thermal-usb-printer"
              className="w14-smallcaps"
              style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
            >
              Drucker
            </label>
            {/* ⚠️ Der Bausatz, nicht von Hand. Befund vom 13.08.2026: hier stand
                ein eigenes <select>, das `backgroundColor` setzte und `color`
                NICHT. Im dunklen Modus erbte es die helle Schrift und schrieb
                weiss auf hell. `baseControlStyle` im Bausatz setzt beide immer
                als PAAR. Drei wortgleiche Abschriften in dieser Datei hatten
                denselben Fehler. */}
            <Select
              id="thermal-usb-printer"
              value={cfg.printerName}
              onChange={(e) =>
                save({ printerName: e.target.value, lastReachable: null, lastCheckedAt: null })
              }
              style={{ flex: 1 }}
            >
              <option value="">automatisch erkennen oder wählen</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({druckerZustand(p.status)})
                </option>
              ))}
              {cfg.printerName && !printers.some((p) => p.name === cfg.printerName) ? (
                <option value={cfg.printerName}>{cfg.printerName}</option>
              ) : null}
            </Select>
          </Row>
        </>
      ) : (
        <Row>
          <LabelledInput
            label="IP-Adresse"
            value={ipDraft}
            onChange={setIpDraft}
            onBlur={() => save({ ip: ipDraft.trim() })}
            placeholder="192.168.1.50"
          />
          <LabelledInput
            label="Port"
            value={portDraft}
            onChange={setPortDraft}
            onBlur={() => save({ port: Number(portDraft) || 9100 })}
            placeholder="9100"
            width={90}
          />
        </Row>
      )}

      {/*
        * DIE ROLLENBREITE.
        *
        * Der Belegaufbau rechnete fest mit 32 Zeichen je Zeile und der
        * Kommentar dazu behauptete, das passe auf 80 mm. Es passt auf 58 mm;
        * 80 mm tragen 48 Zeichen. Ein 80-mm-Drucker druckte also auf zwei
        * Dritteln des Papiers, und der QR-Code wurde für die falsche Breite
        * gerechnet.
        *
        * Vorgabe bleibt 58, damit sich kein laufender Betrieb beim
        * Aktualisieren von selbst umbaut.
        */}
      <Row>
        <span style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)', minWidth: 120 }}>
          Rollenbreite
        </span>
        {([58, 80] as const).map((mm) => (
          <Button
            key={mm}
            variant={cfg.paperWidthMm === mm ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => save({ paperWidthMm: mm })}
          >
            {mm} mm
          </Button>
        ))}
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          {cfg.paperWidthMm === 80 ? '48 Zeichen je Zeile' : '32 Zeichen je Zeile'}
        </span>
      </Row>

      <Row>
        <Button
          variant="ghost"
          onClick={() => void testConnection()}
          disabled={busy !== null || !ready}
        >
          {busy === 'test' ? 'Prüft…' : 'Verbindung prüfen'}
        </Button>
        <Button
          variant="primary"
          onClick={() => void printTestReceipt()}
          disabled={busy !== null || !ready}
        >
          {busy === 'print' ? 'Druckt…' : 'Testbeleg drucken'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht verbunden'
              : cfg.lastReachable
                ? 'Drucker verbunden'
                : 'Drucker nicht erreichbar'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2 — A4 Printer (system queue)
// ════════════════════════════════════════════════════════════════════════

function A4Section(): JSX.Element {
  const printerName = useHardwareStore((s) => s.config.a4.printerName);
  const setA4 = useHardwareStore((s) => s.setA4);
  const addToast = useToastStore((s) => s.addToast);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isRunningInTauri()) return;
    setRefreshing(true);
    try {
      const list = await systemClient.listPrinters();
      setPrinters(list);
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Drucker konnten nicht ermittelt werden',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card title="A4-Drucker (Rechnungen)">
      <Row>
        <label
          htmlFor="a4-printer"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          System-Drucker
        </label>
        <Select
          id="a4-printer"
          value={printerName}
          onChange={(e) => setA4({ printerName: e.target.value })}
          style={{ flex: 1 }}
        >
          <option value="">bitte wählen</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({druckerZustand(p.status)})
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Lädt…' : 'Aktualisieren'}
        </Button>
      </Row>
      <Row>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
          Liste stammt von <code>lpstat -p</code>. PDFs gehen via <code>lpr -P</code>.
        </span>
      </Row>
    </Card>
  );
}

/**
 * ── Der Modulschalter (14.08.2026, Basels Entscheidung) ──────────────────
 *
 * `modul.waage` schaltet den ganzen Waagen-Block je Betrieb ab. Leer gilt
 * als AN; verschwinden darf der Block nur auf ein ausdrueckliches AUS, nie
 * wegen eines Netzfehlers beim Lesen der Einstellung.
 *
 * Die Weiche ist ein EIGENES Bauteil, damit die Geraete-Haken des Blocks
 * (Waagengewicht, Auto-Verbinden) gar nicht erst laufen, wenn der Betrieb
 * keine Waage fuehrt — ein frueher Ausstieg zwischen Haken desselben
 * Bauteils waere gegen die Regeln von React.
 */
/**
 * ── MODULE DIESES BETRIEBS (19.08.2026, Vermessung) ────────────────────────
 *
 * `modul.kursleiste` und `modul.waage` hatten Leser (MetalTicker, die
 * Waagen-Sektion oben), aber nach der Erstinbetriebnahme KEINEN Redakteur:
 * wer die Waage abgeschaltet hatte, fand keine Hand mehr, sie wieder
 * einzuschalten — die Sektion selbst versteckt sich ja bei AUS. Diese Karte
 * ist deshalb IMMER sichtbar und ist der eine Redakteur beider Schalter.
 * Leer gilt als AN, wie im Assistenten dokumentiert.
 */
function ModuleSection(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const q = useQuery({
    queryKey: ['settings', 'module'],
    queryFn: () =>
      api.request<{ settings: Array<{ key: string; value: string }> }>('GET', '/api/settings'),
    staleTime: 60_000,
    select: (d) => ({
      kursleiste: entpacktOderAn(d.settings.find((x) => x.key === 'modul.kursleiste')?.value),
      waage: entpacktOderAn(d.settings.find((x) => x.key === 'modul.waage')?.value),
    }),
  });

  const setzen = useMutation({
    mutationFn: async (arg: { schluessel: string; wert: 'AN' | 'AUS' }) => {
      await api.request('PATCH', `/api/settings/${arg.schluessel}`, { value: arg.wert });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      addToast({ tone: 'success', title: 'Module', body: 'Gespeichert. Gilt sofort.' });
    },
    onError: () =>
      addToast({ tone: 'alert', title: 'Module', body: 'Die Wahl konnte nicht gespeichert werden.' }),
  });

  const zeile = (
    etikett: string,
    satz: string,
    schluessel: string,
    wert: 'AN' | 'AUS' | undefined,
  ): JSX.Element => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--w14-abstand-12)',
        padding: 'var(--w14-abstand-8) 0',
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--w14-schrift-betont)', color: 'var(--w14-ink)' }}>{etikett}</div>
        <div style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>{satz}</div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)' }}>
        {(['AN', 'AUS'] as const).map((w) => (
          <Button
            key={w}
            size="sm"
            variant={wert === w ? 'primary' : 'ghost'}
            disabled={setzen.isPending || wert === undefined}
            onClick={() => setzen.mutate({ schluessel, wert: w })}
          >
            {w === 'AN' ? 'Anzeigen' : 'Ausblenden'}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label="Module dieses Betriebs" />
      <p style={{ margin: '0 0 var(--w14-abstand-8)', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
        Was hier ausgeschaltet wird, verschwindet aus der Flaeche, bleibt aber im
        Programm. Dieselben Schalter wie in der Erstinbetriebnahme.
      </p>
      {zeile(
        'Metallkurs-Leiste',
        'Gold- und Silberkurs am oberen Rand, mit Verlauf.',
        'modul.kursleiste',
        q.data?.kursleiste,
      )}
      {zeile(
        'Waage',
        'Das Wiegen im Ankauf und die Waagen-Einrichtung hier unten.',
        'modul.waage',
        q.data?.waage,
      )}
    </ParchmentCard>
  );
}

/** Leer oder Unbekanntes gilt als AN — dieselbe Vorgabe wie im Assistenten. */
function entpacktOderAn(roh: string | undefined): 'AN' | 'AUS' {
  try {
    const w = roh === undefined ? '' : String(JSON.parse(roh));
    return w === 'AUS' ? 'AUS' : 'AN';
  } catch {
    return roh === 'AUS' ? 'AUS' : 'AN';
  }
}

function WaageSection(): JSX.Element | null {
  const api = useApiClient();
  const modulQ = useQuery({
    queryKey: ['settings', 'modul.waage'],
    queryFn: () =>
      api.request<{ settings: Array<{ key: string; value: string }> }>('GET', '/api/settings'),
    staleTime: 60_000,
    select: (d) => d.settings.find((x) => x.key === 'modul.waage')?.value ?? '',
  });
  if (modulQ.data === 'AUS') return null;
  return <WaageSectionInhalt />;
}

function WaageSectionInhalt(): JSX.Element {

  const portPath = useHardwareStore((s) => s.config.scale.portPath);
  const baudRate = useHardwareStore((s) => s.config.scale.baudRate);
  const setScale = useHardwareStore((s) => s.setScale);
  const addToast = useToastStore((s) => s.addToast);
  const { readWeight, tare, listPorts, loading } = useScaleWeight();
  const [ports, setPorts] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isRunningInTauri()) return;
    setRefreshing(true);
    try {
      setPorts(await listPorts());
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Anschlüsse konnten nicht ermittelt werden',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setRefreshing(false);
    }
  }, [addToast, listPorts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const testWeigh = useCallback(async () => {
    if (!portPath) return;
    try {
      const w = await readWeight(portPath, baudRate);
      addToast({ tone: 'success', title: 'Waage verbunden', body: `Gewicht: ${w.grams} g` });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Wägen fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    }
  }, [addToast, baudRate, portPath, readWeight]);

  const doTare = useCallback(async () => {
    if (!portPath) return;
    try {
      await tare(portPath, baudRate);
      addToast({ tone: 'success', title: 'Waage tariert', body: 'Nullpunkt gesetzt.' });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Tarieren fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    }
  }, [addToast, baudRate, portPath, tare]);

  const actionsDisabled = !isRunningInTauri() || !portPath || loading;

  return (
    <Card title="USB-Waage (Ankauf)">
      <Row>
        <label
          htmlFor="scale-port"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          Anschluss
        </label>
        <Select
          id="scale-port"
          value={portPath}
          onChange={(e) => setScale({ portPath: e.target.value })}
          style={{ flex: 1 }}
        >
          <option value="">bitte wählen</option>
          {/* Keep the persisted port selectable even before the enumeration runs. */}
          {portPath && !ports.includes(portPath) && <option value={portPath}>{portPath}</option>}
          {ports.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          onClick={() => void refresh()}
          disabled={refreshing || !isRunningInTauri()}
        >
          {refreshing ? 'Lädt…' : 'Aktualisieren'}
        </Button>
      </Row>
      <Row>
        <Button variant="ghost" onClick={() => void testWeigh()} disabled={actionsDisabled}>
          {loading ? 'Wägt…' : 'Wägen testen'}
        </Button>
        <Button variant="ghost" onClick={() => void doTare()} disabled={actionsDisabled}>
          Tarieren
        </Button>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
          Serielle Waage (MT-SICS). Nur stabile Gewichte werden übernommen.
        </span>
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2b — Label printer (ZPL / ESC-POS)
// ════════════════════════════════════════════════════════════════════════

function LabelSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.label);
  const setLabel = useHardwareStore((s) => s.setLabel);
  const addToast = useToastStore((s) => s.addToast);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));
  const [busy, setBusy] = useState<'connect' | 'print' | null>(null);

  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const refresh = useCallback(async () => {
    if (!isRunningInTauri()) return;
    try {
      setPrinters(await systemClient.listPrinters());
    } catch {
      // Non-fatal — the operator can still type a name (n/a for label rolls).
    }
  }, []);
  useEffect(() => {
    if (cfg.mode === 'system') void refresh();
  }, [cfg.mode, refresh]);

  const save = useCallback((patch: Partial<LabelPrinterConfig>) => setLabel(patch), [setLabel]);

  const currentConfig = useCallback(
    (): LabelConfig => ({
      mode: cfg.mode,
      ip: cfg.ip || undefined,
      port: cfg.port,
      printerName: cfg.printerName || undefined,
      printerType: cfg.printerType,
    }),
    [cfg.mode, cfg.ip, cfg.port, cfg.printerName, cfg.printerType],
  );

  // One-tap probe: confirm reachability (socket / CUPS queue) without printing
  // a sticker — the calm "verbunden / nicht erreichbar" badge.
  const connect = useCallback(async () => {
    setBusy('connect');
    try {
      const ok = await labelClient.check(currentConfig());
      save({ lastReachable: ok, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Etikettendrucker verbunden' : 'Etikettendrucker nicht erreichbar',
        body: ok
          ? 'Bereit für den Etikettendruck.'
          : 'Keine Antwort. Bitte Strom, Netzwerk oder Warteschlange prüfen.',
      });
    } catch (err) {
      save({ lastReachable: false, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: 'alert',
        title: 'Verbindungsfehler',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, save, currentConfig]);

  const test = useCallback(async () => {
    setBusy('print');
    try {
      await labelClient.test(currentConfig());
      save({ lastReachable: true, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: 'success',
        title: 'Testetikett gesendet',
        body: 'Bitte Etikettendrucker kontrollieren.',
      });
    } catch (err) {
      save({ lastReachable: false, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: 'alert',
        title: 'Etikettendruck fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, save, currentConfig]);

  const notConfigured = cfg.mode === 'system' ? cfg.printerName.length === 0 : cfg.ip.length === 0;
  const actionsDisabled = busy !== null || notConfigured;

  return (
    <Card title="Etikettendrucker">
      <Row>
        <label
          htmlFor="label-mode"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          Modus
        </label>
        <Select
          id="label-mode"
          value={cfg.mode}
          onChange={(e) => save({ mode: e.target.value as LabelPrinterConfig['mode'] })}
          style={{ width: 240 }}
        >
          <option value="system">System-Warteschlange (CUPS)</option>
          <option value="tcp">Netzwerk (TCP 9100)</option>
        </Select>
        <label
          htmlFor="label-type"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 70 }}
        >
          Format
        </label>
        <Select
          id="label-type"
          value={cfg.printerType}
          onChange={(e) =>
            save({ printerType: e.target.value as LabelPrinterConfig['printerType'] })
          }
          style={{ width: 140 }}
        >
          <option value="ZPL">ZPL (Zebra)</option>
          <option value="ESCPOS">ESC/POS</option>
          {/* Ein Rasterdrucker wird ÜBER DIE WARTESCHLANGE bedient, nie über
              Anschluss 9100. Deshalb erscheint er nur im Systembetrieb — im
              Netzbetrieb wäre er eine Wahl, die der Rumpf danach ablehnt. */}
          {cfg.mode === 'system' ? (
            <option value="RASTER">Rasterbild (DYMO, Brother QL, Seiko)</option>
          ) : null}
        </Select>
      </Row>

      {cfg.mode === 'system' ? (
        <Row>
          <label
            htmlFor="label-printer"
            className="w14-smallcaps"
            style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
          >
            System-Drucker
          </label>
          <Select
            id="label-printer"
            value={cfg.printerName}
            onChange={(e) => save({ printerName: e.target.value })}
            style={{ width: 240 }}
          >
            <option value="">bitte wählen</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({druckerZustand(p.status)})
              </option>
            ))}
          </Select>
          <Button variant="ghost" onClick={() => void refresh()}>
            Aktualisieren
          </Button>
        </Row>
      ) : (
        <Row>
          <LabelledInput
            label="IP-Adresse"
            value={ipDraft}
            onChange={setIpDraft}
            onBlur={() => save({ ip: ipDraft.trim() })}
            placeholder="192.168.1.70"
          />
          <LabelledInput
            label="Port"
            value={portDraft}
            onChange={setPortDraft}
            onBlur={() => save({ port: Number(portDraft) || 9100 })}
            placeholder="9100"
            width={90}
          />
        </Row>
      )}

      <Row>
        <Button variant="ghost" onClick={() => void connect()} disabled={actionsDisabled}>
          {busy === 'connect' ? 'Verbindet…' : 'Automatisch verbinden'}
        </Button>
        <Button variant="primary" onClick={() => void test()} disabled={actionsDisabled}>
          {busy === 'print' ? 'Druckt…' : 'Testetikett drucken'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht verbunden'
              : cfg.lastReachable
                ? 'Drucker verbunden'
                : 'Drucker nicht erreichbar'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3 — ZVT Card Terminal
// ════════════════════════════════════════════════════════════════════════

function ZvtSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.zvt);
  const setZvt = useHardwareStore((s) => s.setZvt);
  const addToast = useToastStore((s) => s.addToast);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const save = useCallback((patch: Partial<ZvtTerminalConfig>) => setZvt(patch), [setZvt]);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await zvtClient.check({ ip: cfg.ip, port: cfg.port });
      save({ lastReachable: ok, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Terminal verbunden' : 'Terminal nicht erreichbar',
        body: ok
          ? `${cfg.ip}:${cfg.port}`
          : `Keine Antwort von ${cfg.ip}:${cfg.port}. Bitte Strom und Netzwerk prüfen.`,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'ZVT-Verbindungsfehler',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, cfg.ip, cfg.port, save]);

  return (
    <Card title="Kartenterminal (ZVT)">
      <Row>
        <LabelledInput
          label="IP-Adresse"
          value={ipDraft}
          onChange={setIpDraft}
          onBlur={() => save({ ip: ipDraft.trim() })}
          placeholder="192.168.1.60"
        />
        <LabelledInput
          label="Port"
          value={portDraft}
          onChange={setPortDraft}
          onBlur={() => save({ port: Number(portDraft) || 20007 })}
          placeholder="20007"
          width={90}
        />
      </Row>
      <Row>
        <Button variant="ghost" onClick={() => void check()} disabled={busy || !cfg.ip}>
          {busy ? 'Verbindet…' : 'Automatisch verbinden'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht verbunden'
              : cfg.lastReachable
                ? 'Terminal verbunden'
                : 'Terminal nicht erreichbar'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3b — Barcode-Scanner (USB-HID-Wedge) — plug-and-play, liveness-based status
// ════════════════════════════════════════════════════════════════════════

function ScannerSection(): JSX.Element {
  const lastScanAt = useScannerStore((s) => s.lastScanAt);
  const lastCode = useScannerStore((s) => s.lastCode);

  // A keyboard-class scanner has no IP and nothing to connect to — it works the
  // instant it is plugged in. "Connected" here means the app decoded a scan
  // recently (the only honest readiness signal); until then we show a calm
  // "ready, waiting for first scan" state rather than an error.
  const seen = lastScanAt !== null;

  return (
    <Card title="Barcode-Scanner (USB)">
      <Row>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)', flex: 1 }}>
          Der Handscanner funktioniert ohne Einrichtung: einstecken und scannen. Er wirkt systemweit.
          Ein Scan landet automatisch in Kasse oder Lager.
        </span>
      </Row>
      <Row>
        {seen ? (
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
            Zuletzt gescannt:{' '}
            <code style={{ fontFamily: 'var(--w14-font-mono)' }}>{lastCode ?? '-'}</code>
          </span>
        ) : (
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
            Zum Prüfen einfach ein beliebiges Etikett scannen.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={seen ? 'online' : 'pending'}
          label={seen ? 'Scanner bereit' : 'Bereit, auf ersten Scan wartend'}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 4 — TSE (Fiskaly Cloud)
// ════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ DIE ZWEI LÜGEN, DIE HIER STANDEN — GEMESSEN AM 13.08.2026
 *
 * ── 1. DER SATZ ZEIGTE AUF EINEN AUSGEGRAUTEN KNOPF ───────────────────────
 *
 * Bei jedem endgültigen Ausfall stand hier wörtlich:
 *
 *     „Einige Signaturen konnten nicht übertragen werden.
 *      Bitte TSE-Verbindung prüfen."
 *
 * Für eine Kasse OHNE hinterlegte Kennung sind BEIDE Hälften falsch:
 *
 *   · Es wurde nie eine Signatur erzeugt, die man hätte übertragen können.
 *     Genau die leere Kennung ist die Bedingung, aus der `grundOhneSignatur`
 *     den Fall „keine TSE hinterlegt" ableitet
 *     (`lib/ohne-signatur-hinweis.ts:55`).
 *   · Der genannte Knopf ist in diesem Zustand gesperrt. Seine Bedingung
 *     steht ein paar Zeilen tiefer im selben Abschnitt:
 *     `disabled={busy || !cfg.tssId || !cfg.credentialsStored}`.
 *
 * Der Schirm schickte den Kassierer also auf ein Bedienelement, das er in
 * genau dem beschriebenen Zustand nicht drücken kann. Jetzt führt der Weg
 * dorthin, wo die Sache wirklich zu erledigen ist: Einstellungen, Geräte.
 *
 * ── 2. „AUSSTEHEND" VERSPRACH ETWAS, DAS NIE MEHR KOMMT ───────────────────
 *
 * Das Abzeichen hiess „Ausstehende TSE-Signaturen: N" und zählte die
 * dauerhaft vermerkten Ausfälle MIT (`failedTerminal`). Eine solche Zeile
 * wird nie wieder angefasst: der Nachreicher holt nur `pending` und
 * `in_flight` (`lib/tse-queue-store.ts`, `listDrainable`), und
 * `vermerkeDauerhaftenAusfall` begründet dort ausführlich, warum es für sie
 * keine Heilung gibt. Was nie mehr kommt, steht nicht aus, es fehlt.
 *
 * Deshalb stehen jetzt ZWEI Zahlen da, getrennt gezählt und getrennt
 * benannt: was die Kasse noch von allein holt, und was endgültig fehlt.
 *
 * ── WOHER DIE SÄTZE KOMMEN ────────────────────────────────────────────────
 *
 * Kein Satz wird hier getippt. Beide kommen wortgleich aus der einen Quelle
 * `lib/fiskalzustand-satz.ts`; diese Fläche bringt nur mit, was sie MISST:
 * die drei Zahlen des Korbs und die hinterlegte Einrichtung dieser Kasse.
 * Dass sie nicht wieder selbst zu tippen anfängt, hält ein Wächter fest
 * (`geraetemanager-tippt-den-satz-nicht.test.ts`).
 */
export interface TseRueckstandZeile {
  /** Wie viele Zeilen des Korbs diese eine Bildschirmzeile beschreibt. */
  anzahl: number;
  /** Was neben der Zahl steht. Nie ein Wort, das für beide Gruppen gilt. */
  abzeichen: string;
  ton: HardwareStatusTone;
  /** Der ganze Text, Wort für Wort aus `lib/fiskalzustand-satz.ts`. */
  text: string;
  /** Wohin der Text schickt. Niemals auf einen gesperrten Knopf. */
  ziel: Schrittziel;
  /**
   * Der Zustand, den die Quelle beschreibt. `null` heisst ehrlich: hier enden
   * zwei Zustände gleich, und der Korb kann sie nicht auseinanderhalten.
   */
  zustand: Fiskalzustand | null;
}

export interface TseRueckstand {
  /** Belege, die die Kasse noch selbst nachholt. `null` heisst: keine. */
  wartend: TseRueckstandZeile | null;
  /** Ausfälle, für die dauerhaft entschieden ist. `null` heisst: keine. */
  endgueltig: TseRueckstandZeile | null;
}

/** Die Tonlage der Quelle als Ton dieses Abzeichens. Vollständig, sonst rot. */
const TONLAGE_ALS_ABZEICHEN: Record<Tonlage, HardwareStatusTone> = {
  gut: 'online',
  wartend: 'pending',
  warnend: 'error',
  ernst: 'error',
};

/**
 * Welche Zahl des Korbs zu welcher Gruppe gehört.
 *
 * Die Einteilung wird NICHT hier entschieden: `zustandAusKorbzeile` übersetzt
 * den Status des Korbs in einen Zustand, und `giltAlsWartend` beziehungsweise
 * `giltAlsEndgueltig` sagen, in welche Spalte er zählt. Verschiebt die Quelle
 * eine Möglichkeit, wandert diese Fläche mit, statt eine eigene Meinung zu
 * behalten.
 *
 * `hatSignatur` steht auf `false`, weil der Korb je Zahl gar nicht weiss, ob
 * eine Zeile schon eine Signatur trägt (`getStats` gruppiert nur nach Status,
 * `lib/tse-queue-store.ts`). Für die ZÄHLWEISE ist das gleichgültig: beide
 * Wege einer offenen Zeile warten. Auch das ist geprüft, nicht behauptet.
 */
function zaehleKorb(stats: TseQueueStats): { wartend: number; endgueltig: number } {
  const gruppen: Array<{ status: TseQueueStatus; anzahl: number }> = [
    { status: 'pending', anzahl: stats.pending },
    { status: 'in_flight', anzahl: stats.inFlight },
    { status: 'failed_terminal', anzahl: stats.failedTerminal },
  ];
  let wartend = 0;
  let endgueltig = 0;
  for (const gruppe of gruppen) {
    const zustand = zustandAusKorbzeile(gruppe.status, false);
    if (giltAlsWartend(zustand)) wartend += gruppe.anzahl;
    else if (giltAlsEndgueltig(zustand)) endgueltig += gruppe.anzahl;
  }
  return { wartend, endgueltig };
}

/**
 * Die Zeile für die Belege, die die Kasse noch selbst nachholt.
 *
 * ⚠️ Der Korb meldet Zahlen je Status, nicht ob eine Zeile schon eine
 * Signatur trägt. Diese Fläche kann `wartetAufAbschluss` und
 * `wartetAufMeldung` deshalb NICHT auseinanderhalten — also sagt sie nur, was
 * für beide gilt: den nächsten Schritt, der in beiden Zuständen derselbe ist.
 * Dass er derselbe ist, wird nicht angenommen, sondern im Prüfsatz gemessen;
 * laufen die beiden Zustände je auseinander, wird er rot.
 */
function wartendeZeile(anzahl: number): TseRueckstandZeile {
  const quelle = fiskalzustandSatz('wartetAufAbschluss');
  return {
    anzahl,
    abzeichen: `Wartende Belege: ${anzahl}`,
    ton: TONLAGE_ALS_ABZEICHEN[quelle.tonlage],
    text: quelle.naechsterSchritt.text,
    ziel: quelle.naechsterSchritt.ziel,
    zustand: null,
  };
}

/**
 * Die Zeile für die Ausfälle, die dauerhaft vermerkt sind.
 *
 * Welcher Zustand sie beschreibt, ist an DIESER Kasse gemessen: eine leere
 * Kennung ist genau die Bedingung, aus der `grundOhneSignatur` „keine TSE
 * hinterlegt" ableitet (`lib/ohne-signatur-hinweis.ts:55`). Dann hat nie
 * etwas signiert, der Prüfknopf ist gesperrt, und der nächste Schritt führt
 * nach Einstellungen, Geräte — nicht auf den toten Knopf.
 */
function endgueltigeZeile(anzahl: number, kasse: KassenEinrichtung): TseRueckstandZeile {
  const zustand: Fiskalzustand = kasse.tssIdHinterlegt
    ? 'dauerhaftVermerkt'
    : 'ohneSicherungseinrichtung';
  const quelle = fiskalzustandSatz(zustand);
  return {
    anzahl,
    abzeichen: `Dauerhaft vermerkte Ausfälle: ${anzahl}`,
    ton: TONLAGE_ALS_ABZEICHEN[quelle.tonlage],
    text: `${quelle.satz} ${quelle.naechsterSchritt.text}`,
    ziel: quelle.naechsterSchritt.ziel,
    zustand,
  };
}

/**
 * Der Rückstand der Sicherungseinrichtung, in zwei getrennten Zahlen.
 *
 * `stats === null` heisst „keine örtlichen Aufzeichnungen" (ausserhalb der
 * Kasse lehnt `Db.load` ab, `lib/tse-queue-drain-hook.ts`). Dann bleibt die
 * Fläche leer, statt eine Null zu erfinden.
 */
export function tseRueckstand(stats: TseQueueStats | null, kasse: KassenEinrichtung): TseRueckstand {
  const zahlen = stats ? zaehleKorb(stats) : { wartend: 0, endgueltig: 0 };
  return {
    wartend: zahlen.wartend > 0 ? wartendeZeile(zahlen.wartend) : null,
    endgueltig: zahlen.endgueltig > 0 ? endgueltigeZeile(zahlen.endgueltig, kasse) : null,
  };
}

function TseSection(): JSX.Element {
  // Die Einrichtung muss den SERVER erreichen, nicht nur den Systemtresor —
  // sonst bleibt sein Verkaufsriegel für immer zu (siehe `checkStatus`).
  const api = useApiClient();
  const cfg = useHardwareStore((s) => s.config.tse);
  const setTse = useHardwareStore((s) => s.setTse);
  const addToast = useToastStore((s) => s.addToast);
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tssDraft, setTssDraft] = useState(cfg.tssId);
  const [clientDraft, setClientDraft] = useState(cfg.clientId);
  // Secret drafts are transient: typed once, pushed to the OS keychain, then
  // cleared. They never enter the store or localStorage.
  const [keyDraft, setKeyDraft] = useState('');
  const [secretDraft, setSecretDraft] = useState('');

  // Phase 1.3: der Rückstand aus dem dauerhaften Korb, live. Was er bedeutet
  // und wie er benannt wird, entscheidet `tseRueckstand` weiter oben — dort
  // steht auch, welche zwei Lügen hier standen.
  const tseStats = useTseQueueStats();
  const rueckstand = tseRueckstand(tseStats, {
    tssIdHinterlegt: cfg.tssId.trim().length > 0,
    zugangHinterlegt: cfg.credentialsStored,
  });

  /**
   * Die Kennung lokal speichern UND dem Motor melden.
   *
   * ── DER FUND VOM 02.08.2026, UND ER WAR MEINER ──────────────────────────
   *
   * Der Riegel nach § 146a AO liest den Einstellungsschlüssel `tse.tss_id`.
   * Diese Fläche schrieb die Kennung aber NUR in den lokalen Gerätespeicher
   * des Fensters. Niemand rief `POST /api/tse/einrichten`.
   *
   * Damit war der Riegel, der jeden Verkauf und jeden Ankauf anhält, von der
   * Kasse aus UNAUFHEBBAR: der Händler trug die Kennung ein, die Fläche sagte
   * „gespeichert", und das Bezahlen lehnte weiter ab. Eine Sperre ohne
   * Ausgang, und zwar die teuerste von allen.
   *
   * ⚠️ Das Melden darf NICHT stillschweigend scheitern. Ein Fehler hier heisst:
   * die Kasse verkauft weiterhin nicht, und der Mensch weiss nicht warum.
   */
  const setTseUndMotorMelden = useCallback(
    async (patch: Partial<TseFiskalyConfig>): Promise<void> => {
      setTse(patch);
      const tssId = (patch.tssId ?? cfg.tssId).trim();
      const clientId = (patch.clientId ?? cfg.clientId).trim();
      if (tssId === '') return;
      try {
        await api.request('POST', '/api/tse/einrichten', { tssId, clientId });
        addToast({
          tone: 'success',
          title: 'Sicherungseinrichtung eingetragen',
          body: 'Verkauf und Ankauf sind ab jetzt möglich.',
        });
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Der Motor kennt die Sicherungseinrichtung noch nicht',
          body:
            err instanceof ApiError
              ? describeError(err)
              : 'Die Kennung ist auf diesem Gerät gespeichert, aber nicht beim Motor ' +
                'eingetragen. Verkauf und Ankauf bleiben gesperrt. Bitte erneut speichern.',
        });
      }
    },
    [setTse, api, addToast, cfg.tssId, cfg.clientId],
  );

  const save = useCallback((patch: Partial<TseFiskalyConfig>) => setTse(patch), [setTse]);

  useEffect(() => {
    setTssDraft(cfg.tssId);
    setClientDraft(cfg.clientId);
  }, [cfg.tssId, cfg.clientId]);

  // Reconcile the "stored?" hint with the real OS keychain on mount.
  useEffect(() => {
    let alive = true;
    void tseClient
      .credentialsPresent()
      .then((present) => {
        if (alive) save({ credentialsStored: present });
      })
      .catch(() => {
        /* keychain unavailable (browser mode) — leave the hint untouched */
      });
    return () => {
      alive = false;
    };
  }, [save]);

  const storeCredentials = useCallback(async () => {
    const key = keyDraft.trim();
    const secret = secretDraft.trim();
    if (!key || !secret) {
      addToast({
        tone: 'alert',
        title: 'TSE-Zugangsdaten unvollständig',
        body: 'API-Key und API-Secret sind beide erforderlich.',
      });
      return;
    }
    try {
      await tseClient.storeCredentials(key, secret);
      save({ credentialsStored: true });
      setKeyDraft('');
      setSecretDraft('');
      setEditingKey(false);
      addToast({
        tone: 'success',
        title: 'TSE-Schlüssel gespeichert',
        body: 'Sicher im OS-Schlüsselbund hinterlegt, nicht im Browserspeicher.',
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    }
  }, [addToast, keyDraft, secretDraft, save]);

  const clearCredentials = useCallback(async () => {
    try {
      await tseClient.clearCredentials();
      save({ credentialsStored: false });
      addToast({
        tone: 'success',
        title: 'TSE-Schlüssel gelöscht',
        body: 'Aus dem OS-Schlüsselbund entfernt.',
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Löschen fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    }
  }, [addToast, save]);

  const checkStatus = useCallback(async () => {
    setBusy(true);
    try {
      // Secrets are hydrated inside Rust from the keychain — not sent here.
      const s = await tseClient.status({ tssId: cfg.tssId, clientId: cfg.clientId });
      save({
        lastReachable: s.reachable,
        lastCheckedAt: s.lastCheckedAt,
        ...(s.reachable ? { lastSyncAt: s.lastCheckedAt } : {}),
      });

      // ⚠️ 02.08.2026, DIE FEHLENDE HÄLFTE.
      //
      // Bis heute endete die Einrichtung genau hier: Schlüssel im Systemtresor,
      // Kennungen im örtlichen Speicher dieses Fensters. Der SERVER erfuhr nie
      // davon. Sein Verkaufsriegel prüft aber, ob eine TSE eingerichtet ist —
      // und konnte deshalb nie zufrieden sein.
      //
      // Am Tresen war das ein Kreis ohne Ausgang: die Fläche meldete „TSE
      // erreichbar", das Bezahlen sagte „keine Sicherungseinrichtung
      // eingerichtet", und beides stimmte aus seiner Sicht.
      //
      // Eingetragen wird NUR nach einer erreichbaren Antwort. Eine Kennung, die
      // nie geantwortet hat, ist kein Nachweis, sondern ein Tippfehler.
      let eingetragen = false;
      if (s.reachable) {
        try {
          await api.request('POST', '/api/tse/einrichten', {
            tssId: cfg.tssId.trim(),
            clientId: cfg.clientId.trim(),
            bezeichnung: 'fiskaly TSE, online',
          });
          eingetragen = true;
        } catch (err) {
          // Kein stiller Fehlschlag: ohne diese Eintragung bleibt der Verkauf
          // gesperrt, und der Mensch muss erfahren WARUM.
          addToast({
            tone: 'alert',
            title: 'TSE erreichbar, aber nicht eingetragen',
            body:
              'Die Sicherungseinrichtung antwortet, konnte aber nicht in der Kasse hinterlegt ' +
              'werden. Bis das gelingt, bleibt der Verkauf gesperrt. ' +
              diagnoseAlsZeile(err),
          });
        }
      }

      addToast({
        tone: s.reachable ? 'success' : 'alert',
        title: s.reachable ? 'TSE erreichbar' : 'TSE nicht erreichbar',
        body: eingetragen
          ? `${s.message} Die Kasse ist damit fiskalisch scharf; Verkäufe sind möglich.`
          : s.message,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'TSE-Statusabfrage fehlgeschlagen',
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, api, cfg.tssId, cfg.clientId, save]);

  return (
    <Card title="TSE (Technische Sicherheitseinrichtung)">
      <Row>
        <LabelledInput
          label="Fiskaly TSS-ID"
          value={tssDraft}
          onChange={setTssDraft}
          onBlur={() => void setTseUndMotorMelden({ tssId: tssDraft.trim() })}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Row>
      <Row>
        <LabelledInput
          label="Client-ID"
          value={clientDraft}
          onChange={setClientDraft}
          onBlur={() => save({ clientId: clientDraft.trim() })}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Row>
      <Row>
        <span
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          API-Key
        </span>
        {editingKey ? (
          <>
            <Input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="API-Key"
              type="password"
              autoComplete="off"
              style={{ width: 220 }}
            />
            <Input
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              placeholder="API-Secret"
              type="password"
              autoComplete="off"
              style={{ width: 220 }}
            />
            <Button variant="primary" onClick={() => void storeCredentials()}>
              Speichern
            </Button>
          </>
        ) : (
          <>
            <span
              style={{ flex: 1, fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink-faded)' }}
            >
              {cfg.credentialsStored ? '•••••••••••• (im Schlüsselbund)' : 'nicht gesetzt'}
            </span>
            <Button variant="ghost" onClick={() => setEditingKey(true)}>
              {cfg.credentialsStored ? 'Ändern' : 'Hinterlegen'}
            </Button>
            {cfg.credentialsStored ? (
              <Button variant="ghost" onClick={() => void clearCredentials()}>
                Löschen
              </Button>
            ) : null}
          </>
        )}
      </Row>
      <Row>
        <Button
          variant="ghost"
          onClick={() => void checkStatus()}
          disabled={busy || !cfg.tssId || !cfg.credentialsStored}
        >
          {busy ? 'Prüft…' : 'TSE-Verbindung prüfen'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'error'}
          label={
            /*
             * `null` heisst „noch nie geprueft", NICHT „nicht eingerichtet".
             * Ein Laden mit eingetragener TSS-Kennung und hinterlegtem
             * Schluessel las bisher „Nicht konfiguriert", bis jemand einmal
             * auf „TSE-Verbindung pruefen" tippte — und glaubte, ihm fehle
             * eine Einrichtung, die längst stand.
             */
            cfg.lastReachable === null
              ? cfg.tssId.trim() && cfg.credentialsStored
                ? 'Noch nicht geprüft'
                : 'Nicht eingerichtet'
              : cfg.lastReachable
                ? 'TSE aktiv'
                : 'TSE inaktiv'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
      {rueckstand.wartend && (
        <Row>
          <span style={{ flex: 1, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-faded)' }}>
            {rueckstand.wartend.text}
          </span>
          <HardwareStatusBadge
            tone={rueckstand.wartend.ton}
            label={rueckstand.wartend.abzeichen}
          />
        </Row>
      )}
      {rueckstand.endgueltig && (
        <Row>
          <span style={{ flex: 1, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-faded)' }}>
            {rueckstand.endgueltig.text}
          </span>
          <HardwareStatusBadge
            tone={rueckstand.endgueltig.ton}
            label={rueckstand.endgueltig.abzeichen}
          />
        </Row>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Building blocks — kept local; the Hardware tab is a one-off layout.
// ════════════════════════════════════════════════════════════════════════

function Card({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-10)' }}>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-grund)',
        }}
      >
        {title}
      </h2>
      <Zwischentitel />
      {children}
    </ParchmentCard>
  );
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  placeholder?: string;
  width?: number;
}): JSX.Element {
  const id = `cfg-${label}`.replace(/\s+/g, '-').toLowerCase();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w14-abstand-6)' }}>
      <label
        htmlFor={id}
        className="w14-smallcaps"
        style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
      >
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{ width: width ?? 220 }}
      />
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function buildTestReceipt(): ThermalReceiptData {
  const now = new Date();
  const printedAt = now.toLocaleString('de-DE');
  return {
    // ── KEINE ERFUNDENE ANSCHRIFT, KEINE ERFUNDENE STEUERNUMMER ───────────
    // Hier standen „Musterstraße 1 / 10115 Berlin" und `DE000000000` — auf
    // ECHTEM Bonpapier. `shop-info.ts` erklärt eine Platzhalter-USt-IdNr. auf
    // einem Kassenbon ausdrücklich zum GoBD-Verstoss, und ein Zettel, der aus
    // dem Drucker kommt, weiss nicht, dass er nur ein Test war.
    //
    // Der Testdruck prüft den DRUCKER, nicht den Beleg. Er trägt deshalb gar
    // keine Anschrift und keine Steuernummer, sondern sagt, was er ist.
    shopName: 'DRUCKERPRÜFUNG',
    shopAddress: ['Kein Beleg, nur ein Testdruck'],
    shopVatId: '',
    shopTaxNumber: '',
    shopPhone: null,
    receiptLocator: 'TEST-0001',
    printedAt,
    cashierName: 'Test',
    shiftId: null,
    items: [
      {
        name: 'Test-Position',
        quantity: 1,
        unitPriceEur: '1.00',
        lineTotalEur: '1.00',
        vatLabel: '19%',
      },
    ],
    subtotalEur: '0.84',
    vatEur: '0.16',
    totalEur: '1.00',
    paymentMethodLabel: 'Bar',
    cashReceivedEur: '1.00',
    changeEur: '0.00',
    tseSignatureValue: 'TEST-SIG',
    tseSignatureCounter: '0',
    tseTransactionNumber: '0',
    tseQrPayload: 'TEST',
    footerLines: ['Vielen Dank für Ihren Besuch.', 'Dies ist ein Testbeleg, keine Buchung.'],
  };
}

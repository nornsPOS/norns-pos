/**
 * App shell — Day 5.
 *
 * Boots in three deliberate phases (memory.md #76):
 *
 *   1. unknown          → run `useSessionProbe` once
 *                         GET /api/auth/session decides: authenticated or not.
 *                         While the probe is in-flight, we render a minimal
 *                         brand-themed splash (Seal on parchment).
 *   2. unauthenticated  → <PinLogin />
 *   3. authenticated    → <AppRouter /> (Karteikasten + every surface)
 *
 * A top-level <ErrorBoundary/> wraps the whole tree as the last-resort
 * fallback. The per-route boundary inside AppShell is the first line.
 */

import { useEffect } from 'react';

import { Button, Zwischentitel, NornsZeichen, ParchmentCard } from '@norns/ui-kit';
import { ErrorBoundary } from '@norns/ui-kit';

import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
import { useHardwareAutoConnect } from '../hooks/useHardwareAutoConnect.js';
import { useSessionProbe } from '../hooks/useSessionProbe.js';
import { useOfflineReplay } from '../lib/offline-replay.js';
import { useTseQueueDrain } from '../lib/tse-queue-drain-hook.js';
import { PinLogin } from '../screens/PinLogin.js';
import { EinrichtungsTor } from '../screens/einrichtung/EinrichtungsTor.js';
import { useHardwareStore } from '../state/hardware-store.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useToastStore } from '../state/toast-store.js';
import { setzeWortmarke } from '../lib/etikett-layout.js';
import { useShopInfo } from '../hooks/useShopInfo.js';
import { Splash } from './chrome/Splash.js';
import { tier1Vorladen } from './chrome/surface-registry.js';
import { AppRouter } from './router.js';

export function App(): JSX.Element {
  // Fire the cold-start probe; mutates the session-store status.
  useSessionProbe();

  // ── DIE WORTMARKE AUF DEM ETIKETT GEHÖRT DEM HÄNDLER ─────────────────────
  //
  // Sie stand bis heute fest im Programm („WAREHOUSE 14"), und damit trug
  // JEDES gedruckte Etikett den Namen einer fremden Firma in die Hand des
  // Kunden. Hier wird sie EINMAL zentral gesetzt, aus der Ladenidentität, die
  // der Server liefert. An einer zweiten Stelle zu setzen hiesse: zwei
  // Wahrheiten, und die zweite gewinnt irgendwann.
  //
  // Ohne Identität bleibt sie leer. Eine leere Zeile auf dem ersten Etikett
  // fällt auf; ein fremder Name vielleicht nie.
  const { data: ladenIdentitaet } = useShopInfo();
  useEffect(() => {
    setzeWortmarke(ladenIdentitaet?.name ?? '');
  }, [ladenIdentitaet?.name]);

  // Tier-1-Flaechen SOFORT nach der ersten Zeichnung nachladen (19.08.2026):
  // sie sind eigene Teile (der Hauptteil mass davor 1.073 kB), aber am Tresen
  // muessen sie da sein, BEVOR der Finger den Reiter trifft. Einmal, sofort.
  useEffect(() => {
    tier1Vorladen();
  }, []);

  const status = useSessionStore((s) => s.status);
  const posEntsperrt = useSessionStore((s) => s.posEntsperrt);
  const clearLedger = useLedgerFeed((s) => s.clear);
  const clearToasts = useToastStore((s) => s.clear);

  // Phase 3 (ADR-0044): drain the offline outbox once authenticated. The hook
  // attaches connectivity listeners + runs a startup sweep; the DB connection
  // lazy-loads on first drain, never blocking React mount.
  useOfflineReplay(status === 'authenticated');

  // Phase 1.3 (durable fiscal recovery): drain the TSE signature replay queue on
  // its OWN independent controller — a finish-failed or record-failed KassenSichV
  // signature is re-finished / re-posted here so it is never lost. Kept separate
  // from useOfflineReplay so neither drain's single-flight flag starves the other.
  useTseQueueDrain(status === 'authenticated');

  // Hardware auto-connect: once the operator is in, hydrate the saved endpoints
  // and silently probe every configured device (receipt + label printer, card
  // terminal). Reachable devices light their badge green WITHOUT anyone opening
  // Settings — the one-tap/automatic connect the hardware mandate asks for.
  const hydrateHardware = useHardwareStore((s) => s.hydrateFromLocal);
  useEffect(() => {
    if (status === 'authenticated') hydrateHardware();
  }, [status, hydrateHardware]);
  useHardwareAutoConnect(status === 'authenticated');

  // Global HID-wedge scanner liveness: a passive, app-wide listener that records
  // "a scan just decoded" so the Gerätemanager can show the scanner as connected
  // from any screen. It never swallows Enter or routes the code — the focused
  // surface (Verkauf/Lager) keeps its own routing handler.
  useBarcodeScanner({
    enabled: status === 'authenticated',
    passive: true,
    onScan: () => {
      /* liveness only — recorded inside the hook via the scanner store */
    },
  });

  // Defence-in-depth: any departure from 'authenticated' tears down the
  // in-memory caches that should never outlive a session.
  useEffect(() => {
    if (status !== 'authenticated') {
      clearLedger();
      clearToasts();
    }
  }, [status, clearLedger, clearToasts]);

  const retryProbe = useSessionStore((s) => s.retryProbe);

  // Google-first sign-in (Track A1); PIN stays available as a fallback for the
  // admin who cannot use the org-restricted Google account.

  // ── GOOGLE IST DIE EINZIGE IDENTITAET (Basel, 26.07.2026) ────────────────
  // Die vierstellige Kassen-PIN wurde am 21.07. abgeschafft; trotzdem bot die
  // Anmeldeflaeche weiter „Mit PIN anmelden" an — ein sichtbarer Weg zu einem
  // Verfahren, das es nicht mehr geben soll. Basel woertlich sinngemaess:
  // „Wir melden uns NUR mit Google an. Warum steht da noch die PIN?"
  //
  // Der Weg bleibt AUSSCHLIESSLICH im Entwicklungslauf bestehen, weil die
  // oertliche Prueferei ohne Google-Rueckruf sonst nicht anmelden kann
  // (Vorrichtung aus der Entwicklungs-Saat). Ein Produktionsbau zeigt ihn
  // nicht und kann ihn nicht erreichen — der Server verlangte ohnehin ein
  // gepaartes Geraet.
  // ── NORNS POS: DIE ZIFFERNTÜR IST DER EINZIGE WEG ────────────────────────
  //
  // Hier stand `import.meta.env.DEV`, in Warehouse14 zu Recht: dort ist die
  // Kasse online, und Basel hat die Anmeldung auf Google umgestellt, weil es
  // eine voreingestellte 0000 gab. Die Sperre war die VORGABE, nicht die
  // Ziffernfolge.
  //
  // Norns POS arbeitet ohne Netz. Google braucht das Internet, egal auf
  // welchen Rechner die Maske zeigt — ein Kassierer, der sich morgens ohne
  // Leitung nicht anmelden kann, hat keine Kasse. Also gilt hier die
  // Zifferntür, und zwar als EINZIGER Weg: keine zweite Tür, hinter der
  // niemand steht.
  //
  // Ohne Vorgabe. Der Händler setzt die sechs Stellen beim ersten Start
  // selbst; bis dahin antwortet der Motor mit PIN_NOT_SET, und die Maske
  // führt zur Einrichtung statt „falscher Code" zu sagen.

  let body: JSX.Element;
  if (status === 'unknown') {
    body = <Splash />;
  } else if (status === 'authenticated' && posEntsperrt) {
    /**
     * ── DER EINRICHTUNGSASSISTENT, UND WARUM ER HIER STEHT ───────────────
     *
     * Basels Auftrag vom 09.08.2026: der Händler öffnet zum ersten Mal und
     * wird Schritt für Schritt nach allem gefragt, was die Kasse über ihn
     * wissen muss.
     *
     * ⚠️ HINTER dem Code, nicht davor: die Angaben gehen per
     * `PATCH /api/settings/:key` an den Motor, und der verlangt eine
     * angemeldete Sitzung. Vor der Anmeldung könnte der Assistent nichts
     * speichern und wäre ein Formular ins Leere.
     *
     * Ob er erscheint, entscheidet `EinrichtungsTor` an den DATEN, nicht an
     * einem örtlichen Merkzeichen. Und er lässt sich verlassen: die
     * fiskalischen Riegel hängen an den Werten, nicht an diesem Fenster.
     */
    body = (
      <EinrichtungsTor>
        <AppRouter />
      </EinrichtungsTor>
    );
  } else if (status === 'authenticated') {
    /**
     * ⚠️ EINE MASKE, UND SIE KOMMT AUCH BEIM KALTSTART.
     *
     * Hier stand ein ZWEITES Ziffernschloss (`LocalLockGate`, Gerätecode,
     * PBKDF2 im Fensterspeicher). Damit gab es zwei Codes mit zwei
     * Geheimnissen und jeden Morgen zwei Masken. Basels Anordnung vom
     * 05.08.2026: „ein Code, einmal, fertig."
     *
     * Der Gerätecode ist weg, die EINGABE nicht: der Sitzungsschlüssel
     * überlebt einen Kaltstart, und ohne diesen Zweig öffnete sich die
     * Kasse nach einem Neustart ganz ohne Code, solange die Sitzung noch
     * gilt. Ein Tresen mit Gold in der Lade darf nicht offen sein, nur
     * weil gestern jemand angemeldet war.
     *
     * Der Kassencode ist der richtige: er benennt den MENSCHEN, der nach
     * § 146a AO auf jedem Beleg steht. Der Gerätecode benannte niemanden.
     */
    body = <PinLogin />;
  } else if (status === 'unreachable') {
    body = <ServerUnreachable onRetry={retryProbe} />;
  } else {
    body =
      // KEIN Umweg zu Google: die Tür führte in einer Kasse ohne Netz ins
      // Leere, und eine sichtbare Tür, hinter der niemand steht, kostet den
      // Kassierer morgens zehn Minuten Ratlosigkeit.
      <PinLogin />;
  }

  return (
    <ErrorBoundary>
      {body}
    </ErrorBoundary>
  );
}

/**
 * ServerUnreachable — shown when the cold-start probe could not reach the
 * server (network / circuit-open). Distinct from the PIN pad: it tells the
 * operator the truth ("Keine Verbindung zum Server") instead of implying the
 * session ended, and offers a single retry that re-runs the probe.
 */
function ServerUnreachable({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--w14-parchment)',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        {/* Die Fehlerfläche, auf der Basel das N im Kreis zuerst sah. Hier
            gehört das echte Zeichen hin: es ist oft das Erste und manchmal
            das Einzige, was ein Händler an einem schlechten Morgen sieht. */}
        <NornsZeichen faden="var(--w14-weinrot, #9c2630)"
          size={72}
          tinte="var(--w14-ink)"
          titel="Norns"
          style={{ display: 'block', margin: '0 auto' }}
        />
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
            margin: '16px 0 4px',
          }}
        >
          Keine Verbindung zum Server
        </h1>
        <p
          style={{
            margin: '0 0 18px',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            lineHeight: 1.5,
          }}
        >
          {/* ⚠️ 30.07.2026. Hier stand „Bitte prüfen Sie die Internetverbindung".
              In Norns POS ist der Server ein Kindprozess auf DIESEM Gerät. Der
              Satz schickte den Händler zum Router, zum Netzanbieter und ins
              Leere, während der Fehler zwei Zentimeter weiter lag. */}
          Der Server dieser Kasse läuft auf diesem Gerät und antwortet gerade nicht. Eine
          Internetverbindung wird dafür nicht gebraucht. Hilft „Erneut versuchen" nicht,
          schliessen Sie die Kasse und starten Sie sie neu.
        </p>
        <Button variant="primary" size="md" onClick={onRetry}>
          Erneut versuchen
        </Button>
        <Zwischentitel />
      </ParchmentCard>
    </div>
  );
}

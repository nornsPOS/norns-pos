/**
 * useBarcodeScanner — global keyboard listener that detects USB-HID
 * barcode scanner input via timing heuristic.
 *
 * USB barcode scanners enumerate as HID keyboards and "type" the scanned
 * code rapidly, ending with Enter (or Tab, depending on configuration).
 * They typically emit one character per ~16 ms — humans typing land
 * around 100–300 ms per keystroke. The 50 ms inter-keypress threshold
 * cleanly separates the two without misfiring on power-typists.
 *
 * Hook semantics:
 *   • Attaches a `keydown` listener to `document` while mounted.
 *   • Maintains a rolling buffer of recent characters + their first/last
 *     timestamps.
 *   • Buffer resets when the inter-keypress gap exceeds 50 ms.
 *   • On `Enter`, evaluates the buffer. Scan = buffer length between 6 and 64
 *     AND total elapsed time within a budget that GROWS WITH THE LENGTH
 *     AND every character is printable ASCII.
 *   • Valid scan: `event.preventDefault()` to swallow the trailing Enter
 *     (so it doesn't submit any focused form), then `onScan(buffer)`.
 *   • Invalid: buffer reset, keystrokes flow through to focused inputs
 *     as normal.
 *
 * Coexistence with focused inputs is automatic: typing-speed keystrokes
 * never accumulate fast enough to qualify as a scan, so the focused
 * input field receives them normally.
 *
 * The `enabled` flag lets a parent surface toggle the listener (e.g.
 * disable while a modal that needs Enter-to-submit is open).
 */

import { useEffect, useRef } from 'react';

import { useScannerStore } from '../state/scanner-store.js';

/*
 * FUND (2026-07-26): der Scanner las lange Etiketten nicht.
 *
 * Die Gesamtdauer eines Scans war fest auf 200 ms gedeckelt, unabhängig von
 * der Länge des Codes. Eine EAN-13 hat 13 Zeichen, also ZWÖLF Zwischenräume;
 * bei den oft zitierten 16 ms je Zeichen sind das 192 ms — die Grenze lag
 * damit acht Millisekunden über dem Bedarf, verteilt auf zwölf Abstände.
 * Ein Handscanner, der etwas gemächlicher tippt (ab 17 ms je Zeichen, bei
 * Funk- und Bluetooth-Geräten sind 20 bis 30 ms völlig normal), überschritt
 * die Grenze und wurde lautlos verworfen. Eine 22-stellige Artikelnummer fiel
 * IMMER durch: schon bei 10 ms je Zeichen braucht sie 210 ms.
 *
 * Am Tresen sah das so aus: Basel zieht den Scanner über das Etikett, es
 * passiert nichts, er zieht nochmal, beim dritten Mal geht es. Das war kein
 * Wackelkontakt, sondern diese Zeile. Weil die Grenze genau AUF der Schwelle
 * lag, entschied die Tagesform des Geräts über Erfolg und Misserfolg — daher
 * „mal geht es, mal nicht".
 *
 * Die Korrektur koppelt das Zeitbudget an die Länge. Die Trennung zwischen
 * Mensch und Maschine leistet ohnehin die Abstandsregel unten, nicht die
 * Gesamtdauer.
 */

const MIN_BUFFER_LEN = 6;

/**
 * Abstand zwischen zwei Anschlägen. DIES ist die eigentliche Trennlinie:
 * ein Scanner liefert 10 bis 30 ms, ein Mensch 100 bis 300 ms. Selbst ein
 * sehr schneller Tipper bleibt im Dauerlauf über 60 ms. Unverändert.
 */
const MAX_GAP_MS = 50;

/**
 * Anlaufzuschlag für den ersten Anschlag: USB-HID wird in Abständen von bis
 * zu 8 ms abgefragt, und der erste Bericht eines Geräts kommt oft verspätet.
 */
const SCAN_START_JITTER_MS = 60;

/**
 * Zeitbudget je weiterem Zeichen. Typische Geräte liefern 10 bis 20 ms,
 * langsame Funkgeräte bis 30 ms. 35 ms lässt auch dem trägsten echten Gerät
 * Luft und bleibt zugleich deutlich unter der Abstandsgrenze von 50 ms — der
 * DURCHSCHNITT über den ganzen Lauf muss also unter 35 ms bleiben. Damit
 * greift die Gesamtgrenze noch immer: ein sehr schneller Mensch, der eine
 * eingeübte Ziffernfolge knapp unter 50 ms je Anschlag herunterhämmert,
 * wird weiterhin abgelehnt, obwohl jeder einzelne Abstand durchginge.
 */
const SCAN_PER_CHAR_BUDGET_MS = 35;

/**
 * Obergrenze der Pufferlänge. Die längste Symbologie, die an einem Ladentisch
 * wirklich vorkommt, ist Code 128 beziehungsweise GS1-128 mit in der Praxis
 * rund 48 Zeichen je Etikett; EAN-13 hat 13, unsere eigenen Artikelnummern
 * deutlich weniger. 64 lässt darüber ein Drittel Luft. Was länger ist, ist
 * kein Etikett, sondern eine klemmende Taste, ein maschinell eingefügter
 * Text oder ein zweidimensionaler Code, zu dem die Kasse ohnehin keine Ware
 * kennt. Ein solcher Lauf wird verworfen statt gekürzt: ein gekürzter Code
 * könnte den FALSCHEN Artikel treffen, und das ist am Tresen schlimmer als
 * ein Scan, der sichtbar nicht reagiert.
 */
const MAX_BUFFER_LEN = 64;

const PRINTABLE_ASCII = /^[\x20-\x7e]$/;

/**
 * Erlaubte Gesamtdauer für einen Puffer dieser Länge. Bei n Zeichen liegen
 * n-1 Abstände dazwischen — der klassische Zaunpfahlfehler, der die alte
 * feste Grenze so knapp erscheinen liess.
 *
 * Beispiele: EAN-13 (13 Zeichen) → 480 ms erlaubt, bei 16 ms je Zeichen
 * gebraucht: 192 ms. 22-stellige Artikelnummer → 795 ms erlaubt, bei 20 ms
 * je Zeichen gebraucht: 420 ms.
 */
export function maxTotalMsForLength(len: number): number {
  return SCAN_START_JITTER_MS + Math.max(0, len - 1) * SCAN_PER_CHAR_BUDGET_MS;
}

/** Ein Tastenanschlag mit seinem Zeitpunkt — die Uhr kommt von aussen. */
export interface ScanKeyEvent {
  key: string;
  /** Zeitstempel in Millisekunden. Im Betrieb `performance.now()`. */
  at: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export type ScanVerdict =
  /** Enter kam, und der Puffer ist ein echter Scan. */
  | { kind: 'scan'; code: string }
  /** Enter kam, aber der Puffer war kein Scan — Taste durchreichen. */
  | { kind: 'reject' }
  /** Noch kein Abschluss, es wird weiter gesammelt. */
  | { kind: 'pending' };

export interface ScanDetector {
  feed: (ev: ScanKeyEvent) => ScanVerdict;
  reset: () => void;
}

/**
 * Die reine Entscheidungslogik, ohne DOM und ohne React — damit sie mit
 * echten Längen und echten Zeitabständen geprüft werden kann. Der Haken
 * unten reicht ihr nur `performance.now()` herein.
 */
export function createScanDetector(): ScanDetector {
  let buffer = '';
  let firstAt = 0;
  let lastAt = 0;
  // Eigenes Startkennzeichen statt „lastAt === 0" als Ersatzwert: sonst wäre
  // der Zeitpunkt 0 nicht von „noch nichts gesammelt" zu unterscheiden.
  let started = false;
  /*
   * FUND beim Prüfen der Obergrenze: den Puffer beim Überlauf einfach zu
   * leeren reicht NICHT. Ein Lauf von 400 Zeichen in Maschinentempo wurde
   * dadurch alle 65 Zeichen neu begonnen, und der Rest am Ende — hier zehn
   * Zeichen — meldete sich als gültiger Scan. Genau der abgeschnittene Code,
   * der am Tresen den FALSCHEN Artikel auf den Bon holt.
   *
   * Deshalb wird ein übergelaufener Lauf vergiftet: es wird weiter mitgezählt,
   * aber nichts mehr gesammelt. Die Sperre fällt erst, wenn ein echter
   * Abstand auftritt, also ein Mensch absetzt und neu ansetzt.
   */
  let poisoned = false;

  const reset = (): void => {
    buffer = '';
    firstAt = 0;
    lastAt = 0;
    started = false;
    poisoned = false;
  };

  const feed = (ev: ScanKeyEvent): ScanVerdict => {
    if (ev.key === 'Enter') {
      const code = buffer;
      const total = lastAt - firstAt;
      const qualifies =
        code.length >= MIN_BUFFER_LEN &&
        code.length <= MAX_BUFFER_LEN &&
        total <= maxTotalMsForLength(code.length) &&
        // Jedes Zeichen wurde beim Sammeln schon geprüft; dies ist nur die
        // Vorsichtsprüfung gegen feindliche Eingabemethoden.
        /^[\x20-\x7e]+$/.test(code);
      reset();
      return qualifies ? { kind: 'scan', code } : { kind: 'reject' };
    }

    // Nur einzelne druckbare Zeichen füllen den Puffer. Sondertasten
    // (ArrowLeft, F1, Shift, Meta, …) brechen ihn ab, denn sie bedeuten,
    // dass ein Mensch eingegriffen hat.
    if (ev.key.length !== 1 || !PRINTABLE_ASCII.test(ev.key)) {
      reset();
      return { kind: 'pending' };
    }

    // Anschläge mit Zusatztaste (Strg+V, Cmd+T) sind nie Scannereingabe.
    if (ev.ctrlKey === true || ev.metaKey === true || ev.altKey === true) {
      reset();
      return { kind: 'pending' };
    }

    const gap = started ? ev.at - lastAt : 0;
    if (!started || gap > MAX_GAP_MS) {
      // Mit DIESEM Anschlag als Zeichen 1 neu beginnen. Ein echter Abstand
      // hebt zugleich die Sperre eines übergelaufenen Laufs auf.
      buffer = ev.key;
      firstAt = ev.at;
      lastAt = ev.at;
      started = true;
      poisoned = false;
      return { kind: 'pending' };
    }

    // Gesperrter Lauf: Takt weiter mitführen, damit der nächste echte Abstand
    // erkannt wird, aber kein Zeichen mehr annehmen.
    if (poisoned) {
      lastAt = ev.at;
      return { kind: 'pending' };
    }

    buffer += ev.key;
    lastAt = ev.at;
    if (buffer.length > MAX_BUFFER_LEN) {
      buffer = '';
      poisoned = true;
    }
    return { kind: 'pending' };
  };

  return { feed, reset };
}

export interface UseBarcodeScannerOptions {
  enabled?: boolean;
  onScan: (code: string) => void;
  /**
   * Passive mode: record scanner liveness (for the Gerätemanager "Scanner
   * bereit" badge) but do NOT swallow the trailing Enter or route the code.
   * Used by the always-on app-wide liveness listener so it never competes with
   * the per-screen routing handler (Verkauf/Lager) for the same keystrokes.
   */
  passive?: boolean;
}

export function useBarcodeScanner({
  enabled = true,
  onScan,
  passive = false,
}: UseBarcodeScannerOptions): void {
  // Stash latest callback so the listener doesn't reattach when onScan changes.
  const onScanRef = useRef<UseBarcodeScannerOptions['onScan']>(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const detector = createScanDetector();

    const onKey = (ev: KeyboardEvent): void => {
      // Ignore modifier-only keystrokes and IME composition.
      if (ev.isComposing) return;

      const verdict = detector.feed({
        key: ev.key,
        at: performance.now(),
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        altKey: ev.altKey,
      });

      if (verdict.kind !== 'scan') return;

      // Record liveness so the Gerätemanager can show "Scanner bereit" —
      // a successful HID decode is the only honest readiness signal for a
      // keyboard-class device (it has no IP to probe). Both the passive
      // app-wide listener and the routing listeners ping it; the store
      // de-dupes by overwriting the same timestamp.
      useScannerStore.getState().markScan(verdict.code);
      // Passive (liveness-only) instances never swallow Enter or route —
      // the per-screen routing handler owns that for the focused surface.
      if (!passive) {
        // Swallow the Enter so it doesn't submit any focused form.
        ev.preventDefault();
        ev.stopPropagation();
        onScanRef.current(verdict.code);
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      detector.reset();
    };
  }, [enabled, passive]);
}

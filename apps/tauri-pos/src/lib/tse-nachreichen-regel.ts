/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE FISKALE AUFZEICHNUNG WIRD NICHT AUFGEGEBEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * Der Nachreiche-Weg der TSE-Warteschlange gab endgültig auf. Gemessen:
 *
 *     MAX_ATTEMPTS = 8                (tse-queue-store.ts:50)
 *     Takt fest 5 Sekunden            (tse-queue-drain-hook.ts:129)
 *     danach `markFailedTerminal`     (tse-queue-drain.ts:112)
 *
 * Acht Versuche im Fünf-Sekunden-Takt sind rund 35 Sekunden. Danach stand die
 * Zeile auf `failed_terminal` und wurde von `listDrainable` **nie wieder
 * ausgewählt** — auch ein Neustart der Kasse änderte daran nichts. Der Beleg
 * lag zehn Jahre in der Warteschlange und bekam nie eine Signatur.
 *
 * Eine Wolken-TSE ist regelmässig länger als 35 Sekunden weg. Ein Netz, das
 * eine Minute hakt, kostete damit eine Signatur für immer, und § 146a AO
 * kennt dafür keine Ausnahme.
 *
 * ⚠️ Der Bauplan versprach den richtigen Weg sogar schon:
 *
 *     0003_tse_queue.sql:39
 *     last_attempt_at INTEGER, -- ms epoch; stale-in_flight re-selection + backoff
 *
 * Die Verzögerungsstaffel existierte nie. `last_attempt_at` wurde nur für die
 * hängengebliebene Zeile gelesen, nie für eine wartende.
 *
 * ── DIE ZWEI FRAGEN, DIE HIER GETRENNT WERDEN ────────────────────────────
 *
 * 1. WANN darf der nächste Versuch laufen? Nicht alle fünf Sekunden bis in
 *    alle Ewigkeit: eine tote Gegenstelle würde im Sekundentakt angeklopft.
 *    Eine wachsende Wartezeit mit Deckel, und dann für IMMER weiter.
 *
 * 2. Gibt es überhaupt einen Fall, in dem Aufgeben richtig ist? Ja, genau
 *    einen: wenn die Gegenstelle den Rumpf DAUERHAFT ablehnt. Ein falsch
 *    gebauter Rumpf wird beim tausendsten Versuch genauso abgelehnt, und ihn
 *    ewig zu wiederholen versteckt den Fehler hinter Rauschen.
 *
 *    Alles andere — kein Netz, Zeitüberschreitung, 5xx, „zu viele Anfragen" —
 *    ist vorübergehend und wird ewig wiederholt.
 */

/** Der erste Wiederholabstand. Kurz, damit ein Netzhüpfer nichts kostet. */
export const ERSTE_WARTEZEIT_MS = 5_000;

/**
 * Der Deckel. Eine Wolken-TSE, die Stunden weg ist, wird viertelstündlich
 * angeklopft: oft genug, dass der Händler es am selben Tag zurückbekommt, und
 * selten genug, dass es niemanden stört.
 */
export const MAX_WARTEZEIT_MS = 15 * 60_000;

/**
 * Wie lange nach dem letzten Versuch darf die Zeile frühestens wieder dran
 * sein? Verdoppelnd, gedeckelt, ohne Zufall (damit der Test sie festhalten
 * kann; bei einer einzelnen Kasse gibt es keinen Schwarm, der sich abstimmen
 * müsste).
 *
 * Rein: keine Uhr, kein Netz.
 */
export function wartezeitNachVersuchen(versuche: number): number {
  if (versuche <= 0) return 0;
  const roh = ERSTE_WARTEZEIT_MS * 2 ** (versuche - 1);
  return Math.min(roh, MAX_WARTEZEIT_MS);
}

/** Ist die Zeile jetzt wieder dran? */
export function istWiederFaellig(
  versuche: number,
  letzterVersuchMs: number | null,
  jetztMs: number,
): boolean {
  if (letzterVersuchMs == null) return true;
  return jetztMs - letzterVersuchMs >= wartezeitNachVersuchen(versuche);
}

/**
 * ⚠️ Lehnt die Gegenstelle DAUERHAFT ab?
 *
 * Nur dann ist Aufgeben richtig. Die Unterscheidung ist der ganze Kern: wer
 * sie nicht trifft, gibt entweder eine Signatur wegen eines Netzhüpfers auf
 * (der alte Zustand) oder klopft ewig mit einem Rumpf an, den niemand je
 * annehmen wird.
 *
 * Vorübergehend, also EWIG wiederholen:
 *   · kein Netz, DNS, Verbindung abgelehnt
 *   · Zeitüberschreitung
 *   · 408, 429 und jeder 5xx
 *   · 401 und 403 — siehe `SITZUNGS_STATUS` unmittelbar darunter
 *
 * Dauerhaft, also aufgeben und laut melden:
 *   · jeder andere 4xx. Der Rumpf ist falsch gebaut oder der Vorgang existiert
 *     nicht mehr; der tausendste Versuch endet gleich.
 *
 * Im Zweifel VORÜBERGEHEND. Eine zu oft wiederholte Zeile kostet Rechenzeit,
 * eine zu früh aufgegebene kostet eine gesetzlich verlangte Signatur.
 */
export function istDauerhaftAbgelehnt(fehler: unknown): boolean {
  const status = statusVon(fehler);
  if (status == null) return false; // kein HTTP-Status: Netz, Zeit, Unbekanntes
  if (status === 408 || status === 429) return false;
  if (status >= 500) return false;
  if (SITZUNGS_STATUS.has(status)) return false;
  return status >= 400;
}

/**
 * ⚠️ DER BEFUND VOM 11.08.2026 — ein 401 kostete den GANZEN Rückstau
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen am echten Weg, mit fertiger Signatur auf der Zeile:
 *
 *     HTTP 401 UNAUTHORIZED           -> dauerhaft abgelehnt = true
 *     HTTP 403 DEVICE_NOT_AUTHORIZED  -> dauerhaft abgelehnt = true
 *     Ergebnis der Runde: { attempted: 1, succeeded: 0, terminal: 1, retryable: 0 }
 *     Zeile: [ { status: 'failed_terminal', attempt_count: 0, hat_signatur: 1 } ]
 *     listDrainable jetzt+1 Jahr: 0 Zeilen
 *
 * Es war nicht EIN Wiederholversuch verbraucht, die Signatur lag fertig auf der
 * Zeile, und ein Jahr später wurde sie trotzdem nie wieder ausgewählt.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ────────────────────────────────
 * „4xx heisst: der Aufruf ist falsch, Wiederholen hilft nicht" stimmt für den
 * RUMPF. 401 und 403 sagen aber nichts über den Rumpf, sondern über den
 * ABSENDER: die Personal-Sitzung läuft nach acht Stunden ab, ein Kassierer ohne
 * aufgelöste Gerätekennung bekommt 403, ein Zertifikatswechsel nimmt sie
 * vorübergehend weg. Alles davon kommt von selbst zurück — die nächste
 * Anmeldung reicht. Derselbe Rumpf wird dann angenommen.
 *
 * Und der Nachreiche-Weg läuft alle fünf Sekunden über den GANZEN Rückstau:
 * fällt die Gerätekennung weg, starb in EINEM Durchlauf jede wartende Zeile.
 * § 146a AO kennt für eine verlorene Signatur keine Ausnahme.
 *
 * ── WARUM NICHT EINFACH JEDER 4xx VORÜBERGEHEND ──────────────────────────
 * Dann wäre die Unterscheidung tot und eine Zeile mit dauerhaft falschem Rumpf
 * klopfte für immer an, versteckt hinter dem Rauschen — der Händler sähe nie,
 * dass er handeln muss. 400, 404, 409 und 422 bleiben deshalb endgültig.
 */
export const SITZUNGS_STATUS: ReadonlySet<number> = new Set([401, 403]);

/**
 * Den HTTP-Status aus den Formen holen, in denen dieses Haus ihn trägt.
 *
 * ⚠️ DER BEFUND VOM 13.08.2026 — DIE FORM DER BRÜCKE FEHLTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Nachreiche-Weg spricht mit der Sicherungseinrichtung NICHT über `fetch`,
 * sondern über die Tauri-Brücke: `tse-queue-drain-hook.ts:41` ruft
 * `tseClient.finish`, das ist `invoke('tse_finish_transaction')`
 * (`hardware-client.ts:233`). Rust antwortet dort mit
 *
 *     HardwareError::Device("Fiskaly PUT /tx (FINISHED) returned 404 …")
 *
 * und das serialisiert nach `{ kind: "device", details: "…" }` — so steht es
 * wörtlich in `src-tauri/src/error.rs:22`. KEIN `status`, KEIN `message`.
 *
 * Diese Funktion las nur `status`/`statusCode`/`httpStatus` und `message`. Für
 * jede Ablehnung der Brücke gab sie deshalb `null` zurück, `istDauerhaftAbgelehnt`
 * sagte „vorübergehend", und die Zeile ging zurück auf `pending` — für immer.
 * Der Gerätemanager las daraus „Ausstehende TSE-Signaturen werden automatisch
 * nachgereicht" (`screens/secondary/GeraeteManager.tsx:1331`) und sagte damit
 * dauerhaft etwas Falsches.
 *
 * `details` ist deshalb hier gleichberechtigt. Dieselbe Doppelform kennt
 * `rohtextAus` in `drucker-diagnose.ts:75` schon länger — die Brücke trägt ihre
 * Meldung eben in `details`, das Netz in `message`.
 */
function statusVon(fehler: unknown): number | null {
  if (fehler == null || typeof fehler !== 'object') return null;
  const o = fehler as Record<string, unknown>;
  for (const feld of ['status', 'statusCode', 'httpStatus']) {
    const w = o[feld];
    if (typeof w === 'number' && Number.isFinite(w)) return w;
  }
  // Der Rust-Weg reicht den Fehler als Text durch; dort steht die Zahl im Satz.
  // `details` ist die Form der Tauri-Brücke, `message` die eines Error-Objekts.
  for (const feld of ['details', 'message']) {
    const text = o[feld];
    if (typeof text !== 'string') continue;
    const m = /\b(4\d{2}|5\d{2})\b/.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

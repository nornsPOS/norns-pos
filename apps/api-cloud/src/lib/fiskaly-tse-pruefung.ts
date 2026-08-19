/**
 * ════════════════════════════════════════════════════════════════════════
 *  Fragt die TSE, ob sie WIRKLICH da ist — bevor die Kasse sich scharf nennt
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ DER BEFUND VOM 05.08.2026 ────────────────────────────────────────
 *
 * `POST /api/tse/einrichten` nahm eine getippte Kennung entgegen, schrieb sie
 * in die Einstellungen und meldete Erfolg. Es hat fiskaly NIE gefragt.
 *
 * Gemessen an demselben Tag: bei fiskaly lag eine TSE im Zustand `CREATED`,
 * und jeder Versuch, sie auf `UNINITIALIZED` zu bringen, endete in
 * `E_SMAERS: storage error (66)`, HTTP 502 — dreimal, auch auf einer
 * brandneuen Einheit. Diese TSE kann NICHTS signieren.
 *
 * Hätte Basel genau diese Kennung eingetippt, hätte die Kasse gesagt:
 * „fiskalisch scharf". Jeder Beleg wäre ohne Signatur gelaufen, und aufgefallen
 * wäre es erst bei der Kassennachschau. Das ist die Hauskrankheit
 * „fabricate-when-unconfigured", angewandt auf § 146a AO.
 *
 * ── WAS DIESE DATEI TUT ─────────────────────────────────────────────────
 *
 * Zwei Fragen an fiskalys KassenSichV-Schnittstelle, bevor irgendetwas
 * gespeichert wird:
 *
 *   1. GET /tss/{tssId}                    Gibt es sie, und ist sie
 *                                          INITIALIZED (also scharf)?
 *   2. GET /tss/{tssId}/client/{clientId}  Ist DIESER Kassenklient dort
 *                                          registriert?
 *
 * Jede Antwort bekommt einen eigenen Grund und einen deutschen Satz. Kein
 * „Fehler beim Einrichten": wer an der Theke steht, muss lesen können, ob die
 * Kennung falsch war, die TSE noch nicht scharf ist, oder fiskaly gerade nicht
 * erreichbar ist. Das sind drei verschiedene Handlungen.
 *
 * ── ⚠️ NICHT ERREICHBAR IST KEIN ERFOLG ─────────────────────────────────
 *
 * Kommt keine Antwort, ist das Ergebnis `nicht_erreichbar` — NICHT „bereit".
 * Eine Kasse, die sich bei Netzstörung scharf nennt, ist genau der Zustand,
 * den es zu verhindern gilt.
 *
 * Die Einspritzung von `fetchImpl` folgt `fiskaly-dsfinvk.ts`, damit die Tests
 * ohne Netz laufen und trotzdem das ECHTE Protokoll prüfen.
 */

/** Die KassenSichV-Schnittstelle (SIGN DE). Eine ANDERE Adresse als DSFinV-K. */
const STANDARD_BASIS = 'https://kassensichv-middleware.fiskaly.com/api/v2';
const STANDARD_FRIST_MS = 15_000;

export interface TseZugang {
  apiKey: string;
  apiSecret: string;
}

export type TseFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface TsePruefungOptionen {
  basis?: string;
  fetchImpl?: TseFetch;
  fristMs?: number;
}

/**
 * Das Ergebnis der Prüfung. Eine Vereinigung, keine Wahrheitswerte: „false"
 * beantwortet nicht die Frage, WAS zu tun ist.
 */
export type TsePruefung =
  | { art: 'bereit'; tssZustand: string; clientZustand: string; seriennummer: string | null }
  | { art: 'kein_zugang' }
  | { art: 'tss_unbekannt' }
  | { art: 'tss_nicht_scharf'; zustand: string }
  | { art: 'client_unbekannt' }
  | { art: 'client_nicht_registriert'; zustand: string }
  | { art: 'nicht_erreichbar'; grund: string };

/** Der Satz, den ein Mensch an der Theke lesen soll. */
export function tseSatz(p: TsePruefung): string {
  switch (p.art) {
    case 'bereit':
      return 'Die TSE ist erreichbar, scharf und dieser Kassenklient ist dort registriert.';
    case 'kein_zugang':
      return 'Für diese Kasse sind keine fiskaly-Zugangsdaten hinterlegt, also lässt sich die Kennung nicht überprüfen.';
    case 'tss_unbekannt':
      return 'Unter dieser Kennung findet fiskaly keine TSE. Bitte die Kennung aus dem fiskaly-Konto vergleichen.';
    case 'tss_nicht_scharf':
      return `Die TSE ist bekannt, steht aber im Zustand ${p.zustand} und kann noch nicht signieren. Sie muss erst in Betrieb genommen werden (INITIALIZED).`;
    case 'client_unbekannt':
      return 'Die TSE ist da, aber dieser Kassenklient ist dort nicht angelegt. Bitte den Klienten im fiskaly-Konto registrieren.';
    case 'client_nicht_registriert':
      return `Der Kassenklient ist angelegt, steht aber im Zustand ${p.zustand} statt REGISTERED.`;
    case 'nicht_erreichbar':
      return `fiskaly ist gerade nicht erreichbar (${p.grund}). Die Kennung wurde NICHT übernommen — eine Kasse darf sich nicht scharf nennen, solange das niemand bestätigt hat.`;
  }
}

/** Wahr, wenn Zugangsdaten überhaupt vorliegen. */
export function tseZugangVorhanden(z: TseZugang): boolean {
  return z.apiKey.trim().length > 0 && z.apiSecret.trim().length > 0;
}

interface Marke {
  wert: string;
  laeuftAbUm: number;
  fuerSchluessel: string;
}
let gehalteneMarke: Marke | null = null;

/** Nur für Tests: den Markenspeicher leeren. */
export function _markeVergessen(): void {
  gehalteneMarke = null;
}

const MARKE_PUFFER_S = 120;

async function marke(
  z: TseZugang,
  basis: string,
  hole: TseFetch,
  fristMs: number,
): Promise<string> {
  const jetzt = Math.floor(Date.now() / 1000);
  const m = gehalteneMarke;
  if (m && m.fuerSchluessel === z.apiKey && m.laeuftAbUm - MARKE_PUFFER_S > jetzt) return m.wert;

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), fristMs);
  try {
    const res = await hole(`${basis}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: z.apiKey, api_secret: z.apiSecret }),
      signal: abbruch.signal,
    });
    if (!res.ok) throw new Error(`Anmeldung fehlgeschlagen (HTTP ${res.status})`);
    const d = (await res.json()) as { access_token?: string; access_token_expires_in?: number };
    if (typeof d.access_token !== 'string' || d.access_token.length === 0) {
      throw new Error('Anmeldung ohne Zugriffsmarke');
    }
    gehalteneMarke = {
      wert: d.access_token,
      laeuftAbUm: jetzt + (typeof d.access_token_expires_in === 'number' ? d.access_token_expires_in : 3600),
      fuerSchluessel: z.apiKey,
    };
    return d.access_token;
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Fragt fiskaly, ob diese TSE und dieser Kassenklient wirklich signieren können.
 *
 * Wirft NIE. Jeder Ausgang ist ein benannter Grund — auch ein Netzfehler, denn
 * ein geworfener Fehler an dieser Stelle würde irgendwo weiter oben zu einem
 * allgemeinen 500 und damit wieder zu „irgendwas ging schief".
 */
export async function pruefeTse(
  tssId: string,
  clientId: string,
  zugang: TseZugang,
  optionen: TsePruefungOptionen = {},
): Promise<TsePruefung> {
  if (!tseZugangVorhanden(zugang)) return { art: 'kein_zugang' };

  const basis = optionen.basis ?? STANDARD_BASIS;
  const hole = optionen.fetchImpl ?? ((i, init) => fetch(i, init as RequestInit | undefined));
  const frist = optionen.fristMs ?? STANDARD_FRIST_MS;

  let bearer: string;
  try {
    bearer = await marke(zugang, basis, hole, frist);
  } catch (e) {
    return { art: 'nicht_erreichbar', grund: e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen' };
  }

  const kopf = { authorization: `Bearer ${bearer}` };

  // ── 1. Die TSE selbst ────────────────────────────────────────────────
  let tss: { state?: string; serial_number?: string };
  try {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), frist);
    try {
      const res = await hole(`${basis}/tss/${encodeURIComponent(tssId)}`, {
        headers: kopf,
        signal: abbruch.signal,
      });
      if (res.status === 404) return { art: 'tss_unbekannt' };
      if (!res.ok) {
        return { art: 'nicht_erreichbar', grund: `TSE-Abfrage HTTP ${res.status}` };
      }
      tss = (await res.json()) as { state?: string; serial_number?: string };
    } finally {
      clearTimeout(uhr);
    }
  } catch (e) {
    return { art: 'nicht_erreichbar', grund: e instanceof Error ? e.message : 'TSE nicht abfragbar' };
  }

  const tssZustand = typeof tss.state === 'string' ? tss.state : 'UNBEKANNT';
  // ⚠️ NUR `INITIALIZED` kann signieren. `CREATED` und `UNINITIALIZED` sehen in
  // einer Liste harmlos aus und sind es nicht — genau darauf wäre die Kasse am
  // 05.08.2026 hereingefallen.
  if (tssZustand !== 'INITIALIZED') return { art: 'tss_nicht_scharf', zustand: tssZustand };

  // ── 2. Der Kassenklient an dieser TSE ────────────────────────────────
  let klient: { state?: string };
  try {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), frist);
    try {
      const res = await hole(
        `${basis}/tss/${encodeURIComponent(tssId)}/client/${encodeURIComponent(clientId)}`,
        { headers: kopf, signal: abbruch.signal },
      );
      if (res.status === 404) return { art: 'client_unbekannt' };
      if (!res.ok) return { art: 'nicht_erreichbar', grund: `Klienten-Abfrage HTTP ${res.status}` };
      klient = (await res.json()) as { state?: string };
    } finally {
      clearTimeout(uhr);
    }
  } catch (e) {
    return { art: 'nicht_erreichbar', grund: e instanceof Error ? e.message : 'Klient nicht abfragbar' };
  }

  const clientZustand = typeof klient.state === 'string' ? klient.state : 'UNBEKANNT';
  if (clientZustand !== 'REGISTERED') {
    return { art: 'client_nicht_registriert', zustand: clientZustand };
  }

  return {
    art: 'bereit',
    tssZustand,
    clientZustand,
    seriennummer: typeof tss.serial_number === 'string' ? tss.serial_number : null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER SITZUNGSSCHLÜSSEL GEHÖRT NICHT IN EINE ADRESSZEILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 im Tunnelprotokoll gefunden und selbst nachgemessen: der Wert
 * hinter `access_token=` ist kein Zufallskennzeichen, sondern der volle
 * Anmeldeschlüssel. `plugins/auth.ts` nimmt ihn für jeden `/api/sse/`-Pfad an
 * und löst ihn gegen die Tabelle `sessions` auf. **Wer die Adresszeile liest,
 * ist angemeldet.**
 *
 * Und sie steht an zwei Orten, die niemand als Geheimnisspeicher betrachtet:
 * im Behälterprotokoll auf der Platte und — ausserhalb jeder eigenen Kontrolle
 * — in den Zugriffsprotokollen von Cloudflare am Rand.
 *
 * Nachgemessen: EIN Schlüssel in 24 Stunden, eine echte Zeile in `sessions`,
 * **noch 4,7 Stunden gültig und nicht widerrufen.** Ein benutzbarer
 * Hauptschlüssel, der offen herumlag. Er wurde sofort widerrufen.
 *
 * ── Besonders bitter: die Regel stand schon da ───────────────────────────
 *
 * Zwanzig Zeilen weiter, bei der Melde-Route, begründet ein Kommentar wörtlich,
 * warum der Schlüssel dort in den RUMPF statt in die Adresse gehört: „so it
 * never leaks into access/proxy logs". Dieselbe Regel, dieselbe Datei, bei der
 * SSE-Route nicht angewandt.
 *
 * ── Warum es nicht einfach ein Kopfzeilenfeld tut ────────────────────────
 *
 * `EventSource` kann keine Kopfzeilen setzen — das ist eine Grenze des
 * Browsers, kein Versäumnis. Und der Keks trägt hier nicht: auf Windows
 * verwirft WebView2 den seitenübergreifenden Sitzungskeks, genau deshalb stand
 * der Schlüssel überhaupt in der Adresse.
 *
 * ── Die Eintrittskarte ───────────────────────────────────────────────────
 *
 * Der Client holt sich mit seiner ECHTEN Anmeldung (Keks oder Kopfzeile, also
 * nie in einer Adresse) eine kurzlebige Karte und hängt DIESE an die
 * SSE-Adresse. Drei Eigenschaften machen sie harmlos, wenn sie doch in einem
 * Protokoll landet:
 *
 *   • **30 Sekunden.** Wer sie später liest, liest Müll.
 *   • **Einmalig.** Sie wird beim Einlösen verbraucht; ein Mitleser käme immer
 *     zu spät, selbst innerhalb der 30 Sekunden.
 *   • **Sie ist nicht der Schlüssel.** Aus ihr lässt sich die Sitzung nicht
 *     ableiten, und sie taugt für nichts ausser diesem einen Strom.
 *
 * Verlängert wird nichts: die Karte ist die Eintrittskarte, nicht das Abo. Die
 * Sitzung dahinter behält ihre eigene Laufzeit.
 */

import { randomBytes } from 'node:crypto';

/** Kurz genug, dass eine Karte im Protokoll schon tot ist, wenn jemand sie liest. */
export const KARTE_TTL_MS = 30_000;

/**
 * ⚠️ Die Karte haelt die AUFGELOESTE Sitzung, nicht den Schluessel.
 *
 * Der erste Entwurf hinterlegte den Sitzungsschluessel — und haette damit
 * genau das getan, was hier abgestellt werden soll: ein Geheimnis an einem
 * zweiten Ort ablegen. Jetzt gibt es den Schluessel in dieser Karte gar nicht,
 * und aus ihr laesst sich keiner gewinnen.
 *
 * Nebenwirkung, und sie ist erwuenscht: die Karte umgeht keine Pruefung, die
 * beim Ausstellen schon gelaufen ist — sie TRAEGT deren Ergebnis.
 */
interface Karte<T> {
  sitzung: T;
  gueltigBis: number;
}

/**
 * Im Speicher, mit Absicht.
 *
 * Eine Karte lebt 30 Sekunden und wird einmal benutzt. Sie in die Datenbank zu
 * schreiben hiesse, ein Geheimnis dauerhaft abzulegen, das genau dafür gebaut
 * ist, keines zu bleiben. Ein Serverneustart entwertet alle offenen Karten —
 * das ist richtig so, denn der Strom bricht dabei ohnehin ab und der Client
 * verbindet neu.
 */
const karten = new Map<string, Karte<unknown>>();

/**
 * Räumt abgelaufene Karten weg.
 *
 * Läuft VOR jedem Nachschlagen und vor jedem Ausstellen, nicht auf einem
 * Zeitgeber: ein Zeitgeber hält den Prozess wach und wird beim nächsten
 * Neubau vergessen. So kann eine abgelaufene Karte nie gefunden werden, weil
 * sie schon weg ist, bevor gesucht wird.
 */
function kehre(jetzt: number): void {
  for (const [k, v] of karten) {
    if (v.gueltigBis <= jetzt) karten.delete(k);
  }
}

export function stelleKarteAus<T>(sitzung: T, jetzt = Date.now()): string {
  kehre(jetzt);
  const karte = randomBytes(32).toString('base64url');
  karten.set(karte, { sitzung, gueltigBis: jetzt + KARTE_TTL_MS });
  return karte;
}

/**
 * Löst eine Karte ein und gibt die hinterlegte Sitzung zurück.
 *
 * ⚠️ Verbraucht sie dabei. Ein zweites Einlösen liefert `null` — auch dann,
 * wenn die 30 Sekunden noch laufen. Genau das macht einen Mitleser wirkungslos.
 *
 * ⚠️ Die zurückgegebene Sitzung trägt `ausKarte: true`. Wer sie trägt, bekommt
 * keine NEUE Karte — siehe der Befund vom 08.08.2026 bei `darfMitKarteRein`.
 * Die Marke sitzt auf einer KOPIE: die hinterlegte Sitzung selbst bleibt
 * unberührt, sonst trüge die Sitzung des ehrlichen Anmelders die Marke mit,
 * sobald sie einmal in einer Karte lag, und er bekäme nie wieder eine.
 */
export function loeseKarteEin<T>(karte: string | undefined, jetzt = Date.now()): T | null {
  if (!karte) return null;
  kehre(jetzt);
  const gefunden = karten.get(karte);
  if (!gefunden) return null;
  karten.delete(karte);
  return { ...(gefunden.sitzung as object), ausKarte: true } as T;
}

/** Der Bereich, in dem eine Karte überhaupt gilt. */
const STROM_PRAEFIX = '/api/sse/';

/**
 * Die ausstellende Route. Sie liegt im selben Bereich wie die Ströme, und
 * genau daran hing der Befund.
 */
const AUSSTELLENDE_ROUTE = '/api/sse/ticket';

/**
 * ⚠️ DARF DIESE ANFRAGE MIT EINER KARTE HEREIN?
 *
 * ── DER BEFUND VOM 08.08.2026 ─────────────────────────────────────────────
 *
 * `plugins/auth.ts` liess die Karte für JEDEN Pfad gelten, der mit
 * `/api/sse/` beginnt. Die ausstellende Route heisst `POST /api/sse/ticket`
 * und beginnt genau so. Damit ging:
 *
 *   1. Ein Mitleser fischt eine Karte aus einem Protokoll.
 *   2. Er ruft `POST /api/sse/ticket?ticket=<Karte>`.
 *   3. Die Karte wird eingelöst, die Sitzung steht, die Rollenprüfung geht
 *      durch — die Karte TRÄGT ja eine Inhabersitzung.
 *   4. Die Route stellt eine FRISCHE Karte aus.
 *   5. Zurück zu Schritt 2, für immer.
 *
 * Aus dreissig Sekunden wurde unbegrenzter Inhaberzugang. Alle drei
 * Eigenschaften der Karte waren damit wirkungslos, auch die Einmaligkeit:
 * verbraucht wurde die alte, zurück kam eine neue.
 *
 * ── DIE REGEL ────────────────────────────────────────────────────────────
 *
 * NUR GET, NUR im Strombereich, NIE die ausstellende Route.
 *
 * `EventSource` kann ausschliesslich GET; ein POST konnte also nie eine Karte
 * brauchen. Damit ist die ausstellende Route schon durch die Methode
 * ausgeschlossen, und der Bereich bleibt offen für einen künftigen zweiten
 * Strom, ohne dass jemand eine Liste pflegen muss.
 *
 * Rein: keine Uhr, kein Netz.
 */
export function darfMitKarteRein(methode: string, pfad: string): boolean {
  if (methode.toUpperCase() !== 'GET') return false;

  // Die Abfrage abschneiden, sonst entscheidet ein `?` über die Grenze.
  const ohneAbfrage = (pfad.split('?')[0] ?? '').split('#')[0] ?? '';

  // ⚠️ Ein blosser Präfixvergleich lässt `/api/sseX/…` durch, und ein `..`
  // führt aus dem Bereich heraus. Beides sind fremde Wege mit vertrautem
  // Anfang.
  if (!ohneAbfrage.startsWith(STROM_PRAEFIX)) return false;
  if (ohneAbfrage.includes('..')) return false;

  return ohneAbfrage !== AUSSTELLENDE_ROUTE;
}

/** Nur für Prüfungen: wie viele Karten liegen gerade offen? */
export function offeneKarten(): number {
  return karten.size;
}

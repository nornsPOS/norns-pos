/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  vorgangs-uhr — der VORGANG beginnt beim ERSTEN STÜCK, nicht beim Bezahlen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 19.08.2026 (Fiskal-Audit, H1) ───────────────────────────
 *
 * DSFinV-K 2.4, Anhang I, S. 113: „StartTransaction wird unmittelbar mit
 * Beginn eines Vorgangs an der Kasse aufgerufen." § 146a Abs. 1 Satz 1 AO
 * verlangt die Aufzeichnung „einzeln, vollständig, richtig, ZEITGERECHT und
 * geordnet". § 6 Satz 1 Nr. 2 KassenSichV will auf dem Beleg den Zeitpunkt
 * des Vorgangsbeginns UND der Vorgangsbeendigung.
 *
 * Bis heute öffnete die Kasse die TSE-Transaktion erst im Bezahlen-Dialog —
 * beim Kartenweg sogar NACH der Belastung der Karte. Die Folgen, wie ein
 * Prüfer sie sieht:
 *
 *   • Auf JEDEM Bon liegen <start-zeit> und <log-time> im QR Sekunden
 *     auseinander, egal wie lange der Verkauf wirklich dauerte. Der
 *     „Vorgangsbeginn" war faktisch die Bezahlzeit.
 *   • Ein gefüllter und wieder verworfener Korb berührte die TSE NIE —
 *     keine Spur, kein AVBelegabbruch. Genau das Unterdrückungsfenster,
 *     das die TSE schliessen soll: der Prüfer füllt einen Korb, geht weg,
 *     und findet ihn in keiner Aufzeichnung wieder.
 *
 * ── WAS DIESE UHR TUT ──────────────────────────────────────────────────────
 *
 * Sie hält je Kasse EINEN offenen Vorgang:
 *
 *   beginnen()     Beim ersten Stück im Korb: TSE-Transaktion öffnen (leere
 *                  processData, wie Anhang I S. 113 es beschreibt — die
 *                  Inhalte kommen erst beim FINISH). Der Zeitpunkt wird auch
 *                  dann festgehalten, wenn die TSE gerade NICHT erreichbar
 *                  ist: der Vorgangsbeginn ist eine Tatsache der Kasse, kein
 *                  Geschenk des Signaturdienstes.
 *   uebernehmen()  Beim Bezahlen: der offene Vorgang wandert in den
 *                  Finalize-Weg (dieselbe intention wird FINISHed) und die
 *                  Uhr wird leer.
 *   verwerfen()    Beim Leeren des Korbs: die offene Transaktion wird als
 *                  AVBelegabbruch (fiskaly `ABORT`, laut Live-Spezifikation
 *                  „'ABORT' = AVBelegabbruch") mit Betrag 0 abgeschlossen —
 *                  der verworfene Korb hinterlässt seine Spur.
 *
 * ── WAS SIE BEWUSST NICHT TUT ──────────────────────────────────────────────
 *
 *   • Kein Blockieren: schlägt das Öffnen fehl (TSE aus, offline), merkt
 *     sich die Uhr nur den Zeitpunkt. Der Verkauf läuft weiter; das FINISH
 *     im Bezahlen-Dialog geht dann seinen bewährten Ausfallweg.
 *   • Keine Platte: der offene Vorgang lebt im Speicher. Stirbt die Kasse
 *     hart, läuft die Transaktion bei fiskaly aus (deren Verfall), und der
 *     wiederhergestellte Korb beginnt beim nächsten Stück einen neuen
 *     Vorgang. Ein Verfall ist ehrlicher als ein zweites, halbgeführtes
 *     Vorgangsregister auf der Platte.
 *   • Web-Abholungen: der Vorgang gehört dem Storefront, nicht dieser
 *     Kasse — die Uhr bleibt dort aus.
 *
 * ── DIE UHR, DIE HIER TICKT (19.08.2026, Antwort auf Basels Pruefliste) ────
 *
 * Die Pruefliste warnte: `Date.now()` koenne „die TSE sicherheitshalber
 * stoppen". Das verwechselt die Uhren. Die SIGNATURZEIT stammt bei einer
 * Cloud-TSE von fiskaly — deren Uhr, deren Monotonie; keine lokale Drift
 * kann eine Signatur anhalten oder umordnen. Was DIESE Zeile stempelt, ist
 * der Vorgangsbeginn fuer Bon und DSFinV-K (BON_START), und `finalized_at`
 * stammt aus derselben Maschine: die Kasse und ihr Motor laufen als Sidecar
 * auf EINEM Geraet, es gibt keine zweite Uhr, gegen die sie driften koennte
 * (die 5-Minuten-Schranke der Migration 0147 vergleicht also Uhr mit sich
 * selbst). Das verbleibende, ehrliche Restrisiko: steht die GERAETEUHR
 * falsch, tragen Bon und Tageszuordnung die falsche Ortszeit — dagegen hilft
 * nur NTP des Betriebssystems (auf macOS und Windows Vorgabe). Ein
 * Drift-Waechter (fiskaly-Antwortzeit gegen die Geraeteuhr, Warnung in der
 * Werkstatt ab ~2 Minuten Abstand) ist als eigene Etappe vorgemerkt.
 */

import {
  type TseConfig,
  type TseIntention,
  tseClient,
} from './hardware-client.js';
import { newIntentionId, openTseSession } from './tse-service.js';

export interface OffenerVorgang {
  /** Unsere Vorgangskennung (idempotent gegenüber fiskaly). */
  intentionId: string;
  /** Die offene TSE-Transaktion — `null`, wenn das Öffnen fehlschlug. */
  intention: TseIntention | null;
  /** Wann das ERSTE Stück in den Korb kam (ISO). Immer gesetzt. */
  begonnenAm: string;
}

let offen: OffenerVorgang | null = null;

/** Nur für Tests: die Uhr in den Anfangszustand setzen. */
export function vorgangsUhrZuruecksetzen(): void {
  offen = null;
}

/** Der offene Vorgang, ohne ihn zu verbrauchen (Anzeige, Tests). */
export function offenerVorgang(): OffenerVorgang | null {
  return offen;
}

/**
 * Beim ersten Stück im Korb rufen. Idempotent: läuft schon ein Vorgang,
 * bleibt er stehen (ein zweites Stück beginnt keinen zweiten Vorgang).
 */
export async function vorgangBeginnen(config: TseConfig | null): Promise<OffenerVorgang> {
  if (offen) return offen;
  const begonnenAm = new Date().toISOString();
  const intentionId = newIntentionId();
  // Der Zeitpunkt steht JETZT fest — was immer die TSE gleich sagt.
  offen = { intentionId, intention: null, begonnenAm };
  if (config) {
    const res = await openTseSession({
      config,
      receiptLocator: null,
      intentionId,
      paymentKind: 'CASH', // Platzhalter — die Zahlart entscheidet erst das FINISH.
    });
    if (offen && offen.intentionId === intentionId && 'intention' in res) {
      offen = { ...offen, intention: res.intention };
    }
  }
  return offen ?? { intentionId, intention: null, begonnenAm };
}

/**
 * Beim Bezahlen: den offenen Vorgang herausnehmen. Der Aufrufer FINISHed
 * dessen `intention` (falls vorhanden) statt eine neue zu öffnen.
 */
export function vorgangUebernehmen(): OffenerVorgang | null {
  const v = offen;
  offen = null;
  return v;
}

/**
 * Beim Leeren des Korbs: die Spur des verworfenen Vorgangs schreiben.
 * AVBelegabbruch, Betrag 0, keine Steuereimer — der Vorgang hatte kein
 * Ergebnis, aber er HAT stattgefunden.
 */
export async function vorgangVerwerfen(config: TseConfig | null): Promise<void> {
  const v = offen;
  offen = null;
  if (!v || !v.intention || !config) return;
  try {
    /*
     * Direkt `tseClient.finish`, NICHT `closeTseSession`: der Abbruch hat
     * keinen Server-Vorgang (nichts wurde gebucht), also gibt es nichts, was
     * die Nachreich-Warteschlange je einspielen könnte — deren Pflichtfeld
     * `serverTransactionId` sagt das ehrlich. Die Spur lebt in der TSE
     * selbst (deren TAR-Ausfuhr liest der Prüfer); schlägt das FINISH fehl,
     * läuft die Transaktion bei fiskaly aus — auch das ist eine Spur.
     */
    await tseClient.finish({
      config,
      intentionId: v.intentionId,
      fiskalyTransactionId: v.intention.fiskalyTransactionId,
      amountCents: 0,
      paymentKind: 'CASH',
      processDataBase64: '',
      processType: 'Kassenbeleg-V1',
      receiptType: 'ABORT',
      amountsPerVatRate: [],
    });
  } catch {
    // Best-effort: eine nicht abschliessbare Abbruch-Spur läuft bei fiskaly
    // aus. Der Verkauf des NÄCHSTEN Kunden darf daran nicht hängen.
  }
}

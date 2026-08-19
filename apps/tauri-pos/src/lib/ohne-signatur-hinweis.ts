/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN BELEG OHNE SIGNATUR DARF DEN KASSIERER NICHT UNBEMERKT VERLASSEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * In beiden Bezahlmasken stand am Ende derselbe Satz:
 *
 *     } else if (hardwareCfg.tse.tssId.length > 0) {
 *         addToast({ title: 'TSE nicht erreichbar', … })
 *     }
 *
 * Der Hinweis hing also daran, dass ÖRTLICH etwas eingetragen war. War das
 * Feld leer, gab es keinen `else`-Zweig und **keinen Hinweis**.
 *
 * ── WARUM DAS FELD LEER SEIN KANN, OHNE DASS JEMAND ETWAS FALSCH MACHT ────
 *
 * Zwei Wahrheiten für dieselbe Frage:
 *
 *   Server  →  `system_settings['tse.tss_id']`   eine Zeile, gilt fürs Haus
 *   Kasse   →  `hardwareCfg.tse.tssId`           örtlicher Speicher, je Platz
 *
 * Auf einer Zweitkasse, nach geleertem Webview-Speicher oder wenn
 * `validateSection` das ganze `tse`-Teilobjekt auf die Vorgabe zurückwirft
 * (`hardware-store.ts`, DEFAULT.tse = leere Zeichenketten), ist das örtliche
 * Feld leer, während der Server längst scharf ist. Und `hydrateFromLocal`
 * fängt jeden Fehler still ab — „Corrupt storage, fall through to defaults" —
 * ohne ein Wort an den Menschen. Einen Weg zurück gibt es nicht: der Speicher
 * fragt den Server NIE (null Netzaufrufe in der Datei).
 *
 * ── DIE ABHILFE VON DAMALS ────────────────────────────────────────────────
 *
 * Die Bedingung wurde umgedreht: gewarnt wird, wenn KEINE Signatur entstanden
 * ist — nicht, wenn örtlich zufällig etwas eingetragen war.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ DER BEFUND VOM 13.08.2026 — DIESE DATEI TRUG SELBST EINE LÜGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der zweite Fall dieser Datei antwortete auf `tse_nicht_erreichbar` mit:
 *
 *     „Die Signatur wird nachgeholt, sobald die Sicherungseinrichtung
 *      wieder antwortet."
 *
 * Dieser Satz hatte KEINE Deckung. Er kam aus einer Angabe über den örtlichen
 * Speicher — „hier steht eine Kennung" — und behauptete daraus etwas über
 * einen fiskalischen Vorgang. Beides hat nichts miteinander zu tun:
 *
 *   · Scheitert schon die ERÖFFNUNG, hat die Sicherungseinrichtung den
 *     Vorgang nie gesehen. Nachträglich signieren kann sie ihn nicht, denn
 *     eine später eröffnete Aufzeichnung trüge die Zeit von DANN
 *     (`tse_start_transaction` setzt `Utc::now()`). Nachgeholt wird nie etwas.
 *   · Und ob überhaupt eine Zeile für die Nachreichung entstanden ist, weiss
 *     nur, wer nachgesehen hat (`ausfallSichern` in `tse-queue-store.ts` gibt
 *     genau diese Messung zurück).
 *
 * Der Satz stand also auf einer Vermutung, wo eine Messung hingehört. Genau
 * dieser Wortlaut lief im Ankaufweg auf den Schirm, während NIRGENDS eine
 * Zeile entstand.
 *
 * ── WAS DIESE DATEI HEUTE IST ─────────────────────────────────────────────
 *
 * Eine BRÜCKE, kein Wortlaut. Die Sätze für den Kassierer stehen an EINER
 * Stelle (`lib/fiskalzustand-satz.ts`); hier steht nur noch, welcher Zustand
 * hinter dem einen Fall steckt, den man wirklich am örtlichen Feld ablesen
 * kann:
 *
 *     leeres Feld  →  diese Kasse hat gar keine Sicherungseinrichtung
 *
 * Für den zweiten Fall gibt es hier bewusst KEINEN Satz mehr. Eine hinterlegte
 * Kennung sagt für sich genommen nichts darüber aus, was mit diesem Beleg
 * geschehen ist — der Aufrufer muss messen (`ausfallSichern`) und den Zustand
 * über `zustandAusAusfall` benennen. Diese Enge ist die Abhilfe: was man nicht
 * weiss, kann man so nicht mehr versehentlich behaupten.
 */

import { type Fiskalzustand, fiskalzustandSatz } from './fiskalzustand-satz.js';

/** Warum dieser Beleg keine Signatur trägt. */
export type OhneSignaturGrund = 'keine_tse_hinterlegt' | 'tse_nicht_erreichbar';

/** Rein: nur das örtliche Feld entscheidet, welcher der beiden Fälle vorliegt. */
export function grundOhneSignatur(oertlicheTssId: string | null | undefined): OhneSignaturGrund {
  return (oertlicheTssId ?? '').trim().length > 0
    ? 'tse_nicht_erreichbar'
    : 'keine_tse_hinterlegt';
}

export interface SignaturHinweis {
  title: string;
  body: string;
}

/**
 * Der eine Grund, den das örtliche Feld allein schon beweist, und der Zustand,
 * der daraus folgt.
 *
 * ⚠️ Absichtlich eine Abbildung und kein `if`: sie steht genau EINEM Grund
 * gegenüber. Kommt hier je ein zweiter dazu, muss jemand hinschreiben, welchen
 * fiskalischen Zustand er beweist — und wird dabei merken, dass er das ohne
 * Messung gar nicht kann.
 */
const ZUSTAND_JE_GRUND: Record<'keine_tse_hinterlegt', Fiskalzustand> = {
  keine_tse_hinterlegt: 'ohneSicherungseinrichtung',
};

/**
 * Der Hinweis für eine Kasse, die gar keine Sicherungseinrichtung hinterlegt
 * hat. Der Wortlaut kommt vollständig aus `lib/fiskalzustand-satz.ts`: dort
 * steht der Satz, dort steht der nächste Schritt, und dort ist geprüft, dass
 * der genannte Handgriff in diesem Zustand wirklich begehbar ist.
 *
 * ⚠️ Der erste Wert ist auf `'keine_tse_hinterlegt'` verengt, und das ist die
 * eigentliche Abhilfe des 13.08.2026. Vorher nahm diese Funktion beide Gründe
 * und gab für den zweiten ein Versprechen ohne Deckung aus. Wer heute
 * `tse_nicht_erreichbar` hier hineinreichen will, kommt an der Typprüfung nicht
 * vorbei und muss stattdessen messen: `ausfallSichern` sagt, ob eine Zeile
 * liegt, `zustandAusAusfall` macht daraus den Zustand, `fiskalzustandSatz`
 * daraus den Satz.
 *
 * Der Rückgabewert trägt bewusst KEINEN Ton. Beide Masken setzen ihn selbst
 * aus `TONLAGE_ALS_MELDUNGSTON`, und ein Ton in diesem Ergebnis würde beim
 * Ausbreiten den der Maske überschreiben — still und ungewollt.
 */
export function hinweisOhneSignatur(
  grund: 'keine_tse_hinterlegt',
  vorgang: 'Verkauf' | 'Ankauf',
): SignaturHinweis {
  const satz = fiskalzustandSatz(ZUSTAND_JE_GRUND[grund], vorgang);
  return {
    title: satz.titel,
    // Der Handgriff gehört an den Satz. Ohne ihn weiss der Kassierer, dass
    // etwas fehlt, aber nicht, wohin er gehen soll.
    body: `${satz.satz} ${satz.naechsterSchritt.text}`,
  };
}

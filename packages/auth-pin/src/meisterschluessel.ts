/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Herstellercode — die letzte Tür, wenn ALLES andere verloren ist
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DIE KETTE DER TÜREN (21.08.2026, Basels Auftrag: „حل جذري") ────────────
 *
 *   1. Kassencode        — der tägliche Weg.
 *   2. Notfallschlüssel  — der Händler selbst, wenn er den Code vergisst
 *                          (aber nur, wenn er den Zettel noch hat).
 *   3. Rettungsstick     — dasselbe Geheimnis auf einem USB-Stick, für den,
 *                          der lieber ein Ding als einen Zettel verwahrt.
 *   4. HERSTELLERCODE    — wenn der Händler WEDER Zettel NOCH Stick hat.
 *                          Das sind wir, mit einem Schlüssel, den nur wir
 *                          besitzen.
 *
 * ── WARUM AUFGABE UND ANTWORT, NICHT EIN FESTER CODE ───────────────────────
 *
 * ⚠️ Basel bat wörtlich um einen „كود ماستر المطورين" — einen festen
 * Entwicklercode. Der wäre eine Katastrophe: einmal geleakt (ein Screenshot,
 * ein Support-Mitschnitt), öffnet er JEDE Kasse dieses Hauses für immer, und
 * ein Prüfer, der ihn im Quelltext fände, hätte eine Universal-Hintertür in
 * einem Fiskalsystem vor sich. Deshalb Challenge-Response:
 *
 *   • Die Kasse zeigt eine AUFGABE: Gerätekennung + frischer Zufall,
 *     30 Minuten gültig, nach dem ersten Einlösen verbraucht.
 *   • Der Hersteller UNTERSCHREIBT die Aufgabe mit dem privaten
 *     Ed25519-Schlüssel (liegt einzig in Basels Tresor, nie im Werk).
 *   • Die Kasse prüft gegen den ÖFFENTLICHEN Schlüssel hier unten.
 *
 * Eine abgefangene Antwort ist wertlos: sie passt nur zu DIESER Aufgabe, an
 * DIESER Kasse, in diesem Fenster. Es gibt kein Geheimnis in der Kasse, das
 * man ihr entreissen könnte — nur einen öffentlichen Schlüssel.
 *
 * ── WAS ER TUT UND WAS NICHT ───────────────────────────────────────────────
 *
 * Wie der Notfallschlüssel: er MELDET NICHT AN. Er erlaubt genau, einen
 * neuen Kassencode zu setzen, schreibt laut ins Tagebuch und auf die
 * Aufsicht, und gilt einmal.
 */

import { createPublicKey, verify as edVerify } from 'node:crypto';

/** Der öffentliche Schlüssel des Hauses (SPKI-DER, base64). Der private NIE hier. */
export const MEISTER_PUBLIC_SPKI_B64 =
  'MCowBQYDK2VwAyEALSadx7zDyjh8RCv1frGv/ZixvhYOnCLFlImH5u2o+HY=';

/** Wie lange eine Aufgabe gilt. Eine Nottür ist kein Dauerzustand. */
export const AUFGABE_GILT_MS = 30 * 60 * 1000;

/** Ohne I, O, 0, 1 — die Aufgabe wird am Telefon vorgelesen. */
const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Aufgabe {
  geraet: string;
  zufall: string;
  gueltigBis: number;
}

function zufallStueck(laenge: number, zufall: () => number): string {
  let s = '';
  for (let i = 0; i < laenge; i++) s += ZEICHEN[Math.floor(zufall() * ZEICHEN.length)];
  return s;
}

/**
 * Der Text, der WIRKLICH unterschrieben wird. Beide Seiten bauen ihn aus den
 * Teilen der Aufgabe identisch zusammen — sonst passt keine Unterschrift.
 */
export function aufgabenText(a: Aufgabe): string {
  return `norns-meister-v1|${a.geraet}|${a.zufall}|${a.gueltigBis}`;
}

/** Die Kurzform auf dem Bildschirm: `NORNS-M1-<gerät8>-<zufall8>-<frist>`. */
export function aufgabeAlsText(a: Aufgabe): string {
  return `NORNS-M1-${a.geraet}-${a.zufall}-${a.gueltigBis}`;
}

/** Zurücklesen (Werkzeugseite). `null`, wenn die Form nicht stimmt. */
export function aufgabeAusText(text: string): Aufgabe | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^NORNS-M1-([A-Z2-9]{8})-([A-Z2-9]{8})-(\d{10,16})$/.exec(t);
  if (!m) return null;
  const geraet = m[1];
  const zufall = m[2];
  const frist = m[3];
  if (geraet === undefined || zufall === undefined || frist === undefined) return null;
  return { geraet, zufall, gueltigBis: Number(frist) };
}

/**
 * Eine frische Aufgabe erzeugen (Motorseite).
 *
 * Die Gerätekennung fliesst ein, damit eine Antwort nur an DIESER Kasse
 * gilt; die Uhr kommt herein, damit die Probe sie festhalten kann.
 */
export function erzeugeAufgabe(
  geraetKennung: string,
  jetzt: number,
  zufall: () => number = Math.random,
): Aufgabe {
  const bereinigt = geraetKennung.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return {
    geraet: `${bereinigt}XXXXXXXX`.slice(0, 8),
    zufall: zufallStueck(8, zufall),
    gueltigBis: jetzt + AUFGABE_GILT_MS,
  };
}

/**
 * Die Antwort (Ed25519-Unterschrift, base64) gegen die Aufgabe prüfen.
 *
 * ⚠️ Prüft AUSDRÜCKLICH auch die Frist: eine gültige Unterschrift auf einer
 * abgelaufenen Aufgabe wird abgewiesen — sonst wäre eine einmal abgefangene
 * Antwort für immer gültig.
 */
export function antwortStimmt(
  aufgabe: Aufgabe,
  antwortB64: string,
  jetzt: number,
  publicSpkiB64: string = MEISTER_PUBLIC_SPKI_B64,
): boolean {
  if (jetzt > aufgabe.gueltigBis) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(antwortB64.trim(), 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicSpkiB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    // Ed25519: der Algorithmus steckt im Schlüssel, der erste Parameter bleibt null.
    return edVerify(null, Buffer.from(aufgabenText(aufgabe), 'utf8'), key, sig);
  } catch {
    return false;
  }
}

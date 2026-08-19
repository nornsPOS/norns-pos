/**
 * Wo diese Kasse ihre Sicherungen ablegt, und wann sie es zuletzt tat.
 *
 * ── WARUM ÖRTLICH UND NICHT IN DEN EINSTELLUNGEN DES BETRIEBS ───────────
 *
 * Der Zielordner ist eine Eigenschaft DIESES Geräts, nicht des Betriebs:
 * es ist ein Ordner auf dieser Platte oder ein USB-Stick, der an dieser
 * Kasse steckt. Stünde er in `system_settings`, bekäme die zweite Kasse im
 * Laden denselben Pfad, den es bei ihr nicht gibt — und niemand erführe,
 * warum ihre Sicherung jede Nacht scheitert.
 *
 * ⚠️ Gemessener Befund vom 13.08.2026: der Zielordner lebte ausschliesslich
 * in einem `useState` der Einstellungsfläche. Er überlebte keinen
 * Reiterwechsel. Der Händler tippte ihn bei JEDER Sicherung neu — und eine
 * Sicherung, die man jedes Mal neu einrichten muss, macht niemand täglich.
 */

const SCHLUESSEL_ZIEL = 'norns.sicherung.zielordner';
const SCHLUESSEL_TAG = 'norns.sicherung.zuletzt-am';

/** Der Vorschlag, wenn der Händler noch nichts gewählt hat. */
export const VORGABE_ZIEL = 'Dokumente/Norns Sicherungen';

function lies(schluessel: string): string {
  try {
    return globalThis.localStorage?.getItem(schluessel) ?? '';
  } catch {
    // Ein gesperrter Speicher darf keine Kasse aufhalten.
    return '';
  }
}

function schreib(schluessel: string, wert: string): void {
  try {
    globalThis.localStorage?.setItem(schluessel, wert);
  } catch {
    /* siehe oben */
  }
}

export function zielLesen(): string {
  const gespeichert = lies(SCHLUESSEL_ZIEL).trim();
  return gespeichert === '' ? VORGABE_ZIEL : gespeichert;
}

export function zielSchreiben(ordner: string): void {
  schreib(SCHLUESSEL_ZIEL, ordner.trim());
}

/** Der Tag der letzten gelungenen Sicherung, als ISO-Tag. Leer heisst: nie. */
export function zuletztLesen(): string {
  return lies(SCHLUESSEL_TAG).trim();
}

/**
 * ⚠️ NUR nach einer nachweislich gelungenen Sicherung rufen.
 *
 * Wer den Tag schon beim Starten setzt, sperrt sich für den Rest des Tages
 * aus: der erste Versuch scheitert, der Tag gilt als erledigt, und die
 * Kasse versucht es bis morgen nicht wieder.
 */
export function zuletztSchreiben(tag: string): void {
  schreib(SCHLUESSEL_TAG, tag);
}

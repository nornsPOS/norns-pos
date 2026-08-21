/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Notfallschlüssel — der einzige Weg zurück in eine verschlossene Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Beim Nachsehen, ob ein Händler seinen Kassencode zurückbekommt, gemessen:
 *
 *     POST /api/admin/staff/:id/kassencode-loeschen   →   requireOwner(req)
 *
 * Für einen MITARBEITER ist das genau richtig gebaut: der Inhaber löscht, der
 * Mitarbeiter setzt am Tresen einen neuen, und niemand kennt je den Code
 * eines anderen — das trägt die Bedienerzuordnung nach § 146a AO.
 *
 * Für den INHABER SELBST gibt es dieses Tor nicht. Er müsste sich anmelden,
 * um sich zurückzusetzen. Vergisst er seinen Code, kommt NIEMAND mehr in die
 * Kasse — auch kein zweiter Mitarbeiter mit Verwalterrechten. Der Weg zurück
 * führte über die Datenbank, also über einen Techniker.
 *
 * ── DIE ABWÄGUNG, DIE DIESEN BAU FORMT ─────────────────────────────────────
 *
 * ⚠️ Ein Notfallschlüssel ist ein ZWEITES Geheimnis, das die Kasse öffnet. Wo
 * so etwas in der Praxis landet — ein Zettel neben der Kasse —, schwächt es
 * genau die Bedienerzuordnung, die der jetzige Bau so sorgfältig schützt.
 *
 * Deshalb ist er bewusst SCHWÄCHER gebaut als ein Kassencode:
 *
 *   1. ER MELDET NICHT AN. Er erlaubt nur, einen NEUEN Kassencode zu setzen.
 *      Wer ihn findet, kann damit nichts buchen — er muss erst einen Code
 *      setzen, und das ist ein sichtbarer, protokollierter Vorgang.
 *   2. ER GILT EINMAL. Nach Gebrauch ist er verbraucht; die Kasse gibt einen
 *      neuen aus, wieder genau einmal sichtbar.
 *   3. ER SCHREIBT INS TAGEBUCH. Ein Missbrauch fällt beim nächsten Blick auf
 *      die Aufsicht auf, statt unbemerkt zu bleiben.
 *   4. ER WIRD NIE GESPEICHERT, nur sein Abdruck (argon2id, derselbe Weg wie
 *      beim Kassencode).
 *
 * ── DIE FORM ───────────────────────────────────────────────────────────────
 *
 *     NORNS-4K7M-9PQR-2XYZ
 *
 * Vier Gruppen zu vier Zeichen, mit Bindestrichen — so schreibt man ihn ab,
 * ohne sich zu verzählen. Ohne die verwechselbaren Zeichen (I/1, O/0), denn
 * er wird von Hand notiert und später von Hand eingetippt.
 */

import { hashPin, verifyPin } from './index.js';

/**
 * Die Zeichen, aus denen ein Schlüssel besteht.
 *
 * ⚠️ Ohne `I`, `O`, `0`, `1`. Ein Schlüssel, den ein Mensch auf Papier notiert
 * und Monate später abtippt, darf keine zwei Zeichen enthalten, die in
 * Handschrift gleich aussehen.
 */
const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Wie viele Gruppen, und wie lang jede. */
const GRUPPEN = 4;
const JE_GRUPPE = 4;

/** Das Vorwort, damit man den Zettel wiedererkennt. */
const VORWORT = 'NORNS';

/**
 * Wie viel Rateaufwand darin steckt.
 *
 * 32 Zeichen an 16 Stellen sind 32^16, also 80 Bit. Zum Vergleich: der
 * sechsstellige Kassencode hat eine Million Möglichkeiten (rund 20 Bit) und
 * wird durch die Sperre nach zehn Fehlversuchen geschützt. Der Schlüssel
 * braucht diese Sperre also nicht, um sicher zu sein — er bekommt sie
 * trotzdem, weil eine Kasse einem Menschen gegenübersteht und nicht einem
 * Rechenzentrum.
 */
export const SCHLUESSEL_BITS = Math.round((GRUPPEN * JE_GRUPPE * Math.log2(ZEICHEN.length)));

/** Ein frischer Notfallschlüssel im Klartext. */
export function erzeugeNotfallschluessel(zufall: () => number = Math.random): string {
  const gruppen: string[] = [];
  for (let g = 0; g < GRUPPEN; g++) {
    let teil = '';
    for (let i = 0; i < JE_GRUPPE; i++) {
      teil += ZEICHEN[Math.floor(zufall() * ZEICHEN.length)];
    }
    gruppen.push(teil);
  }
  return `${VORWORT}-${gruppen.join('-')}`;
}

/**
 * Einen eingetippten Schlüssel auf seine Grundform bringen.
 *
 * ⚠️ Wer einen Schlüssel vom Zettel abtippt, macht das mit Kleinbuchstaben,
 * ohne Bindestriche, mit einem Leerzeichen zu viel. Eine Kasse, die ihn
 * deshalb ablehnt, ist die Kasse, die den Händler aussperrt — und genau das
 * soll dieser Schlüssel ja verhindern.
 */
export function normiereSchluessel(eingabe: string): string {
  const roh = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, '');
  /*
   * ⚠️ Das VORWORT fällt weg, und das ist kein Schönheitsgriff: es gehört
   * nicht zum Geheimnis, es steht auf jedem Zettel gleich. Bliebe es drin,
   * ergäben „NORNS-4K7M-…" und „4K7M-…" zwei verschiedene Abdrücke — und wer
   * den Schlüssel ohne Vorwort abtippt, käme nicht in seine eigene Kasse.
   *
   * Meine eigene Probe hat das gefangen.
   */
  return roh.startsWith(VORWORT) ? roh.slice(VORWORT.length) : roh;
}

/** Sieht das überhaupt wie ein Schlüssel aus? */
export function schluesselFormStimmt(eingabe: string): boolean {
  const kern = normiereSchluessel(eingabe);
  if (kern.length !== GRUPPEN * JE_GRUPPE) return false;
  return [...kern].every((z) => ZEICHEN.includes(z));
}

/** Den Abdruck bilden, der gespeichert wird. Der Klartext niemals. */
export function schluesselAbdruck(schluessel: string): Promise<string> {
  return hashPin(normiereSchluessel(schluessel));
}

/** Passt der eingetippte Schlüssel zum gespeicherten Abdruck? */
export function schluesselStimmt(eingabe: string, abdruck: string): Promise<boolean> {
  return verifyPin(normiereSchluessel(eingabe), abdruck);
}

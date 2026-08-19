/**
 * § 146a AO an EINER Stelle, für alle Wege in die fiskalische Tabelle.
 *
 * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────────
 *
 * Es gibt SECHS Wege, die eine Zeile in `transactions` schreiben. Genau EINER
 * prüfte, ob überhaupt eine technische Sicherungseinrichtung eingerichtet ist:
 * `transactions-finalize.ts`. Die anderen fünf gingen ungeprüft durch.
 *
 * Am Tresen hiess das: der Händler liest an der Verkaufsmaske, seine Kasse
 * erfülle § 146a AO nicht und ein Verkauf sei nicht möglich. Eine Minute
 * später kauft er für 5.000 Euro Gold an, und nichts wird rot. Bei einer
 * Kassennachschau steht ein halbes Geschäftsjahr Ankäufe ohne Signatur da,
 * während das Haus glaubt, der Riegel habe gehalten.
 *
 * Das ist die Klasse „Vordertür zu, Hintertür offen", und sie kam hier
 * zustande, weil der Riegel als Textblock IN einer Route stand statt als
 * Funktion, die jede Route ruft.
 *
 * ── WELCHER WEG SPERREN DARF, UND WELCHER NICHT ────────────────────────────
 *
 * ⚠️ Nicht jeder Weg darf anhalten. Ein Riegel am falschen Ort schadet mehr
 * als er nützt:
 *
 *   VERKAUF (finalize)      SPERRT. Ohne TSE darf nicht verkauft werden.
 *   ANKAUF                  SPERRT. Ein Ankauf ist ein aufzeichnungs- und
 *                           signaturpflichtiger Geschäftsvorfall wie ein
 *                           Verkauf. Es steht kein Kunde mit bezahltem Geld
 *                           da: der Händler kauft eben nicht, bis die TSE
 *                           steht.
 *   BEWERTUNG ANNEHMEN      SPERRT, aus demselben Grund. Sie erzeugt einen
 *                           Ankauf.
 *
 *   STORNO                  SPERRT NICHT. Eine Rückbuchung anzuhalten hielte
 *                           das Geld des Kunden fest. Der Vorgang wird
 *                           aufgezeichnet und der Ausfall dokumentiert
 *                           (§ 6 KassenSichV). ⚠️ 14.08.2026: hier stand
 *                           „wird nachsigniert" — das tut kein Code. Die
 *                           Warteschlange reicht nur Signaturen nach, die
 *                           die TSE bereits ANGENOMMEN hat; rückwirkend
 *                           signiert der Motor nicht.
 *   RÜCKGABE                SPERRT NICHT, gleiche Begründung.
 *   SHOP-WEBHOOK            SPERRT NICHT. Der Kunde hat bereits BEZAHLT. Ein
 *                           Abbruch hier nähme das Geld und schriebe keine
 *                           Bestellung; das wäre der schlimmere Zustand. Der
 *                           richtige Ort für diese Sperre ist die Kasse des
 *                           Shops VOR der Zahlung, nicht die Quittung danach.
 *
 * Diese Liste ist keine Meinung dieser Datei: der Wächter
 * `jeder-weg-in-die-fiskaltabelle.test.ts` hält sie gegen den Baum und wird
 * rot, sobald ein SIEBTER Weg entsteht, der weder ruft noch namentlich
 * begründet ausgenommen ist.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';

/** Der Einstellungsschlüssel, den `tse-einrichtung.ts` setzt. */
export const SCHLUESSEL_TSS_ID = 'tse.tss_id';

/** Ein Vorgang, der ohne Sicherungseinrichtung nicht signiert werden kann. */
export type VorgangOhneTse = 'Verkauf' | 'Ankauf';

/**
 * Der Satz, wenn KEINE Sicherungseinrichtung eingerichtet ist.
 *
 * ── DIE RUNDREISE DIESES SATZES, WEIL SIE ETWAS LEHRT ──────────────────────
 *
 * Er stand hier schon einmal und endete mit „Ein Verkauf ist bis dahin nicht
 * möglich." Am 13.08.2026 wurde er geloescht, weil Basels damalige Anweisung
 * eine Gnadenfrist von zehn Belegen einfuehrte und der Satz damit LOG.
 *
 * Am 15.08.2026 hat Basel die Gnadenfrist wieder gestrichen, nach der
 * Rechtspruefung: die Kasse wird nur noch mit fertig eingerichteter
 * Sicherungseinrichtung ausgeliefert, wer sie herunterlaedt hat bezahlt. Damit
 * ist der Satz wieder WAHR und kommt zurueck; `lib/belege-vor-der-tse.ts` ist
 * ersatzlos geloescht.
 *
 * Die Lehre, die hier bleiben soll: ein Satz ist nicht deshalb richtig, weil
 * er einmal richtig war. Er gehoert an dieselbe Stelle wie der Riegel, den er
 * beschreibt — darum wohnt er neben `istSicherungseinrichtungEingerichtet` und
 * nicht in einer eigenen Datei, die eigene Wege gehen kann.
 */
export function satzOhneSicherungseinrichtung(vorgang: VorgangOhneTse): string {
  return (
    'Es ist keine technische Sicherheitseinrichtung eingerichtet. ' +
    `Ein ${vorgang} ist deshalb nicht möglich, denn § 146a AO verlangt für ` +
    'jeden Beleg eine Signatur. ' +
    'Die Sicherungseinrichtung wird unter Einstellungen, Geräte eingetragen; ' +
    'nötig sind die Kennung der Sicherungseinrichtung und die Kennung dieser ' +
    'Kasse, beide vom Anbieter der TSE.'
  );
}

/**
 * Ist überhaupt je eine Sicherungseinrichtung eingerichtet worden?
 *
 * ⚠️ Geprüft wird AUSDRÜCKLICH NUR das. Ob sie GERADE erreichbar ist, wird
 * hier nicht geprüft: Norns POS arbeitet ohne Netz, der einzige gebaute
 * TSE-Weg ist ein Wolken-Weg, und damit ist der Ausfall der Regelfall. Ein
 * Riegel, der auch den Ausfall sperrt, hielte den Laden an, sobald das Netz
 * wackelt. Für den Ausfall gibt es § 6 KassenSichV: kennzeichnen, nachholen,
 * nachweisen. Die Warteschlange auf Platte ist dafür gebaut.
 */
export async function istSicherungseinrichtungEingerichtet(db: AppDb): Promise<boolean> {
  const zeilen = await db.execute<{ wert: string | null }>(drizzleSql`
    SELECT value #>> '{}' AS wert FROM system_settings
     WHERE key = ${SCHLUESSEL_TSS_ID}`);
  return (zeilen[0]?.wert ?? '').trim() !== '';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE STELLENKENNUNG — ein Code, der den ORT nennt, nicht nur die Art
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 09.08.2026 ────────────────────────────────────────────
 *
 * Gemessen in `apps/api-cloud/src`:
 *
 *     194 Fehlerklassen erben von `DomainError`
 *      20 Codes gibt es am Draht
 *     139 der 194 fallen auf DREI davon zusammen:
 *           50 × CONFLICT      46 × NOT_FOUND      43 × VALIDATION_ERROR
 *
 * Ein Code benennt also die ART, nie die STELLE. `BargeldOhneSchichtError`
 * heisst am Draht schlicht CONFLICT — wie neunundvierzig andere.
 *
 * Der Händler ruft an und sagt „es kam ein Konflikt". Damit ist niemandem
 * geholfen: es gibt fünfzig davon.
 *
 * ── DIE LÖSUNG, UND WARUM SIE KEINE LISTE IST ────────────────────────────
 *
 * Die naheliegende Antwort wäre eine Tabelle: Fehlerklasse → Nummer. Das
 * wäre im Haus die Klasse „Wächter mit Namensliste wird blind": eine neue
 * Klasse ohne Eintrag bekäme still keine Kennung, und niemandem fiele es auf.
 *
 * Stattdessen wird die Kennung ABGELEITET, aus dem Klassennamen, den
 * `DomainError` ohnehin in `this.name` festhält. Damit kann sie nicht
 * fehlen und nicht veralten:
 *
 *     BargeldOhneSchichtError   →   NORNS-BARGELD-OHNE-SCHICHT
 *     KycRequiredError          →   NORNS-KYC-REQUIRED
 *     ZNummerFehltError         →   NORNS-Z-NUMMER-FEHLT
 *
 * Wer die Kennung liest, kann sie im Quelltext suchen und landet auf der
 * einen Stelle, an der sie geworfen wird.
 *
 * ── ⚠️ EINE MESSUNG, DIE DAS GANZE TRÄGT ────────────────────────────────
 *
 * Der Weg hängt daran, dass der Klassenname das Bündeln überlebt. Gemessen
 * am AUSGELIEFERTEN `resources/sidecar/start.mjs`: `KycRequiredError` fünf
 * Treffer, `DomainError` 189. Die Namen stehen also drin, das Bündel wird
 * nicht verkleinert. Ein Wächter hält das fest — ein `minify` im Fliessband
 * würde sonst jede Kennung still zu Unsinn machen.
 */

/** Der Vorsatz. Damit ist die Kennung im Quelltext eindeutig auffindbar. */
export const KENNUNG_VORSATZ = 'NORNS';

/**
 * Aus einem Klassennamen die Stellenkennung bauen.
 *
 * Rein und ohne Tabelle: was hier hereinkommt, bekommt eine Kennung.
 */
export function stellenkennung(klassenname: string): string {
  const roh = klassenname.trim();
  if (roh === '') return `${KENNUNG_VORSATZ}-UNBEKANNT`;

  // Das angehängte „Error" trägt nichts bei — jede Klasse hier ist ein Fehler.
  const ohneError = roh.replace(/Error$/, '');
  if (ohneError === '') return `${KENNUNG_VORSATZ}-UNBEKANNT`;

  /**
   * An den Grossbuchstaben trennen, aber Abkürzungen zusammenhalten:
   * `ZNummerFehlt` wird `Z` + `Nummer` + `Fehlt`, nicht `ZNummer`.
   * `USTIdFehlt` wird `UST` + `Id` + `Fehlt`.
   */
  const teile = ohneError
    .replace(/([A-ZÄÖÜ]+)([A-ZÄÖÜ][a-zäöüß])/g, '$1 $2')
    .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter((t) => t !== '');

  if (teile.length === 0) return `${KENNUNG_VORSATZ}-UNBEKANNT`;

  // ⚠️ `toUpperCase` auf Deutsch: aus „ß" wird „SS", und das ist richtig.
  // Umlaute bleiben Umlaute — eine Kennung, die der Händler am Telefon
  // vorliest, soll aussehen wie das Wort, das er kennt.
  return `${KENNUNG_VORSATZ}-${teile.map((t) => t.toLocaleUpperCase('de-DE')).join('-')}`;
}

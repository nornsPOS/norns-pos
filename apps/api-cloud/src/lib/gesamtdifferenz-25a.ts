/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  § 25a Abs. 4 UStG — DIE GESAMTDIFFERENZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Einzeldifferenz rechnet Stück für Stück: Verkaufspreis minus
 * Einkaufspreis, davon 19/119. Sie ist gebaut (`cart-math.ts:160`) und richtig.
 *
 * **Sie ist aber nicht die Hälfte, die dieser Händler braucht.**
 *
 * Auf der Produktion gemessen: von 115 Stücken mit hinterlegtem Einkaufspreis
 * liegen **105 unter 750 EUR** — **91 Prozent**. Ein Briefmarken- und
 * Münzenhändler kauft Konvolute und Kleinposten; für die erlaubt § 25a Abs. 4
 * die Gesamtdifferenz.
 *
 * ── Was die Gesamtdifferenz ist ──────────────────────────────────────────
 *
 * Statt je Gegenstand wird je BESTEUERUNGSZEITRAUM gerechnet:
 *
 *     Gesamtdifferenz = Σ Verkaufserlöse − Σ Einkaufspreise   (im Zeitraum)
 *     Steuer          = Gesamtdifferenz × 19/119
 *
 * Beide Summen umfassen NUR Gegenstände, deren Einkaufspreis 750 EUR nicht
 * übersteigt. Der Vorteil ist nicht die Bequemlichkeit: bei einem Konvolut ist
 * der Einkaufspreis je Einzelstück oft gar nicht bestimmbar, und die
 * Einzeldifferenz wäre dann eine erfundene Zahl.
 *
 * ── Die drei Regeln, die man leicht verletzt ─────────────────────────────
 *
 * **1. Eine negative Gesamtdifferenz ergibt KEINE negative Steuer.**
 * Wie bei der Einzeldifferenz: sie wird null. Der Verlust mindert die Steuer
 * anderer Zeiträume nicht (Abschn. 25a.1 Abs. 13 Satz 5 UStAE; 19.08.2026
 * berichtigt, vorher stand hier Abs. 12 — derselbe Absatz war für zwei
 * verschiedene Regeln zitiert).
 *
 * **2. Derselbe Gegenstand darf NICHT in beiden Strömen auftauchen.**
 * Wer ein Stück in der Einzeldifferenz abrechnet und dessen Einkauf auch in
 * die Gesamtdifferenz einrechnet, zieht ihn zweimal ab. Das ist keine
 * Schludrigkeit, sondern eine Steuerverkürzung — und sie ist beim ersten
 * Nachrechnen sichtbar.
 *
 * **3. Die 750-EUR-Grenze gilt für den EINKAUFSPREIS, nicht den Verkaufspreis.**
 * Ein für 400 EUR gekauftes und für 2.000 EUR verkauftes Stück gehört in die
 * Gesamtdifferenz. Andersherum nicht.
 *
 * ── Was diese Datei NICHT tut ────────────────────────────────────────────
 *
 * Sie entscheidet nicht, welcher Gegenstand in welchen Strom gehört — das ist
 * die Wahl des Händlers je Wirtschaftsjahr und gehört in die Einstellungen.
 * Sie rechnet und sie WEIST NACH, und sie verweigert, wenn die Voraussetzungen
 * nicht stimmen.
 */

/** Die Grenze aus § 25a Abs. 4 Satz 1 UStG, in Cent. */
export const GRENZE_EINKAUFSPREIS_CENT = 75_000n;

import { bruttoBruch, satzAm } from '@norns/domain';

export interface Posten {
  /** Kennung des Gegenstands — für den Riegel gegen Doppelerfassung. */
  produktId: string;
  /** Einkaufspreis in Cent. Entscheidet über die 750-EUR-Grenze. */
  einkaufCent: bigint;
  /**
   * Verkaufserlös in Cent. `null`, solange der Gegenstand noch im Bestand ist.
   *
   * ⚠️ Der Einkauf zählt im Zeitraum des EINKAUFS, der Erlös im Zeitraum des
   * VERKAUFS. Ein Stück, das im Quartal gekauft und nicht verkauft wurde,
   * mindert die Gesamtdifferenz dieses Quartals trotzdem — genau dafür ist sie
   * da.
   */
  erloesCent: bigint | null;
  /** Wurde dieser Gegenstand EINZELN differenzbesteuert? Dann gehört er hier nicht her. */
  einzeldifferenzGenutzt: boolean;
}

export interface Befund {
  produktId: string;
  grund: string;
}

export interface Gesamtdifferenz {
  /** Summe der Erlöse der berücksichtigten Gegenstände, in Cent. */
  erloeseCent: bigint;
  /** Summe der Einkaufspreise, in Cent. */
  einkaeufeCent: bigint;
  /** Erlöse minus Einkäufe. Kann negativ sein — die Steuer wird es nicht. */
  differenzCent: bigint;
  /** 19/119 der Differenz, nie negativ. */
  steuerCent: bigint;
  /** Wie viele Gegenstände eingerechnet wurden. Für den Nachweis. */
  anzahl: number;
  /** Was ausgeschlossen wurde und warum. Gehört in den Nachweis, nicht in den Papierkorb. */
  ausgeschlossen: Befund[];
}

/**
 * Kaufmännisch runden mit Bankiersrundung, wie `cart-math.ts` es tut.
 *
 * Bewusst dieselbe Regel: zwei Rundungsarten im selben System erzeugen
 * Differenzen von einem Cent, die niemand mehr zuordnen kann.
 */
function rundeHalfEven(zaehler: bigint, nenner: bigint): bigint {
  const negativ = zaehler < 0n;
  const z = negativ ? -zaehler : zaehler;
  const ganz = z / nenner;
  const rest = z % nenner;
  const doppelt = rest * 2n;
  let auf = false;
  if (doppelt > nenner) auf = true;
  else if (doppelt === nenner) auf = ganz % 2n === 1n; // zur GERADEN Zahl
  const ergebnis = auf ? ganz + 1n : ganz;
  return negativ ? -ergebnis : ergebnis;
}

/**
 * Rechnet die Gesamtdifferenz eines Zeitraums.
 *
 * Rein: keine Uhr, kein Netz, keine Datenbank. Der Aufrufer bestimmt den
 * Zeitraum und liefert die Posten.
 */
export function berechneGesamtdifferenz(
  posten: readonly Posten[],
  zeitraum: { von: string; bis: string },
): Gesamtdifferenz {
  const ausgeschlossen: Befund[] = [];
  let erloese = 0n;
  let einkaeufe = 0n;
  let anzahl = 0;

  const gesehen = new Set<string>();

  for (const p of posten) {
    // ── Regel 2: kein Gegenstand in beiden Strömen ────────────────────────
    if (p.einzeldifferenzGenutzt) {
      ausgeschlossen.push({
        produktId: p.produktId,
        grund: 'bereits einzeldifferenzbesteuert, eine zweite Berücksichtigung wäre ein doppelter Abzug',
      });
      continue;
    }

    // ⚠️ Und kein Gegenstand ZWEIMAL in derselben Rechnung. Das klingt
    // selbstverständlich, ist es aber nicht: eine Abfrage mit einem
    // unglücklichen JOIN liefert Zeilen doppelt, und die Summe wäre still
    // falsch.
    if (gesehen.has(p.produktId)) {
      ausgeschlossen.push({ produktId: p.produktId, grund: 'doppelt in der Eingabe' });
      continue;
    }
    gesehen.add(p.produktId);

    // ── Regel 3: die Grenze gilt für den EINKAUFSPREIS ────────────────────
    if (p.einkaufCent > GRENZE_EINKAUFSPREIS_CENT) {
      ausgeschlossen.push({
        produktId: p.produktId,
        grund: `Einkaufspreis über 750 EUR, gehört in die Einzeldifferenz (§ 25a Abs. 4 Satz 1)`,
      });
      continue;
    }

    if (p.einkaufCent < 0n) {
      ausgeschlossen.push({ produktId: p.produktId, grund: 'negativer Einkaufspreis' });
      continue;
    }

    einkaeufe += p.einkaufCent;
    if (p.erloesCent !== null) erloese += p.erloesCent;
    anzahl += 1;
  }

  const differenz = erloese - einkaeufe;

  /*
   * ── DER SATZ GEHÖRT DEM ZEITRAUM (20.08.2026) ─────────────────────────
   *
   * Hier stand `19n/119n` fest. Die Gesamtdifferenz rechnet aber über einen
   * BESTEUERUNGSZEITRAUM, also über Vergangenes — und § 25a besteuert die
   * Marge mit dem Regelsatz. Im Corona-Halbjahr 2020 waren das 16 Prozent.
   *
   * ⚠️ Und wenn der Zeitraum eine Satzänderung ÜBERSPANNT, gibt es keine
   * einzelne richtige Zahl. Dann wird nicht die eine oder die andere
   * gewählt, sondern abgebrochen: der Zeitraum gehört geteilt. Eine still
   * gewählte Zahl wäre hier der Fehler, den am Beleg niemand mehr sieht.
   */
  const satzVon = satzAm('REGEL', zeitraum.von);
  const satzBis = satzAm('REGEL', zeitraum.bis);
  if (satzVon !== satzBis) {
    throw new Error(
      `Der Zeitraum ${zeitraum.von} bis ${zeitraum.bis} überspannt eine Änderung des ` +
        `Umsatzsteuersatzes (${satzVon} → ${satzBis}). Die Gesamtdifferenz nach § 25a ` +
        'Abs. 4 UStG braucht je Satz einen eigenen Zeitraum.',
    );
  }

  // ── Regel 1: eine negative Differenz ergibt keine negative Steuer ───────
  const { zaehler, nenner } = bruttoBruch(satzVon);
  const steuer = differenz > 0n ? rundeHalfEven(differenz * zaehler, nenner) : 0n;

  return { erloeseCent: erloese, einkaeufeCent: einkaeufe, differenzCent: differenz, steuerCent: steuer, anzahl, ausgeschlossen };
}

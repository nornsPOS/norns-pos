/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  rueckweg — wohin „zurück" führt, und wie es heisst
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (Basel, auf seinem Schirm) ───────────────────
 *
 * „Beim Betreten der Einstellungen fehlt der Zurück-Knopf, besonders von den
 * Symbolen unten."
 *
 * Er hat recht, und es ist schlimmer als es klingt. Die acht Karteireiter
 * oben führen NUR auf die acht Hauptflächen. Die vierzehn sekundären Flächen
 * (Steuer-Export, Konfliktpostfach, Inventur …) stehen in keinem Reiter. Wer
 * eine davon betritt, sieht oben eine Zeile mit ihrem Namen — und sonst
 * nichts, was zurückführt. Der einzige Ausweg war, irgendeinen der acht
 * Reiter zu drücken und damit woanders zu landen als dort, wo man herkam.
 *
 * ── WARUM NICHT EINFACH `navigate(-1)` ─────────────────────────────────────
 *
 * Weil ein Knopf, der manchmal nichts tut, schlimmer ist als keiner. Die
 * Kasse öffnet Flächen auch aus der Startliste, aus Cmd+K und aus Meldungen
 * heraus; nach einem Neustart auf einer tiefen Adresse gibt es überhaupt
 * keine Geschichte, und der Browserschritt zurück führte aus der Anwendung
 * heraus. Der Weg zurück wird deshalb BENANNT: er sagt, wohin er führt, und
 * er führt wirklich dorthin.
 *
 * ── DIE REGEL, IN DIESER REIHENFOLGE ───────────────────────────────────────
 *
 *   1. Auf einer der acht Hauptflächen gibt es keinen Rückweg. Die Reiter
 *      SIND der Weg; ein zweiter daneben wäre eine Tür zu viel.
 *   2. Kam der Mensch von einer anderen Fläche, führt der Weg dorthin
 *      zurück — mit ihrem Namen darauf. Das ist der Normalfall: er ist über
 *      die Einstellungen hereingekommen und will dorthin zurück.
 *   3. Sonst führt er in die GRUPPE, zu der diese Fläche gehört. Jede
 *      sekundäre Fläche wohnt in genau einer; das ist die Tür, durch die sie
 *      überhaupt erreichbar ist.
 *   4. Und sonst auf die Heimfläche. Sie gibt es immer, sie heisst im Knopf
 *      wie in der Schiene, und der Weg führt wirklich dorthin — das ist die
 *      Bedingung, nicht die Herkunft.
 *
 * ⚠️ Regel 3 überspringt eine Gruppe, deren Tür die Fläche SELBST ist: die
 * Einstellungen sind die Tür aller Gruppen, ein Knopf von dort auf sich
 * selbst täte nichts. Der Wächter `jede-flaeche-hat-einen-rueckweg` hat
 * genau diesen Fall gefunden, bevor ihn ein Mensch sehen musste.
 */

import { GRUPPEN_HEIMAT } from '../../screens/secondary/gruppen.js';
import { HOME_PATH, PRIMARY_SURFACES, findSurfaceByPath } from './surface-registry.js';

/**
 * Wo der Mensch war, und wo er davor war.
 *
 * ── DER FEHLER, DEN DIE NACHPRÜFUNG GEFUNDEN HAT (20.08.2026) ──────────────
 *
 * Die erste Fassung merkte sich den Vorgänger in einem `useRef`, das im
 * AUFRÄUMEN eines Effekts beschrieben wurde. React räumt aber erst NACH dem
 * Rendern der neuen Fläche auf. Beim ersten Bild der neuen Fläche stand im
 * Halter also noch der Pfad von VORVORHIN, und der Rückweg fiel auf die
 * Heimfläche zurück.
 *
 * Gemessen an der laufenden Kasse: von „Lager" nach „Dokumente" sagte der
 * Knopf „Zurück zu Werkstatt". Meine erste Probe hatte das NICHT gefangen,
 * weil ich von der Werkstatt aus geprüft hatte — und die Heimfläche IST die
 * Werkstatt. Die falsche Antwort sah aus wie die richtige.
 *
 * Deshalb steht die Regel jetzt als reine Funktion da: sie lässt sich ohne
 * React durchspielen, und der Wächter spielt genau diese Folge durch.
 */
export interface Wegstand {
  /** Die Adresse, auf der er steht. */
  letzter: string | null;
  /** Die Adresse davor. */
  vorher: string | null;
}

/**
 * Den Weg fortschreiben.
 *
 * ⚠️ Idempotent: derselbe Pfad zweimal hintereinander ändert nichts. React
 * rendert im Prüfmodus doppelt, und ein zweiter Durchlauf darf den Vorgänger
 * nicht wegwerfen.
 */
export function schreibeWegFort(stand: Wegstand, pfad: string): Wegstand {
  if (stand.letzter === pfad) return stand;
  return { letzter: pfad, vorher: stand.letzter };
}

/** Ein benannter Weg zurück. */
export interface Rueckweg {
  /** Wohin er führt. */
  pfad: string;
  /** Wie er heisst — der Name der Fläche, nicht das Wort „zurück". */
  label: string;
}

/** Wahr, wenn diese Adresse eine der acht Hauptflächen ist. */
function istHauptflaeche(pfad: string): boolean {
  return PRIMARY_SURFACES.some((s) => pfad === s.path || pfad.startsWith(`${s.path}/`));
}

/**
 * Wohin „zurück" von hier führt.
 *
 * @param pfad          Die Adresse, auf der der Mensch gerade steht.
 * @param vorherigerPfad Die Adresse davor, oder `null` nach einem Neustart.
 */
export function rueckwegFuer(pfad: string, vorherigerPfad: string | null): Rueckweg | null {
  // 1. Hauptflächen tragen ihren Weg in der Schiene.
  if (istHauptflaeche(pfad)) return null;

  // 2. Der Weg, den er gekommen ist — aber nur, wenn es eine ANDERE Fläche
  //    ist. Ein Knopf, der auf die eigene Adresse zeigt, tut nichts.
  if (vorherigerPfad !== null && vorherigerPfad !== pfad) {
    const woher = findSurfaceByPath(vorherigerPfad);
    /*
     * ⚠️ 20.08.2026, am Schirm gesehen: eine WEICHE ist kein Herkunftsort.
     *
     * Seit die vier Aufsichtsflächen unter einer Tür stehen, leitet
     * `/tagebuch` sofort nach `/leitstand?bereich=tagebuch` weiter. Wer die
     * alte Adresse aufruft, hatte damit „Tagebuch" als vorherige Fläche —
     * und der Knopf zurück führte auf die Weiche, die ihn postwendend
     * wieder hierher schickte. Eine Schleife, aus der man nicht herauskommt.
     */
    if (woher && woher.weicheAuf === undefined) {
      return { pfad: woher.path, label: woher.label };
    }
  }

  // 3. Die Gruppe, in der diese Fläche wohnt — sofern ihre Tür nicht diese
  //    Fläche selbst ist.
  const heimat = GRUPPEN_HEIMAT.get(pfad);
  if (heimat !== undefined && heimat !== pfad) {
    const flaeche = findSurfaceByPath(heimat);
    if (flaeche) return { pfad: flaeche.path, label: flaeche.label };
  }

  // 4. Die Heimfläche. Sie gibt es immer.
  const heim = findSurfaceByPath(HOME_PATH);
  return heim ? { pfad: heim.path, label: heim.label } : null;
}

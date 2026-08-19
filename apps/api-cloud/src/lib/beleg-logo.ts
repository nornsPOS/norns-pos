/**
 * Die SVG-Waesche fuer das Beleg-Logo des Haendlers (Dekret 26.07.2026).
 *
 * SVG IST EIN ANGRIFFSWEG: ein SVG ist ein XML-Dokument, das Script tragen,
 * auf fremde Server zeigen und ueber `foreignObject` beliebiges HTML
 * einbetten kann. Das Logo wird spaeter in der Kassen-Oberflaeche angezeigt
 * und auf dem Server gerastert — gespeichert wird deshalb NIE das rohe
 * Hochgeladene, sondern ausschliesslich das Ergebnis dieser Waesche.
 *
 * Entfernt wird, BEVOR irgendetwas gespeichert wird:
 *   • `<script>`-Elemente (samt Inhalt),
 *   • `<foreignObject>`-Elemente (samt Inhalt),
 *   • jedes Ereignis-Attribut (`on…=`),
 *   • jeder `href`/`xlink:href`, der nicht auf ein internes Fragment (`#…`)
 *     oder ein eingebettetes Bild (`data:image/…`) zeigt,
 *   • `url(…)`-Verweise auf fremde Quellen in Stilen,
 *   • Kommentare und die DOCTYPE-Zeile (dort verstecken sich Entities).
 *
 * Ein Dokument mit `<!ENTITY` wird ganz abgelehnt (XXE-Weg), und ein SVG, in
 * dem nach der Waesche kein zeichnendes Element mehr steht, ebenfalls — mit
 * klarer Meldung statt eines leeren weissen Kastens auf jedem Bon.
 *
 * Bewusst textbasiert statt mit einem XML-Parser: die Waesche ist eine von
 * ZWEI Waenden. Die zweite ist der Rasterbeweis in der Route — was hier
 * durchkommt, muss sich anschliessend von sharp (librsvg) zeichnen lassen,
 * sonst wird es genauso abgelehnt.
 */

/** Die drei angenommenen Formate — 'svg' ist laut Dekret die praeziseste Form. */
export type BelegLogoFormat = 'svg' | 'png' | 'jpeg';

/** Obergrenze der gespeicherten Datei; dieselbe Zahl steht als CHECK in 0119. */
export const BELEG_LOGO_MAX_BYTES = 262_144;

/** Obergrenze der Kante eines Rasterbilds (px). */
export const BELEG_LOGO_MAX_KANTE_PX = 2_048;

export interface SvgWaescheErgebnis {
  /** null, wenn das Dokument abzulehnen ist — dann steht der Grund in `grund`. */
  sauber: string | null;
  /** Deutsch, fuer Meldung und Pruefprotokoll. */
  grund: string | null;
  /** Was entfernt wurde, fuer das Pruefprotokoll (leer bei sauberer Eingabe). */
  entfernt: string[];
}

/** Elemente, die ein SVG sichtbar machen — eines davon muss uebrig bleiben. */
const ZEICHNENDE_ELEMENTE =
  /<(path|rect|circle|ellipse|line|polyline|polygon|text|tspan|use|image|g)\b/i;

/**
 * Waescht ein SVG-Dokument. Gibt entweder das bereinigte Dokument zurueck
 * oder einen deutschen Ablehnungsgrund — nie beides.
 */
export function waescheSvg(quelle: string): SvgWaescheErgebnis {
  const entfernt: string[] = [];

  if (!/<svg[\s>]/i.test(quelle)) {
    return { sauber: null, grund: 'Die Datei ist kein SVG (kein <svg>-Wurzelelement).', entfernt };
  }
  // XXE: eigene Entities koennen Dateien des Servers einlesen. Es gibt keinen
  // ehrlichen Grund fuer ein Logo, Entities zu erklaeren — ablehnen.
  if (/<!ENTITY/i.test(quelle)) {
    return {
      sauber: null,
      grund: 'Das SVG erklaert eigene XML-Entities und wird deshalb abgelehnt.',
      entfernt,
    };
  }

  let s = quelle;

  // Kommentare und DOCTYPE zuerst: was in einem Kommentar steht, ist inert,
  // wuerde aber die Muster unten zu Fehlgriffen verleiten.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<!DOCTYPE[^>]*>/gi, '');

  // Script- und foreignObject-Elemente SAMT Inhalt.
  const vorScript = s;
  s = s
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<script\b[^>]*>/gi, '');
  if (s !== vorScript) entfernt.push('script-Element');

  const vorForeign = s;
  s = s
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*\/>/gi, '');
  if (s !== vorForeign) entfernt.push('foreignObject-Element');

  // Ereignis-Attribute: onload, onclick, onerror, …
  const vorEreignis = s;
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (s !== vorEreignis) entfernt.push('Ereignis-Attribut (on…)');

  // href/xlink:href: nur interne Fragmente (#id) und eingebettete Bilder
  // (data:image/…) bleiben. Alles andere — http(s), protokoll-relativ,
  // javascript:, fremde data:-Arten — faellt weg.
  const vorHref = s;
  s = s.replace(
    /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (ganz, a: string | undefined, b: string | undefined, c: string | undefined) => {
      const wert = (a ?? b ?? c ?? '').trim();
      if (wert.startsWith('#') || /^data:image\//i.test(wert)) return ganz;
      return '';
    },
  );
  if (s !== vorHref) entfernt.push('fremder href-Verweis');

  // url(…)-Verweise in Stilen (style-Attribut, <style>, fill="url(http…)"):
  // fremde Quellen werden auf `none` gelegt, interne Fragmente bleiben.
  const vorUrl = s;
  s = s.replace(/url\s*\(\s*(["']?)([^)"']*)\1\s*\)/gi, (ganz, _anf: string, ziel: string) => {
    const wert = ziel.trim();
    if (wert.startsWith('#') || /^data:image\//i.test(wert)) return ganz;
    return 'none';
  });
  if (s !== vorUrl) entfernt.push('fremder url()-Verweis');

  if (!ZEICHNENDE_ELEMENTE.test(s)) {
    return {
      sauber: null,
      grund:
        'Das SVG ist nach dem Entfernen unsicherer Teile leer, es enthaelt ' +
        'kein zeichnendes Element mehr und wuerde als weisser Kasten drucken. ' +
        'Bitte ein SVG ohne Script/Fremdverweise hochladen.',
      entfernt,
    };
  }

  return { sauber: s, grund: null, entfernt };
}

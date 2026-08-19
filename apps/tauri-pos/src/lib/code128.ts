/**
 * code128 — ein Strichcode für die Bestellnummer, ohne fremde Abhängigkeit.
 *
 * WOFÜR
 * Auf der Versandmarke und auf dem Regalzettel steht die Bestellnummer
 * (`BST-2026-000001`). Ein Mensch kann sie abtippen, ein Handscanner nicht.
 * Code 128 in der Zeichenmenge B kann genau das, was hier gebraucht wird:
 * Grossbuchstaben, Ziffern und den Bindestrich.
 *
 * WARUM SELBST GESCHRIEBEN
 * Der Code besteht aus 107 festen Strichmustern und einer Prüfsumme. Das ist
 * eine Tabelle und eine Schleife. Eine Abhängigkeit dafür ins Bündel zu holen,
 * die dann mitgepflegt und mitgeprüft werden müsste, wäre teurer als diese
 * Datei — und sie wäre eine weitere Stelle, an der bei einem Kassensystem
 * fremder Code läuft.
 *
 * WAS ES NICHT TUT
 * Es druckt nicht und es kennt kein HTML. Es liefert nur die Strichbreiten.
 * Wer daraus ein Bild macht, entscheidet die aufrufende Fläche.
 */

/**
 * Die 107 Muster von Code 128, je sechs Ziffern: Breite von Strich, Lücke,
 * Strich, Lücke, Strich, Lücke. Index 0 entspricht dem Wert 0 der Zeichenmenge.
 * Die letzte Zeile ist das Schlusszeichen und hat sieben Elemente.
 */
const MUSTER = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const;

/** Startzeichen der Zeichenmenge B. */
const START_B = 104;
/** Schlusszeichen; sein Muster steht als letztes in der Tabelle. */
const STOPP = 106;

/**
 * Die kleinste und die grösste Zeichennummer, die die Zeichenmenge B kann:
 * Leerzeichen (32) bis Tilde (126). Alles darunter oder darüber hat dort kein
 * Muster, und ein erfundener Ersatz würde einen Code ergeben, den ein Scanner
 * anstandslos liest — nur eben als etwas anderes.
 */
const KLEINSTES = 32;
const GROESSTES = 126;

export class Code128UnkodierbarError extends Error {
  constructor(public readonly zeichen: string) {
    super(
      `„${zeichen}" lässt sich in Code 128 B nicht darstellen. ` +
        'Erlaubt sind die druckbaren Zeichen von Leerzeichen bis Tilde.',
    );
    this.name = 'Code128UnkodierbarError';
  }
}

/**
 * Die Strichbreiten eines Textes, abwechselnd Strich und Lücke, beginnend mit
 * einem Strich. Die Werte sind Vielfache der schmalsten Einheit (1 bis 4).
 *
 * Wirft, wenn ein Zeichen nicht darstellbar ist. Bewusst: eine Marke mit einem
 * still verstümmelten Strichcode ist schlimmer als gar keine Marke, weil sie
 * am Scanner erst auffällt, wenn das Paket schon gepackt ist.
 */
export function code128BalkenBreiten(text: string): number[] {
  if (text.length === 0) {
    throw new Code128UnkodierbarError('');
  }

  const werte: number[] = [START_B];
  for (const zeichen of text) {
    const punkt = zeichen.codePointAt(0) ?? 0;
    if (punkt < KLEINSTES || punkt > GROESSTES) {
      throw new Code128UnkodierbarError(zeichen);
    }
    werte.push(punkt - KLEINSTES);
  }

  // Die Prüfsumme: Startwert plus jeder Nutzwert mal seiner Stellung, modulo
  // 103. Ohne sie weist jeder Scanner den Code zurück.
  let summe = START_B;
  for (let i = 1; i < werte.length; i += 1) {
    summe += werte[i]! * i;
  }
  werte.push(summe % 103);
  werte.push(STOPP);

  const breiten: number[] = [];
  for (const wert of werte) {
    for (const ziffer of MUSTER[wert]!) {
      breiten.push(Number(ziffer));
    }
  }
  return breiten;
}

/**
 * Derselbe Strichcode als SVG, damit ihn jede Druckansicht ohne Bilddatei
 * einbetten kann.
 *
 * `einheit` ist die Breite des schmalsten Strichs in Millimetern. Der Standard
 * 0,33 mm ergibt bei einer üblichen Bestellnummer eine Marke, die ein
 * Handscanner aus dreissig Zentimetern liest.
 */
export function code128Svg(
  text: string,
  { einheit = 0.33, hoeheMm = 14 }: { einheit?: number; hoeheMm?: number } = {},
): string {
  const breiten = code128BalkenBreiten(text);
  const gesamt = breiten.reduce((a, b) => a + b, 0) * einheit;

  let x = 0;
  const rechtecke: string[] = [];
  breiten.forEach((breite, i) => {
    const mm = breite * einheit;
    // Gerade Stellen sind Striche, ungerade sind Lücken.
    if (i % 2 === 0) {
      rechtecke.push(
        `<rect x="${x.toFixed(3)}" y="0" width="${mm.toFixed(3)}" height="${hoeheMm}" fill="#000"/>`,
      );
    }
    x += mm;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${gesamt.toFixed(3)}mm" ` +
    `height="${hoeheMm}mm" viewBox="0 0 ${gesamt.toFixed(3)} ${hoeheMm}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Strichcode ${text}">` +
    rechtecke.join('') +
    '</svg>'
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ EINE ZUSAMMENFASSUNG DARF KEINEN RIEGEL BEHAUPTEN, DEN ES NICHT GIBT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 22.08.2026, UND ICH BIN SELBST HINEINGELAUFEN ──────────
 *
 * Vier Wege führen an die KYC-Ausweisdokumente. Zwei tragen den Gerätecode
 * (die beiden LÖSCHwege), zwei nicht (Ablegen, Bild ansehen). Das ist
 * richtig so: Basels Entscheidung vom 05.08.2026, wörtlich „einmal beim
 * Öffnen, und ein zweites Mal nur bei Handlungen, die sich nicht widerrufen
 * lassen". Vorher stand der Code an 47 Endpunkten.
 *
 * Die TEXTE sagten etwas anderes. Drei Stellen behaupteten einen Riegel, den
 * es nicht gibt:
 *
 *   • der Kopf der Datei: „Both routes: … + requireStepUp" — geschrieben,
 *     als es zwei Wege gab,
 *   • die Zusammenfassung des Bildwegs: „ADMIN + step-up, never public",
 *   • die des Ablegewegs: „ADMIN-only + step-up REQUIRED",
 *   • und im Client der Vermerk „closes #I-47, step-up".
 *
 * ⚠️ DAS IST KEINE UNGENAUIGKEIT, SONDERN EINE FALLE. Ich habe am 22.08.
 * gemessen „zwei von vier Wegen ohne Step-Up", die Zusammenfassung gelesen,
 * die den Riegel verspricht — und ihn eingebaut. Erst
 * `code-nur-fuer-unwiderrufliches.guard` wurde rot und zeigte, dass ich
 * gerade eine ENTSCHEIDUNG des Händlers rückgängig machte, keinen Mangel.
 *
 * Ein Text, der einen strengeren Zustand behauptet als der Code, treibt den
 * nächsten Leser dazu, den Code „nachzuziehen". Er ist gefährlicher als gar
 * kein Text.
 *
 * ── WAS DIESE PROBE MISST ─────────────────────────────────────────────────
 *
 * Für jeden Weg dieser Datei: verspricht sein Text einen Step-Up, dann muss
 * sein Rumpf einen haben — und umgekehrt. Beide Richtungen, denn beide
 * Abweichungen sind schon vorgekommen.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WEGE = resolve(HIER, '../../src/routes/customer-kyc-documents.ts');

/** Kommentare weg: ein `requireStepUp` in einer Erklärung ist kein Riegel. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => `${davor} `);
}

interface Weg {
  readonly wort: string;
  readonly pfad: string;
  readonly zusage: string;
  readonly hatRiegel: boolean;
}

/** Jede Weganmeldung der Datei mit ihrer Zusammenfassung und ihrem Riegel. */
function wege(): Weg[] {
  const quelle = ohneKommentare(readFileSync(WEGE, 'utf8'));
  const stellen = [...quelle.matchAll(/app\.(get|post|put|patch|delete)\b/g)];
  return stellen.map((m, i) => {
    const rumpf = quelle.slice(m.index ?? 0, stellen[i + 1]?.index ?? quelle.length);
    return {
      wort: (m[1] ?? '').toUpperCase(),
      pfad: /'(\/api\/[^']+)'/.exec(rumpf)?.[1] ?? '(ohne Pfad)',
      // Die Zusammenfassung kann über mehrere Zeilen laufen; alles bis zum
      // schliessenden Apostroph gehört dazu.
      zusage: [...rumpf.matchAll(/summary:\s*([\s\S]*?),\n/g)].map((z) => z[1] ?? '').join(' '),
      hatRiegel: rumpf.includes('requireStepUp(req)'),
    };
  });
}

/** Nennt ein Text den Gerätecode? */
const NENNT_CODE = /step[- ]?up/i;

describe('⛔ Keine Zusage über den Gerätecode, die der Code nicht hält', () => {
  const gefunden = wege();

  it('findet überhaupt alle Wege', () => {
    // „null ist nicht grün".
    expect(gefunden.length, 'Der Sammler findet keine Wege.').toBeGreaterThanOrEqual(4);
    expect(
      gefunden.filter((w) => w.zusage.length > 0).length,
      'Kein einziger Weg trägt eine lesbare Zusammenfassung — dann prüft alles ' +
        'darunter nichts.',
    ).toBeGreaterThanOrEqual(4);
  });

  it.each(gefunden.map((w) => [`${w.wort} ${w.pfad}`, w] as const))(
    '⛔ %s: Zusage und Riegel sagen dasselbe',
    (_name, weg) => {
      const verspricht = NENNT_CODE.test(weg.zusage);
      expect(
        verspricht,
        verspricht
          ? `${weg.wort} ${weg.pfad} VERSPRICHT den Gerätecode, hat ihn aber nicht. Genau dieser Text hat mich am 22.08. dazu gebracht, ihn einzubauen — und damit Basels Entscheidung vom 05.08. rückgängig zu machen. Entweder der Riegel kommt (dann ist es eine unwiderrufliche Handlung und gehört in \`code-nur-fuer-unwiderrufliches\`), oder der Text sagt die Wahrheit.`
          : `${weg.wort} ${weg.pfad} HAT den Gerätecode, sagt es aber nicht. Wer die Zusammenfassung liest, hält den Weg für beiläufig.`,
      ).toBe(weg.hatRiegel);
    },
  );

  it('⛔ und jeder Weg bleibt der Ladenleitung vorbehalten', () => {
    const ohne = gefunden
      .filter((w) => !w.pfad.startsWith('(ohne'))
      .filter((_w) => !readFileSync(WEGE, 'utf8').includes("requireRole(req, 'ADMIN')"));
    expect(
      ohne.map((w) => w.pfad),
      'Ein KYC-Weg ohne ADMIN-Schranke.',
    ).toEqual([]);
  });
});

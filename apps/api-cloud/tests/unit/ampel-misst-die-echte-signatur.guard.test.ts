/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Fiskal-Ampel muss die Tabelle lesen, in die wirklich geschrieben wird
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Die Ampel zählte die unsignierten Belege so:
 *
 *     WHERE NOT EXISTS (SELECT 1 FROM tse_transactions x
 *                        WHERE x.transaction_id = t.id)
 *
 * `tse_transactions` steht im Bauplan, hat einen Auslöser und Rechte — und
 * **NIEMAND SCHREIBT JEMALS HINEIN.** Im ganzen Baum gibt es kein einziges
 * INSERT darauf. Die echte Signatur landet in `tse_signatures`
 * (`transactions-tse-signature.ts:157`), und genau die liest auch der
 * Tagesabschluss (`closings-finalize.ts:484`).
 *
 * ── ⚠️ DIE RICHTUNG WAR ANDERS ALS GEMELDET, UND DAS IST SCHLIMMER ─────
 *
 * Die Härteprüfung meldete „die Ampel meldet grün". Nachgemessen stimmt das
 * nicht: weil die Tabelle IMMER leer ist, ist `NOT EXISTS` immer wahr, und
 * die Ampel zählt JEDEN Beleg der letzten sieben Tage als unsigniert.
 *
 * Sie steht also dauerhaft auf ROT, auch wenn jeder Beleg sauber signiert
 * ist. Eine Lampe, die immer leuchtet, wird weggeschaut — und dann ist das
 * ECHTE Rot unsichtbar. Genau die Klasse „roter Wächter verdeckt seinen
 * echten Treffer".
 *
 * Nur ein Laden ohne einen einzigen Beleg in sieben Tagen sah grün. Der
 * gemeldete Fall existiert also, aber nur im leeren Laden.
 *
 * ── DIE REGEL ──────────────────────────────────────────────────────────
 *
 * Ampel und Tagesabschluss beantworten dieselbe Frage: welcher Beleg hat
 * keine Signatur? Sie MÜSSEN dieselbe Quelle lesen. Zwei Quellen für eine
 * Frage driften, und die eine war schon tot.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../..');

const lies = (p: string): string => readFileSync(join(WURZEL, p), 'utf8');

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⚠️ GEMESSEN WIRD DER GEBRAUCH, NICHT DIE ERWÄHNUNG. BEFUND VOM 13.08.2026.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Alle Sätze hier lasen den Quelltext MIT Kommentaren. Das geht in beide
 * Richtungen schief, und beide Richtungen waren echt:
 *
 * FALSCH GRÜN. `q.includes('tse_signatures')` ist erfüllt, sobald der Name
 * irgendwo steht. In `system-health.ts` steht er unter anderem in Zeile 190,
 * in einem KOMMENTAR. Jemand könnte die Abfrage auf die tote Tabelle
 * zurückdrehen und den erklärenden Kommentar stehen lassen: der Satz bliebe
 * grün.
 *
 * FALSCH ROT. `/FROM\s+tse_transactions/` darf nicht zutreffen. Dieses Haus
 * dokumentiert aber genau so, nämlich indem es die alte, falsche Abfrage
 * wörtlich zitiert. Gemessen stehen in `system-health.ts` heute DREI
 * Erwähnungen von `tse_transactions`, alle drei in Kommentaren (Zeilen 185,
 * 187, 190). Der Satz besteht bis heute nur deshalb, weil keiner dieser
 * Kommentare zufällig `FROM tse_transactions` schreibt. Wer den Befund
 * sorgfältiger aufschreibt, macht den Wächter rot, ohne den Code anzufassen.
 *
 * Ein Wächter, den gute Dokumentation rot macht, erzieht dazu, nichts
 * aufzuschreiben.
 *
 * ⚠️ Der Abstreifer ist bewusst grob: er kennt `//`, `/* … *\/` und das
 * SQL-`--`. Zeichenketten mit `--` darin würde er ebenfalls treffen. Das ist
 * hier zulässig, weil unten NACHGEMESSEN wird, was er auf den echten Dateien
 * wirklich tut, statt es anzunehmen.
 */
function ohneKommentare(quelle: string): string {
  return (
    quelle
      // Blockkommentare, auch mehrzeilige Kopfstücke.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // Zeilenkommentare in JS. `https://` ist ausgenommen, sonst
      // verschwände die halbe Zeile hinter jeder URL.
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      // SQL-Zeilenkommentare in den Schablonen.
      .replace(/--.*$/gm, '')
  );
}

describe('⛔ der Abstreifer selbst, an den echten Dateien gemessen', () => {
  it('entfernt die drei Kommentar-Erwähnungen aus system-health.ts', () => {
    const roh = lies('src/routes/system-health.ts');
    const rein = ohneKommentare(roh);

    // „null ist nicht grün": stünde der Name gar nicht mehr im Rohtext, wäre
    // die Zahl unten trivial gleich. Am 13.08.2026 waren es drei.
    const imRohtext = (roh.match(/tse_transactions/g) ?? []).length;
    expect(imRohtext, 'Es gibt keine Erwähnung mehr zu entfernen.').toBeGreaterThanOrEqual(1);

    expect(
      (rein.match(/tse_transactions/g) ?? []).length,
      'Nach dem Abstreifen steht `tse_transactions` immer noch im Text. Dann ' +
        'misst der Wächter weiterhin die Erwähnung, nicht den Gebrauch.',
    ).toBe(0);

    expect(
      rein,
      'Der Abstreifer hat die ECHTE Abfrage mitgenommen. Dann misst er nichts ' +
        'mehr, und alles darunter wäre trivial erfüllt.',
    ).toContain('tse_signatures');
  });
});

describe('Die Ampel liest die Tabelle, in die geschrieben wird', () => {
  it('⛔ sie zählt die unsignierten Belege über `tse_signatures`', () => {
    const q = ohneKommentare(lies('src/routes/system-health.ts'));
    expect(q, 'die Zählung fehlt').toContain('unsigniert');
    expect(
      /(?:FROM|JOIN)\s+tse_signatures/i.test(q),
      'Die Ampel liest nicht `tse_signatures` — also nicht die Tabelle, in ' +
        'die der Signaturweg schreibt. (Gemessen wird ein `FROM` oder `JOIN`, ' +
        'nicht die blosse Erwähnung des Namens: ein Kommentar ist kein ' +
        'Gebrauch. Der Tagesabschluss liest sie per LEFT JOIN, deshalb beides.)',
    ).toBe(true);
  });

  it('⛔ und NICHT mehr über `tse_transactions`, in das niemand schreibt', () => {
    const q = ohneKommentare(lies('src/routes/system-health.ts'));
    expect(
      /(?:FROM|JOIN)\s+tse_transactions/i.test(q),
      'Die Ampel misst wieder eine Tabelle, die kein Schreibweg je füllt.',
    ).toBe(false);
  });

  it('⚠️ und der Tagesabschluss beantwortet dieselbe Frage aus derselben Quelle', () => {
    // Zwei Quellen für eine Frage driften. Hier war die eine sogar tot,
    // während die andere stimmte — und beide sahen für sich plausibel aus.
    const abschluss = ohneKommentare(lies('src/routes/closings-finalize.ts'));
    expect(
      /(?:FROM|JOIN)\s+tse_signatures/i.test(abschluss),
      'Der Tagesabschluss holt die Signaturen nicht mehr aus `tse_signatures`.',
    ).toBe(true);
  });
});

describe('⛔ `tse_transactions` hat weiterhin KEINEN Schreibweg', () => {
  it('und solange das so ist, darf niemand daraus einen Zustand ableiten', () => {
    /**
     * Der eigentliche Grund des Befunds. Sollte jemand die Tabelle eines
     * Tages wirklich befüllen, ist dieser Satz rot — und dann gehört neu
     * entschieden, was sie bedeutet, statt sie stillschweigend wieder als
     * Wahrheit zu benutzen.
     */
    const schreibweise = /\.insert\(\s*tseTransactions\s*\)|INSERT\s+INTO\s+tse_transactions/i;
    const treffer: string[] = [];

    const durchsuche = (ordner: string): void => {
      for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) {
          durchsuche(pfad);
          continue;
        }
        if (!eintrag.name.endsWith('.ts')) continue;
        // Auch hier der Gebrauch, nicht die Erwähnung: ein Kommentar, der ein
        // `INSERT INTO tse_transactions` zitiert, um zu erklären, warum es
        // das NICHT gibt, wäre sonst der Beweis für sein Gegenteil.
        if (schreibweise.test(ohneKommentare(readFileSync(pfad, 'utf8')))) treffer.push(pfad);
      }
    };
    durchsuche(join(WURZEL, 'src'));

    expect(
      treffer,
      'Jemand schreibt jetzt nach `tse_transactions`. Dann ist neu zu ' +
        'entscheiden, was die Tabelle bedeutet — sie war bis zum 08.08.2026 ' +
        `leer und wurde trotzdem als Wahrheit gelesen:\n${treffer.join('\n')}`,
    ).toEqual([]);
  });
});

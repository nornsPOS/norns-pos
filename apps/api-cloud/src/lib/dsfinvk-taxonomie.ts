/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE AMTLICHE TAXONOMIE, GELESEN STATT ABGESCHRIEBEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die DSFinV-K liefert ihre eigene Beschreibung mit: `index.xml` aus dem
 * BZSt-Paket definiert alle 20 Tabellen mit Dateinamen, IDEA-Namen, Spalten,
 * Reihenfolge, Typ und Länge — maschinenlesbar.
 *
 * ── Warum diese Datei existiert ──────────────────────────────────────────
 *
 * `dsfinvk-export.test.ts` schrieb die erwarteten Dateinamen als Zeichenketten
 * in den Test selbst und verglich die Kopfzeilen mit denselben Bezeichnern,
 * die der Erzeuger schreibt. **Links und rechts stand dasselbe Wort, und beide
 * stammten aus derselben Feder.**
 *
 * 392 Zeilen Test, und keine einzige fragte eine FREMDE Stelle, ob es
 * `bon_kopf.csv` überhaupt gibt. Deshalb liefen neun frei erfundene
 * Dateinamen jahrelang grün durch: `bon_kopf.csv`, `bon_pos.csv`,
 * `bon_pos_preise.csv`, `bon_pos_ust.csv`, `bon_ust.csv` und Geschwister
 * kennt die Taxonomie nicht.
 *
 * Ein Wächter, dessen Erwartung vom Erzeuger stammt, kann bei genau diesem
 * Fehler nie rot werden. Also kommt die Erwartung ab jetzt aus dem amtlichen
 * Prüfstück, und diese Datei ist der Leser dafür.
 *
 * ⚠️ Sie nennt KEINEN Dateinamen und KEINEN Feldnamen selbst. Was sie
 * zurückgibt, steht so in `index.xml`.
 */

/** Eine Spalte, wie die Taxonomie sie beschreibt. */
export interface TaxonomieSpalte {
  name: string;
  beschreibung: string;
  /** `text` = AlphaNumeric, `zahl` = Numeric. */
  art: 'text' | 'zahl';
  /** Bei Text die Höchstlänge, bei Zahlen die Nachkommastellen. */
  laenge: number | null;
}

/** Eine Tabelle, wie die Taxonomie sie beschreibt. */
export interface TaxonomieTabelle {
  /** Der amtliche Dateiname, wörtlich. */
  datei: string;
  /** Der IDEA-Importname, z. B. `Bonpos_USt`. */
  ideaName: string;
  spalten: TaxonomieSpalte[];
  /** Trennzeichen und Kodierung, wie die Norm sie vorschreibt. */
  format: {
    spaltentrenner: string;
    zeilentrenner: string;
    texteinfassung: string;
    dezimalzeichen: string;
    tausenderzeichen: string;
    /** Ab welcher Zeile die Daten beginnen (2 = eine Kopfzeile). */
    datenAb: number;
  };
}

/** Ein Knoten aus der `index.xml`, so weit hier gebraucht. */
function inhalt(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m?.[1] ?? null;
}

function entschluessele(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/**
 * Die amtliche `index.xml` lesen.
 *
 * Absichtlich ein schlanker Leser statt einer XML-Bibliothek: die Datei ist
 * unveränderlich (Prüfsumme im Wächter), ihre Struktur ist flach, und eine
 * Abhängigkeit mehr im Fiskalpfad ist ein Risiko ohne Gegenwert.
 */
export function leseTaxonomie(indexXml: string): TaxonomieTabelle[] {
  const tabellen: TaxonomieTabelle[] = [];

  for (const roh of indexXml.split('<Table>').slice(1)) {
    const block = roh.split('</Table>')[0] ?? '';
    const datei = inhalt(block, 'URL')?.trim();
    const ideaName = inhalt(block, 'Name')?.trim();
    if (!datei || !ideaName) continue;

    const vl = inhalt(block, 'VariableLength') ?? '';
    const spalten: TaxonomieSpalte[] = [];

    for (const sRoh of vl.split('<VariableColumn>').slice(1)) {
      const s = sRoh.split('</VariableColumn>')[0] ?? '';
      const name = inhalt(s, 'Name')?.trim();
      if (!name) continue;
      const istZahl = s.includes('<Numeric>');
      const laengeRoh = istZahl ? inhalt(s, 'Accuracy') : inhalt(s, 'MaxLength');
      spalten.push({
        name,
        beschreibung: entschluessele(inhalt(s, 'Description')?.trim() ?? ''),
        art: istZahl ? 'zahl' : 'text',
        laenge: laengeRoh === null ? null : Number(laengeRoh.trim()),
      });
    }

    tabellen.push({
      datei,
      ideaName,
      spalten,
      format: {
        spaltentrenner: entschluessele(inhalt(vl, 'ColumnDelimiter') ?? ';'),
        zeilentrenner: entschluessele(inhalt(vl, 'RecordDelimiter') ?? '\r\n'),
        texteinfassung: entschluessele(inhalt(vl, 'TextEncapsulator') ?? '"'),
        dezimalzeichen: entschluessele(inhalt(block, 'DecimalSymbol') ?? ','),
        tausenderzeichen: entschluessele(inhalt(block, 'DigitGroupingSymbol') ?? '.'),
        datenAb: Number((inhalt(inhalt(block, 'Range') ?? '', 'From') ?? '2').trim()),
      },
    });
  }

  return tabellen;
}

/**
 * Die Kopfzeile einer Datei, genau so wie die Taxonomie sie verlangt.
 *
 * ⚠️ OHNE Texteinfassung. Die amtlichen Beispieldateien schreiben die
 * Kopfzeile unquotiert; die Einfassung gilt den Datenfeldern.
 */
export function kopfzeile(t: TaxonomieTabelle): string {
  return t.spalten.map((s) => s.name).join(t.format.spaltentrenner);
}

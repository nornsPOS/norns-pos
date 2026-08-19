#!/usr/bin/env node
/**
 * Wache: ein Dokument unter docs/ darf auf KEINE Quelldatei zeigen, die es
 * nicht gibt.
 *
 * WARUM ES DIESE WACHE GIBT (Befund vom 26.07.2026):
 * `docs/companion-architecture.md` stand an HEAD, 219 Zeilen, und nannte sich
 * in Zeile 10 bis 12 woertlich „the architecture-of-record"; die Rust-Umsetzung
 * liege in `apps/tauri-pos/src-tauri/src/commands/companion.rs`. Diese Datei
 * war seit dem 22.06.2026 geloescht — Einchecken c6bd85f entfernte 8.888 Zeilen
 * Begleiter-Quelltext in sechs Dateien. Das Dokument versprach also im Praesens
 * ein System, von dem an HEAD kein einziges Zeichen mehr stand.
 *
 * Das ist dieselbe Klasse wie der DSFinV-K-Fund, nur umgekehrt: dort lebten
 * ZWEI Kopien und die gepflegte war tot. Hier ist der Quelltext weg und das
 * Dokument lebt weiter und verspricht. Ein Typpruefer sieht in ein Dokument
 * nicht hinein, ein Test las bisher kein Dokument — die Luege konnte also
 * beliebig lange stehen bleiben. Genau das schliesst diese Wache.
 *
 * WIE SIE ARBEITET
 * Sie liest jede `.md`-Datei unter docs/ und sammelt Pfadangaben aus
 *   • Kode-Spannen         `apps/api-cloud/src/index.ts`
 *   • Markdown-Verweisen   [Text](../packages/db/src/schema.ts)
 * Gemeldet wird ein Pfad nur dann, wenn ALLE drei Bedingungen zutreffen:
 *   1. er ist VERANKERT — entweder beginnt er mit einem echten Verzeichnis der
 *      obersten Ebene (apps, packages, scripts, infrastructure, docs, patches,
 *      .github), oder er ist ein ausdruecklich relativer Verweis (`./`, `../`),
 *   2. er traegt eine Endung aus der Liste der Quell-Endungen,
 *   3. unter diesem Pfad existiert nichts.
 *
 * WARUM DIE VERANKERUNG TRAEGT (gemessen, nicht vermutet): die erste Fassung
 * dieser Wache liess auch unverankerte Bruchstuecke zu und meldete 294 Treffer
 * bei 690 geprueften Verweisen. Der grosse Rest davon war KEIN Fund, sondern
 * Kurzschrift im Fliesstext — `plugins/mtls.ts` meint
 * `apps/api-cloud/src/plugins/mtls.ts` und behauptet nicht, es liege eine Datei
 * unter `docs/plugins/`. Eine Wache mit 250 Fehlalarmen wird abgeschaltet, und
 * dann faengt sie gar nichts mehr. Kurzschrift wird deshalb bewusst NICHT
 * geprueft; geprueft wird, was wie eine vollstaendige Pfadzusage aussieht.
 * Ebenso ausgenommen: Klammer-Kurzschrift (`lib/{a,b}.ts`) und Auslassungs-
 * punkte (`…/commands/mdns.rs`) — beides ist Abkuerzung, keine Zusage.
 *
 * Ein Verweis auf etwas ABSICHTLICH Geloeschtes ist erlaubt, wenn er in der
 * Zeile als geloescht ausgewiesen wird (siehe GELOESCHT_MARKER) — ein Merkkasten
 * MUSS den Pfad ja nennen duerfen, um zu erklaeren, was fehlt.
 *
 * DIE SPERRKLINKE
 * Am 26.07.2026 standen 55 tote Verweise in docs/. Ein Tor, das vom ersten Tag
 * an rot ist, wird herausgenommen statt behoben — deshalb liegt der Altbestand
 * namentlich in `scripts/doku-tote-verweise.txt`. Die Wache faellt aus, wenn
 *   • ein NEUER toter Verweis auftaucht, der nicht im Verzeichnis steht, oder
 *   • ein Eintrag im Verzeichnis steht, den es nicht mehr gibt.
 * Der zweite Fall ist der wichtigere: ohne ihn verrottet die Liste und die
 * Zahl 55 waere bald eine Behauptung statt einer Messung. So kann der Bestand
 * nur schrumpfen, und jede neue Luege faellt sofort auf.
 *
 * Aufruf:  node scripts/check-doku-quellverweise.mjs
 *          node scripts/check-doku-quellverweise.mjs --schreiben   (Liste neu)
 * Ausgang: 0 = nichts Neues und nichts Verrottetes, 1 = sonst.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DOKU = join(ROOT, 'docs');
const VERZEICHNIS = join(ROOT, 'scripts/doku-tote-verweise.txt');
const SCHREIBEN = process.argv.includes('--schreiben');

/** Verzeichnisse der obersten Ebene, in denen echter Quelltext liegt. */
const QUELL_WURZELN = new Set([
  'apps',
  'packages',
  'scripts',
  'infrastructure',
  'docs',
  'patches',
  '.github',
]);

/**
 * Endungen, die eine Datei als Quelltext ausweisen. Ohne diese Liste wuerde
 * jedes `apps/kasse` (ein Verzeichnis-Sammelbegriff im Fliesstext) geprueft
 * und die Wache waere Laerm statt Signal.
 */
const QUELL_ENDUNGEN = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.sql',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.css',
  '.html',
  '.svg',
  '.mts',
]);

/**
 * Steht eines dieser Woerter in derselben Zeile, so ist der Verweis als
 * Grabstein gemeint und kein Versprechen. Der Merkkasten in
 * companion-architecture.md ist genau dieser Fall.
 */
const GELOESCHT_MARKER = [
  'geloescht',
  'gelöscht',
  'entfernt',
  'archiviert',
  'archive/',
  'existiert nicht',
  'gibt es nicht',
  'nicht mehr',
  'ehemals',
  'deleted',
  'removed',
  'archived',
];

/**
 * Interne Arbeitsnotizen, die NICHT zum veroeffentlichten Baum gehoeren
 * (19.08.2026): das Projekttagebuch und die Planhefte bleiben lokal und
 * reisen nicht ins oeffentliche Verzeichnis. Eine Wache, die auf Dateien
 * zeigt, die es im veroeffentlichten Baum nicht gibt, waere dort sofort
 * rot — deshalb werden sie hier ausdruecklich uebersprungen, ob die Datei
 * lokal liegt oder nicht.
 */
const INTERN = ['docs/memory.md', 'docs/superpowers'];

/** Alle .md-Dateien unter einem Verzeichnis, rekursiv. */
function markdownDateien(verzeichnis) {
  const treffer = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (INTERN.some((i) => pfad.endsWith(i) || pfad.includes(`/${i}/`) || pfad.includes(i + '/'))) {
      continue;
    }
    if (statSync(pfad).isDirectory()) {
      treffer.push(...markdownDateien(pfad));
    } else if (eintrag.endsWith('.md')) {
      treffer.push(pfad);
    }
  }
  return treffer.sort();
}

/**
 * Schneidet Zierrat ab, den Fliesstext an einen Pfad haengt: eine Zeilenangabe
 * (`datei.ts:42`), einen Anker (`datei.ts#L10`), Satzzeichen am Ende.
 */
function kernPfad(roh) {
  let p = roh.trim();
  p = p.replace(/[#?].*$/, '');
  p = p.replace(/:\d+(-\d+)?$/, '');
  p = p.replace(/[),.;:!?»"'`]+$/, '');
  return p;
}

/** Sieht der Text ueberhaupt wie ein Pfad in diesen Baum aus? */
function istKandidat(pfad) {
  if (!pfad || pfad.includes(' ') || pfad.includes('\n')) return false;
  if (!pfad.includes('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(pfad)) return false; // http:, mailto:, data:
  if (pfad.startsWith('/') || pfad.startsWith('~')) return false; // /etc/…, /api/…
  if (pfad.startsWith('@')) return false; // @norns/db
  if (pfad.includes('*')) return false; // Glob-Muster
  if (pfad.includes('{') || pfad.includes('}')) return false; // lib/{a,b}.ts
  if (pfad.includes('…') || pfad.includes('...')) return false; // Auslassung
  const endung = pfad.slice(pfad.lastIndexOf('.'));
  if (!QUELL_ENDUNGEN.has(endung)) return false;
  return true;
}

/**
 * Ist der Pfad eine vollstaendige Zusage — und keine Kurzschrift?
 * Verankert heisst: er beginnt in einer echten Wurzel der obersten Ebene, oder
 * er ist ausdruecklich relativ geschrieben (`./`, `../`).
 */
function istVerankert(pfad, herkunft) {
  if (pfad.startsWith('./') || pfad.startsWith('../')) return herkunft === 'verweis';
  return QUELL_WURZELN.has(pfad.split('/')[0]);
}

/**
 * Loest einen verankerten Pfad auf: absolut gegen die Baumwurzel, relativ
 * gegen das Verzeichnis des Dokuments. Gibt den Treffer zurueck, sonst null.
 */
function loesenGegenBaum(pfad, dokumentVerzeichnis) {
  // ACHTUNG: auf `.` zu pruefen waere falsch — `.github/workflows/ci.yml`
  // beginnt ebenfalls mit einem Punkt, ist aber baumwurzel-verankert. Die
  // erste Fassung meldete deshalb fuenf existierende Arbeitsablauf-Dateien
  // als tot. Nur `./` und `../` sind ausdrueckliche Relativverweise.
  const istRelativ = pfad.startsWith('./') || pfad.startsWith('../');
  const kandidat = istRelativ ? resolve(dokumentVerzeichnis, pfad) : join(ROOT, pfad);
  // Nichts ausserhalb des Baumes pruefen.
  if (!normalize(kandidat).startsWith(ROOT)) return kandidat;
  return existsSync(kandidat) ? kandidat : null;
}

/**
 * Sammelt Pfadangaben einer Zeile, MIT ihrer Herkunft.
 * `spanne` = aus einer Kode-Spanne, `verweis` = aus einem Markdown-Verweis.
 * Die Herkunft entscheidet, ob ein `./`- oder `../`-Pfad als Zusage gilt:
 * ein Markdown-Verweis zeigt vom Dokument aus, eine Kode-Spanne dagegen ist
 * meist ein Einfuhr-Bezeichner aus einer QUELLDATEI (`../state/cart-store.js`)
 * und meint dann gar nicht das Dokumentverzeichnis. Ohne diese Unterscheidung
 * meldete die Wache drei solcher Bezeichner als tot, obwohl die Dateien da
 * sind, nur eben relativ zur Quelldatei und mit `.ts` statt `.js`.
 */
function pfadeAusZeile(zeile) {
  const gefunden = new Map();
  for (const treffer of zeile.matchAll(/`([^`\n]+)`/g)) {
    if (!gefunden.has(treffer[1])) gefunden.set(treffer[1], 'spanne');
  }
  // Verweise gewinnen: sie sind die staerkere Zusage.
  for (const treffer of zeile.matchAll(/\]\(([^)\s]+)\)/g)) {
    gefunden.set(treffer[1], 'verweis');
  }
  return [...gefunden];
}

const tot = [];
let geprueft = 0;

for (const datei of markdownDateien(DOKU)) {
  const zeilen = readFileSync(datei, 'utf8').split('\n');
  const dokumentVerzeichnis = dirname(datei);
  let inKodeblock = false;

  zeilen.forEach((zeile, index) => {
    // Ein eingerueckter Kodeblock zeigt oft ERFUNDENE Beispielpfade. Nur
    // Fliesstext und Kode-Spannen tragen Versprechen.
    if (/^\s*```/.test(zeile)) {
      inKodeblock = !inKodeblock;
      return;
    }
    if (inKodeblock) return;

    const untenZeile = zeile.toLowerCase();
    const alsGrabsteinAusgewiesen = GELOESCHT_MARKER.some((m) => untenZeile.includes(m));

    for (const [roh, herkunft] of pfadeAusZeile(zeile)) {
      const pfad = kernPfad(roh);
      if (!istKandidat(pfad)) continue;
      if (!istVerankert(pfad, herkunft)) continue;
      geprueft += 1;
      if (loesenGegenBaum(pfad, dokumentVerzeichnis)) continue;
      if (alsGrabsteinAusgewiesen) continue;
      tot.push({
        datei: relative(ROOT, datei),
        zeile: index + 1,
        pfad,
      });
    }
  });
}

// Schluessel OHNE Zeilennummer: ein Absatz weiter oben eingefuegter Text darf
// das Verzeichnis nicht ungueltig machen. Datei plus Pfad genuegt.
const schluessel = (t) => `${t.datei}\t${t.pfad}`;
const jetzt = new Set(tot.map(schluessel));

if (SCHREIBEN) {
  const kopf = [
    '# Altbestand toter Quellverweise in docs/ — die Sperrklinke.',
    '# Erzeugt von scripts/check-doku-quellverweise.mjs --schreiben',
    '# Diese Liste darf NUR schrumpfen. Ein neuer Eintrag von Hand ist ein',
    '# Versprechen, das niemand geprueft hat.',
    '# Format: <dokument>\\t<verwiesener pfad>',
  ];
  writeFileSync(VERZEICHNIS, `${[...kopf, ...[...jetzt].sort()].join('\n')}\n`);
  console.log(`Verzeichnis geschrieben: ${relative(ROOT, VERZEICHNIS)} — ${jetzt.size} Eintraege.`);
  process.exit(0);
}

const bekannt = new Set(
  existsSync(VERZEICHNIS)
    ? readFileSync(VERZEICHNIS, 'utf8')
        .split('\n')
        .filter((z) => z.trim() && !z.startsWith('#'))
    : [],
);

const neu = tot.filter((t) => !bekannt.has(schluessel(t)));
const verrottet = [...bekannt].filter((k) => !jetzt.has(k));

if (neu.length === 0 && verrottet.length === 0) {
  console.log(
    `OK — ${geprueft} Quellverweise in docs/ geprueft. ` +
      `Kein neuer toter Verweis; ${bekannt.size} bekannte im Altbestand.`,
  );
  process.exit(0);
}

if (neu.length > 0) {
  console.error(
    `\nNEUE TOTE QUELLVERWEISE: ${neu.length} (von ${geprueft} geprueften Verweisen in docs/).\nDiese Dokumente versprechen eine Quelldatei, die es nicht gibt:\n`,
  );
  for (const t of neu) console.error(`  ${t.datei}:${t.zeile}  →  ${t.pfad}`);
  console.error(
    '\nEntweder den Pfad richtigstellen, oder die Zeile als Grabstein ausweisen\n' +
      '(ein Wort wie „geloescht", „entfernt", „archiviert" in derselben Zeile).\n',
  );
}

if (verrottet.length > 0) {
  console.error(
    `\nVERALTETE EINTRAEGE IM VERZEICHNIS: ${verrottet.length}.\nDiese Verweise sind behoben — bitte aus scripts/doku-tote-verweise.txt streichen\n(oder \`node scripts/check-doku-quellverweise.mjs --schreiben\` laufen lassen):\n`,
  );
  for (const k of verrottet) console.error(`  ${k.replace('\t', '  →  ')}`);
  console.error('');
}

process.exit(1);

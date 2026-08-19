#!/usr/bin/env node
/**
 * `latest.json` aus ALLEN Paketen einer Freigabe bauen — nach den Bauläufen.
 *
 * ── DER FUND (26.07.2026, v0.8.0) ──────────────────────────────────────────
 * Drei Bauläufe erzeugen je EIN Paket und schreiben je EIN `latest.json`.
 * `tauri-action` liest dabei das schon vorhandene Verzeichnis und fügt seinen
 * Eintrag hinzu — solange die Läufe nacheinander fertig werden.
 *
 * Bei v0.8.0 wurden die beiden Mac-Läufe im Abstand von ZWEI Sekunden fertig.
 * Beide lasen dasselbe Nichts, beide schrieben ihr eigenes Verzeichnis, der
 * zweite Schreibvorgang gewann. Ergebnis: `darwin-x86_64` fehlte, obwohl das
 * Paket sauber gebaut, signiert und hochgeladen war. Für jeden Intel-Mac im
 * Laden hätte die Kasse gemeldet „Sie sind aktuell" — auf einer alten Fassung.
 *
 * Genau dieser Ausfall steht schon einmal im Kopf von `release.yml`, damals
 * mit einer anderen Ursache (der Intel-Läufer existierte nicht mehr). Ein
 * Fehler, der aus zwei verschiedenen Richtungen kommt, gehört nicht zweimal
 * geflickt, sondern an der Stelle geschlossen, an der er sichtbar wird.
 *
 * ── DAS VERFAHREN ──────────────────────────────────────────────────────────
 * Dieses Skript läuft EINMAL, nachdem alle Bauläufe fertig sind. Es fragt die
 * Freigabe, welche Pakete WIRKLICH daliegen, liest zu jedem die zugehörige
 * `.sig` und baut das Verzeichnis vollständig neu. Kein Zusammenführen, kein
 * Lesen-dann-Schreiben, also auch kein Wettlauf.
 *
 * Fehlt eine Plattformfamilie, wird das Verzeichnis TROTZDEM geschrieben —
 * die Geräte, für die gebaut wurde, sollen ihr Update bekommen — und danach
 * endet das Skript mit einem Fehler, damit niemand den Lauf für vollständig
 * hält. Stillschweigend unvollständig ist der Zustand, der ein Jahr lang
 * unbemerkt bleibt.
 *
 * Aufruf:  node .github/scripts/manifest-zusammenfuehren.mjs v0.8.0
 *          node .github/scripts/manifest-zusammenfuehren.mjs v0.7.7 --trocken
 *
 * `--trocken` baut das Verzeichnis und zeigt es, lädt aber nichts hoch. Damit
 * lässt sich das Skript gegen eine ältere, nachweislich vollständige Freigabe
 * prüfen: kommt dasselbe Verzeichnis heraus, das dort schon liegt, stimmt die
 * Zuordnung von Paket zu Schlüssel.
 *
 * Benötigt: `gh`, angemeldet, mit Schreibrecht auf die Freigaben.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argumente = process.argv.slice(2);
const trocken = argumente.includes('--trocken');
const tag = argumente.find((a) => !a.startsWith('--'));
if (!tag) {
  console.error('Aufruf: manifest-zusammenfuehren.mjs <tag> [--trocken]   (z. B. v0.8.0)');
  process.exit(2);
}
const version = tag.replace(/^v/, '');

/** `gh` aufrufen und die Ausgabe zurückgeben. */
function gh(...args) {
  // GH_REPO zwingt jede gh-Anweisung auf das LIEFERLAGER. Ohne das loeste gh
  // das Lager aus dem ausgecheckten origin auf — also aus dem privaten
  // Quell-Lager, waehrend die Freigabe seit dem 14.08.2026 im oeffentlichen
  // Lieferlager norns-releases wohnt.
  //
  // ⚠️ Der Name ist bewusst LIEFERLAGER und nicht GITHUB_REPOSITORY: letzteres
  // ist in Actions RESERVIERT, ein Setzen im Workflow wird still verworfen,
  // und gh suchte die Freigabe im Quell-Lager („release not found",
  // Lauf 31793118861, waehrend alle Pakete laengst im Lieferlager lagen).
  const env = { ...process.env };
  const lager = env.LIEFERLAGER || env.GITHUB_REPOSITORY;
  if (lager) env.GH_REPO = lager;
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
}

/**
 * Welches Paket bedient welchen Schlüssel im Verzeichnis.
 *
 * Die Schlüsselnamen sind NICHT frei wählbar: der Aktualisierer im Programm
 * bildet sie aus `{os}-{arch}`, und `tauri-action` legt zusätzlich die
 * Varianten `-app` und `-nsis` an. Die Liste stammt aus dem Verzeichnis von
 * v0.7.7, das vollständig war — abgeschrieben, nicht geraten.
 */
// ⚠️ 31.07.2026: DIE MAC-FAMILIE IST WIEDER DA — und der Satz, der hier stand,
// war eine Falle, in die ich prompt getreten bin.
//
// Er lautete sinngemäss: nur Windows, für macOS ist nichts gemessen, „kommt die
// Mac-Fassung, kommt sie hier wieder dazu". Ich habe die Mac-Fassung gebaut und
// freigegeben — und DIESE Zeile vergessen.
//
// Gemessen an der fertigen Freigabe v0.0.1: das Verzeichnis trug NUR
// windows-x86_64. Die Mac-Kasse hätte auf ewig nach Aktualisierungen gefragt
// und immer „nichts Neues" gehört. Kein Fehler, keine Meldung, nur Stille —
// die schlimmste Sorte, weil sie wie Erfolg aussieht.
//
// Der Aktualisierer lädt NICHT das .dmg, sondern das .app.tar.gz: das dmg ist
// zum Installieren von Hand, das Archiv ist das, was er auspacken kann.
const FAMILIEN = [
  {
    name: 'Windows',
    passt: (n) => /_x64-setup\.exe$/.test(n),
    schluessel: ['windows-x86_64', 'windows-x86_64-nsis'],
  },
  {
    name: 'macOS Apple Silicon',
    passt: (n) => /_aarch64\.app\.tar\.gz$/.test(n),
    schluessel: ['darwin-aarch64'],
  },
];

// ⚠️ Auch die Paket-Adressen IM Verzeichnis muessen aufs Lieferlager zeigen:
// mit GITHUB_REPOSITORY haetten sie im Actions-Lauf auf das private
// Quell-Lager gezeigt, und jeder Aktualisierer haette beim Paketdownload
// 404 gehoert, obwohl latest.json selbst erreichbar war.
const REPO =
  process.env.LIEFERLAGER ||
  process.env.GITHUB_REPOSITORY ||
  gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').trim();

// ── Was liegt wirklich in der Freigabe? ────────────────────────────────────
const freigabe = JSON.parse(gh('release', 'view', tag, '--json', 'assets,body'));
const namen = freigabe.assets.map((a) => a.name);
console.log(`Pakete in ${tag}: ${namen.length}`);
for (const n of namen.slice().sort()) console.log('  ·', n);

const arbeit = mkdtempSync(join(tmpdir(), 'w14-manifest-'));
const platforms = {};
const fehlend = [];

for (const familie of FAMILIEN) {
  const paket = namen.find((n) => familie.passt(n) && !n.endsWith('.sig'));
  if (!paket) {
    fehlend.push(`${familie.name}: kein Paket`);
    continue;
  }
  const sigName = `${paket}.sig`;
  if (!namen.includes(sigName)) {
    fehlend.push(`${familie.name}: ${paket} ohne Signatur`);
    continue;
  }

  gh('release', 'download', tag, '-p', sigName, '-D', arbeit, '--clobber');
  const sigPfad = join(arbeit, sigName);
  if (!existsSync(sigPfad)) {
    fehlend.push(`${familie.name}: ${sigName} liess sich nicht laden`);
    continue;
  }
  const signature = readFileSync(sigPfad, 'utf8').trim();
  if (!signature) {
    fehlend.push(`${familie.name}: ${sigName} ist leer`);
    continue;
  }

  // Die Adresse wird gebaut, nicht aus `gh` übernommen: `gh` liefert je nach
  // Fassung eine API-Adresse, der Aktualisierer braucht die Browser-Adresse.
  const url = `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(paket)}`;
  for (const s of familie.schluessel) platforms[s] = { signature, url };
  console.log(`✓ ${familie.name} → ${familie.schluessel.join(', ')}`);
}

// ── Notizen und Datum ──────────────────────────────────────────────────────
// Der Text der Freigabe IST die „Was ist neu"-Liste im Programm. Er steht
// schon fertig auf der Freigabe (jeder Bauauftrag setzt denselben), also wird
// er von dort übernommen statt ein zweites Mal aus dem Änderungsbuch gebaut —
// zwei Quellen für denselben Satz driften auseinander.
const notes = (freigabe.body || '').trim() || `Neue Version ${tag}.`;

// Das vorherige Verzeichnis kommt in einen EIGENEN Ordner, damit es beim
// Schreiben des neuen nicht überschrieben wird — im Trockenlauf will man
// beide nebeneinander vergleichen können.
const altOrdner = join(arbeit, 'vorher');
let pubDate = new Date().toISOString();
try {
  gh('release', 'download', tag, '-p', 'latest.json', '-D', altOrdner, '--clobber');
  const alt = JSON.parse(readFileSync(join(altOrdner, 'latest.json'), 'utf8'));
  // Das Datum des ERSTEN Schreibvorgangs behalten: es ist der Zeitpunkt der
  // Freigabe, nicht der Zeitpunkt dieser Reparatur.
  if (typeof alt.pub_date === 'string' && alt.pub_date) pubDate = alt.pub_date;
} catch {
  // Kein vorheriges Verzeichnis — dann ist jetzt der Zeitpunkt der Freigabe.
}

const manifest = { version, notes, pub_date: pubDate, platforms };
const zielPfad = join(arbeit, 'latest.json');
writeFileSync(zielPfad, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

if (trocken) {
  console.log(`\n[trocken] NICHT hochgeladen. Verzeichnis liegt in ${zielPfad}`);
} else {
  gh('release', 'upload', tag, zielPfad, '--clobber');
}
console.log(`\nVerzeichnis: ${Object.keys(platforms).length} Schlüssel`);
for (const s of Object.keys(platforms).sort()) console.log('  ·', s);

if (fehlend.length > 0) {
  console.error('\nUNVOLLSTÄNDIG — diese Geräte bekommen KEIN Update:');
  for (const f of fehlend) console.error('  ✗', f);
  process.exit(1);
}
console.log('\nVollständig: jede gebaute Plattform steht im Verzeichnis.');

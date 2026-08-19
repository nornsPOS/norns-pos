/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE AMTLICHEN DATEIEN MÜSSEN MIT IN DEN BAU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `tsc` übersetzt TypeScript und rührt nichts anderes an. `index.xml` und die
 * DTD blieben deshalb unter `src/` liegen, und im gebauten Abbild fehlten sie.
 *
 * Am Simulationsmandanten gemessen, gegen ein echtes Abbild:
 *
 *     GET …/export/dsfinvk → 500
 *     ENOENT: no such file or directory,
 *             open '/app/dist/fiskal/dsfinvk-2.4/index.xml'
 *
 * ⚠️ Und das Tückische daran: JEDE Prüfung war grün. Die Prüfungen laufen
 * gegen `src/`, wo die Dateien liegen. Erst das gebaute Abbild kennt den
 * Unterschied — dieselbe Lehre wie „dist statt Quelle macht Rot-Grün wertlos".
 *
 * Der Schritt hängt am `build`-Skript und nicht am Dockerfile, damit auch ein
 * lokaler Bau nicht in dieselbe Grube fällt.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const von = join(hier, '..', 'src', 'fiskal');
const nach = join(hier, '..', 'dist', 'fiskal');

if (!existsSync(von)) {
  console.error(`[fiskal] ${von} gibt es nicht — nichts zu kopieren.`);
  process.exit(1);
}

cpSync(von, nach, { recursive: true });

// ⚠️ UND IN DAS AUSGELIEFERTE PAKET, nicht nur ins `dist`.
//
// Gemessen am 02.08.2026 am gebauten Mac-Paket: es enthielt KEINE einzige
// `index.xml`. Der Motor reist als gebündeltes `start.mjs`, und die amtlichen
// Dateien werden zur LAUFZEIT gelesen, also bündelt esbuild sie nicht mit.
// Der Prüfer hätte im Laden gestanden und der Export wäre abgebrochen.
const insPaket = join(hier, '..', '..', 'tauri-pos', 'src-tauri', 'resources', 'sidecar', 'fiskal');
if (existsSync(join(hier, '..', '..', 'tauri-pos', 'src-tauri', 'resources', 'sidecar'))) {
  cpSync(von, insPaket, { recursive: true });
  console.log(`[fiskal] auch ins ausgelieferte Paket kopiert: ${insPaket}`);
} else {
  console.log('[fiskal] kein Sidecar-Ordner der Kasse gefunden — übersprungen.');
}

// Nachsehen, nicht annehmen: ein stiller Kopierfehler wäre genau der Zustand,
// den dieser Schritt beendet.
const erwartet = ['index.xml', 'gdpdu-01-09-2004.dtd'];
const da = readdirSync(join(nach, 'dsfinvk-2.4'));
const fehlt = erwartet.filter((n) => !da.includes(n));
if (fehlt.length > 0) {
  console.error(`[fiskal] nach dem Kopieren fehlen: ${fehlt.join(', ')}`);
  process.exit(1);
}
console.log(`[fiskal] ${da.length} Dateien nach dist/fiskal kopiert`);

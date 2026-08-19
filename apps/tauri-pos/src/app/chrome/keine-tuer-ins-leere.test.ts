/**
 * Keine Tür, hinter der niemand steht.
 *
 * Norns POS läuft VOLLSTÄNDIG offline. Ihr einziger Weg nach draussen ist die
 * TSE-Wolke und der Kursdienst. Es gibt keine Google-Anmeldung, keine Wolke,
 * keine Synchronisierung mit einem Server irgendwo.
 *
 * ⚠️ 01.08.2026 auf Basels Schirm gesehen: die Gerätesperre sagte dreimal
 * „Google". Sie versprach „Die eigentliche Anmeldung bleibt Google", drohte
 * „dann ist eine neue Google-Anmeldung nötig", und ihr Knopf hiess „Mit Google
 * neu anmelden" — obwohl er `onSignOut` ruft und schlicht abmeldet.
 *
 * `App.tsx` hatte die Google-Tür an der Anmeldung schon bewusst weggelassen,
 * mit der Begründung im Quelltext: eine sichtbare Tür, hinter der auf einer
 * Kasse ohne Netz niemand steht, kostet den Kassierer morgens zehn Minuten
 * Ratlosigkeit. Auf der Sperre stand sie trotzdem noch.
 *
 * Dieser Wächter liest die QUELLEN aller Flächen und verlangt: kein Wort aus
 * der Wolke im SICHTBAREN Text. Kommentare sind ausgenommen — sonst könnte
 * diese Erklärung hier den Wächter selbst rot machen.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLEN = join(HIER, '../..');

/** Kommentare weg: die Begründung darf nicht als Befund zählen. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Wörter, die dem Händler eine Verbindung versprechen, die diese Kasse nicht
 * hat.
 *
 * NICHT auf der Liste, mit Grund:
 *   • `TSE` und `Kurs` — diese beiden Wege gibt es wirklich, sie sind die
 *     einzigen zwei Löcher in der Wand.
 *   • `synchronisieren` — die Kasse gleicht ihre Offline-Warteschlange mit dem
 *     EIGENEN, mitgelieferten Motor ab. Das ist kein Weg nach draussen, und
 *     eine erste, gröbere Fassung dieses Wächters hat genau daran vier
 *     harmlose Flächen fälschlich rot gemacht.
 */
const TUEREN_INS_LEERE = ['Google', 'Cloud', 'iCloud', 'Dropbox', 'OneDrive'];

/**
 * Ausnahmen mit Grund. Wer hier etwas einträgt, muss erklären, warum die Tür
 * in DIESER Kasse wirklich irgendwohin führt.
 */
const MIT_GRUND: Record<string, string> = {
  // Die Anmeldefläche trägt den Google-Weg als OPTION im Bauplan; `App.tsx`
  // reicht ihn in dieser Kasse bewusst nicht durch. Der Text erscheint dem
  // Händler also nie. Der Wächter unten prüft genau diese Enthaltung mit.
  'screens/PinLogin.tsx': 'Google-Zweig existiert, wird von App.tsx aber nicht durchgereicht',

  // Das Kalender-Abo gehört der Kasse SELBST: `POST /api/appointments/feed-token`
  // gibt eine Adresse auf den EIGENEN, mitgelieferten Server. Der Satz „In
  // iPhone/Google Kalender abonnieren" sagt dem Händler, wo er diese Adresse
  // einfügen kann — er verspricht keine Verbindung der Kasse zu Google. Der
  // Kalender auf seinem Telefon holt sie, nicht die Kasse.
  'screens/termine/IcsFeedCard.tsx': 'Abo-Adresse des EIGENEN Servers; Google ist nur der Ort, wo der Händler sie einfügt',

  // „Mit Google registriert" beschreibt, wie ein KUNDE sich einst angemeldet
  // hat. Das ist eine Tatsache aus dem Datensatz (`registration.method`), kein
  // Versprechen an den Händler. Gibt es solche Kunden nicht, erscheint der Satz
  // nie — die Zeile lügt in keinem Fall.
  'screens/kunden/CustomerDetailPanel.tsx': 'beschreibt die Anmeldeart eines Kunden aus den Daten, verspricht nichts',
};

function alleQuellen(ort: string, gesammelt: string[] = []): string[] {
  for (const e of readdirSync(ort, { withFileTypes: true })) {
    const pfad = join(ort, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      alleQuellen(pfad, gesammelt);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      gesammelt.push(pfad);
    }
  }
  return gesammelt;
}

describe('Keine Tür ins Leere', () => {
  const dateien = alleQuellen(QUELLEN);

  it('findet die Flächen überhaupt', () => {
    // Ohne diesen Satz wäre ein verschobener Ordner eine leere Liste, und gegen
    // eine leere Liste ist jede Suche unten grün.
    expect(dateien.length).toBeGreaterThan(40);
    // Der Fühler war einst `screens/LocalLock.tsx`; das Sperrbild starb am
    // 14.08.2026 mit dem Gerätecode. PinLogin ist die stabilste Fläche.
    expect(dateien.some((d) => d.endsWith('screens/PinLogin.tsx'))).toBe(true);
  });

  it('verspricht dem Händler keine Verbindung, die es nicht gibt', () => {
    const treffer: string[] = [];
    for (const datei of dateien) {
      const kurz = datei.slice(QUELLEN.length + 1);
      if (Object.keys(MIT_GRUND).some((a) => kurz.endsWith(a))) continue;
      const rumpf = ohneKommentare(readFileSync(datei, 'utf8'));
      for (const wort of TUEREN_INS_LEERE) {
        if (rumpf.includes(wort)) treffer.push(`${kurz}: ${wort}`);
      }
    }
    expect(treffer, `Türen ins Leere:\n  ${treffer.join('\n  ')}`).toEqual([]);
  });

  it('die Anmeldung bekommt den Google-Weg wirklich NICHT durchgereicht', () => {
    // Die Ausnahme oben gilt nur, solange App.tsx sich enthält. Reicht jemand
    // `onUseGoogle` durch, ist die Tür plötzlich sichtbar — und dann ist die
    // Ausnahme eine Lüge. Dieser Satz hält sie ehrlich.
    const app = ohneKommentare(readFileSync(join(QUELLEN, 'app/App.tsx'), 'utf8'));
    expect(app).not.toMatch(/onUseGoogle\s*=/);
  });
});

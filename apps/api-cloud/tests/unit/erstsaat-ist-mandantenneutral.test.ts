/**
 * Die Erstsaat darf NIEMANDES Betrieb tragen.
 *
 * ── DER FUND VOM 01.08.2026 ─────────────────────────────────────────────────
 *
 * `erststart/referenz.sql` wird bei JEDEM ersten Start einer frischen Kasse
 * eingespielt. Sie enthielt die echten Betriebsdaten von Roman:
 *
 *   Zeile 183  shop.tagline        "Antiquitäten · Briefmarken · Münzen"
 *   Zeile 184  shop.address_line2  "73614 Schorndorf"
 *   Zeile 194  shop.address_line1  "Rosenstraße 40"
 *   Zeile 205  steuer.modus        "REGELBESTEUERUNG"
 *   Zeile 206  Kommentar mit seiner USt-IdNr. im Klartext
 *   sechs Zeilen mit seiner Benutzerkennung in `updated_by_user_id`
 *
 * Das sind zwei verschiedene Schäden, und beide sind schwer:
 *
 * ERSTENS, für den KÄUFER der Software. Sein erster gedruckter Beleg trägt
 * eine fremde Anschrift. Das ist ein Aufzeichnungsmangel nach § 14 UStG auf
 * genau dem Papier, das er der Kundschaft in die Hand gibt. Und `steuer.modus`
 * wird bei JEDEM Verkauf gelesen: ein Kleinunternehmer nach § 19 UStG weist
 * damit still Umsatzsteuer aus, die er nicht schuldet, und schuldet sie danach
 * nach § 14c UStG doch.
 *
 * ZWEITENS, für ROMAN. Seine Anschrift, seine Handelszeile, sein
 * Umsatzsteuerstatus und seine Steuerkennung wandern in jede ausgelieferte
 * Kopie. Er hat dem nicht zugestimmt, und niemand hat ihn gefragt.
 *
 * Besonders tückisch: die Saat läuft mit `session_replication_role = replica`.
 * Selbst die Fremdschlüsselwächter schweigen dabei.
 *
 * ── WARUM DIESER WÄCHTER ZWEI DATEIEN LIEST, UND EINE DAVON NUR MANCHMAL ───
 *
 * Es gibt vier Kopien im Baum. Zwei sind Bauabfall unter `target/`. Die zwei,
 * auf die es ankommt:
 *
 *   apps/api-cloud/sidecar/erststart/referenz.sql            ← die QUELLE
 *   apps/tauri-pos/src-tauri/resources/sidecar/erststart/…   ← die BEIPACKKOPIE
 *
 * Nur die QUELLE liegt in der Versionsverwaltung; `.gitignore:90` schliesst
 * den Beipackordner aus, und `.github/workflows/release.yml:233` legt ihn beim
 * Freigabebau an. Die Kopie ist also Bauausgabe.
 *
 * Sie trotzdem zu prüfen, ist kein Übereifer: sie ist die Datei, die WIRKLICH
 * ausgeliefert wird, und auf einer Entwicklermaschine liegt sie vom letzten
 * Bau noch da und wird von einem örtlichen `tauri build` unverändert
 * eingepackt. Genau so trug sie hier Romans Daten weiter, nachdem die Quelle
 * schon sauber war. Das ist die Klasse „dist statt Quelle", die in diesem Haus
 * schon einmal eine ganze Rot-Grün-Prüfung wertlos gemacht hat.
 *
 * Deshalb: die Quelle MUSS da sein, die Kopie wird geprüft, WENN sie da ist.
 * Auf einem frischen Klon und in der Prüfstrasse fehlt sie, und das ist kein
 * Fehler.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../../../..');

const QUELLE = join(WURZEL, 'apps/api-cloud/sidecar/erststart/referenz.sql');
const BEIPACK = join(
  WURZEL,
  'apps/tauri-pos/src-tauri/resources/sidecar/erststart/referenz.sql',
);

/**
 * Die Fassungen, die es GERADE gibt. Die Quelle immer, die Beipackkopie nur,
 * wenn auf dieser Maschine schon einmal gebaut wurde.
 */
const SAATEN: ReadonlyArray<{ rolle: string; pfad: string }> = [
  { rolle: 'QUELLE', pfad: QUELLE },
  ...(existsSync(BEIPACK) ? [{ rolle: 'BEIPACKKOPIE', pfad: BEIPACK }] : []),
];

function lies(pfad: string): string {
  return readFileSync(pfad, 'utf8');
}

/**
 * Zeichenketten, die einem bestimmten Betrieb gehören und in keiner
 * ausgelieferten Datei stehen dürfen.
 *
 * Bewusst auch die USt-IdNr.: sie stand in einem KOMMENTAR, nicht in einem
 * Wert. Ein Kommentar wird mit ausgeliefert wie jede andere Zeile.
 */
const FREMDE_BETRIEBSDATEN: ReadonlyArray<{ text: string; wem: string }> = [
  { text: 'Rosenstra', wem: 'Romans Strasse' },
  { text: 'Schorndorf', wem: 'Romans Ort' },
  { text: '73614', wem: 'Romans Postleitzahl' },
  { text: 'DE343451090', wem: 'Romans USt-IdNr.' },
  { text: '922464c2', wem: 'Romans Benutzerkennung' },
];

/**
 * Schlüsselräume, die dem HÄNDLER gehören und deshalb leer ausgeliefert
 * werden. Ein Wert hier ist immer falsch, auch ein harmlos aussehender.
 *
 * `steuer.*` ist der gefährlichste: `transactions-finalize.ts` liest
 * `steuer.modus` bei jedem Verkauf. Leer heisst, die Kasse verweigert den
 * Verkauf, bis der Händler seinen Status erklärt. Das ist die RICHTIGE
 * Vorgabe: eine Kasse, die nicht weiss, ob ihr Betreiber Kleinunternehmer
 * ist, darf keine Umsatzsteuer ausweisen.
 */
const GEHOERT_DEM_HAENDLER = ['shop.', 'steuer.', 'datev.beraternummer', 'datev.mandantennummer'];

/** Die Wertspalte einer `system_settings`-Zeile aus der Saat holen. */
function wertVon(zeile: string): string | null {
  // Form: ('schluessel', 'wert', 'beschreibung', benutzer, zeit, zeit),
  const m = /^\s*\('([^']+)',\s*('(?:[^']|'')*'|NULL)/.exec(zeile);
  return m?.[2] ?? null;
}

function schluesselVon(zeile: string): string | null {
  const m = /^\s*\('([^']+)'/.exec(zeile);
  return m?.[1] ?? null;
}

describe('Die Erstsaat ist mandantenneutral', () => {
  it('findet die Quelle — sonst prüft dieser Test nichts', () => {
    // Ohne diesen Satz wäre ein verschobener Pfad ein grüner Test über eine
    // leere Menge: die schlimmste Art von grün. Die Quelle ist eingecheckt und
    // muss deshalb IMMER da sein.
    expect(existsSync(QUELLE), `die Quelle fehlt: ${QUELLE}`).toBe(true);
    for (const { rolle, pfad } of SAATEN) {
      expect(lies(pfad).length, `${rolle} ist leer: ${pfad}`).toBeGreaterThan(1000);
    }
  });

  it('trägt in KEINER Fassung die Betriebsdaten eines bestimmten Händlers', () => {
    const treffer: string[] = [];
    for (const { rolle, pfad } of SAATEN) {
      const text = lies(pfad);
      for (const { text: nadel, wem } of FREMDE_BETRIEBSDATEN) {
        const zeilen = text
          .split('\n')
          .map((z, i) => ({ z, nr: i + 1 }))
          .filter(({ z }) => z.includes(nadel));
        for (const { nr } of zeilen) {
          treffer.push(`${rolle} Zeile ${nr}: ${nadel} (${wem})`);
        }
      }
    }
    expect(treffer, `Fremde Betriebsdaten in der Saat:\n  ${treffer.join('\n  ')}`).toEqual([]);
  });

  it('liefert jeden Schlüssel, der dem Händler gehört, LEER aus', () => {
    const gefuellt: string[] = [];
    for (const { rolle, pfad } of SAATEN) {
      for (const zeile of lies(pfad).split('\n')) {
        const schluessel = schluesselVon(zeile);
        if (schluessel === null) continue;
        if (!GEHOERT_DEM_HAENDLER.some((p) => schluessel.startsWith(p))) continue;
        const wert = wertVon(zeile);
        // `''""''` ist der leere JSON-Text, `'""'` ebenso. Alles andere zählt.
        if (wert !== null && wert !== `'""'` && wert !== 'NULL' && wert !== `''`) {
          gefuellt.push(`${rolle}: ${schluessel} = ${wert}`);
        }
      }
    }
    expect(
      gefuellt,
      `Diese Schlüssel gehören dem Händler und dürfen nicht vorbelegt sein:\n  ${gefuellt.join('\n  ')}`,
    ).toEqual([]);
  });

  it('schreibt keine Zeile einem echten Menschen zu', () => {
    // `updated_by_user_id` benennt den Menschen, der einen Wert zuletzt
    // geändert hat. In einer AUSGELIEFERTEN Saat hat niemand etwas geändert.
    const zugeschrieben: string[] = [];
    for (const { rolle, pfad } of SAATEN) {
      const text = lies(pfad);
      const treffer = text.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g);
      // Kennungen von Referenzzeilen (Kategorien, Punzen) sind in Ordnung: sie
      // benennen eine Sache, keinen Menschen. Nur die Benutzerspalte zählt.
      for (const zeile of text.split('\n')) {
        const m = /,\s*'([0-9a-f-]{36})',\s*'\d{4}-\d{2}-\d{2}[^']*',\s*'\d{4}-\d{2}-\d{2}/.exec(
          zeile,
        );
        if (m) zugeschrieben.push(`${rolle}: ${schluesselVon(zeile) ?? '?'} → ${m[1]}`);
      }
      void treffer;
    }
    expect(
      zugeschrieben,
      `In einer ausgelieferten Saat hat niemand etwas geändert:\n  ${zugeschrieben.join('\n  ')}`,
    ).toEqual([]);
  });

  it('Quelle und Beipackkopie sind Zeichen für Zeichen gleich', () => {
    // Driften sie auseinander, liest der Freigabebau die eine und ein
    // örtlicher Bau die andere. Dann ist jede Messung an einer von beiden
    // wertlos.
    //
    // Auf einem frischen Klon gibt es die Kopie nicht; dann ist nichts zu
    // vergleichen, und der Satz sagt das ausdrücklich, statt still zu
    // bestehen.
    if (!existsSync(BEIPACK)) {
      expect(SAATEN.length, 'ohne Beipackkopie bleibt nur die Quelle').toBe(1);
      return;
    }
    expect(lies(QUELLE)).toBe(lies(BEIPACK));
  });
});

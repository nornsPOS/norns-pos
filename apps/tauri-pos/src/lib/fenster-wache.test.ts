/**
 * fenster-wache — der Wächter über die handgebauten Fenster der Kasse.
 *
 * WARUM ES DIESEN WÄCHTER GIBT
 * Die Kasse hat neben dem sehr guten `Dialog` aus dem Baukasten gut zwei Dutzend
 * handgebaute Fenster. Zwei Eigenschaften entscheiden darüber, ob so ein Fenster
 * am Tresen benutzbar ist oder nicht:
 *
 *   1. EIN AUSWEG. Wer ein Fenster öffnet, muss es ohne Maus wieder schliessen
 *      können. Ohne Escape steht die Kassiererin fest, wenn der Zeiger klemmt
 *      oder die Schaltfläche ausserhalb des Bildes liegt.
 *
 *   2. EINE HÖHENBEGRENZUNG. Der Wurzelkasten der Anwendung steht auf
 *      `height: 100dvh` und `overflow: hidden`. Ein Fenster ohne Begrenzung
 *      wächst deshalb bei kleinem Schirm oben und unten aus dem Bild, und es
 *      gibt keine Rolle, die es zurückholt. Überschrift und erste Felder sind
 *      dann schlicht unerreichbar.
 *
 * Beides ist am fertigen Bild schwer zu sehen, weil es nur bei kleinem Schirm
 * auffällt — also genau dann, wenn niemand hinschaut. Deshalb prüft der Wächter
 * den Quelltext.
 *
 * WARUM EINE SPERRKLINKE UND KEIN RUNDUMSCHLAG
 * Zum Zeitpunkt dieser Etappe tragen 23 Dateien ein `aria-modal`. Acht davon
 * sind hier nachgerüstet worden. Die übrigen gehören anderen Arbeitspaketen und
 * dürfen in dieser Etappe nicht angefasst werden. Ein Wächter, der sofort alle
 * 23 verlangt, wäre daher entweder rot oder müsste abgeschaltet werden, und
 * beides nützt niemandem.
 *
 * Also arbeitet er als Sperrklinke:
 *   • GEPRUEFT — die nachgerüsteten Fenster. Verliert eines seinen Ausweg oder
 *     seine Höhenbegrenzung, wird der Wächter rot.
 *   • NACHRUESTLISTE — die bekannten, noch offenen Fenster. Sie sind namentlich
 *     eingetragen, damit sie nicht in Vergessenheit geraten.
 *   • Taucht ein Fenster auf, das auf KEINER der beiden Listen steht, wird der
 *     Wächter rot. So kann die Nachrüstliste nur schrumpfen, nie wachsen.
 *
 * Fenster, die den Baukasten-`Dialog` benutzen, tauchen hier gar nicht erst
 * auf: ihr `aria-modal` steht im Baukasten, nicht in ihrem eigenen Quelltext.
 * Genau richtig, denn der Baukasten bringt beide Eigenschaften mit.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const QUELLE = new URL('..', import.meta.url).pathname;

/**
 * Die nachgerüsteten Fenster. Jedes muss einen Ausweg UND eine
 * Höhenbegrenzung nachweisen.
 */
const GEPRUEFT = [
  // 19.08.2026: neu gebaut MIT Ausweg (Escape) und Hoehenbegrenzung (86vh).
  'screens/kasse/RueckgabeDialog.tsx',
  'screens/bewertung/AcceptanceDialog.tsx',
  'screens/kasse/ZBonDialog.tsx',
  'screens/kunden/CustomerCreateDialog.tsx',
  'screens/kunden/CustomerEditDialog.tsx',
  'screens/kunden/CustomerEraseDialog.tsx',
  'screens/kunden/CustomerTrustDialog.tsx',
  'screens/kunden/KycCaptureModal.tsx',
  'screens/verkauf/StornoDialog.tsx',
  // 20.08.2026: der Ausweisleser am Ankauf. Neu eingebaut MIT dem
  // gemeinsamen Rahmen (Escape, Fokusfang) und eigener Höhenbegrenzung.
  'screens/ankauf/CustomerPanel.tsx',
];

/**
 * Bekannte, noch nicht nachgerüstete Fenster. Diese Liste darf schrumpfen,
 * niemals wachsen. Wer eines davon in Ordnung bringt, trägt es nach GEPRUEFT um.
 *
 * 01.08.2026 um drei Einträge gekürzt, weil die Flächen ausgezogen sind:
 * die Hülle des Sprachassistenten (er konnte auf einer Norns-Kasse nie
 * verbinden), `Ebay.tsx` und `WhatsApp.tsx` (beide Kanäle brauchen
 * Zugangsdaten aus der Umgebung, die der Rumpf nicht durchreicht).
 *
 * Beim ersten dieser drei fiel eine Lücke auf, die der Satz „nennt nur
 * Dateien, die es gibt" unten schliesst. Er hat sich sofort bewährt: die
 * zwei Kanal-Einträge hat er im selben Durchgang gefangen.
 */
const NACHRUESTLISTE = [
  'app/chrome/Spotlight.tsx',
  'components/hardware/CropStudio.tsx',
  'components/hardware/ZvtSpinner.tsx',
  'screens/ankauf/AnkaufBezahlenDialog.tsx',
  'screens/bewertung/AppraisalItemsList.tsx',
  'screens/kunden/KycLocalDocs.tsx',
  'screens/secondary/Dokumente.tsx',
  'screens/secondary/Finanzen.tsx',
  'screens/secondary/Kurse.tsx',
  'screens/verkauf/BezahlenDialog.tsx',
  'screens/verkauf/KaeuferPicker.tsx',
  'screens/verkauf/ReceiptPreview.tsx',
];

/** Alle .tsx unterhalb von src, ohne Prüfdateien. */
function alleQuellen(ordner: string, gesammelt: string[] = [], wurzel = ordner): string[] {
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) {
      alleQuellen(pfad, gesammelt, wurzel);
    } else if (eintrag.name.endsWith('.tsx') && !eintrag.name.includes('.test.')) {
      gesammelt.push(pfad.slice(wurzel.length).replace(/^\//, ''));
    }
  }
  return gesammelt;
}

function lies(relativ: string): string {
  return readFileSync(join(QUELLE, relativ), 'utf8');
}

/** Trägt die Datei ein handgebautes `aria-modal`. */
function istHandgebautesFenster(text: string): boolean {
  return /aria-modal\s*=\s*["'{]?\s*["']?true/.test(text);
}

/**
 * Hat das Fenster einen Ausweg ohne Maus — entweder über den gemeinsamen
 * Rahmen oder über einen eigenen Escape-Lauscher.
 *
 * ACHTUNG, hier lag beim Rot-Grün-Beweis eine Falle: die erste Fassung suchte
 * bloss den Namen `useFensterRahmen` im Text. Der steht aber schon in der
 * Einfuhrzeile. Ein Fenster, das den Rahmen einführt und dann NIE aufruft,
 * wäre also grün durchgegangen. Deshalb wird jetzt der AUFRUF verlangt, nicht
 * die blosse Erwähnung.
 */
function hatAusweg(text: string): boolean {
  return /useFensterRahmen\s*\(/.test(text) || /['"]Escape['"]/.test(text);
}

/**
 * Ist die Höhe begrenzt — entweder über den gemeinsamen Rollrahmen oder über
 * ein eigenes `maxHeight`.
 *
 * Dieselbe Falle wie oben, und hier ist sie beim Rot-Grün-Beweis tatsächlich
 * zugeschnappt: die Höhenbegrenzung wurde aus dem Z-Bon-Fenster ENTFERNT und
 * die Prüfung blieb grün, weil die Einfuhrzeile den Namen weiterhin enthielt.
 * Verlangt wird deshalb die tatsächliche VERWENDUNG, also das Ausbreiten in
 * einen Stil.
 */
function hatHoehenbegrenzung(text: string): boolean {
  return /\.\.\.\s*FENSTER_ROLLRAHMEN/.test(text) || text.includes('maxHeight');
}

describe('Fenster-Wache', () => {
  const fenster = alleQuellen(QUELLE).filter((datei) => istHandgebautesFenster(lies(datei)));

  it('findet die handgebauten Fenster überhaupt (sonst prüft der Wächter nichts)', () => {
    // Ohne diese Zusicherung könnte ein kaputter Sucher still null Dateien
    // liefern, und alle folgenden Prüfungen wären grün und wertlos.
    expect(fenster.length).toBeGreaterThanOrEqual(GEPRUEFT.length);
  });

  it('jedes geprüfte Fenster hat einen Ausweg ohne Maus', () => {
    const ohneAusweg = GEPRUEFT.filter((datei) => !hatAusweg(lies(datei)));
    expect(ohneAusweg).toEqual([]);
  });

  it('jedes geprüfte Fenster hat eine Höhenbegrenzung', () => {
    const ohneBegrenzung = GEPRUEFT.filter((datei) => !hatHoehenbegrenzung(lies(datei)));
    expect(ohneBegrenzung).toEqual([]);
  });

  it('jedes geprüfte Fenster trägt auch wirklich ein aria-modal', () => {
    // Fängt den Fall ab, dass eine Datei umbenannt oder umgebaut wird und die
    // Liste GEPRUEFT dann auf etwas zeigt, das gar kein Fenster mehr ist.
    const keinFenster = GEPRUEFT.filter((datei) => !istHandgebautesFenster(lies(datei)));
    expect(keinFenster).toEqual([]);
  });

  it('kein handgebautes Fenster steht auf einer nackten Ebenenzahl', () => {
    // Die Ebenenleiter in tokens.css ist benannt. Eine erfundene Zahl gewinnt
    // sonst gegen die Zweitbestätigung, die eigentlich obenauf gehört — genau
    // so lag der Storno-Dialog über der Zahlentastatur, nach der er fragte.
    const mitNackterZahl = GEPRUEFT.filter((datei) => /zIndex:\s*\d/.test(lies(datei)));
    expect(mitNackterZahl).toEqual([]);
  });

  it('die Nachrüstliste wächst nicht (jedes Fenster steht auf genau einer Liste)', () => {
    const bekannt = new Set([...GEPRUEFT, ...NACHRUESTLISTE]);
    const unbekannt = fenster.filter((datei) => !bekannt.has(datei));
    expect(unbekannt).toEqual([]);
  });

  /**
   * ⚠️ 01.08.2026, eine Lücke, die beim Ausbau des Sprachassistenten auffiel.
   *
   * Beide Listen oben nennen Dateien beim Namen. Der Wächter läuft über die
   * WIRKLICH vorhandenen Fenster und prüft jedes gegen die Listen. Ein Eintrag
   * für eine Datei, die es nicht mehr gibt, wird deshalb nie geprüft — und
   * fällt auch nie auf. Die Hülle des ausgezogenen Sprachassistenten stand
   * nach dem Löschen noch drin, und alle Sätze blieben grün.
   *
   * So sammeln sich Geister an. Eine Nachrüstliste voller Namen, hinter denen
   * nichts steht, sieht nach Arbeit aus, die noch zu tun wäre, und verdeckt
   * die, die es wirklich ist.
   */
  it('nennt nur Dateien, die es wirklich gibt', () => {
    const vorhanden = new Set(fenster);
    const geister = [...GEPRUEFT, ...NACHRUESTLISTE].filter((d) => !vorhanden.has(d));
    expect(geister, `Einträge ohne Datei:\n  ${geister.join('\n  ')}`).toEqual([]);
  });
});

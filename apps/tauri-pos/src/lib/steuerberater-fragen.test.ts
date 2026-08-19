/**
 * ⛔ Der Brief an den Steuerberater erfindet nichts und vergisst nichts.
 *
 * Zwei Zusagen: eine offene Frage bleibt offen (Schreiblinie, kein stiller
 * Wert), und ein lebender Wert aus den Einstellungen erscheint wirklich auf
 * dem Blatt. Dazu die inhaltlichen Anker der Recherche vom 12.08.2026, die
 * teuer waren: "Ausgabe" darf NIE als Typ angeboten werden, 3270 darf NIE
 * als Gutscheinkonto empfohlen werden.
 */

import { describe, expect, it } from 'vitest';

import { baueSteuerberaterFragen } from './steuerberater-fragen.js';

const JETZT_TEXT = '12.08.2026, 12:00 Uhr';

function alleZeilen(einstellungen: Record<string, string>) {
  const d = baueSteuerberaterFragen(einstellungen, JETZT_TEXT);
  return d.abschnitte.flatMap((a) => a.zeilen);
}

describe('⛔ der Brief an den Steuerberater', () => {
  it('lässt offene Fragen OFFEN statt Werte zu erfinden', () => {
    const d = baueSteuerberaterFragen({}, JETZT_TEXT);
    for (const z of d.abschnitte.flatMap((a) => a.zeilen)) {
      expect(z.wert, `"${z.etikett}" traegt einen erfundenen Wert`).toBeNull();
    }
    expect(d.firma).toBe('');
  });

  it('trägt lebende Werte aus den Einstellungen aufs Blatt', () => {
    const zeilen = alleZeilen({
      'shop.legal_name': 'Muster Edelmetallhandel e. K.',
      'datev.beraternummer': '12345',
      'dsfinvk.ust_schluessel.margin_25a': '1001',
      'dsfinvk.ust_beschreibung.margin_25a': 'Differenzbesteuerung § 25a UStG, Basis ist die Marge',
      'dsfinvk.gv_typ.ankauf': 'Auszahlung',
    });
    const je = new Map(zeilen.map((z) => [z.etikett, z.wert]));
    expect(je.get('Beraternummer der Kanzlei')).toBe('12345');
    expect(je.get('Schlüssel § 25a')).toBe('1001');
    // Der Motor liest Satz und Beschriftung fuer die vat.csv; der Brief muss
    // sie mit abfragen (Befund der Gegenpruefung vom 12.08.2026).
    expect(je.get('Beschriftung § 25a im Prüferpaket')).toContain('Basis ist die Marge');
    expect(je.has('Rechensatz § 25a')).toBe(true);
    expect(je.get('Typ für den Ankauf von Privat')).toBe('Auszahlung');
  });

  it('übersetzt die Festschreibung für Menschen statt das rohe Token zu drucken', () => {
    // Der Wert liegt als jsonb-Boolean in der Datenbank; auf dem Blatt fuer
    // die Kanzlei stuende sonst woertlich `false`.
    const je = (v: string) =>
      new Map(alleZeilen({ 'datev.festschreibung': v }).map((z) => [z.etikett, z.wert]));
    expect(je('false').get('Festschreibung der Stapel')).toBe('nein');
    expect(je('true').get('Festschreibung der Stapel')).toBe('ja');
  });

  it('zeigt BESTÄTIGTE Konten statt einer Schreiblinie, wenn die Kanzlei sie längst festgelegt hat', () => {
    const je = new Map(
      alleZeilen({
        'datev.konto.skr03.gutschein_mehrzweck': '1796',
        'datev.konto.skr03.erloese_margin_25a_marge': '8191',
        'datev.konto.skr04.erloese_margin_25a_marge': '4136',
      }).map((z) => [z.etikett, z.wert]),
    );
    expect(je.get('Mehrzweck-Gutschein (Verbindlichkeit bei Ausgabe)')).toBe('SKR03 1796');
    expect(je.get('Erlöse § 25a, Marge')).toBe('SKR03 8191 / SKR04 4136');
    // Und ohne Bestaetigung bleibt es die Schreiblinie.
    expect(je.get('Erlöse § 25a, Einkaufsanteil')).toBeNull();
  });

  it('nennt NIE den nicht existierenden Typ "Ausgabe" und NIE das Automatikkonto 3270 als Empfehlung', () => {
    const d = baueSteuerberaterFragen({}, JETZT_TEXT);
    const text = JSON.stringify(d);
    // "Ausgabe" existiert in Anhang C nicht; die erste Brieffassung bot es an.
    expect(text).not.toMatch(/"Ausgabe"|Typ Ausgabe/);
    // 3270 darf nur als WARNUNG vorkommen, nie als Vorschlagszeile.
    for (const a of d.abschnitte) {
      for (const z of a.zeilen) {
        expect(z.erklaerung, `3270 als Empfehlung bei "${z.etikett}"`).not.toContain('3270');
      }
    }
    expect(text).toContain('1796');
    expect(text).toContain('3786');
  });

  it('verlangt die Gegenzeichnung genau bei den gesetzten Standards (Teil B)', () => {
    const d = baueSteuerberaterFragen({}, JETZT_TEXT);
    for (const a of d.abschnitte) {
      const istB = a.nummer.startsWith('B');
      expect(a.gegenzeichnung, `${a.nummer} ${a.titel}`).toBe(istB);
    }
    // Beide Teile sind wirklich da.
    expect(d.abschnitte.some((a) => a.nummer.startsWith('A'))).toBe(true);
    expect(d.abschnitte.some((a) => a.nummer.startsWith('B'))).toBe(true);
  });
});

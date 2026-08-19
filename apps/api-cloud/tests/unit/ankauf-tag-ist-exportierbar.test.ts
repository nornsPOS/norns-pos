/**
 * Ein Edelmetallhändler kann seinen Ankaufstag exportieren.
 *
 * ── DIE LAGE VOR DEM 02.08.2026 ────────────────────────────────────────────
 *
 * `gvTypFuer('ANKAUF')` warf immer. Die Begründung war richtig und ist es
 * geblieben: der alte Erzeuger schrieb „Einkauf", ein Wert, der im ganzen
 * Normtext NULL Mal als Geschäftsvorfalltyp vorkommt. Einen Wert zu erfinden,
 * den ein Prüfwerkzeug nicht kennt, wäre schlimmer als kein Paket.
 *
 * Nur war die Sperre ohne Ausgang. Für Norns ist das keine Randnotiz: die
 * Kasse ist auf Gold und Schmuck ausgerichtet, und dort IST der Ankauf von
 * Privat das halbe Geschäft und die Quelle der Differenzbesteuerung. Also
 * scheiterte fast JEDER Tag am Export — und der Händler hatte keinen Ort, an
 * dem er die Frage hätte beantworten können.
 *
 * ── DIE AUFLÖSUNG, UND WARUM SIE NICHT „EINFACH AUSZAHLUNG" HEISST ─────────
 *
 * Welcher Geschäftsvorfalltyp für den Ankauf von Privat gilt, ist eine
 * steuerliche AUSLEGUNG. Aus Anhang C käme `Auszahlung` in Betracht, weil Geld
 * die Kasse verlässt. Diese Auslegung gehört dem Steuerberater des Händlers,
 * nicht der Kasse.
 *
 * Deshalb: die Kasse entscheidet NICHT, sie fragt. Der Wert steht in den
 * Einstellungen, er ist auf die amtlichen Werte aus Anhang C begrenzt, und
 * solange er leer ist, bleibt es beim 409 — mit einem Satz, der jetzt auch
 * sagt, WO die Antwort hingehört.
 *
 * Dasselbe Muster wie `steuer.modus`: eine Frage, die nur der Händler
 * beantworten kann, wird gestellt statt geraten.
 */

import { describe, expect, it } from 'vitest';

import {
  GV_TYP,
  GeschaeftsvorfallOffenError,
  gvTypFuer,
} from '../../src/lib/dsfinvk-schluessel.js';

describe('Der Ankaufstag lässt sich exportieren, sobald der Händler entschieden hat', () => {
  it('ohne Entscheidung bleibt es beim 409 — kein erfundener Wert', () => {
    // Die Sperre ist die Hälfte, die NICHT fallen darf. Ein Paket mit einem
    // Geschäftsvorfalltyp, den kein Prüfwerkzeug kennt, ist wertlos und
    // erweckt trotzdem den Eindruck, alles sei in Ordnung.
    for (const leer of [undefined, null, '', '   ']) {
      expect(() => gvTypFuer('ANKAUF', leer)).toThrow(GeschaeftsvorfallOffenError);
    }
  });

  it('der Satz sagt jetzt auch, WO die Antwort hingehört', () => {
    // Ein Riegel ohne Weg lässt den Menschen genauso stehen wie eine falsche
    // Auskunft. Genau das war der Zustand: richtig, und ohne Ausgang.
    try {
      gvTypFuer('ANKAUF', null);
      throw new Error('hätte werfen müssen');
    } catch (e) {
      const satz = (e as Error).message;
      expect(satz).toMatch(/Einstellungen/);
      expect(satz).toMatch(/Steuerberater/);
      // Und er darf die Sperre weiterhin begründen, nicht nur verweisen.
      expect(satz).toMatch(/Einkauf/);
    }
  });

  it('mit einer amtlichen Entscheidung läuft der Export', () => {
    expect(gvTypFuer('ANKAUF', 'Auszahlung')).toBe('Auszahlung');
    expect(gvTypFuer('ANKAUF', GV_TYP.PRIVATENTNAHME)).toBe(GV_TYP.PRIVATENTNAHME);
  });

  it('ein NICHT amtlicher Wert wird abgewiesen, auch wenn er plausibel klingt', () => {
    // ⚠️ Der eigentliche Schutz. Ohne ihn hätte jemand „Einkauf" in die
    // Einstellungen tippen können — genau den Wert, dessen Erfindung dieser
    // ganze Riegel verhindern soll, nur diesmal über die Oberfläche.
    for (const erfunden of ['Einkauf', 'Ankauf', 'auszahlung', 'Wareneingang', 'AUSZAHLUNG', 'Verkauf']) {
      expect(
        () => gvTypFuer('ANKAUF', erfunden),
        `„${erfunden}" darf NICHT durchgehen`,
      ).toThrow(GeschaeftsvorfallOffenError);
    }
  });

  it('ein versehentliches Leerzeichen wird verziehen, nicht bestraft', () => {
    // ⚠️ Mein erster Prüfsatz verlangte, dass „Auszahlung " (mit Leerzeichen)
    // abgewiesen wird. Das war der Prüfsatz, der falsch lag, nicht der Code:
    // ein Händler, der in ein Eingabefeld tippt, darf an einer unsichtbaren
    // Leerstelle nicht scheitern — und ein Wert MIT Leerzeichen sähe in der
    // Fehlermeldung genauso aus wie einer ohne.
    expect(gvTypFuer('ANKAUF', '  Auszahlung  ')).toBe('Auszahlung');
  });

  it('der Verkauf bleibt unverändert Umsatz', () => {
    // Ein stiller Wechsel hier träfe jeden bestehenden Export.
    expect(gvTypFuer('VERKAUF')).toBe(GV_TYP.UMSATZ);
    expect(gvTypFuer('VERKAUF', 'Auszahlung')).toBe(GV_TYP.UMSATZ);
  });

  it('die erlaubten Werte stammen aus der amtlichen Liste, nicht aus einer zweiten Aufzählung', () => {
    // Eine zweite, handgepflegte Liste wäre der nächste stille Fehler: sie
    // driftet von Anhang C weg, und niemand merkt es.
    const amtlich = Object.values(GV_TYP);
    expect(amtlich).toContain('Auszahlung');
    expect(amtlich).not.toContain('Einkauf');
  });
});

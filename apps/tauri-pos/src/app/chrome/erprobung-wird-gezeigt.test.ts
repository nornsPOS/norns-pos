/**
 * ⛔ DIE ERPROBUNGSUMGEBUNG WIRD IN DER FLAECHE NIE VERSCHWIEGEN
 *
 * Gegenstueck zum Rust-Waechter `erprobungsumgebung-wird-nie-verschwiegen.rs`.
 * Der misst, dass die ENTSCHEIDUNG richtig faellt. Dieser hier misst, dass sie
 * auch ANKOMMT — genau die Haelfte, die am 15.08.2026 fehlte: die Entscheidung
 * gab es, einen Aufrufer im Produktivcode nicht.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { streifenText } from './ErprobungsStreifen.js';

const HIER = dirname(fileURLToPath(import.meta.url));

describe('⛔ Erprobungsumgebung in der Flaeche', () => {
  it('⛔ eine Erprobung erzeugt einen Streifen, der die Wertlosigkeit BENENNT', () => {
    const t = streifenText({ rechtsgueltig: false, adresse: 'https://beispiel.test/api/v2' });
    expect(t, 'kein Streifen bei einer Erprobung').not.toBeNull();
    expect(t?.titel).toMatch(/ERPROBUNG/);
    // Der Satz muss die FOLGE nennen, nicht nur den Zustand.
    expect(t?.satz).toMatch(/wertlos/);
    // Und WELCHE Umgebung, sonst sucht der Betreuer im Dunkeln.
    expect(t?.satz).toContain('https://beispiel.test/api/v2');
  });

  it('✅ die amtliche Umgebung erzeugt KEINEN Streifen', () => {
    // Sonst waere die Warnung Dauerzustand und niemand saehe sie mehr an.
    expect(streifenText({ rechtsgueltig: true, adresse: 'egal' })).toBeNull();
  });

  it('⚠️ unbekannte Umgebung schweigt, statt falsch zu warnen', () => {
    expect(streifenText(null)).toBeNull();
  });

  it('⛔ der Streifen haengt WIRKLICH in der Huelle, nicht nur im Baum', () => {
    /*
     * Die Haelfte, die gefehlt hat. Ohne diesen Satz koennte jemand die
     * Komponente behalten und den Aufruf entfernen — und alles oben bliebe
     * gruen, waehrend die Kasse wieder schweigt.
     */
    const huelle = readFileSync(join(HIER, 'AppShell.tsx'), 'utf8')
      .split('\n')
      .filter((z) => !z.trim().startsWith('*') && !z.trim().startsWith('//'))
      .join('\n');
    expect(huelle, 'die Huelle rendert den Streifen nicht').toContain('<ErprobungsStreifen />');
  });
});

/**
 * Der Wächter über die Sanftheit der Verbindung (Basels Auftrag, 26.07. nachts).
 *
 * ── WARUM ES DIESEN WÄCHTER GIBT ────────────────────────────────────────────
 * Die Erkundung fand vier verschiedene Ladesprachen nebeneinander: echte
 * Skelettzeilen im Lager, ein nacktes kursives „Lädt…" in der Kundenhistorie,
 * einen zentrierten Satz „Bestellungen werden geladen …" und „Lädt den
 * Katalog…" im Verkauf. Dazu blitzten drei der vier grossen Listen beim
 * Filterwechsel LEER auf, weil nur das Lager den alten Inhalt festhielt
 * (keepPreviousData). Nichts davon meldet ein Typprüfer, nichts ein Rendering-
 * Test — nur Hinsehen. Dieser Wächter liest deshalb den QUELLTEXT der vier
 * grossen Listen und wird ROT, sobald eine davon in die alte Sprache
 * zurückfällt.
 *
 * Die vier grossen Listen: Verkauf-Katalog, Lager, Kundenakte, Bestellungen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const SCREENS = join(HIER, '../screens');

function quelle(relativ: string): string {
  return readFileSync(join(SCREENS, relativ), 'utf8');
}

describe('Nachladen hält den alten Inhalt fest (kein Blitzen auf Leere)', () => {
  // Filterwechsel und Suche dürfen die Fläche nie auf einen leeren Zustand
  // zurückwerfen: der alte Inhalt bleibt stehen, bis der neue eintrifft.
  it('Verkauf-Katalog: placeholderData hält die alten Kacheln', () => {
    expect(quelle('verkauf/CatalogGrid.tsx')).toContain('placeholderData');
  });
  it('Lager: keepPreviousData bleibt gesetzt', () => {
    expect(quelle('lager/Lager.tsx')).toContain('keepPreviousData: true');
  });
  it('Kundenakte: keepPreviousData hält die alten Zeilen', () => {
    expect(quelle('kunden/CustomerListPanel.tsx')).toContain('keepPreviousData: true');
  });
  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.
});

describe('Erstes Laden zeigt ein Skelett in der Geometrie der echten Zeilen', () => {
  it('Verkauf-Katalog: Skelett-Kacheln statt des nackten Satzes', () => {
    const text = quelle('verkauf/CatalogGrid.tsx');
    expect(text).toContain('SkelettBalken');
    expect(text).not.toContain('Lädt den Katalog…');
  });
  it('Lager: die Skelettzeilen bleiben (das Vorbild aller vier)', () => {
    expect(quelle('lager/LagerTable.tsx')).toContain('SkeletonRows');
  });
  it('Kundenakte: Skelett-Karten beim ersten Laden', () => {
    expect(quelle('kunden/CustomerListPanel.tsx')).toContain('SkelettBalken');
  });
  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.
});

describe('Eintreffen und Geldschimmer gehorchen den Bewegungsregeln', () => {
  it('SanfteMomente: reduced motion wird in JS geprüft (der Weg von motion.tsx)', () => {
    // Die globale reduced-motion-Regel in tokens.css nullt nur die DAUER,
    // nicht die Verzögerung — deshalb muss jede neue Bewegung die Vorliebe
    // selbst lesen und die Animation ganz fallen lassen.
    const text = quelle('_shared/SanfteMomente.tsx');
    expect(text).toContain('useReducedMotion');
  });
  it('SanfteMomente: nur Deckkraft und Farbe bewegen sich, nie Layout', () => {
    const text = quelle('_shared/SanfteMomente.tsx');
    for (const verboten of ['width', 'height', 'left', 'top', 'margin']) {
      // Layout-Eigenschaften dürfen im Keyframe-Text nicht vorkommen —
      // width/height als STATISCHE Masse des Skelettbalkens sind erlaubt,
      // in den Keyframes (bis zur schließenden Klammer des Blocks, die
      // allein auf ihrer Zeile steht) aber nicht.
      const keyframes = text.match(/@keyframes[\s\S]*?\n\}/g) ?? [];
      for (const block of keyframes) {
        expect(block, `Layout-Eigenschaft „${verboten}" in einem Keyframe`).not.toContain(
          `${verboten}:`,
        );
      }
    }
  });
  it('Korb: die Summen tragen den Geldschimmer', () => {
    expect(quelle('verkauf/CartPanel.tsx')).toContain('Geldschimmer');
  });
});

describe('Fehler ohne Schreck: Wiederholen-Weg IN der Fläche', () => {
  it('Lager: der Fehlerzustand bietet „Erneut versuchen" an', () => {
    expect(quelle('lager/Lager.tsx')).toContain('Erneut versuchen');
  });
  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.
});

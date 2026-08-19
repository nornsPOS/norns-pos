/**
 * Einen Beleg an seiner Nummer finden.
 *
 * WARUM (Basel, 25.07.2026): „مافي بحث برقم الفاتورة". Ein Kunde kommt mit
 * seinem Bon zurück und will stornieren oder einen Nachdruck. Die Liste der
 * letzten Verkäufe hatte keine Suche — bei zwanzig Verkäufen am Tag heisst das
 * scrollen und vergleichen, während er wartet.
 *
 * DIE EINE ENTSCHEIDUNG, DIE HIER ZÄHLT: ein Bon wird ABGELESEN, nicht kopiert.
 * Der Mensch tippt die letzten Stellen, oder er tippt sie mit Bindestrichen,
 * oder er lässt führende Nullen weg. Ein Vergleich auf Gleichheit findet davon
 * nichts. Also wird beides auf Buchstaben und Ziffern reduziert und als
 * TEILSTÜCK verglichen, und ein reines Ziffernwort zusätzlich gegen die
 * Ziffernspur — damit „0042" die `B-2026-0042` findet.
 *
 * Reines Modul, kein Zustand, keine Abfrage.
 */

/** Was von einer Zeile durchsucht werden darf. */
export interface BelegZeile {
  receiptLocator: string;
  totalEur: string;
  finalizedAt: string;
}

function nurZeichen(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

function nurZiffern(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Trifft die Suche auf diese Zeile?
 *
 * Der BETRAG zählt bewusst mit: „119,00" ist oft das Einzige, woran sich
 * jemand sicher erinnert. Die Uhrzeit dagegen NICHT — sie wechselt je nach
 * Anzeige, und eine Suche, die mal trifft und mal nicht, ist schlimmer als
 * eine, die es gar nicht versucht.
 */
export function belegTrifft(zeile: BelegZeile, suche: string): boolean {
  const woerter = suche.trim().split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return true;

  const text = `${nurZeichen(zeile.receiptLocator)} ${nurZeichen(zeile.totalEur)}`;
  const ziffern = `${nurZiffern(zeile.receiptLocator)} ${nurZiffern(zeile.totalEur)}`;

  return woerter.every((wort) => {
    const z = nurZeichen(wort);
    if (z && text.includes(z)) return true;
    const zi = nurZiffern(wort);
    return zi.length > 0 && ziffern.includes(zi);
  });
}

/** Die Liste eindampfen. Leere Suche → dieselbe Liste, nie eine leere. */
export function filtereBelege<T extends BelegZeile>(zeilen: readonly T[], suche: string): T[] {
  if (suche.trim().length === 0) return zeilen as T[];
  return zeilen.filter((z) => belegTrifft(z, suche));
}

/**
 * Die ehrliche Leermeldung.
 *
 * „Keine Verkäufe in den letzten 24 Stunden" nach einer Suche wäre eine falsche
 * Aussage über den Tag. Es gab welche, sie passen nur nicht.
 */
export function belegLeerMeldung(suche: string, vorhanden: number): string {
  const s = suche.trim();
  if (s.length === 0) return 'Keine Verkäufe in den letzten 24 Stunden.';
  if (vorhanden === 0) return `Zu „${s}" nichts gefunden. In den letzten 24 Stunden gab es keinen Verkauf.`;
  return `Zu „${s}" nichts gefunden. ${vorhanden === 1 ? 'Ein Verkauf liegt' : `${vorhanden} Verkäufe liegen`} in den letzten 24 Stunden.`;
}

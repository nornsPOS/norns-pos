/**
 * Schriftgroesse der Kasse — EIN Zuhause fuer Schluessel und Anwendung.
 *
 * ⚠️ 19.08.2026, Vermessung: der Kommentar an der Wahlflaeche versprach
 * „wird beim Laden wiederhergestellt", aber der einzige Wiederhersteller
 * war die Flaeche SELBST — sie mountet erst, wenn jemand die Einstellungen
 * oeffnet. Eine Kassiererin mit „Sehr gross" sah nach jedem Start wieder
 * die normale Schrift, bis sie die Einstellungen besuchte. Der Start ruft
 * jetzt `initTextScale()` (main.tsx, neben initTheme), die Flaeche bleibt
 * der Redakteur.
 */

export const TEXT_SCALE_KEY = 'w14-text-scale';
export type TextScale = '' | 'lg' | 'xl';

export function applyTextScale(scale: TextScale): void {
  if (scale === '') delete document.documentElement.dataset.textScale;
  else document.documentElement.dataset.textScale = scale;
}

export function storedTextScale(): TextScale {
  try {
    const stored = localStorage.getItem(TEXT_SCALE_KEY);
    return stored === 'lg' || stored === 'xl' ? stored : '';
  } catch {
    return '';
  }
}

/** Beim Programmstart die gespeicherte Wahl anwenden. */
export function initTextScale(): void {
  applyTextScale(storedTextScale());
}

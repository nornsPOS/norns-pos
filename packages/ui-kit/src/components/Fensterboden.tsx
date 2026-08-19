/**
 * Fensterboden — der Boden, auf dem jedes Fenster steht: document.body.
 *
 * ── DER FUND VOM 19.08.2026, live gemessen ─────────────────────────────────
 *
 * Der Storno-Dialog der Tageskasse lag mit seinem Schleier (z-fenster, 1050)
 * UNTER der Schichtschluss-Karte. Nicht wegen einer Zahl — wegen des Orts:
 * die handgerollten Fenster werden mitten IM Flächenbaum gerendert, und
 * `.w14-paper-noise` (jede Pergamentkarte!) trägt `isolation: isolate`. Das
 * ist ein Stapelkontext, und KEIN z-Wert der Welt hebt ein Element über die
 * Grenze seines Kontexts. Der Schleier deckte den Sichtbereich, aber jede
 * spätere Karte im Baum malte sich darüber.
 *
 * `ModalShell` hat das nie getroffen, weil es von jeher nach document.body
 * portalt. Dieses Bauteil gibt den handgerollten Fenstern denselben Boden,
 * ohne ihre Struktur anzufassen: aussen herumlegen, fertig. Der eigentliche
 * Umbau (alle Fenster auf ModalShell) bleibt eine eigene Etappe.
 *
 * React reicht Ereignisse durch ein Portal im REACT-Baum weiter, nicht im
 * DOM-Baum — Escape-Wege und Schleier-Klicks der Fenster bleiben unberührt.
 */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Fensterboden({ children }: { children: ReactNode }): JSX.Element | null {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

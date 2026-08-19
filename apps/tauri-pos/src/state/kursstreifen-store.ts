/**
 * kursstreifen-store — zeigt die Kasse den Metallkurs-Streifen im Kopf, ja
 * oder nein.
 *
 * ── WARUM ES DIESEN SCHALTER GIBT ──────────────────────────────────────────
 *
 * Basel, 05.08.2026: „اسعار المعادان الموجودة Metallkurse ضيف عليها زر اضهار
 * الاسعار على الشاشة الشريط العلوي او اخفائه لان اختياري" — die Metallkurse
 * brauchen einen Knopf zum Ein- und Ausblenden, denn sie sind OPTIONAL.
 *
 * Der Streifen lief bis dahin immer, für jeden. Für einen Edelmetallhändler
 * ist er meistens das Wichtigste am Bildschirm; an einem Tag ohne Ankauf ist
 * er nur eine Zeile, die sich bewegt und den Blick zieht. Wer den ganzen Tag
 * davorsteht, muss das selbst entscheiden dürfen.
 *
 * ⚠️ Die Wahl ist eine ANSICHT dieses Geräts, kein Geschäftsvorgang. Sie
 * gehört deshalb neben die Darstellung (hell/dunkel) in den Gerätespeicher
 * und NICHT in die Datenbank: sonst würde die Zweitkasse mitgeschaltet, und
 * niemand hätte darum gebeten.
 *
 * ⚠️ Die Vorgabe ist SICHTBAR. Ein Schalter, der etwas Bestehendes
 * ausschaltbar macht, darf es nicht beim ersten Start heimlich abschalten —
 * sonst sucht der Händler nach etwas, das gestern noch da war.
 */

import { create } from 'zustand';

const SPEICHER = 'w14.kursstreifen';

function anfangswert(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Nur ein ausdrückliches „aus" schaltet ab. Ein leerer, kaputter oder
    // fremder Wert bedeutet SICHTBAR, nicht versteckt.
    return window.localStorage.getItem(SPEICHER) !== 'aus';
  } catch {
    /* kein Speicher (privater Modus) — dann eben jedes Mal sichtbar */
    return true;
  }
}

interface Kursstreifen {
  sichtbar: boolean;
  umschalten: () => void;
  setzen: (sichtbar: boolean) => void;
}

export const useKursstreifenStore = create<Kursstreifen>((set, get) => ({
  sichtbar: anfangswert(),

  umschalten: () => get().setzen(!get().sichtbar),

  setzen: (sichtbar) => {
    set({ sichtbar });
    try {
      window.localStorage.setItem(SPEICHER, sichtbar ? 'an' : 'aus');
    } catch {
      /* ohne Speicher gilt die Wahl bis zum nächsten Start — ehrlich so */
    }
  },
}));

/** Für Flächen, die nur wissen wollen, ob der Streifen steht. */
export function useKursstreifenSichtbar(): boolean {
  return useKursstreifenStore((s) => s.sichtbar);
}

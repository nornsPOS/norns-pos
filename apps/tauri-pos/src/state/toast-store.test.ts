/**
 * Der Meldungsspeicher — Obergrenze, Zusammenfassen, Selbstauflösung.
 *
 * Bewacht den Fund vom 2026-07-26: in der Kasse stehen 141 Aufrufe mit dem Ton
 * „alert", ein Alarm hat absichtlich keine Uhr, und der Speicher hatte weder
 * eine Obergrenze noch ein Zusammenfassen. Bei einem Netzausfall meldete jede
 * laufende Abfrage einzeln, und alle diese Blasen blieben stehen — nach einer
 * halben Minute lag ein Stapel identischer Sätze über dem Bezahldialog.
 *
 * Die Uhren werden hier geprüft und nicht im Baukasten, weil sie in dieser
 * Datei liegen: der Kasten des Baukastens stellt seine Uhren in einem Effekt
 * über die ganze Liste und verlängert damit bei JEDER neuen Meldung alle
 * laufenden. Die Uhr hier hängt am Erscheinen der einzelnen Meldung. Genau das
 * prüft „die Uhr einer alten Meldung läuft weiter".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from './toast-store.js';

const speicher = () => useToastStore.getState();

/** Die Meldungen als Paare aus Titel und Zähler — knapp und gut lesbar. */
function bild(): Array<{ title: string; count: number }> {
  return speicher().toasts.map((t) => ({
    title: t.title,
    count: (t as { count?: number }).count ?? 1,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  speicher().clear();
});

afterEach(() => {
  speicher().clear();
  vi.useRealTimers();
});

describe('Obergrenze und Verdrängung', () => {
  it('hält höchstens vier Meldungen und wirft die ÄLTESTE hinaus', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      speicher().addToast({ tone: 'info', title: `Meldung ${n}` });
    }

    // Fünf gemeldet, vier sichtbar. Die erste ist weg, die eben erschienene da:
    // wer gerade etwas kaputt gemacht hat, will DAS sehen.
    expect(bild().map((m) => m.title)).toEqual([
      'Meldung 2',
      'Meldung 3',
      'Meldung 4',
      'Meldung 5',
    ]);
  });

  it('verdrängt zuerst die harmlosen und schont den Alarm', () => {
    speicher().addToast({ tone: 'alert', title: 'Hash-Kette verletzt' });
    for (const n of [1, 2, 3, 4] as const) {
      speicher().addToast({ tone: 'success', title: `Beleg ${n} gedruckt` });
    }

    // Vier Quittungen aus einem Kassiervorgang dürfen den Alarm nicht
    // wegdrücken, den noch niemand gesehen hat.
    const titel = bild().map((m) => m.title);
    expect(titel).toContain('Hash-Kette verletzt');
    expect(titel).not.toContain('Beleg 1 gedruckt');
    expect(titel).toHaveLength(4);
  });

  it('stehen nur Alarme, weicht der älteste Alarm', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      speicher().addToast({ tone: 'alert', title: `Alarm ${n}` });
    }
    expect(bild().map((m) => m.title)).toEqual(['Alarm 2', 'Alarm 3', 'Alarm 4', 'Alarm 5']);
  });

  it('räumt Kennungen und Pfade der verdrängten Meldung mit ab', () => {
    const erste = speicher().addToast({
      tone: 'info',
      title: 'Meldung 1',
      onClickPath: '/kunden',
    });
    for (const n of [2, 3, 4, 5]) {
      speicher().addToast({ tone: 'info', title: `Meldung ${n}` });
    }
    expect(speicher().ids.has(erste)).toBe(false);
    expect(speicher().paths.has(erste)).toBe(false);
  });
});

describe('Zusammenfassen gleicher Meldungen', () => {
  it('macht drei gleiche Meldungen zu EINER mit Zähler', () => {
    for (let i = 0; i < 3; i += 1) {
      speicher().addToast({
        tone: 'alert',
        title: 'Verbindung unterbrochen',
        body: 'Der Server antwortet nicht.',
      });
    }
    expect(bild()).toEqual([{ title: 'Verbindung unterbrochen', count: 3 }]);
  });

  it('gibt bei jedem Zusammenfassen dieselbe Kennung zurück', () => {
    const a = speicher().addToast({ tone: 'warn', title: 'Etikett nicht gedruckt' });
    const b = speicher().addToast({ tone: 'warn', title: 'Etikett nicht gedruckt' });
    expect(b).toBe(a);
  });

  it('fasst NICHT zusammen, wenn der Ton verschieden ist', () => {
    speicher().addToast({ tone: 'success', title: 'Gespeichert' });
    speicher().addToast({ tone: 'alert', title: 'Gespeichert' });
    expect(bild()).toEqual([
      { title: 'Gespeichert', count: 1 },
      { title: 'Gespeichert', count: 1 },
    ]);
  });

  it('fasst NICHT zusammen, wenn der Grund verschieden ist', () => {
    // Derselbe Titel mit zwei verschiedenen Gründen sind ZWEI Tatsachen. Ginge
    // der zweite Grund in einem Zähler unter, verlöre die Kassiererin genau die
    // Auskunft, mit der sie den Vorgang retten kann.
    speicher().addToast({
      tone: 'alert',
      title: 'Speichern fehlgeschlagen',
      body: 'Netzwerk nicht erreichbar.',
    });
    speicher().addToast({
      tone: 'alert',
      title: 'Speichern fehlgeschlagen',
      body: 'Beleg bereits storniert.',
    });
    expect(bild()).toHaveLength(2);
  });

  it('rückt die zusammengefasste Meldung ans Ende, damit sie nicht verdrängt wird', () => {
    speicher().addToast({ tone: 'info', title: 'Kurse veraltet' });
    for (const n of [1, 2, 3] as const) {
      speicher().addToast({ tone: 'info', title: `Füller ${n}` });
    }
    // Der anhaltende Fehler passiert erneut — er steht damit vorn in der
    // Verdrängungsreihe, wenn er nicht ans Ende wandert.
    speicher().addToast({ tone: 'info', title: 'Kurse veraltet' });
    speicher().addToast({ tone: 'info', title: 'Füller 4' });

    expect(bild()).toEqual([
      { title: 'Füller 2', count: 1 },
      { title: 'Füller 3', count: 1 },
      { title: 'Kurse veraltet', count: 2 },
      { title: 'Füller 4', count: 1 },
    ]);
  });

  it('zählt eine eigene Kennung NICHT hoch — sie ist eine reine Doppelabwehr', () => {
    // Die Brücke der Ereignisse vergibt eine Kennung je Zeile. Kommt dieselbe
    // Zeile zweimal an, ist das EIN Vorfall, kein zweiter.
    speicher().addToast({ id: 'alert-42', tone: 'alert', title: 'AML-Verdachtsmeldung' });
    speicher().addToast({ id: 'alert-42', tone: 'alert', title: 'AML-Verdachtsmeldung' });
    expect(bild()).toEqual([{ title: 'AML-Verdachtsmeldung', count: 1 }]);
  });
});

describe('Selbstauflösung je Ton', () => {
  it('die Quittung geht nach vier Sekunden', () => {
    speicher().addToast({ tone: 'success', title: 'Beleg gedruckt' });
    vi.advanceTimersByTime(3_999);
    expect(bild()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(bild()).toHaveLength(0);
  });

  it('der Hinweis geht nach fünf Sekunden', () => {
    speicher().addToast({ tone: 'info', title: 'Kurse aktualisiert' });
    vi.advanceTimersByTime(4_999);
    expect(bild()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(bild()).toHaveLength(0);
  });

  it('die Warnung steht länger und geht dann von selbst', () => {
    // Der Fall zwischen Quittung und Alarm: ist schiefgegangen, aber nichts ist
    // kaputt. Niemand muss ihn quittieren, also darf er nicht stehen bleiben.
    speicher().addToast({ tone: 'warn', title: 'Etikett nicht gedruckt' });
    vi.advanceTimersByTime(5_000);
    expect(bild()).toHaveLength(1);
    vi.advanceTimersByTime(3_000);
    expect(bild()).toHaveLength(0);
  });

  it('ein ALARM verschwindet NIEMALS von selbst', () => {
    speicher().addToast({ tone: 'alert', title: 'Hash-Kette verletzt' });
    vi.advanceTimersByTime(60 * 60 * 1_000); // eine Stunde
    expect(bild()).toEqual([{ title: 'Hash-Kette verletzt', count: 1 }]);
    // Nur die Hand der Kassiererin nimmt ihn weg.
    speicher().dismiss(speicher().toasts[0]?.id ?? '');
    expect(bild()).toHaveLength(0);
  });

  it('eine neue Meldung verlängert die Uhr der alten NICHT', () => {
    // Genau der Fehler des Kastens im Baukasten: dort hängen alle Uhren an der
    // ganzen Liste, jede neue Meldung stellt sie neu, und bei einem Schwall
    // verschwindet nichts mehr.
    speicher().addToast({ tone: 'success', title: 'Beleg gedruckt' });
    vi.advanceTimersByTime(3_500);
    speicher().addToast({ tone: 'info', title: 'Kurse aktualisiert' });
    vi.advanceTimersByTime(500);

    expect(bild().map((m) => m.title)).toEqual(['Kurse aktualisiert']);
  });

  it('das Zusammenfassen lässt die Uhr neu anlaufen', () => {
    speicher().addToast({ tone: 'warn', title: 'Kurs nicht abrufbar' });
    vi.advanceTimersByTime(7_000);
    speicher().addToast({ tone: 'warn', title: 'Kurs nicht abrufbar' });
    // Ohne Neustart wäre die Blase nach weiteren 1000 ms weg, obwohl der Satz
    // gerade eben wieder frisch geworden ist.
    vi.advanceTimersByTime(7_000);
    expect(bild()).toEqual([{ title: 'Kurs nicht abrufbar', count: 2 }]);
    vi.advanceTimersByTime(1_000);
    expect(bild()).toHaveLength(0);
  });

  it('eine weggeklickte Meldung nimmt ihre Uhr mit', () => {
    const id = speicher().addToast({ tone: 'info', title: 'Kurse aktualisiert' });
    speicher().dismiss(id);
    // Dieselbe Kennung wird nie wieder vergeben; die Prüfung sichert nur, dass
    // keine verwaiste Uhr später in den Speicher greift.
    speicher().addToast({ tone: 'alert', title: 'Hash-Kette verletzt' });
    vi.advanceTimersByTime(10_000);
    expect(bild()).toHaveLength(1);
  });

  it('clear() räumt auch die laufenden Uhren ab', () => {
    speicher().addToast({ tone: 'info', title: 'Kurse aktualisiert' });
    speicher().clear();
    speicher().addToast({ tone: 'alert', title: 'Hash-Kette verletzt' });
    vi.advanceTimersByTime(10_000);
    expect(bild()).toEqual([{ title: 'Hash-Kette verletzt', count: 1 }]);
  });
});

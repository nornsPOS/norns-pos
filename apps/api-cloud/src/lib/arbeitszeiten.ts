/**
 * Die Woche eines Menschen, geprüft bevor sie in die Datenbank geht.
 *
 * ── WARUM DIESE PRÜFUNG SEPARAT UND REIN IST ───────────────────────────────
 *
 * `available_slots()` baut die Kapazität mit einem CROSS JOIN auf
 * `staff_working_hours`. Ein CROSS JOIN MULTIPLIZIERT: zwei Zeilen, die sich
 * am selben Tag überschneiden, ergeben doppelte Plätze zur selben Stunde. Die
 * Kasse verspräche dann zwei Kunden denselben Termin, und beide stünden da.
 *
 * Die Datenbank fängt das nicht: ihre CHECK-Bedingungen prüfen nur die
 * einzelne Zeile (Wochentag 0 bis 6, Ende nach Anfang). Eine Überschneidung
 * ist eine Beziehung ZWISCHEN Zeilen, und dafür gibt es keine Bedingung.
 *
 * Deshalb hier, rein und ohne Datenbank prüfbar.
 */

/** Ein Zeitfenster an einem Wochentag. */
export interface Zeitfenster {
  /**
   * Wie die Datenbank zählt — und das ist NICHT die übliche SQL-Zählung.
   *
   * ⚠️ `available_slots()` vergleicht mit `EXTRACT(ISODOW FROM tag) - 1`
   * (Wanderung 0012, Zeile 493). ISODOW zählt Montag = 1 bis Sonntag = 7,
   * also ergibt minus eins: MONTAG = 0, Sonntag = 6.
   *
   * Das ist die Umkehrung von Postgres' `DOW` (Sonntag = 0). Wer sie
   * verwechselt, verschiebt JEDE Öffnungszeit um genau einen Tag — der
   * Händler trägt Montag bis Freitag ein, und offen ist Dienstag bis Samstag.
   */
  wochentag: number;
  /** `HH:MM`, 24 Stunden. */
  von: string;
  bis: string;
}

/**
 * Die Wochentage, mit den Nummern, die `available_slots()` WIRKLICH erwartet.
 *
 * ⚠️ 02.08.2026 BERICHTIGT, und der Fehler war meiner. Ich hatte die übliche
 * SQL-Zählung angenommen (Sonntag = 0, `DOW`). Die Kapazitätsfunktion
 * vergleicht aber mit `EXTRACT(ISODOW FROM tag) - 1`, und ISODOW zählt
 * Montag = 1 bis Sonntag = 7. Also: MONTAG = 0, Sonntag = 6.
 *
 * Mit meiner ersten Fassung wäre jede Öffnungszeit um genau einen Tag nach
 * hinten gerutscht: eingetragen Montag bis Freitag, offen Dienstag bis
 * Samstag. Und es wäre erst am Samstag aufgefallen, wenn jemand einen Termin
 * bekommt, obwohl zu ist — oder am Montag, wenn keiner geht.
 *
 * Der Integrationstest deckt das NICHT auf: er sät stumpf 0 bis 6, also alle
 * Tage, und trifft damit immer.
 */
export const WOCHENTAGE: ReadonlyArray<{ nummer: number; name: string }> = [
  { nummer: 0, name: 'Montag' },
  { nummer: 1, name: 'Dienstag' },
  { nummer: 2, name: 'Mittwoch' },
  { nummer: 3, name: 'Donnerstag' },
  { nummer: 4, name: 'Freitag' },
  { nummer: 5, name: 'Samstag' },
  { nummer: 6, name: 'Sonntag' },
];

/**
 * Dieselbe Rechnung wie in `available_slots()`, in Javascript.
 *
 * Sie steht hier, damit ein Prüfsatz sie gegen die SQL-Regel halten kann,
 * statt sie nachzuerzählen. `Date.getDay()` liefert Sonntag = 0 bis
 * Samstag = 6; ISODOW ist Montag = 1 bis Sonntag = 7.
 */
export function wochentagFuerDatum(d: Date): number {
  const isodow = d.getDay() === 0 ? 7 : d.getDay();
  return isodow - 1;
}

function nameFuer(wochentag: number): string {
  return WOCHENTAGE.find((t) => t.nummer === wochentag)?.name ?? `Tag ${wochentag}`;
}

/** `HH:MM` in Minuten seit Mitternacht, oder `null` wenn es keine Uhrzeit ist. */
function minuten(uhrzeit: string): number | null {
  // Streng: genau zwei Ziffern, Doppelpunkt, zwei Ziffern. „9:00" wird
  // abgewiesen, denn eine halb getippte Zeit ist meist eine halb gedachte.
  const m = /^(\d{2}):(\d{2})$/.exec(uhrzeit);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface Wochenpruefung {
  /** Leer heisst: die Woche darf gespeichert werden. */
  fehler: string[];
}

/**
 * Eine ganze Woche prüfen.
 *
 * Eine LEERE Woche ist erlaubt und heisst: dieser Mensch nimmt keine Termine
 * an. Nicht jeder Mitarbeiter tut das, und ihn zu zwingen, etwas Unwahres
 * einzutragen, wäre der schlechtere Zustand.
 */
export function pruefeWoche(fenster: readonly Zeitfenster[]): Wochenpruefung {
  const fehler: string[] = [];

  for (const f of fenster) {
    const tag = nameFuer(f.wochentag);
    if (!Number.isInteger(f.wochentag) || f.wochentag < 0 || f.wochentag > 6) {
      fehler.push(`„${f.wochentag}" ist kein Wochentag. Erlaubt sind 0 bis 6.`);
      continue;
    }
    const von = minuten(f.von);
    const bis = minuten(f.bis);
    if (von === null || bis === null) {
      fehler.push(
        `${tag}: „${f.von}" bis „${f.bis}" ist keine gültige Uhrzeit. Erwartet wird die Form 09:00.`,
      );
      continue;
    }
    if (bis <= von) {
      fehler.push(`${tag}: ${f.bis} liegt nicht nach ${f.von}. Eine Zeit muss vorwärts laufen.`);
    }
  }
  // Bei Formfehlern nicht weiter: eine Überschneidung zwischen unlesbaren
  // Zeiten zu melden würde den Menschen nur zusätzlich verwirren.
  if (fehler.length > 0) return { fehler };

  // ⚠️ Die Überschneidung, der eigentliche Grund dieser Datei.
  const nachTag = new Map<number, { von: number; bis: number; roh: Zeitfenster }[]>();
  for (const f of fenster) {
    const liste = nachTag.get(f.wochentag) ?? [];
    liste.push({ von: minuten(f.von) as number, bis: minuten(f.bis) as number, roh: f });
    nachTag.set(f.wochentag, liste);
  }
  for (const [tag, liste] of nachTag) {
    const sortiert = [...liste].sort((a, b) => a.von - b.von);
    for (let i = 1; i < sortiert.length; i += 1) {
      const vorher = sortiert[i - 1];
      const jetzt = sortiert[i];
      if (vorher === undefined || jetzt === undefined) continue;
      // `<` und nicht `<=`: 13:00 bis 13:00 ist eine Grenze, keine
      // Überschneidung. Wer hier zu streng prüft, macht aus einer
      // Schichtübergabe einen Fehler.
      if (jetzt.von < vorher.bis) {
        fehler.push(
          `${nameFuer(tag)}: ${jetzt.roh.von} bis ${jetzt.roh.bis} überschneidet sich mit ` +
            `${vorher.roh.von} bis ${vorher.roh.bis}. Zwei überlappende Zeiten ergäben doppelte ` +
            `Termine zur selben Stunde.`,
        );
      }
    }
  }
  return { fehler };
}

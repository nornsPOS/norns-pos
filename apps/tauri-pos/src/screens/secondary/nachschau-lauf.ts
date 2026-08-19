/**
 * Der Lauf für die Kassennachschau, und der Probelauf davor.
 *
 * ── BASELS ANWEISUNG VOM 02.08.2026 ────────────────────────────────────────
 *
 * Wörtlich: wenn der Prüfer den Laden besucht und den Knopf drückt, MUSS er
 * laufen. Scheitert die Prüfung aus irgendeinem Grund, kostet das Bussgelder
 * und zerstört den Ruf für immer.
 *
 * ── ZWEI FEHLER, DIE DAS HEUTE UNMÖGLICH MACHTEN ───────────────────────────
 *
 * ⚠️ 1. DER LAUF BRACH BEIM ERSTEN SCHLECHTEN TAG AB. Die alte Schleife lag
 *    in EINEM `try`: warf der 47. von 900 Kassentagen, endete alles, und der
 *    Händler las „Export fehlgeschlagen" ohne zu wissen, welche 46 Tage schon
 *    auf der Platte lagen und welche 853 fehlten. Vor einem Prüfer ist das
 *    schlimmer als gar kein Knopf, denn es sieht nach Verweigerung aus.
 *
 *    ⚠️ § 146b AO gibt dem Prüfer das Recht auf die Daten. Ein Export, der
 *    bei Tag 47 aufhört und schweigt, ist aus seiner Sicht ein unvollständiger
 *    Datenträger. Deshalb: jeder Tag wird EINZELN versucht, ein Sturz reisst
 *    keinen anderen mit, und am Ende steht namentlich, welcher Tag fehlt.
 *
 * ⚠️ 2. ES GAB KEINEN WEG, DAS VORHER ZU WISSEN. Ob der Export läuft, erfuhr
 *    der Händler erst, während der Prüfer neben ihm stand. Genau das ist der
 *    Zeitpunkt, an dem man es NICHT erfahren will.
 *
 *    Der Probelauf ruft deshalb DIESELBEN Wege wie der echte Export und wirft
 *    nur die Bytes weg. Keine Attrappe, keine Simulation: was im Probelauf
 *    grün ist, ist am Prüfungstag grün, weil es derselbe Weg war.
 */

/** Ein Kassentag, wie ihn der Lauf braucht. */
export interface Nachschautag {
  /** Die Kennung des Abschlusses. */
  id: string;
  /** Der Geschäftstag, JJJJ-MM-TT. Das ist, was der Mensch liest. */
  tag: string;
}

/** Wie ein einzelner Tag ausgegangen ist. */
export interface Tagesergebnis {
  tag: string;
  gelungen: boolean;
  /** Der deutsche Satz, wenn er nicht gelang. Leer, wenn er gelang. */
  grund: string;
}

export interface Laufbericht {
  ergebnisse: Tagesergebnis[];
  gelungen: number;
  gescheitert: number;
  /** Die Tage, die fehlen. Namentlich, nicht als Zahl. */
  fehlendeTage: string[];
  /** Der Satz für den Menschen. Immer gefüllt, auch bei vollem Erfolg. */
  satz: string;
}

/**
 * Führt jeden Tag EINZELN aus und überlebt jeden einzelnen Sturz.
 *
 * `arbeit` ist beim echten Export das Herunterladen, beim Probelauf derselbe
 * Abruf ohne Speichern. Der Lauf kennt den Unterschied nicht, und genau
 * deshalb sagt der Probelauf die Wahrheit über den Export.
 *
 * `melde` bekommt nach jedem Tag den Fortschritt. Bei 900 Tagen ist eine
 * Fläche ohne Lebenszeichen nicht von einer abgestürzten zu unterscheiden.
 */
export async function laufeUeberTage(
  tage: readonly Nachschautag[],
  arbeit: (t: Nachschautag) => Promise<void>,
  beschreibeFehler: (fehler: unknown) => string,
  melde?: (fertig: number, gesamt: number, tag: string) => void,
): Promise<Laufbericht> {
  const ergebnisse: Tagesergebnis[] = [];

  for (const t of tage) {
    try {
      await arbeit(t);
      ergebnisse.push({ tag: t.tag, gelungen: true, grund: '' });
    } catch (fehler) {
      // ⚠️ Hier NICHT abbrechen. Das war der Fehler.
      ergebnisse.push({ tag: t.tag, gelungen: false, grund: beschreibeFehler(fehler) });
    }
    melde?.(ergebnisse.length, tage.length, t.tag);
  }

  const fehlendeTage = ergebnisse.filter((e) => !e.gelungen).map((e) => e.tag);
  const gelungen = ergebnisse.length - fehlendeTage.length;

  return {
    ergebnisse,
    gelungen,
    gescheitert: fehlendeTage.length,
    fehlendeTage,
    satz: berichtssatz(gelungen, fehlendeTage, ergebnisse),
  };
}

/**
 * Der Satz, den der Mensch liest.
 *
 * Kein „teilweise erfolgreich". Bei einer Kassennachschau ist unvollständig
 * dasselbe wie fehlgeschlagen, nur gefährlicher, weil es nach Erfolg aussieht.
 */
export function berichtssatz(
  gelungen: number,
  fehlendeTage: readonly string[],
  ergebnisse: readonly Tagesergebnis[],
): string {
  if (ergebnisse.length === 0) {
    return 'Im gewählten Zeitraum liegt kein abgeschlossener Kassentag. Ein Tag zählt erst, wenn er abgeschlossen wurde.';
  }
  if (fehlendeTage.length === 0) {
    return `Alle ${gelungen} Kassentage sind vollständig. Der Datenträger für den Prüfer ist lückenlos.`;
  }

  // Der erste echte Grund, nicht der häufigste: der erste ist meistens die
  // Ursache, und die anderen sind seine Folge.
  const ersterGrund = ergebnisse.find((e) => !e.gelungen)?.grund ?? '';
  const namen = fehlendeTage.slice(0, 8).join(', ');
  const rest = fehlendeTage.length > 8 ? ` und ${fehlendeTage.length - 8} weitere` : '';

  return (
    `${fehlendeTage.length} von ${ergebnisse.length} Kassentagen FEHLEN: ${namen}${rest}. ` +
    `Ein Datenträger mit Lücken gilt bei einer Kassennachschau als unvollständig. ` +
    `Grund des ersten Fehlers: ${ersterGrund}`
  );
}

/** Liegt der Geschäftstag im gewählten Fenster? Beide Grenzen zählen mit. */
export function imFenster(tag: string, von: string, bis: string): boolean {
  return tag >= von && tag <= bis;
}

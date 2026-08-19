/**
 * toast-store — the global toast queue.
 *
 * Pure Zustand list of `ToastShape` records. `<ToastContainer/>` reads,
 * any code path (SSE alert subscription, error boundary, step-up modal)
 * calls `addToast(...)`.
 *
 * ─── FUND 2026-07-26: bei einem Netzausfall wurde der Schirm zugemauert ──
 * Der Speicher hatte KEINE Obergrenze, KEIN Zusammenfassen gleicher Meldungen
 * und die Uhren lagen ausserhalb. In der Kasse stehen 141 Aufrufe mit dem Ton
 * „alert", und ein Alarm hat absichtlich keine Uhr. Fällt die Verbindung aus,
 * meldet jede laufende Abfrage einzeln — Kurse, Bestellungen, Aufgaben,
 * Gerätezustand — und jede dieser Meldungen bleibt stehen. Nach einer halben
 * Minute lag ein Stapel von zwanzig identischen Blasen über dem Bezahldialog,
 * alle mit demselben Satz. Die Kassiererin sah weder den Betrag noch die eine
 * Meldung, die wirklich neu war.
 * Behoben durch drei Dinge in dieser Datei:
 *   • eine Obergrenze mit Verdrängung von hinten (die älteste weicht),
 *   • Zusammenfassen gleicher Meldungen zu einer mit Zähler,
 *   • eigene Uhren je Meldung, die am Erscheinen hängen.
 *
 * ─── Zur Uhr: warum sie jetzt hier liegt ─────────────────────────────────
 * `ToastContainer` stellt seine Uhren in einem Effekt, dessen Abhängigkeit die
 * ganze Liste ist. Jede NEUE Meldung erzeugt eine neue Liste, der Effekt räumt
 * auf und stellt ALLE Uhren neu — eine Quittung, die schon vier Sekunden alt
 * war, bekommt also wieder die vollen fünf. Bei einem Schwall von Meldungen
 * verschwindet damit gar nichts mehr. Der Kasten wird zentral gepflegt, seine
 * Uhr bleibt deshalb unangetastet; sie kann nach der Verlängerung nur SPÄTER
 * feuern als die Uhr hier und ist damit ein harmloser Nachläufer. Die Uhr in
 * dieser Datei hängt am Erscheinen der einzelnen Meldung und wird von späteren
 * Meldungen nicht mehr angefasst. Sie ist ausserdem die einzige, die ohne
 * Bildschirm prüfbar ist — die Prüfungen der Kasse laufen ohne DOM.
 */

import type { ReactNode } from 'react';

import { create } from 'zustand';

import type { ToastShape, ToastTone as KitToastTone } from '@norns/ui-kit';

/**
 * Der Ton der Meldung. `warn` ist der Fall zwischen Quittung und Alarm:
 * „ist schiefgegangen, aber nichts ist kaputt" — der Etikettendruck lief nicht,
 * die Kursabfrage kam nicht durch. Er löst sich selbst auf, denn niemand muss
 * ihn quittieren; nur der Alarm bleibt stehen.
 */
export type ToastTone = KitToastTone | 'warn';

interface ToastInput {
  tone: ToastTone;
  title: string;
  body?: ReactNode;
  /** ms; pass `null` for sticky. Defaults: info 5000, success 4000, warn 8000, alert null. */
  autoDismissMs?: number | null;
  /** Stable id — when set, duplicate adds are coalesced (used by SSE bridge). */
  id?: string;
  /** Optional target — clicking the toast navigates here (router-aware caller). */
  onClickPath?: string;
}

/**
 * Eine Meldung, wie dieser Speicher sie hält: die Form des Baukastens plus den
 * vierten Ton und den Zähler.
 *
 * Warum die zwei Übergänge unten mit einer Umtypung arbeiten: der Baukasten
 * wird zentral gebaut, die Kasse liest seine VERÖFFENTLICHTEN Typen. Bis zum
 * nächsten zentralen Bau kennt die veröffentlichte Form den vierten Ton noch
 * nicht, obwohl die Quelle des Baukastens ihn bereits trägt. Deshalb genau
 * ZWEI Stellen, an denen die Meldung die Form wechselt, statt einer Umtypung
 * an jedem Aufruf. Nach dem nächsten Bau des Baukastens sind beide überflüssig
 * und können ersatzlos entfallen.
 */
interface GespeicherteMeldung {
  id: string;
  tone: ToastTone;
  title: string;
  body?: ReactNode;
  autoDismissMs: number | null;
  count?: number;
}

const alsKitForm = (m: GespeicherteMeldung): ToastShape => m as unknown as ToastShape;
const alsGespeicherte = (l: readonly ToastShape[]): GespeicherteMeldung[] =>
  l as unknown as GespeicherteMeldung[];

interface ToastState {
  toasts: ToastShape[];
  /** Stable IDs of toasts currently in the queue (de-dupe). */
  ids: Set<string>;
  /** Map from toast id → optional navigation path. */
  paths: Map<string, string>;

  addToast: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

const DEFAULT_AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  info: 5_000,
  success: 4_000,
  // Länger als eine Quittung: ein „warn" trägt einen Satz, den man wirklich
  // lesen und oft auch abschreiben soll (welcher Drucker, welcher Kurs).
  warn: 8_000,
  alert: null, // sticky — operator dismisses manually
};

/**
 * Höchstzahl gleichzeitig sichtbarer Meldungen.
 *
 * Vier, gerechnet und nicht geraten: eine Blase misst mit Polsterung und der
 * neuen Höhengrenze im schlimmsten Fall etwa 156 Pixel, dazu 10 Pixel Abstand.
 * Der Kasten beginnt 76 Pixel unter der Oberkante. Vier Blasen enden also bei
 * rund 730 Pixeln und lassen auf dem Tresenschirm (1080 hoch, im Fenster meist
 * um die 900) den unteren Teil frei — dort steht die Fusszeile des
 * Bezahldialogs mit dem Betrag und der Schaltfläche. Die fünfte Blase würde
 * genau diese Zeile verdecken.
 */
const HOECHSTZAHL = 4;

/**
 * Die Uhren liegen bewusst NEBEN dem Zustand: sie sind kein Inhalt, den ein
 * Bildschirm zeichnet. Lägen sie im Zustand, würde jede gestellte Uhr die ganze
 * Anwendungshülle neu zeichnen.
 */
const uhren = new Map<string, ReturnType<typeof setTimeout>>();

function uhrLoeschen(id: string): void {
  const u = uhren.get(id);
  if (u !== undefined) {
    clearTimeout(u);
    uhren.delete(id);
  }
}

function uhrStellen(id: string, ms: number | null): void {
  uhrLoeschen(id);
  if (ms === null) return; // ein Alarm bekommt NIE eine Uhr
  uhren.set(
    id,
    setTimeout(() => {
      uhren.delete(id);
      useToastStore.getState().dismiss(id);
    }, ms),
  );
}

/**
 * Der Fingerabdruck des Textkörpers — und damit die Antwort auf „was heisst
 * dieselbe Meldung?".
 *
 * Zusammengefasst wird nur bei GLEICHEM Ton, GLEICHEM Titel und GLEICHEM
 * Textkörper. Der Titel allein reicht nicht: „Speichern fehlgeschlagen" mit
 * dem Grund „Netzwerk nicht erreichbar" und dasselbe mit „Beleg bereits
 * storniert" sind zwei verschiedene Tatsachen, und die zweite ginge in einem
 * Zähler unter. Der Ton allein reicht erst recht nicht. Umgekehrt darf ein
 * Erfolg nie mit einem gleichlautenden Alarm verschmelzen.
 *
 * Ist der Textkörper ein Bauteil statt einer Zeichenkette, gibt es keinen
 * ehrlichen Vergleich — dann wird NICHT zusammengefasst. Lieber eine Blase zu
 * viel als zwei verschiedene Sachverhalte unter einem Zähler.
 */
function koerperAbdruck(body: ReactNode | undefined): string | null {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string' || typeof body === 'number' || typeof body === 'boolean') {
    return `${typeof body}:${String(body)}`;
  }
  return null;
}

/**
 * Verdrängung, wenn die Obergrenze überschritten ist.
 *
 * Die älteste weicht, nicht die neueste — wer gerade etwas kaputt gemacht hat,
 * will das sehen. Mit einer Verschärfung: zuerst weicht die älteste Meldung,
 * die sich ohnehin selbst auflöst. Ein Alarm wird erst verdrängt, wenn NUR
 * noch Alarme dastehen. Sonst könnten vier Quittungen aus einem Kassiervorgang
 * eine Warnung wegdrücken, die niemand gesehen hat.
 */
function beschneiden(liste: GespeicherteMeldung[]): GespeicherteMeldung[] {
  const rest = [...liste];
  while (rest.length > HOECHSTZAHL) {
    let weg = rest.findIndex((m) => m.autoDismissMs !== null);
    if (weg === -1) weg = 0;
    const [entfernt] = rest.splice(weg, 1);
    if (entfernt) uhrLoeschen(entfernt.id);
  }
  return rest;
}

/** Baut Kennungen und Pfade aus der beschnittenen Liste neu auf. */
function ableiten(
  liste: GespeicherteMeldung[],
  pfade: Map<string, string>,
): Pick<ToastState, 'toasts' | 'ids' | 'paths'> {
  const ids = new Set(liste.map((m) => m.id));
  const paths = new Map<string, string>();
  for (const [id, pfad] of pfade) if (ids.has(id)) paths.set(id, pfad);
  return { toasts: liste.map(alsKitForm), ids, paths };
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  ids: new Set(),
  paths: new Map(),

  addToast: ({ tone, title, body, autoDismissMs, id, onClickPath }) => {
    const finalId = id ?? nextId();
    // De-dupe by stable id — useful for "one toast per AML event row".
    if (id && get().ids.has(id)) return finalId;
    const ms = autoDismissMs === undefined ? DEFAULT_AUTO_DISMISS_MS[tone] : autoDismissMs;

    // Zusammenfassen nur ohne eigene Kennung: wer eine Kennung mitgibt, führt
    // selbst Buch (die Brücke der Ereignisse vergibt eine je Zeile), und zwei
    // verschiedene Zeilen dürfen nie zu einer werden.
    const abdruck = id === undefined ? koerperAbdruck(body) : null;
    const vorhanden =
      abdruck === null
        ? undefined
        : alsGespeicherte(get().toasts).find(
            (m) => m.tone === tone && m.title === title && koerperAbdruck(m.body) === abdruck,
          );

    // Das Zeitfenster des Zusammenfassens ist die Standzeit der Blase selbst:
    // solange dieselbe Meldung noch sichtbar ist, wird gezählt statt gestapelt.
    // Danach ist es für den Betrachter ein neuer Vorfall — und ein Alarm, der
    // absichtlich stehen bleibt, zählt einen anhaltenden Ausfall ehrlich hoch
    // („12 ×"), statt zwölf gleiche Blasen zu stapeln.
    if (vorhanden) {
      const gezaehlt: GespeicherteMeldung = {
        ...vorhanden,
        count: (vorhanden.count ?? 1) + 1,
      };
      set((s) => {
        // Ans Ende: die Meldung ist gerade eben wieder passiert. Bliebe sie
        // vorn, würde die Verdrängung ausgerechnet den anhaltenden Fehler
        // hinauswerfen.
        const liste = alsGespeicherte(s.toasts).filter((m) => m.id !== vorhanden.id);
        liste.push(gezaehlt);
        const pfade = new Map(s.paths);
        if (onClickPath) pfade.set(vorhanden.id, onClickPath);
        return ableiten(beschneiden(liste), pfade);
      });
      // Die Uhr läuft neu an: der Satz ist wieder frisch und soll erneut voll
      // lesbar sein. Ein Alarm bekommt weiterhin keine.
      uhrStellen(vorhanden.id, vorhanden.autoDismissMs);
      return vorhanden.id;
    }

    const t: GespeicherteMeldung =
      body !== undefined
        ? { id: finalId, tone, title, body, autoDismissMs: ms }
        : { id: finalId, tone, title, autoDismissMs: ms };
    set((s) => {
      const liste = [...alsGespeicherte(s.toasts), t];
      const pfade = new Map(s.paths);
      if (onClickPath) pfade.set(finalId, onClickPath);
      return ableiten(beschneiden(liste), pfade);
    });
    // Nur stellen, wenn die Meldung die Verdrängung überlebt hat.
    if (get().ids.has(finalId)) uhrStellen(finalId, ms);
    return finalId;
  },
  dismiss: (id) => {
    uhrLoeschen(id);
    set((s) => {
      if (!s.ids.has(id)) return s;
      const nextIds = new Set(s.ids);
      nextIds.delete(id);
      const nextPaths = new Map(s.paths);
      nextPaths.delete(id);
      return {
        toasts: s.toasts.filter((t) => t.id !== id),
        ids: nextIds,
        paths: nextPaths,
      };
    });
  },
  clear: () => {
    for (const id of [...uhren.keys()]) uhrLoeschen(id);
    set({ toasts: [], ids: new Set(), paths: new Map() });
  },
}));

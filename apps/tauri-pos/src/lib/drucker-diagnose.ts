/**
 * Warum der Drucker nicht tut, und was JETZT zu tun ist.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * In der Druckererkennung stand dem Händler wörtlich `[object Object]` im
 * Hinweisfenster. Der Grund ist klein und die Wirkung gross:
 *
 *   `DruckerErkennen.tsx:123` und `:203` schrieben
 *       err instanceof Error ? err.message : String(err)
 *
 *   Der Rumpf lehnt aber nicht mit einem `Error` ab, sondern mit einem
 *   schlichten Objekt: `error.rs:23` serialisiert `HardwareError` als
 *   `{ kind, details }`. `String({…})` ergibt `[object Object]`.
 *
 * Der Mensch am Tresen liest also eine Zeichenkette, die ihm nichts sagt,
 * über ein Gerät, das er in der Hand hält.
 *
 * ── WARUM NICHT EINFACH `describeHardwareError` ────────────────────────────
 *
 * Das Haus hat schon einen Übersetzer (`hardware-client.ts`). Er bildet acht
 * Fehlerarten auf acht ruhige Sätze ab und VERWIRFT den Detailtext dabei
 * absichtlich. Für die meisten Flächen ist das richtig: „connection reset by
 * peer" hilft am Tresen niemandem.
 *
 * Beim Drucker ist es genau umgekehrt. Dort IST die Ursache die nützliche
 * Auskunft, und sie ist jedes Mal eine andere Handlung:
 *
 *   „Forbidden"        → Rechte fehlen, die Warteschlange lässt sich so nicht
 *                        anlegen
 *   „no PPD"           → kein Treiber
 *   „printer is stopped" → Warteschlange angehalten
 *   „out of paper"     → Papier leer
 *   „cover open"       → Deckel offen
 *
 * Acht allgemeine Sätze machen aus fünf verschiedenen Handlungen eine
 * einzige Ratlosigkeit. Deshalb liest dieser Übersetzer den Detailtext, statt
 * ihn wegzuwerfen.
 *
 * ── DIE REGEL, DIE HIER NIE GEBROCHEN WERDEN DARF ──────────────────────────
 *
 * Es kommt IMMER ein lesbarer deutscher Satz heraus. Für jede Eingabe, auch
 * für `undefined`, für eine Zeichenkette, für ein leeres Objekt. Ein
 * Übersetzer, der in einem Randfall wieder `[object Object]` durchlässt, hat
 * den Fehler nur verschoben.
 */

/** Was der Rumpf schickt: `error.rs:23`, `serde(tag = "kind", content = "details")`. */
interface RumpfFehler {
  kind?: unknown;
  details?: unknown;
}

export interface Druckerdiagnose {
  /** Ein Satz, der die Lage benennt. Immer deutsch, nie leer. */
  satz: string;
  /** Was der Mensch TUN soll. `null`, wenn es nichts zu tun gibt ausser erneut zu versuchen. */
  handlung: string | null;
  /**
   * Der Rohtext des Systems, unverändert. Gehört in eine ruhige Zeile, nicht
   * in die Überschrift: er hilft bei der Ferndiagnose und verwirrt am Tresen.
   * `null`, wenn es keinen gab.
   */
  rohtext: string | null;
}

/**
 * Den Detailtext aus allem herausholen, was eine Ablehnung sein kann.
 *
 * AUSGEFÜHRT, weil das Problem nicht auf Drucker beschränkt ist: der
 * Aktualisierer und die TSE-Warteschlange lehnen mit derselben Form ab und
 * zeigten dieselbe Zeichenkette. Wer eine Ablehnung darstellen will, ruft
 * `lesbareAblehnung`, nicht `String(err)`.
 */
export function rohtextAus(fehler: unknown): string | null {
  if (fehler == null) return null;
  if (typeof fehler === 'string') return fehler.trim() || null;
  if (fehler instanceof Error) return fehler.message.trim() || null;
  if (typeof fehler === 'object') {
    const f = fehler as RumpfFehler;
    if (typeof f.details === 'string' && f.details.trim()) return f.details.trim();
    // Manche Wege reichen die Meldung als `message` durch.
    const m = (fehler as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return null;
}

/** Die Fehlerart, falls der Rumpf eine mitgeschickt hat. */
function artAus(fehler: unknown): string | null {
  if (fehler != null && typeof fehler === 'object') {
    const k = (fehler as RumpfFehler).kind;
    if (typeof k === 'string' && k.trim()) return k.trim();
  }
  return null;
}

/**
 * Bekannte Ursachen, in der Reihenfolge ihrer Genauigkeit.
 *
 * Die Muster sind bewusst englisch: sie stammen aus CUPS und dem
 * Windows-Spooler, nicht aus unserem Quelltext. Sie zu übersetzen wäre der
 * Fehler — wir übersetzen die BEDEUTUNG.
 */
const URSACHEN: ReadonlyArray<{
  muster: RegExp;
  satz: string;
  handlung: string;
}> = [
  {
    muster: /forbidden|not authori[sz]ed|unauthori[sz]ed|permission denied|eacces/i,
    satz: 'Das Betriebssystem hat das Einrichten der Warteschlange abgelehnt: es fehlen Rechte.',
    handlung:
      'Diese Kasse darf Drucker noch nicht selbst einrichten. Den Drucker einmalig in den ' +
      'Systemeinstellungen hinzufügen; danach findet die Kasse ihn und braucht nie wieder Rechte.',
  },
  {
    muster: /no ppd|ppd file|driver not|unsupported.*driver|filter failed/i,
    satz: 'Für dieses Gerät fehlt der Treiber.',
    handlung:
      'Den Treiber des Herstellers installieren und danach erneut suchen. Ohne Treiber weiss das ' +
      'System nicht, wie es das Gerät ansprechen soll.',
  },
  {
    muster: /is stopped|paused|disabled since|rejecting jobs/i,
    satz: 'Die Warteschlange dieses Druckers ist angehalten.',
    handlung:
      'In den Systemeinstellungen den Drucker fortsetzen. Angehalten heisst: die Aufträge sammeln ' +
      'sich, es kommt aber kein Papier.',
  },
  {
    muster: /out of paper|media empty|no paper|paper.?out/i,
    satz: 'Der Drucker meldet: kein Papier.',
    handlung: 'Papier einlegen. Der Auftrag läuft danach von selbst weiter.',
  },
  {
    muster: /cover open|door open|lid open/i,
    satz: 'Der Deckel des Druckers ist offen.',
    handlung: 'Deckel schliessen. Der Auftrag läuft danach von selbst weiter.',
  },
  {
    muster: /offline|not connected|unreachable|no such (device|file)|connection refused/i,
    satz: 'Das Gerät ist nicht erreichbar.',
    handlung:
      'Kabel und Strom prüfen. Bei einem Netzwerkdrucker: ob er im selben Netz hängt wie diese ' +
      'Kasse.',
  },
  {
    muster: /lpadmin|nicht unterst|not supported on windows/i,
    satz: 'Auf diesem Betriebssystem kann die Kasse die Warteschlange nicht selbst anlegen.',
    handlung:
      'Den Drucker einmalig in den Windows-Einstellungen unter Geräte und Drucker hinzufügen. ' +
      'Danach erscheint er hier.',
  },
];

/** Rückfall je Fehlerart des Rumpfes, falls kein Muster greift. */
const NACH_ART: Readonly<Record<string, string>> = {
  network: 'Keine Verbindung zum Drucker.',
  timeout: 'Der Drucker antwortet nicht rechtzeitig.',
  device: 'Der Drucker hat unerwartet reagiert.',
  not_configured: 'Dieser Drucker ist noch nicht eingerichtet.',
  encoding: 'Die Druckdaten konnten nicht erzeugt werden.',
  local_io: 'Eine Datei auf diesem Rechner liess sich nicht schreiben.',
  invalid_argument: 'Die Angaben zum Drucker sind unvollständig.',
  internal: 'Beim Drucken ist etwas Unerwartetes geschehen.',
};

/**
 * Aus einer Ablehnung eine brauchbare Auskunft machen.
 *
 * Nimmt ALLES entgegen, was eine Ablehnung sein kann, und liefert IMMER einen
 * deutschen Satz.
 */
export function diagnostiziereDrucker(fehler: unknown): Druckerdiagnose {
  const rohtext = rohtextAus(fehler);
  const art = artAus(fehler);

  if (rohtext !== null) {
    for (const u of URSACHEN) {
      if (u.muster.test(rohtext)) {
        return { satz: u.satz, handlung: u.handlung, rohtext };
      }
    }
  }

  // ⚠️ 02.08.2026, an der eigenen Kette gefunden: hier stand der Rückfall nach
  // Fehlerart VOR dem Rohtext. Der Windows-Zweig des Rumpfes schickt aber einen
  // ganzen deutschen Satz als `details` einer `not_configured`-Ablehnung — und
  // der wäre durch „Dieser Drucker ist noch nicht eingerichtet" ersetzt worden.
  // Der Drucker IST eingerichtet; der Satz hätte den Händler in einen
  // Gerätemanager geschickt, in dem alles bereits stimmt.
  //
  // Die Rangfolge lautet deshalb: erkannte Ursache, dann ein ganzer Satz, dann
  // die Fehlerart. Ein SATZ ist alles, was Leerzeichen hat und auf einen Punkt
  // endet — ein Kürzel wie „ENOENT" ist keiner und bekommt weiter den
  // allgemeinen Satz, denn dort ist er die bessere Auskunft.
  const istGanzerSatz =
    rohtext !== null && rohtext.length > 40 && rohtext.includes(' ') && rohtext.endsWith('.');
  if (istGanzerSatz && rohtext !== null) {
    return { satz: rohtext, handlung: null, rohtext: null };
  }

  const nachArt = art !== null ? NACH_ART[art] : undefined;
  if (nachArt !== undefined) {
    return { satz: nachArt, handlung: null, rohtext };
  }

  // Letzter Rückfall. Auch hier ein ganzer Satz, niemals ein rohes Objekt.
  return {
    satz: 'Der Drucker liess sich nicht ansprechen.',
    handlung:
      'Bitte erneut versuchen. Bleibt es dabei, hilft der Rohtext unten bei der Ferndiagnose.',
    rohtext,
  };
}

/**
 * Die Diagnose zu einer Zeile zusammenziehen, für Stellen mit nur einem Feld
 * (Meldungsblase, Zustandszeile).
 */
export function diagnoseAlsZeile(fehler: unknown): string {
  const d = diagnostiziereDrucker(fehler);
  return d.handlung !== null ? `${d.satz} ${d.handlung}` : d.satz;
}


/**
 * Eine Ablehnung als lesbaren Text, für Flächen OHNE Druckerbezug.
 *
 * ⚠️ Der ganze Zweck: `String(err)` auf einer Tauri-Ablehnung ergibt
 * `[object Object]`, weil der Rumpf mit einem schlichten Objekt ablehnt
 * (`src-tauri/src/error.rs:23`) und nicht mit einem `Error`. Diese Funktion
 * liefert stattdessen den Detailtext, wenn es einen gibt, und sonst einen
 * ganzen deutschen Satz.
 *
 * Für Drucker ist `diagnostiziereDrucker` die bessere Wahl: sie erkennt die
 * Ursache und nennt die Handlung.
 */
export function lesbareAblehnung(fehler: unknown): string {
  const roh = rohtextAus(fehler);
  if (roh !== null) return roh;
  return 'Der Vorgang ist fehlgeschlagen, ohne einen Grund zu nennen.';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ KEIN TSE-ZWEIG DES ANKAUFWEGS ENDET OHNE EINREIHUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 — DER HALBE FIX AN DERSELBEN AMPEL ──────────
 *
 * Der Verkaufsweg bekam an diesem Tag seinen Wächter und seine Einreihung.
 * Der Ankaufweg, die ZWEITE Bezahlmaske derselben Kasse, blieb unverändert
 * stehen — mit der ganzen ursprünglichen Lücke samt Lüge:
 *
 *     AnkaufBezahlenDialog.tsx  else-Zweig der Eröffnung
 *         → NICHTS in die Nachreiche-Warteschlange
 *         → „Die Signatur wird nachgeholt, sobald die
 *            Sicherungseinrichtung wieder antwortet."
 *
 * Bei einem Netzausfall scheitert der ERSTE TSE-Schritt, die Eröffnung. Beide
 * Schreiber der Warteschlange hängen aber am Abschluss und am Melden. Es
 * entstand also nirgends eine Zeile, während der Kassierer eine Nachreichung
 * versprochen bekam. Ein verlorener fiskalischer Datensatz UND eine Lüge auf
 * dem Schirm — auf dem Weg, auf dem Bargeld das Haus VERLÄSST.
 *
 * Dazu zwei kleinere Löcher desselben Abschnitts:
 *
 *   · `else if (finishRes.kind === 'queued_offline')` liess `unavailable`
 *     ohne jeden Zweig: kein Wort, kein Eintrag, nichts. Genau dieser Wert
 *     kommt zurück, sobald die Kasse nicht in der Tauri-Hülle läuft.
 *   · Der Satz nach `queued_offline` versprach eine Nachreichung, ohne dass
 *     jemand nachgesehen hätte. `closeTseSession` fängt einen Fehlschlag
 *     SEINES eigenen Korbschreibers ab (`lib/tse-service.ts:135`) und meldet
 *     trotzdem Erfolg.
 *
 * ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────────────
 *
 * Zu JEDEM Satz an den Kassierer im TSE-Abschnitt muss in SEINEM Zweig eine
 * Messung stehen. Keine Namensliste von Zweigen: ein fünfter Ausgang, den
 * jemand morgen baut, wird ohne Zutun mitgeprüft.
 *
 * Der Schwesterwächter des Verkaufswegs steht in
 * `screens/verkauf/kein-tse-zweig-ohne-einreihung.test.ts`. Zwei Dateien und
 * nicht eine, weil jede ihren eigenen Abschnitt hat — aber dieselbe Frage.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ALLE_FISKALZUSTAENDE,
  TONLAGE_ALS_MELDUNGSTON,
  fiskalzustandSatz,
  zustandAusAusfall,
} from '../../lib/fiskalzustand-satz.js';
import { hinweisOhneSignatur } from '../../lib/ohne-signatur-hinweis.js';
import { istNachreichbar } from '../../lib/tse-queue-store.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIALOG = resolve(HIER, 'AnkaufBezahlenDialog.tsx');

/** Der Anfang des TSE-Abschnitts — die Verzweigung auf die Eröffnung. */
const ABSCHNITT_ANFANG = "if ('intention' in tseIntentionRes) {";
/** Sein Ende — der Beleg wird gebaut, der fiskalische Teil ist entschieden. */
const ABSCHNITT_ENDE = 'buildAndStoreReceipt(result, tseForReceipt);';

/**
 * Eine Zweiggrenze. Oberhalb davon zählt nichts mehr zum selben Zweig:
 * `} else`, ein neues `if (`, ein `try {`, ein `} catch`.
 */
const ZWEIGGRENZE = /\}\s*else|^\s*if\s*\(|^\s*try\s*\{|^\s*\}\s*catch/;

/**
 * Was einen Satz an den Kassierer rechtfertigt.
 *
 * ⚠️ Der dritte Eintrag gilt nur mit dem AUSGESCHRIEBENEN Grund. Vor dem
 * Befund stand im Ankaufweg `hinweisOhneSignatur(grundOhneSignatur(…), …)` —
 * dieselbe Zeile deckte damit auch „nicht erreichbar" ab, und genau dort war
 * das Versprechen ohne Deckung. Ein Wächter, der die blosse Erwähnung des
 * Namens genügen liesse, wäre beim ursprünglichen Defekt grün gewesen.
 */
const RECHTFERTIGUNGEN = [
  'ausfallSichern(',
  'enqueueSignatureRecordOnly(',
  "hinweisOhneSignatur('keine_tse_hinterlegt'",
];

/** Kommentarzeilen zählen NICHT — gemessen wird der Gebrauch, nicht das Wort. */
function istKommentar(zeile: string): boolean {
  const t = zeile.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function tseAbschnitt(): { zeilen: string[]; versatz: number } {
  const alle = readFileSync(DIALOG, 'utf8').split('\n');
  const von = alle.findIndex((z) => z.includes(ABSCHNITT_ANFANG));
  if (von < 0) {
    throw new Error(
      `Anker "${ABSCHNITT_ANFANG}" nicht gefunden — misst dieser Wächter noch den Ankaufweg?`,
    );
  }
  const bis = alle.findIndex((z, i) => i > von && z.includes(ABSCHNITT_ENDE));
  if (bis < 0) {
    throw new Error(`Anker "${ABSCHNITT_ENDE}" nicht gefunden — der Abschnitt hat kein Ende mehr.`);
  }
  return { zeilen: alle.slice(von, bis + 1), versatz: von + 1 };
}

describe('⛔ kein TSE-Zweig des Ankaufwegs ohne Einreihung', () => {
  it('zu JEDEM Satz an den Kassierer gehört eine Messung in seinem Zweig', () => {
    const { zeilen, versatz } = tseAbschnitt();
    const ungedeckt: string[] = [];
    let gefunden = 0;

    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile) || !zeile.includes('addToast(')) continue;
      gefunden += 1;

      // Rückwärts bis zur nächsten Zweiggrenze.
      const davor: string[] = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const z = zeilen[j] ?? '';
        if (ZWEIGGRENZE.test(z)) break;
        if (!istKommentar(z)) davor.push(z);
      }

      // Und die Anweisung selbst, bis sie geschlossen ist — die Rechtfertigung
      // darf im Rumpf des Aufrufs stehen.
      const anweisung: string[] = [];
      for (let j = i; j < zeilen.length; j += 1) {
        const z = zeilen[j] ?? '';
        if (!istKommentar(z)) anweisung.push(z);
        if (j > i && /^\s*\}?\)?;?\s*$|\)\s*;\s*$/.test(z)) break;
      }

      const zweig = [...davor, ...anweisung].join('\n');
      if (!RECHTFERTIGUNGEN.some((r) => zweig.includes(r))) {
        ungedeckt.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }

    expect(
      gefunden,
      'kein einziger Ausgang im TSE-Abschnitt gefunden — misst dieser Wächter noch etwas?',
    ).toBeGreaterThanOrEqual(4);

    expect(
      ungedeckt,
      'Diese Sätze gehen an den Kassierer, ohne dass der Zweig etwas eingereiht hätte:\n' +
        ungedeckt.join('\n'),
    ).toEqual([]);
  });

  it('⛔ der Eröffnungs-Ausfall schreibt eine Zeile OHNE erfundene Vorgangsnummer', () => {
    const { zeilen } = tseAbschnitt();
    const text = zeilen.filter((z) => !istKommentar(z)).join('\n');

    // Die Eröffnung ist der Schritt, der bei Netzausfall zuerst fällt — und
    // genau der Zweig, der im Ankaufweg nichts eingereiht hat.
    expect(text, 'der Eröffnungs-Ausfall reiht nichts ein').toContain("'eroeffnung',");
    expect(text, 'der Eröffnungs-Ausfall benennt seinen Zustand nicht').toContain(
      "zustandAusAusfall('eroeffnung'",
    );
    // Und er erfindet keine Vorgangsnummer: es gibt keine. Eine plausibel
    // aussehende wäre eine unrichtige Angabe nach § 146a AO.
    expect(text, 'die Zeile ohne Eröffnung braucht die ausdrückliche Leermarke').toContain(
      'fiskalyTransactionId: OHNE_EROEFFNUNG',
    );
  });

  it('⛔ der Abschluss-Ausfall lässt keinen Ausgang der Sitzung unbehandelt', () => {
    /**
     * `closeTseSession` gibt drei Formen zurück: `signed`, `queued_offline`
     * und `unavailable`. Ein `else if` auf `queued_offline` liess die dritte
     * ohne Zweig — kein Wort, kein Eintrag. Der Gegenteil-Zweig muss deshalb
     * ein blankes `else` sein.
     */
    const { zeilen, versatz } = tseAbschnitt();
    const eng: string[] = [];
    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile)) continue;
      if (/finishRes\.kind\s*===\s*'(queued_offline|unavailable)'/.test(zeile)) {
        eng.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }
    expect(
      eng,
      'Auf eine EINZELNE Form zu verzweigen lässt die andere stumm:\n' + eng.join('\n'),
    ).toEqual([]);
  });

  it('⛔ kein Ausgang behauptet eine Sicherung ohne Messung', () => {
    const { zeilen, versatz } = tseAbschnitt();
    const erfunden: string[] = [];
    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile)) continue;
      // Der zweite Wert von `zustandAusAusfall` IST die Messung. Eine feste
      // Wahrheit dort wäre dieselbe Lüge in neuer Schreibweise.
      if (/zustandAusAusfall\(\s*'[a-z_]+'\s*,\s*(true|false)\b/.test(zeile)) {
        erfunden.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }
    expect(erfunden, `Feste Wahrheit statt Messung:\n${erfunden.join('\n')}`).toEqual([]);
  });

  it('⛔ in dieser Maske entsteht kein Wortlaut mehr', () => {
    /**
     * Der schwerste Mangel war nicht die fehlende Zeile, sondern der Satz
     * darüber. Er stand hier abgetippt — und lief deshalb nicht mit, als der
     * Verkaufsweg richtiggestellt wurde. Ein Satz, der zweimal getippt ist,
     * sind zwei Wahrheiten, die auseinanderlaufen.
     *
     * Gemessen wird die SACHE: keine Zeichenkette im TSE-Abschnitt, die eine
     * Nachreichung oder das Fehlen einer Signatur beschreibt. Solche Sätze
     * kommen aus `lib/fiskalzustand-satz.ts`, sonst nirgends her.
     */
    const { zeilen, versatz } = tseAbschnitt();
    const abgetippt: string[] = [];
    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile)) continue;
      /**
       * ⚠️ 13.08.2026 — AUSNAHME MIT GRUND: Ausgaben an die Entwicklerkonsole.
       *
       * Der Wächter wurde rot an
       *     console.warn('recordTseSignature failed (non-blocking)', sigErr);
       * weil in `recordTseSignature` das Wort „Signatur" steckt. Diese Zeile
       * erreicht aber keinen Kassierer und keinen Kunden — sie steht in der
       * Konsole, die im ausgelieferten Programm niemand sieht.
       *
       * Der Wächter misst den WORTLAUT AUF DEM SCHIRM. Ein englischer
       * Entwicklerhinweis ist keiner. Ohne diese Ausnahme bliebe er dauerhaft
       * rot — und ein Wächter, der immer rot ist, wird weggeschaut, bis er
       * einen echten Fund verdeckt.
       */
      if (/\bconsole\.(log|info|warn|error|debug)\s*\(/.test(zeile)) continue;
      if (/['"`][^'"`]*(nachgereicht|nachgeholt|nachgemeldet|Signatur)[^'"`]*['"`]/.test(zeile)) {
        abgetippt.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }
    expect(
      abgetippt,
      'Hier entsteht wieder ein eigener Wortlaut statt eines aus der EINEN Quelle:\n' +
        abgetippt.join('\n'),
    ).toEqual([]);
  });
});

describe('⛔ Was der Ankaufweg sagt, deckt sich mit dem, was der Korb tut', () => {
  const SCHRITTE = ['keine_tse', 'eroeffnung', 'abschluss', 'melden'] as const;
  /** Ein Satz, der auf ein späteres Nachkommen der Signatur hinausläuft. */
  const VERSPRICHT_NACHREICHUNG = /nachgereicht|nachgemeldet|holt (die Signatur |es )?(selbst )?nach/i;

  it('genau die Schritte, die `istNachreichbar` bejaht, dürfen etwas versprechen', () => {
    // Ein Satz und eine Zeile stützen sich auf DIESELBE Entscheidung. Wären es
    // zwei, könnte der Schirm etwas anderes sagen als der Korb tut.
    for (const schritt of SCHRITTE) {
      const s = fiskalzustandSatz(zustandAusAusfall(schritt, true), 'Ankauf');
      const verspricht = VERSPRICHT_NACHREICHUNG.test(
        `${s.titel} ${s.satz} ${s.naechsterSchritt.text}`,
      );
      expect(verspricht, `${schritt}: Satz und Korb sind sich uneinig`).toBe(
        istNachreichbar(schritt),
      );
    }
  });

  it('⛔ ging die örtliche Sicherung nicht, verspricht KEIN Schritt mehr etwas', () => {
    // Der einzige Fall echten Verlusts. Er schlägt jede andere Aussage, egal
    // an welchem Schritt es gescheitert ist.
    for (const schritt of SCHRITTE) {
      const zustand = zustandAusAusfall(schritt, false);
      expect(zustand, `${schritt}: ohne Sicherung ist nichts gesichert`).toBe('nichtGesichert');
      const s = fiskalzustandSatz(zustand, 'Ankauf');
      expect(
        VERSPRICHT_NACHREICHUNG.test(`${s.titel} ${s.satz} ${s.naechsterSchritt.text}`),
        `${schritt}: verspricht eine Nachreichung, obwohl nichts liegt`,
      ).toBe(false);
      // Und er bleibt stehen, bis der Kassierer ihn wegtippt.
      expect(TONLAGE_ALS_MELDUNGSTON[s.tonlage]).toBe('alert');
    }
  });

  it('⛔ die Brücke des Verkaufswegs sagt für den Ankauf dasselbe', () => {
    /**
     * Der Zweig „keine Sicherungseinrichtung hinterlegt" holt seinen Wortlaut
     * über `hinweisOhneSignatur`, damit beide Masken denselben Weg gehen. Hier
     * wird gemessen, dass dieser Weg beim selben Satz herauskommt wie der
     * Zustand, den `zustandAusAusfall` für denselben Fall nennt.
     */
    const zustand = zustandAusAusfall('keine_tse', true);
    expect(zustand).toBe('ohneSicherungseinrichtung');
    const quelle = fiskalzustandSatz(zustand, 'Ankauf');
    const bruecke = hinweisOhneSignatur('keine_tse_hinterlegt', 'Ankauf');
    expect(bruecke.title).toBe(quelle.titel);
    expect(bruecke.body).toBe(`${quelle.satz} ${quelle.naechsterSchritt.text}`);
  });

  it('jeder Ton, den diese Maske setzen kann, ist ein Ton der Meldungsleiste', () => {
    // Ein unbekannter Ton fiele in der Leiste auf die Vorgabe zurück und
    // verlöre still seine Dringlichkeit.
    const ECHTE_TOENE = ['info', 'success', 'warn', 'alert'];
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const s = fiskalzustandSatz(zustand, 'Ankauf');
      expect(ECHTE_TOENE, `${zustand}`).toContain(TONLAGE_ALS_MELDUNGSTON[s.tonlage]);
      // Und der Satz nennt den Vorgang, damit er in der Leiste zuzuordnen ist.
      expect(s.satz).toMatch(/^Ankauf gebucht\./);
    }
  });
});

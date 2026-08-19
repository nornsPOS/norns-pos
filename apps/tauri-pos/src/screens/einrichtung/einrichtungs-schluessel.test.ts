/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Assistent schreibt nur Schlüssel, die es WIRKLICH gibt
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEINAHE-FEHLER VOM 09.08.2026 ───────────────────────────────────
 *
 * Beim Bauen der Fragenliste stand `shop.email` darin. Der Schlüssel
 * existiert in KEINER Wanderung und an keiner Stelle des Motors. Ein eigener
 * Abgleich hat ihn vor dem ersten Nutzer gefangen; ohne ihn hätte der
 * Händler seine Adresse eingetragen, die Kasse hätte „gespeichert" gemeldet,
 * und der Wert wäre in einer Zeile gelandet, die niemand liest.
 *
 * ── ⚠️ WARUM DAS DIE GEFÄHRLICHSTE FASSUNG DIESES FENSTERS IST ──────────
 *
 * `PATCH /api/settings/:key` legt einen unbekannten Schlüssel bereitwillig
 * an. Es gibt also keinen Fehler, keine rote Meldung, nichts. Der Assistent
 * sähe vollständig aus, die Startliste bliebe rot, und niemand könnte sagen
 * warum — die Hausklasse „Ein Feld, das 187 Klassen deklarieren und keiner
 * liest", nur an der Stelle, an der der Händler zum ersten Mal Vertrauen
 * fasst.
 *
 * Gemessen wird deshalb gegen die WANDERUNGEN, die die Schlüssel anlegen.
 * Das ist die Quelle, aus der auch der laufende Betrieb sie kennt.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EINRICHTUNGS_SCHRITTE,
  HILFE_KENNUNGEN,
  HILFE_WURZEL,
  alleSchluessel,
} from './einrichtungs-schritte.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const MOTOR = join(HIER, '../../../../api-cloud/src');

/**
 * ⚠️ DIE RICHTIGE FRAGE IST NICHT „wer legt den Schlüssel an", SONDERN
 * „WER LIEST IHN".
 *
 * Zuerst stand hier ein Abgleich gegen die Wanderungen. Der war zu eng und
 * schlug bei `steuer.modus` an — einem Schlüssel, den es sehr wohl gibt, den
 * aber keine Wanderung vorlegt, weil er beim ersten Schreiben entsteht.
 *
 * Und er hätte die falsche Sache gemessen: ein Schlüssel, den eine Wanderung
 * anlegt und den danach niemand liest, ist genauso wertlos wie ein erfundener.
 * Beides ist dieselbe Hausklasse — ein Feld, das niemand liest.
 *
 * Gemessen wird deshalb der Motor: irgendeine Stelle dort muss den Schlüssel
 * WIRKLICH benutzen.
 */
function schluesselDieDerMotorLiest(): Set<string> {
  const gefunden = new Set<string>();

  const durchgehen = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner)) {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) {
        durchgehen(pfad);
        continue;
      }
      if (!eintrag.endsWith('.ts')) continue;

      /*
       * ⚠️ NUR Zeilen ohne Kommentar. Sonst machte ein Satz, der einen
       * Schlüssel bespricht, ihn gültig — der Wächter mässe die ERWÄHNUNG
       * statt den GEBRAUCH, und genau das ist im Haus schon dreimal
       * schiefgegangen.
       */
      const code = readFileSync(pfad, 'utf8')
        .split('\n')
        .filter((z) => {
          const t = z.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');

      // 12.08.2026: `dsfinvk` ergänzt — der sechste Schritt (Steuerberater)
      // schreibt diese Schlüssel, und der Motor liest sie wörtlich in
      // `routes/settings.ts` und `routes/closing-export.ts`. Der Punkt in
      // der Mitte bleibt Pflicht, ein Präfix allein zählt nicht.
      for (const treffer of code.matchAll(
        /['"`]((?:shop|steuer|kasse|betrieb|datev|dsfinvk)\.[a-z0-9_.]+)['"`]/g,
      )) {
        gefunden.add(treffer[1]!);
      }
    }
  };

  durchgehen(MOTOR);

  /*
   * ── 14.08.2026: die Modulschalter lesen NICHT im Motor, sondern in der
   * KASSE ────────────────────────────────────────────────────────────────
   *
   * `modul.kursleiste` schaltet die Kursleiste (MetalTicker), `modul.waage`
   * den Waagen-Block (GeraeteManager). Beide Leser sind Flächen; der Motor
   * kennt die Schlüssel nur als Einträge seiner Positivliste. Ein Wächter,
   * der nur den Motor abtastet, erklärte jeden Modulschalter zum erfundenen
   * Schlüssel — oder zwänge einen Schein-Leser in den Motor.
   *
   * Gemessen wird deshalb ZUSÄTZLICH die Kasse selbst, mit derselben
   * Disziplin: nur Zeilen ohne Kommentar, nur `modul.`-Schlüssel. Fällt der
   * echte Leser (der Ticker, der Waagen-Block), verschwindet der Schlüssel
   * aus dieser Menge, und der Eintrag im Assistenten wird ROT.
   */
  const KASSE = join(HIER, '../..');
  const kasseDurchgehen = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner)) {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) {
        kasseDurchgehen(pfad);
        continue;
      }
      if (!eintrag.endsWith('.ts') && !eintrag.endsWith('.tsx')) continue;
      if (eintrag.includes('.test.')) continue;
      if (pfad.includes('einrichtungs-schritte')) continue;
      const code = readFileSync(pfad, 'utf8')
        .split('\n')
        .filter((z) => {
          const t = z.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      for (const treffer of code.matchAll(/['"`](modul\.[a-z0-9_.]+)['"`]/g)) {
        gefunden.add(treffer[1]!);
      }
    }
  };
  kasseDurchgehen(KASSE);

  return gefunden;
}

describe('⛔ Jedes Feld des Assistenten trifft einen Schlüssel, den der Motor LIEST', () => {
  it('⛔ kein einziger erfundener Schlüssel', () => {
    const echte = schluesselDieDerMotorLiest();

    // Der Wächter selbst muss etwas gefunden haben, sonst prüft er nichts.
    expect(echte.size, 'nichts im Motor gelesen — der Pfad stimmt nicht').toBeGreaterThan(10);

    const erfunden = alleSchluessel().filter((k) => !echte.has(k));
    expect(
      erfunden,
      'diese Schlüssel liest im Motor NIEMAND; der Händler traegt ins Leere ein. ' +
        '`PATCH /api/settings/:key` legt jeden unbekannten Schluessel klaglos an, ' +
        'es gaebe also keine Fehlermeldung — nur eine Startliste, die rot bleibt.',
    ).toEqual([]);
  });

  it('⚠️ und der Wächter wird rot, wenn jemand einen erfindet', () => {
    // Gegenprobe: der Wächter ist scharf, nicht nur grün.
    const echte = schluesselDieDerMotorLiest();
    expect(echte.has('shop.legal_name'), 'ein bekannter Schluessel fehlt').toBe(true);
    /*
     * `shop.email` ist der ECHTE Beinahe-Fehler vom 09.08.2026 und steht hier
     * als Andenken: er sah aus wie die anderen und war keiner.
     */
    expect(echte.has('shop.email'), 'shop.email gibt es doch — dann darf er gefragt werden').toBe(
      false,
    );
    expect(echte.has('shop.gibt_es_nicht'), 'der Waechter nimmt alles an').toBe(false);
  });
});

describe('⚠️ Die Fragen bleiben brauchbar', () => {
  it('⚠️ jedes Feld sagt, WOFÜR es gebraucht wird und was ohne es passiert', () => {
    for (const s of EINRICHTUNGS_SCHRITTE) {
      for (const f of s.felder) {
        expect(f.wozu.trim(), `${f.schluessel}: kein Zweck`).not.toBe('');
        expect(f.wennLeer.trim(), `${f.schluessel}: keine Folge`).not.toBe('');
        expect(f.etikett.trim(), `${f.schluessel}: kein Etikett`).not.toBe('');
      }
    }
  });

  it('⚠️ eine Auswahl hat auch Optionen, sonst ist sie eine leere Liste', () => {
    for (const s of EINRICHTUNGS_SCHRITTE) {
      for (const f of s.felder) {
        if (f.art === 'auswahl') {
          expect(f.optionen?.length ?? 0, `${f.schluessel}: Auswahl ohne Optionen`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });

  it('⚠️ kein Schlüssel wird zweimal gefragt', () => {
    const alle = alleSchluessel();
    expect(alle.length, 'ein Schluessel steht in zwei Schritten').toBe(new Set(alle).size);
  });

  it('⚠️ jede Hilfe zeigt auf norns.de, nicht irgendwohin', () => {
    for (const s of EINRICHTUNGS_SCHRITTE) {
      if (s.hilfe !== undefined) {
        expect(s.hilfe.startsWith(HILFE_WURZEL), `${s.kennung}: fremde Adresse`).toBe(true);
      }
    }
  });

  /**
   * ⛔ JEDE HILFE IST EINE KENNUNG, NIE EIN PFAD
   *
   * ── DER BEFUND VOM 15.08.2026 ───────────────────────────────────────────
   *
   * Die Kasse lieferte in 0.6.0 acht Knöpfe aus, die alle unter
   * `norns.de/anleitung/…` lagen. Anonym gemessen antwortete schon die Wurzel
   * mit 404 — jeder dieser Knöpfe führte den Händler auf eine Fehlerseite, an
   * genau den Stellen, an denen er nicht weiterweiss.
   *
   * ── WARUM DIESER SATZ JETZT ANDERS PRÜFT ────────────────────────────────
   *
   * Zuerst stand hier ein Satz, der einen tiefen Pfad verbot, solange ein
   * Schalter sagte, die Unterseiten stünden nicht. Das hielt die 404 auf,
   * behandelte aber das Symptom. Die Ursache war, dass die ausgelieferte
   * Kasse überhaupt einen Pfad kannte.
   *
   * Seit dem 15.08.2026 schickt sie nur eine Kennung, und der Weiser auf
   * norns.de entscheidet. Damit gibt es keinen Zustand mehr, in dem ein
   * Verweis ins Leere zeigen kann, und der Schalter ist ersatzlos weg.
   *
   * Dieser Satz hält deshalb die neue Form fest: KEIN Verweis darf je wieder
   * einen Pfad in die Anleitung einbacken.
   */
  it('⛔ kein Hilfeverweis backt einen Pfad ein, jeder nennt nur eine Kennung', () => {
    for (const s of EINRICHTUNGS_SCHRITTE) {
      if (s.hilfe === undefined) continue;

      expect(
        s.hilfe.startsWith(`${HILFE_WURZEL}/h/`),
        `${s.kennung}: verweist nicht über den Weiser, sondern direkt — das ist die 404 von 0.6.0`,
      ).toBe(true);

      // ⛔ Ein Pfad in die Anleitung ist genau das, was nie wieder ausgeliefert wird.
      expect(s.hilfe, `${s.kennung}: enthält einen Pfad in die Anleitung`).not.toContain('/anleitung/');

      const kennung = s.hilfe.slice(`${HILFE_WURZEL}/h/`.length);
      expect(
        (HILFE_KENNUNGEN as readonly string[]).includes(kennung),
        `${s.kennung}: die Kennung ${kennung} steht nicht in der vereinbarten Liste`,
      ).toBe(true);
      // Namensraum davor, sonst kollidieren spätere Bereiche miteinander.
      expect(kennung, `${s.kennung}: Kennung ohne Namensraum`).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/);
    }
  });

  it('⛔ der Vertrag nennt genau so viele Seiten, wie Schritte Hilfe anbieten', () => {
    /*
     * ⚠️ Hier stand zuerst ein Vergleich der SCHRITTKENNUNG gegen
     * `HILFE_KENNUNGEN`, und er wurde sofort rot — zu Recht: der Schritt
     * `verantwortung` zeigt auf die Seite `verfahrensdokumentation`. Kennung
     * und Seitenname sind zwei verschiedene Dinge und dürfen es sein.
     *
     * Dass jede benutzte Seite im Vertrag steht, erzwingt ohnehin schon der
     * Typ: `hilfeFuer` nimmt nur Werte aus `HILFE_KENNUNGEN`, ein Tippfehler
     * bricht die Übersetzung. Was der Typ NICHT sieht, ist eine Seite, die im
     * Vertrag steht und die niemand benutzt — dann schuldet der Website-Bau
     * eine Seite, die nie jemand aufruft.
     */
    const mitHilfe = EINRICHTUNGS_SCHRITTE.filter((s) => s.hilfe !== undefined);
    /*
     * 19.08.2026: der Vertrag traegt seither auch die staendigen
     * Hausadressen (`norns.*`: Anleitung, Support, Preise — Einstellungen,
     * Hilfe-Bereich). Verglichen wird deshalb nur der Namensraum
     * `einrichtung.`, dessen Kennungen wirklich an Schritten haengen; die
     * Hausadressen prueft der Webseiten-Waechter gegen sein Register.
     */
    const einrichtungsKennungen = HILFE_KENNUNGEN.filter((k) => k.startsWith('einrichtung.'));
    expect(
      einrichtungsKennungen.length,
      'Der Vertrag verlangt mehr oder weniger Kennungen, als Schritte Hilfe anbieten. ' +
        'Entweder zeigt ein Schritt ins Leere, oder norns.de schuldet eine Seite, ' +
        'die niemand aufruft.',
    ).toBe(mitHilfe.length);
  });
});

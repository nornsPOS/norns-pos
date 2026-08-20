/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER SERVER RECHNETE DEN NACHWEIS AUS UND WARF IHN WEG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `darfReverseCharge` liefert seit dem 26.07.2026 ein Feld `belegvermerk`:
 *
 *     USt-IdNr. DE811907980 · EU-Abfrage vom 23.07.2026 · gültig
 *
 * In `transactions-finalize.ts` wurde davon ausschliesslich `urteil.erlaubt`
 * gelesen. Der Vermerk fiel auf den Boden.
 *
 * Und die Kasse rief `steuerausweisFuerBeleg(zeilen)` — OHNE zweites Argument.
 * Die Funktion ist für diesen Fall gebaut und lässt den Hinweis dann nicht
 * etwa weg, sondern druckt ihn ehrlich als Fehlanzeige:
 *
 *     „USt-IdNr.: Nachweis der EU-Abfrage FEHLT."
 *
 * Ergebnis: **jeder** § 13b-Beleg trug diesen Satz. Auch der, bei dem die
 * Abfrage getan, gültig und in der Datenbank festgehalten war — denn ohne
 * gültige Prüfung lässt `darfReverseCharge` den Verkauf gar nicht erst zu.
 * Der Satz stand also immer und ausnahmslos falsch da.
 *
 * ── Warum das mehr ist als ein Schönheitsfehler ──────────────────────────
 *
 * § 6a Abs. 4 UStG schützt den guten Glauben nur bei belegter Sorgfalt. Bei
 * einer Prüfung Jahre später liegt der BELEG auf dem Tisch, nicht die
 * Datenbank. Ein Beleg, der die eigene Sorgfalt bestreitet, ist schlechter
 * als gar keiner.
 *
 * ── Warum der Vermerk aus der PRÜFROUTE kommt und nicht aus finalize ─────
 *
 * Die Kasse siegelt ihren Belegrumpf VOR dem Netz (`sealFiscalRequest`,
 * `posIntentsStore.create`) — damit ein Absturz zwischen Kasse und Server
 * einen wiedereinspielbaren Vorgang hinterlässt. Was finalize antwortet,
 * kommt für den Beleg zu spät. Die Prüfung der USt-IdNr. geschieht aber
 * ohnehin vorher, am Tresen. Dort wird der Vermerk jetzt herausgegeben.
 */

import { describe, expect, it } from 'vitest';

import { belegvermerkFuerVatPruefung, darfReverseCharge } from '../../src/lib/reverse-charge.js';

describe('der Wortlaut steht an EINER Stelle', () => {
  it('so sieht er aus', () => {
    expect(belegvermerkFuerVatPruefung('DE811907980', new Date('2026-07-23T09:00:00Z'))).toBe(
      'USt-IdNr. DE811907980 · EU-Abfrage vom 23.07.2026 · gültig',
    );
  });

  it('⚠️ und `darfReverseCharge` baut ihn NICHT selbst nochmal', () => {
    // Zwei Fassungen desselben Satzes laufen auseinander, sobald eine geändert
    // wird — und dann steht auf dem Beleg etwas anderes als in der Prüfung.
    const u = darfReverseCharge({
      kunde: {
        vatId: 'DE811907980',
        geprueftesVatId: 'DE811907980',
        geprueftAm: new Date('2026-07-23T09:00:00Z'),
        ergebnis: 'GUELTIG',
      },
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(true);
    expect(u.belegvermerk).toBe(
      belegvermerkFuerVatPruefung('DE811907980', new Date('2026-07-23T09:00:00Z')),
    );
  });

  it('das deutsche Datum, nicht das englische', () => {
    expect(belegvermerkFuerVatPruefung('ATU12345678', new Date('2026-01-05T00:00:00Z'))).toContain(
      '05.01.2026',
    );
  });
});

describe('⛔ die Prüfroute gibt den Vermerk heraus — und NUR wenn er trägt', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/customers-verify-vat.ts', import.meta.url),
      'utf8',
    );

  it('⚠️ das Feld steht im ANTWORTSCHEMA', async () => {
    // Ohne diesen Eintrag entfernt Fastify das Feld still aus der Antwort.
    // Genau diese Falle hat in diesem Haus schon einmal zugeschlagen — und
    // sie hinterlässt keine Spur: der Server sendet, der Klient bekommt nichts.
    const q = await lies();
    const schema = q.slice(q.indexOf('const ResponseSchema'), q.indexOf('const QuerySchema'));
    const fallback = q.slice(q.indexOf('const ResponseSchema'), q.indexOf('const ResponseSchema') + 1800);
    expect(schema.length > 0 ? schema : fallback).toContain('belegvermerk:');
  });

  it('er wird aus der gemeinsamen Fassung gebaut, nicht neu getippt', async () => {
    const q = await lies();
    expect(q).toContain('belegvermerkFuerVatPruefung(');
  });

  it('⛔ und NUR bei gültig UND festgehalten', async () => {
    // Ein Vermerk zu einer Prüfung, die nirgends gespeichert ist, wäre eine
    // Behauptung ohne Grundlage — und finalize würde den Verkauf ohnehin
    // abweisen. Dann lieber kein Satz als ein unbelegter.
    const q = await lies();
    const i = q.indexOf('belegvermerk:\n');
    const stelle = q.slice(i, i + 260);
    expect(stelle).toContain("ergebnis === 'GUELTIG'");
    expect(stelle).toContain('gespeichert');
  });
});

/**
 * ⚠️ Der Wächter auf der Kassenseite.
 *
 * Er liest die Kasse, weil ihr Zustand hier nicht ausführbar ist. Was er prüft,
 * ist trotzdem das Entscheidende: dass der Vermerk WIRKLICH ins zweite Argument
 * geht — an BEIDEN Aufrufstellen. Eine allein zu versorgen ist der Fehler, der
 * sich beim Lesen am leichtesten übersieht.
 */
describe('die Kasse reicht ihn an den Beleg durch', () => {
  const liesKasse = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../../tauri-pos/src/screens/verkauf/BezahlenDialog.tsx', import.meta.url),
      'utf8',
    );

  it('⛔ BEIDE Aufrufe von steuerausweisFuerBeleg bekommen den Vermerk', async () => {
    const q = await liesKasse();
    const aufrufe = q.split('steuerausweisFuerBeleg(').length - 1;
    expect(aufrufe, 'die Zahl der Aufrufstellen hat sich geändert').toBe(2);
    /*
     * ⚠️ 20.08.2026: dieser Satz zählte die WÖRTLICHE Zeichenfolge
     * „viesBelegvermerk,\n          );" — also den Vermerk als LETZTES
     * Argument. Als der Steuerstatus des Betriebs dahinterkam (§ 19 UStG,
     * `betriebsmodus`), zählte er null und wurde rot, obwohl der Vermerk
     * unverändert durchgereicht wird.
     *
     * Ein Wächter, der die Schreibweise misst statt die Sache, wird bei
     * jeder Erweiterung rot und erzieht dazu, ihn abzuschalten. Er zählt
     * jetzt die Aufrufstellen, in deren Argumentliste der Vermerk STEHT —
     * gleich an welcher Stelle.
     */
    const mitVermerk = q
      .split('steuerausweisFuerBeleg(')
      .slice(1)
      .filter((teil) => teil.slice(0, teil.indexOf(');')).includes('viesBelegvermerk')).length;
    expect(mitVermerk, 'nicht jede Aufrufstelle reicht den Vermerk durch').toBe(2);
  });

  it('der Wortlaut wird in der Kasse NICHT nachgebaut', async () => {
    // Sonst gäbe es zwei Fassungen, und die des Belegs wäre die falsche.
    const q = await liesKasse();
    expect(q).not.toContain('EU-Abfrage vom');
  });

  it('⚠️ ein Vermerk aus einer FRÜHEREN Abfrage bleibt nicht stehen', async () => {
    // Er wird bei jeder Antwort neu gesetzt — auch auf null. Ein Satz zur
    // Nummer von vorhin auf dem Beleg von jetzt wäre schlimmer als keiner.
    const q = await liesKasse();
    expect(q).toContain('setViesBelegvermerk(res.belegvermerk ?? null);');
    expect(q).toContain('setViesBelegvermerk(null);');
  });

  it('und er steht in den Abhängigkeitslisten beider Rückrufe', async () => {
    // Ohne das hält React den Wert von vorher fest.
    const q = await liesKasse();
    const inListen = q.split(/^\s+viesBelegvermerk,$/m).length - 1;
    expect(inListen, 'der Vermerk fehlt in einer Abhängigkeitsliste').toBeGreaterThanOrEqual(2);
  });
});

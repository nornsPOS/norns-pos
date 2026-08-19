/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE USt-IdNr. DARF NICHT OHNE PRÜFSATZ EXISTIEREN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am Abend des 26.07.2026, Stunden nachdem der § 13b-Riegel ausgerollt war:
 * der Riegel stand, aber der einzige legitime Weg zu ihm war tot.
 *
 *   Kasse fragt die EU OHNE `customerId`   →  nichts wird festgehalten
 *   Kunde entsteht DANACH, `create` schreibt nur `vat_id`
 *   `darfReverseCharge`                    →  „nie geprüft"
 *   finalize                               →  403 VAT_CHECK_REQUIRED
 *   Kartenweg                              →  Karte SCHON belastet
 *
 * Geld gezogen, kein Vorgang gebucht, kein Ausweg.
 */

import { describe, expect, it, vi } from 'vitest';

import { frageVies, haltePruefungFest, pruefeUndHalteFest } from '../../src/lib/vies.js';

/** Ein Datenbankattrappe, die mitschreibt, was wirklich abgesetzt wurde. */
function db(treffer = 1) {
  const abgesetzt: unknown[] = [];
  return {
    abgesetzt,
    execute: async (q: unknown) => {
      abgesetzt.push(q);
      return treffer > 0 ? [{ id: 'kunde-1' }] : [];
    },
  };
}

describe('die EU-Abfrage trennt „ungueltig" von „konnte nicht fragen"', () => {
  it('eine Nummer ohne Form wird gar nicht erst abgefragt', async () => {
    const spion = vi.spyOn(globalThis, 'fetch');
    const a = await frageVies('XX');
    expect(a.ergebnis).toBe('FORMFEHLER');
    expect(spion).not.toHaveBeenCalled();
    spion.mockRestore();
  });

  it('die EU kennt sie nicht → UNGUELTIG', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ isValid: false }), { status: 200 }),
    );
    expect((await frageVies('DE811907980')).ergebnis).toBe('UNGUELTIG');
    vi.restoreAllMocks();
  });

  it('⚠️ ein AUSFALL ist NICHT „ungueltig", sondern NICHT_ERREICHBAR', async () => {
    // Vorher gaben beide Faelle `valid: false` zurueck, ununterscheidbar. Fuer
    // den Geschaeftskunden war das eine falsche Anschuldigung.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const a = await frageVies('DE811907980');
    expect(a.ergebnis).toBe('NICHT_ERREICHBAR');
    expect(a.error).toBe('VIES_UNAVAILABLE');
    vi.restoreAllMocks();
  });

  it('eine Zeitueberschreitung ebenso', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('abort'), { name: 'AbortError' }),
    );
    const a = await frageVies('DE811907980');
    expect(a.ergebnis).toBe('NICHT_ERREICHBAR');
    expect(a.error).toBe('VIES_TIMEOUT');
    vi.restoreAllMocks();
  });

  it('DE und ES verbergen die Angaben, das ist kein Mangel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ isValid: true, name: '   ', address: '' }), { status: 200 }),
    );
    const a = await frageVies('DE811907980');
    expect(a.ergebnis).toBe('GUELTIG');
    expect(a.name).toBe('---');
    vi.restoreAllMocks();
  });
});

describe('das Festhalten', () => {
  it('schreibt die abgefragte Nummer NORMALISIERT mit', async () => {
    // Ohne diese Spalte koennte man eine gepruefte Nummer eintragen, die
    // Pruefung stehenlassen und die Nummer danach austauschen.
    const d = db();
    await haltePruefungFest(d, 'kunde-1', 'de 811 907 980', { ergebnis: 'GUELTIG' });
    expect(JSON.stringify(d.abgesetzt)).toContain('DE811907980');
  });

  it('⚠️ meldet FALSCH, wenn keine Zeile beschrieben wurde', async () => {
    // Genau diese fuenf Spalten hat die Spaltenrechte-Falle in diesem Haus
    // schon zweimal live gesperrt. Ein stiller Erfolg waere hier fatal: der
    // Kunde traege eine USt-IdNr. und keinen Pruefsatz, und niemand wuesste es.
    expect(await haltePruefungFest(db(0), 'weg', 'DE811907980', { ergebnis: 'GUELTIG' })).toBe(false);
  });
});

describe('der eine Handgriff fuer jede schreibende Stelle', () => {
  it('ohne USt-IdNr. passiert gar nichts', async () => {
    const d = db();
    for (const leer of [null, undefined, '', '   ']) {
      expect(await pruefeUndHalteFest(d, 'k', leer)).toBeNull();
    }
    expect(d.abgesetzt).toHaveLength(0);
  });

  it('ein Ausfall bei der EU verhindert NICHT das Anlegen des Kunden', async () => {
    // Sonst koennte ein Netzproblem in Bruessel den Laden lahmlegen. Der
    // Pruefsatz sagt dann NICHT_ERREICHBAR, und § 13b bleibt gesperrt — das
    // ist die sichere Richtung.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('kein Netz'));
    const a = await pruefeUndHalteFest(db(), 'k', 'DE811907980');
    expect(a?.ergebnis).toBe('NICHT_ERREICHBAR');
    vi.restoreAllMocks();
  });

  it('und wirft auch dann nicht, wenn die Datenbank streikt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    );
    const kaputt = {
      execute: async () => {
        throw new Error('permission denied for column vat_id_check_result');
      },
    };
    const warnungen: string[] = [];
    await expect(
      pruefeUndHalteFest(kaputt, 'k', 'DE811907980', { warn: (_o, m) => void warnungen.push(m) }),
    ).resolves.toBeNull();
    expect(warnungen.join(' ')).toContain('fehlgeschlagen');
    vi.restoreAllMocks();
  });
});

/**
 * ⚠️ Die Wächter gegen die Rückkehr des toten Weges.
 *
 * Die Prüfungen oben belegen die Bibliothek. Sie sagen nichts darüber, ob die
 * schreibenden Routen sie auch AUFRUFEN — und genau das war der Fehler: der
 * Riegel stand, der Weg zu ihm nicht.
 */
describe('jede Stelle, die vat_id schreibt, loest die Pruefung aus', () => {
  const lies = async (datei: string) =>
    (await import('node:fs')).readFileSync(
      new URL(`../../src/routes/${datei}`, import.meta.url),
      'utf8',
    );

  /**
   * ⚠️ Auf den AUFRUF prüfen, nicht auf den Namen.
   *
   * Der erste Entwurf suchte schlicht `pruefeUndHalteFest`. Beim rot/grün-Beweis
   * habe ich den Aufruf entfernt und die EINFUHRZEILE stehenlassen — der
   * Wächter blieb grün. Ein Wächter, der den Import zählt, bewacht die
   * Importliste.
   */
  const ruftAuf = (q: string) => /(?<!as\s)\bpruefeUndHalteFest\s*\(/.test(q);

  it('das ANLEGEN prueft', async () => {
    const q = await lies('customers.ts');
    expect(ruftAuf(q), 'customers.ts schreibt vat_id ohne Pruefung').toBe(true);
  });

  it('das AENDERN prueft — und wirft den alten Satz weg', async () => {
    const q = await lies('customer-update.ts');
    expect(ruftAuf(q), 'customer-update.ts schreibt vat_id ohne Pruefung').toBe(true);
    // Der alte Satz gilt fuer die ALTE Nummer. Bliebe er stehen, waere er ein
    // Nachweis, der nie zu dieser Nummer gehoerte.
    expect(q, 'der alte Pruefsatz bleibt bei einer Aenderung stehen').toContain(
      'vat_id_checked_value = NULL',
    );
  });

  it('⚠️ die Abfrage steht AUSSERHALB der Transaktion', async () => {
    // Ein Netzaufruf mit 5 Sekunden Zeitgrenze in einer offenen Transaktion
    // haelt die Verbindung fest und legt sie unter Last lahm.
    const q = await lies('customers.ts');
    const tx = q.indexOf('app.db.transaction');
    const ruf = q.indexOf('pruefeUndHalteFest(');
    const ende = q.indexOf('return reply.status(200)', tx);
    expect(ruf, 'der Aufruf steht nicht nach der Transaktion').toBeGreaterThan(tx);
    expect(ruf, 'der Aufruf steht INNERHALB der Transaktion').toBeLessThan(ende);
  });
});

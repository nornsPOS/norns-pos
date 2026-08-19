/**
 * Die Entscheidung nach § 146a AO wird AUSGEFÜHRT, nicht nur gelesen.
 *
 * ── WARUM ES DIESE DATEI GEBEN MUSS ────────────────────────────────────────
 *
 * Die anderen Wächter um diesen Riegel sind Textsuchen. Sie fangen, dass die
 * Entscheidung existiert, dass sie den richtigen Schlüssel liest und dass sie
 * keine Erreichbarkeit prüft. Was sie NICHT fangen können: jemand lässt den
 * Lesevorgang stehen und hängt `|| true` an. Die Textsuche bliebe grün, und
 * der Riegel wäre aus.
 *
 * Genau diese Lücke hat dieses Haus schon zweimal getroffen. Deshalb hier die
 * Gegenprobe, die keine Zeichenkette liest, sondern die Funktion RUFT: eine
 * Attrappe liefert die Zeile, die Postgres liefern würde, und die Antwort
 * wird gemessen.
 *
 * ⚠️ Die Attrappe ist bewusst dumm. Sie gibt zurück, was ihr gesagt wird, und
 * hält fest, welche Anfrage gestellt wurde. Eine Attrappe, die selbst
 * entscheidet, prüft nur sich selbst.
 */

import { describe, expect, it } from 'vitest';

import { satzOhneSicherungseinrichtung } from '../../src/lib/kassenpflicht.js';
import {
  istSicherungseinrichtungEingerichtet,
  SCHLUESSEL_TSS_ID,
} from '../../src/lib/kassenpflicht.js';

/** Eine Datenbank-Attrappe, die genau eine Antwort kennt. */
function attrappe(antwort: { wert: string | null }[]): {
  db: Parameters<typeof istSicherungseinrichtungEingerichtet>[0];
  gefragt: () => number;
} {
  let anfragen = 0;
  const db = {
    execute: async () => {
      anfragen += 1;
      return antwort;
    },
  };
  return {
    db: db as unknown as Parameters<typeof istSicherungseinrichtungEingerichtet>[0],
    gefragt: () => anfragen,
  };
}

describe('Die Entscheidung nach § 146a AO', () => {
  it('⛔ eine Kasse OHNE Zeile ist nicht eingerichtet', async () => {
    const { db, gefragt } = attrappe([]);
    expect(await istSicherungseinrichtungEingerichtet(db)).toBe(false);
    // Und sie hat wirklich gefragt, statt aus dem Gedächtnis zu antworten.
    expect(gefragt()).toBe(1);
  });

  it('⛔ eine Kasse mit LEEREM Wert ist nicht eingerichtet', async () => {
    expect(await istSicherungseinrichtungEingerichtet(attrappe([{ wert: '' }]).db)).toBe(false);
  });

  it('⛔ eine Kasse mit NULL ist nicht eingerichtet', async () => {
    expect(await istSicherungseinrichtungEingerichtet(attrappe([{ wert: null }]).db)).toBe(false);
  });

  it('⛔ und Leerzeichen sind kein Nachweis', async () => {
    // Ein Feld, in das jemand versehentlich ein Leerzeichen getippt hat, darf
    // eine fiskalische Sperre nicht aufheben.
    for (const wert of [' ', '   ', '\t', '\n']) {
      expect(
        await istSicherungseinrichtungEingerichtet(attrappe([{ wert }]).db),
        `„${JSON.stringify(wert)}" darf nicht als eingerichtet gelten`,
      ).toBe(false);
    }
  });

  it('✅ eine Kasse mit einer echten Kennung IST eingerichtet', async () => {
    expect(
      await istSicherungseinrichtungEingerichtet(
        attrappe([{ wert: '4f3c2a10-0000-4000-8000-000000000001' }]).db,
      ),
    ).toBe(true);
  });

  it('✅ und Leerzeichen AUSSEN stören eine echte Kennung nicht', async () => {
    // Nachsicht beim Kopieren aus einem Brief. Der Wert ist da, nur unsauber
    // getippt: das darf keine Sperre auslösen.
    expect(await istSicherungseinrichtungEingerichtet(attrappe([{ wert: '  tss-1  ' }]).db)).toBe(
      true,
    );
  });

  it('der Schlüssel ist der, den die Einrichtungsroute setzt', () => {
    expect(SCHLUESSEL_TSS_ID).toBe('tse.tss_id');
  });

  /**
   * ⚠️ 13.08.2026: hier stand `satzOhneSicherungseinrichtung`. Er sagte „Ein
   * Verkauf ist bis dahin nicht möglich", und seit dem Vorrat von zehn Belegen
   * stimmte das nicht mehr. Der Satz ist gelöscht, die Prüfung wandert auf die
   * Sätze, die WIRKLICH gezeigt werden.
   */
  it('der Absagesatz nennt die Norm, den Ort und den Vorgang', () => {
    for (const vorgang of ['Verkauf', 'Ankauf'] as const) {
      const satz = satzOhneSicherungseinrichtung(vorgang);
      expect(satz).toContain('§ 146a AO');
      expect(satz, 'ohne Weg ist eine Absage ein Vorwurf').toMatch(/Einstellungen, Geräte/);
      expect(satz).toContain(vorgang);
      // Hausregel: kein Gedankenstrich in sichtbarem Text.
      expect(satz).not.toMatch(/[—–]/);
    }
  });
});

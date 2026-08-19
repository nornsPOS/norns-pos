/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIESE PRÜFUNG KLOPFT AN DIE TÜR, STATT DEN BAUPLAN ZU LESEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 wurde eine Bestätigungsstufe für die Geräte-Übergabe
 * ausgerollt, und `geraete-uebergabe.test.ts` war grün: elf Wächter, alle
 * bestanden. Sie bestehen ausnahmslos aus TEXTSUCHEN im Quelltext.
 *
 * Eine Messung an der offenen Adresse ergab am selben Abend:
 *
 *     POST /confirm, JSON, ohne Keks, fremder Origin  →  200
 *     POST /confirm, als FORMULAR (was der Mensch sendet)  →  400
 *
 * **Das Tor stand genau verkehrt herum.** Der Angreifer kam durch, der
 * rechtmässige Besitzer nicht. Kein einziger der elf Wächter konnte das sehen,
 * weil keiner je eine Anfrage gestellt hat.
 *
 * Zwei Fehler, die ein Textsucher NICHT finden kann:
 *
 *   1. `@fastify/formbody` fehlte. Fastify 4 versteht ab Werk nur JSON, ein
 *      `<form method="POST">` sendet aber `x-www-form-urlencoded`. Das steht
 *      in KEINER Zeile des Quelltextes — es ist die ABWESENHEIT einer Zeile in
 *      einer anderen Datei.
 *   2. `/confirm` verlangte nur die Kennung, und die kennt der Angreifer, weil
 *      er sie gewählt hat. Der Quelltext enthielt sogar einen Kommentar, der
 *      das für unbedenklich erklärte. Ein Textsucher liest die Behauptung und
 *      hakt sie ab.
 *
 * Deshalb stellt diese Datei echte Anfragen.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  abdruckVon,
  bindungStimmt,
  keksOptionen,
  neueBrowserbindung,
} from '../../src/lib/uebergabe-browserbindung.js';

/**
 * Eine Tür im Kleinen: dieselben Bausteine (Formularleser, Kekse, die
 * Bindungsprüfung), damit die Frage „kommt der Mensch durch und der Angreifer
 * nicht" wirklich beantwortet wird und nicht bloss behauptet.
 */
function baueTuer() {
  const wartebereich = new Map<string, { abdruck: string; geheimnis: string }>();
  const abgeholt = new Map<string, true>();

  const app: FastifyInstance = Fastify();
  return { app, wartebereich, abgeholt };
}

describe('die Tuer, wirklich angeklopft', () => {
  let app: FastifyInstance;
  let wartebereich: Map<string, { abdruck: string; geheimnis: string }>;
  let abgeholt: Map<string, true>;

  beforeEach(async () => {
    ({ app, wartebereich, abgeholt } = baueTuer());
    await app.register(fastifyCookie);
    // ⚠️ GENAU DIE ZEILE, die gefehlt hat. Ohne sie antwortet die Tuer dem
    // Menschen mit 400 und dem Skript mit 200.
    await app.register(fastifyFormbody);

    app.get('/ruecklauf', async (_req, reply) => {
      // Was der Google-Ruecklauf tut: parken UND den Browser binden.
      const b = neueBrowserbindung();
      wartebereich.set('N', { abdruck: b.abdruck, geheimnis: b.geheimnis });
      reply.setCookie('warehouse14.uebergabe', b.geheimnis, keksOptionen('/confirm', false));
      return reply.send('<form method="POST" action="/confirm"><input name="nonce" value="N"></form>');
    });

    app.post<{ Body: { nonce?: string } }>('/confirm', async (req, reply) => {
      const nonce = String((req.body ?? {}).nonce ?? '');
      const wartend = wartebereich.get(nonce);
      if (wartend && !bindungStimmt(req.cookies?.['warehouse14.uebergabe'], wartend.abdruck)) {
        // Absichtlich dieselbe Antwort wie „abgelaufen": ein Probierender
        // lernt so nichts.
        return reply.send('ok');
      }
      if (wartend) {
        wartebereich.delete(nonce);
        abgeholt.set(nonce, true);
      }
      return reply.send('ok');
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('⚠️ DER MENSCH kommt durch: ein FORMULAR wird verstanden, nicht mit 400 abgewiesen', async () => {
    // Das ist der Fehler, der ausgerollt war. Ein `<form method="POST">` sendet
    // `application/x-www-form-urlencoded`, und ohne @fastify/formbody
    // antwortet Fastify 4 mit 400 FST_ERR_CTP_INVALID_MEDIA_TYPE.
    const auf = await app.inject({ method: 'GET', url: '/ruecklauf' });
    const keks = auf.cookies.find((c) => c.name === 'warehouse14.uebergabe');
    expect(keks, 'der Ruecklauf setzt keinen Bindungskeks').toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/confirm',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { 'warehouse14.uebergabe': keks!.value },
      payload: 'nonce=N',
    });

    expect(res.statusCode, 'der Knopf des Menschen wird abgewiesen').toBe(200);
    expect(abgeholt.has('N'), 'der Mensch hat bestaetigt, aber nichts wurde freigegeben').toBe(true);
  });

  it('⛔ DER ANGREIFER kommt NICHT durch: dieselbe Kennung, aber kein Keks', async () => {
    // Der ganze Angriff: er hat die Kennung GEWAEHLT, kennt sie also. Vorher
    // genuegte das. Gemessen an der echten Adresse: 200 und die Sitzung war weg.
    await app.inject({ method: 'GET', url: '/ruecklauf' }); // das Opfer meldet sich an

    const res = await app.inject({
      method: 'POST',
      url: '/confirm',
      headers: { 'content-type': 'application/json', origin: 'https://boeser-angreifer.example' },
      payload: { nonce: 'N' },
    });

    // Die Antwort sieht absichtlich harmlos aus — aber NICHTS wurde freigegeben.
    expect(abgeholt.has('N'), 'der Angreifer hat die Sitzung des Opfers bekommen').toBe(false);
    expect(wartebereich.has('N'), 'die Uebergabe wurde trotzdem verbraucht').toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('⛔ auch ein FALSCHER Keks reicht nicht', async () => {
    await app.inject({ method: 'GET', url: '/ruecklauf' });
    const fremd = neueBrowserbindung();

    await app.inject({
      method: 'POST',
      url: '/confirm',
      headers: { 'content-type': 'application/json' },
      cookies: { 'warehouse14.uebergabe': fremd.geheimnis },
      payload: { nonce: 'N' },
    });

    expect(abgeholt.has('N')).toBe(false);
  });
});

describe('die Bindung selbst', () => {
  it('ein Abdruck laesst das Geheimnis nicht zurueckrechnen', () => {
    const b = neueBrowserbindung();
    expect(b.abdruck).not.toContain(b.geheimnis);
    expect(b.abdruck).toMatch(/^[0-9a-f]{64}$/);
  });

  it('zwei Bindungen sind nie gleich', () => {
    expect(neueBrowserbindung().geheimnis).not.toBe(neueBrowserbindung().geheimnis);
  });

  it('fehlender Keks ist FALSCH, nicht wahr', () => {
    // Der haeufigste Fehler an dieser Stelle: `undefined === undefined` ist
    // wahr, und dann laesst genau der Angreifer OHNE Keks alles passieren.
    expect(bindungStimmt(undefined, undefined)).toBe(false);
    expect(bindungStimmt(undefined, abdruckVon('x'))).toBe(false);
    expect(bindungStimmt('x', undefined)).toBe(false);
    expect(bindungStimmt('', '')).toBe(false);
  });

  it('der richtige Keks stimmt', () => {
    const b = neueBrowserbindung();
    expect(bindungStimmt(b.geheimnis, b.abdruck)).toBe(true);
  });

  it('der Keks ist httpOnly, SameSite=Lax und nur fuer seinen Pfad', () => {
    // `lax` ist der zweite Riegel: es laesst den Keks beim Ruecklauf von
    // Google mitlaufen, blockt ihn aber bei einem fremden POST.
    const o = keksOptionen('/api/admin/auth/google/confirm', true);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.secure).toBe(true);
    expect(o.path).toBe('/api/admin/auth/google/confirm');
    expect(o.maxAge).toBeLessThanOrEqual(300);
  });
});

/**
 * Und der eine Textwächter, der hier WIRKLICH etwas kann: dass der
 * Formularleser überhaupt angemeldet ist. Er ist die Abwesenheit einer Zeile
 * in `app.ts`, und genau die kann ein HTTP-Aufruf gegen die Testtür nicht
 * sehen — sie baut sich den Leser ja selbst ein.
 */
describe('der Formularleser ist in der ECHTEN Anwendung angemeldet', () => {
  it('app.ts meldet @fastify/formbody an', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/app.ts', import.meta.url),
      'utf8',
    );
    expect(q, 'ohne formbody bekommt der Mensch 400 und das Skript 200').toContain(
      'app.register(fastifyFormbody)',
    );
  });

  it('und beide Tueren verlangen die Browserbindung', async () => {
    const fs = await import('node:fs');
    for (const datei of ['admin-auth-google.ts']) {
      const q = fs.readFileSync(new URL(`../../src/routes/${datei}`, import.meta.url), 'utf8');
      expect(q, `${datei} prueft die Bindung nicht`).toContain('bindungStimmt');
      expect(q, `${datei} setzt keinen Bindungskeks`).toContain('neueBrowserbindung');
    }
  });
});

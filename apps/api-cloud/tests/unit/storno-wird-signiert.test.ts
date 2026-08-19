/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  JEDER STORNO WAR OHNE TSE-SIGNATUR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `StornoDialog.tsx` schickte den POST und sonst nichts. Keine Intention,
 * kein FINISH, keine Aufzeichnung der Signatur.
 *
 * Auf der Produktion am 28.07.2026 gemessen:
 *
 *     SELECT count(*) FILTER (WHERE storno_of_transaction_id IS NOT NULL)      → 1
 *     ... und davon ohne Signatur                                              → 1
 *
 * Also ausnahmslos. Im Monatslauf dasselbe Bild: 73 Vorgänge, 72 Signaturen.
 *
 * ── Warum das kein Randfall ist ──────────────────────────────────────────
 *
 * § 146a AO kennt keine Ausnahme für die Rücknahme. Ein Storno ist ein
 * aufzeichnungspflichtiger Geschäftsvorfall wie der Verkauf, den er aufhebt.
 *
 * Und er ist der WICHTIGERE der beiden: die Buchung, die einen Erlös wieder
 * verschwinden lässt, ist die, die ein Prüfer zuerst ansieht. Genau dort
 * fehlte der Nachweis, dass sie zu ihrer Zeit und in dieser Reihenfolge
 * stattgefunden hat.
 */

import { describe, expect, it } from 'vitest';

const liesKasse = async () =>
  (await import('node:fs')).readFileSync(
    new URL('../../../tauri-pos/src/screens/verkauf/StornoDialog.tsx', import.meta.url),
    'utf8',
  );

const ohneKommentare = (q: string) =>
  q
    .split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join('\n');

describe('⛔ der Storno durchläuft die ganze TSE-Kette', () => {
  it('Vorgangsbeginn VOR dem Schreiben', async () => {
    const q = ohneKommentare(await liesKasse());
    const auf = q.indexOf('openTseSession(');
    const post = q.indexOf("'/api/transactions/storno'");
    expect(auf, 'keine TSE-Intention beim Storno').toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);
    expect(auf, 'die Intention wird erst NACH dem Storno geöffnet').toBeLessThan(post);
  });

  it('Signatur NACH dem Schreiben', async () => {
    const q = ohneKommentare(await liesKasse());
    expect(q).toContain('closeTseSession(');
    expect(q.indexOf('closeTseSession(')).toBeGreaterThan(
      q.indexOf("'/api/transactions/storno'"),
    );
  });

  it('⛔ und sie wird auf dem SERVER aufgezeichnet', async () => {
    // Nur auf dem Bon zu stehen genügt nicht — GoBD und BSI TR-03153
    // verlangen die dauerhafte Aufbewahrung, verknüpft mit dem Vorgang.
    const q = ohneKommentare(await liesKasse());
    expect(q, 'die Signatur wird nirgends festgehalten').toContain('recordTseSignature(');
    // Und zwar am STORNO, nicht am Original.
    expect(q).toMatch(/recordTseSignature\(\s*api\s*,\s*stornoRes\.id/);
  });

  it('⚠️ ein Fehlschlag der Signatur macht den Storno NICHT rückgängig', async () => {
    // Der Storno ist gebucht. Ihn wegen einer fehlenden Signatur zu
    // verwerfen hiesse, dem Kunden sein Geld nicht zurückzugeben, weil ein
    // Gerät nicht antwortet.
    const q = await liesKasse();
    const i = q.indexOf('closeTseSession(');
    // ⚠️ Der Abstand ist GEMESSEN, nicht geraten: seit dem 11.08.2026 liegt
    // zwischen `closeTseSession(` und dem Auffangen der ausfuehrliche Absatz
    // ueber das frueher LEERE `catch {}`. Ein zu enges Fenster machte den
    // Satz rot, ohne dass etwas kaputt waere.
    const block = q.slice(i, i + 6000);
    expect(block, 'kein Auffangen um die Signaturkette').toMatch(/\}\s*catch/);
  });

  it('⛔ und der Fehlschlag verschwindet nicht in einem LEEREN Auffangen', async () => {
    /*
     * ── DER BEFUND VOM 11.08.2026, UND WARUM DIESER SATZ NEU IST ─────────
     *
     * Der Satz darüber verlangte wörtlich `} catch {` — also GENAU die
     * Schreibweise des leeren Auffangens. Er hat damit den Defekt
     * FESTGEPINNT: in `StornoDialog.tsx` stand nach erfolgreichem FINISH
     *
     *     } catch {
     *       // Der Storno steht. Die Signatur holt die Warteschlange nach.
     *     }
     *
     * und `grep -c "enqueueSignatureRecordOnly"` ergab 0. Der Kommentar
     * behauptete das Gegenteil dessen, was der Code tat: es gab keine
     * Warteschlange, die hier etwas nachholte. Der FINISH war gelungen, die
     * Signatur lag im Fenster, und sie verschwand beim nächsten Klick,
     * sobald der Server die Aufzeichnung ablehnte. Hausklasse
     * „Prüfstand macht denselben Fehler".
     *
     * Verkauf und Ankauf rufen an derselben Stelle `enqueueSignatureRecordOnly`
     * UND melden dem Kassierer, ob die Sicherung geklappt hat. Der Storno tat
     * beides nicht.
     *
     * Gemessen wird deshalb ab jetzt der GEBRAUCH der Sicherung, nicht die
     * Schreibweise des Auffangens.
     */
    const q = ohneKommentare(await liesKasse());
    expect(q, 'der Storno sichert die Signatur nicht in die Warteschlange').toContain(
      'stornoSignaturSichern(',
    );
    // Und das leere Auffangen darf nicht zurückkehren.
    expect(
      /\}\s*catch\s*\{\s*\}/.test(q),
      'ein LEERES Auffangen ist zurück: die Signatur verschwindet wieder still',
    ).toBe(false);
  });

  it('⛔ der Storno sendet die Gerätezeit mit', async () => {
    const q = ohneKommentare(await liesKasse());
    expect(q).toContain('erfasstAm:');
  });
});

describe('was NICHT passieren darf', () => {
  it('⛔ der blosse POST ohne jede TSE-Kette ist nicht zurück', async () => {
    const q = ohneKommentare(await liesKasse());
    // Die alte Form: der Aufruf direkt an `api.request` ohne alles davor.
    const nackt =
      /await api\.request\('POST',\s*'\/api\/transactions\/storno',\s*\{\s*originalTransactionId: transactionId,\s*reason: reason\.trim\(\),\s*\}\);/;
    expect(nackt.test(q), 'der Storno läuft wieder ohne Signatur').toBe(false);
  });
});

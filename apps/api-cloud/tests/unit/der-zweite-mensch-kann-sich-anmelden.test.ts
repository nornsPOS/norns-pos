/**
 * Ein zweiter Mensch kann sich an dieser Kasse anmelden.
 *
 * ── DER FUND VOM 01.08.2026 ─────────────────────────────────────────────────
 *
 * `resolveCandidateUser` las AUSSCHLIESSLICH `devices.paired_by_user_id`. Ein
 * Gerät, ein Mensch, für immer. Auf einer Norns-Kasse zeigt diese Spalte auf
 * den bei der Erstsaat angelegten Inhaber (`inhaber@norns.lokal`).
 *
 * Die Folge war nicht „unbequem", sondern strukturell:
 *
 *   • `POST /api/admin/staff` legt Mitarbeiter an. Die Team-Fläche zeigt sie.
 *   • Ihr vorgesehener Anmeldeweg ist die Google-Anmeldung, und die gibt es
 *     auf dieser Kasse nicht.
 *   • Also konnte KEINER von ihnen sich je anmelden.
 *   • Und jede fiskalische Zeile trug denselben synthetischen Menschen.
 *
 * Bedienerzuordnung nach § 146a AO war damit nicht unfertig, sondern
 * unmöglich.
 *
 * ── DIE ZWEI EIGENSCHAFTEN, DIE DIESER WÄCHTER SCHÜTZT ─────────────────────
 *
 * 1. DIE SPERRE HÄNGT AM MENSCHEN, NICHT AM GERÄT. Deshalb sagt der Klient,
 *    WER er ist, statt den Code gegen alle Benutzer zu prüfen. Bei einem
 *    falschen Code wüsste man sonst nicht, wessen Zähler steigt, und zehn
 *    Fehlversuche für A würden B aussperren.
 *
 * 2. DER WUNSCH WIRD GEPRÜFT, NICHT GEGLAUBT. Der gewünschte Mensch muss
 *    bereits einen Kassencode haben. Das schützt eine ANDERE Auslieferung als
 *    Norns: hier horcht der Motor auf `127.0.0.1` und ist nur aus dem eigenen
 *    Fenster erreichbar, in der Wolkenfassung von Warehouse14 ist diese Route
 *    dagegen aus dem Netz erreichbar. Dort könnte sonst jemand die Sperre
 *    eines NAMENTLICH gewählten Mitarbeiters auslösen. Wer keinen Code hat,
 *    kann auch nicht ausgesperrt werden.
 *
 * Und ein unbekannter Wunsch wird STILL auf den gepaarten Menschen
 * zurückgeführt. Eine eigene Fehlermeldung wäre ein Orakel darüber, welche
 * Kennungen existieren und wer einen Code hat.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const AUTH = join(HIER, '../../src/routes/auth-pin.ts');

function quelle(): string {
  return readFileSync(AUTH, 'utf8');
}

/** Kommentare weg: eine Erklärung ist kein Verhalten. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Der zweite Mensch kann sich anmelden', () => {
  it('findet die Datei — sonst prüft dieser Test nichts', () => {
    expect(quelle().length).toBeGreaterThan(5000);
  });

  it('die Anmeldung nimmt entgegen, WER sich anmeldet', () => {
    // Der eigentliche Fund: vorher gab es dieses Feld nicht, und die Anmeldung
    // konnte strukturell nur einen Menschen kennen.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/userId: Type\.Optional\(Type\.String\(\{ format: 'uuid' \}\)\)/);
  });

  it('reicht den Wunsch WIRKLICH an die Auflösung weiter', () => {
    // Ein entgegengenommenes und dann ignoriertes Feld wäre die schlimmere
    // Fassung des alten Fehlers: die Oberfläche böte eine Wahl an, die nichts
    // bewirkt, und jede Buchung trüge weiter den falschen Namen.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/resolveCandidateUser\(app, req\.deviceId, gewuenschterMensch/);
  });

  it('prüft den Wunsch, statt ihm zu glauben', () => {
    const rumpf = ohneKommentare(quelle());
    const fn = /async function resolveCandidateUser[\s\S]*?\n\}/.exec(rumpf)?.[0] ?? '';
    expect(fn.length, 'die Auflösung ist nicht auffindbar').toBeGreaterThan(200);
    // Der gewünschte Mensch muss einen Kassencode haben.
    expect(fn).toMatch(/isNotNull\(users\.posPinHash\)/);
  });

  it('führt einen unbekannten Wunsch STILL auf den gepaarten Menschen zurück', () => {
    // Kein eigener Fehler: der wäre ein Orakel über vorhandene Kennungen.
    const rumpf = ohneKommentare(quelle());
    const fn = /async function resolveCandidateUser[\s\S]*?\n\}/.exec(rumpf)?.[0] ?? '';
    expect(fn).toMatch(/return \{ userId: r\.pairedBy \}/);
    // Und im Wunschzweig darf nichts geworfen werden.
    const zweig = /if \(wunschUserId != null[\s\S]*?\n  \}/.exec(fn)?.[0] ?? '';
    expect(zweig.length).toBeGreaterThan(50);
    expect(zweig).not.toMatch(/throw/);
  });

  it('die Anmelde-Auflösung wird NIE zum Setzen eines Codes benutzt', () => {
    // ⚠️ 02.08.2026: Dieser Satz behauptete zwischenzeitlich, `pin/set` löse
    // weiterhin über `resolveCandidateUser` auf. Das stimmte nach dem Umbau
    // nicht mehr — er war grün mit einer falschen Begründung, und das ist
    // schlimmer als rot.
    //
    // Was WIRKLICH zählt: die zwei Auflösungen tragen entgegengesetzte
    // Bedingungen. Würde `pin/set` je die Anmelde-Auflösung benutzen, könnte
    // jemand den Code eines Menschen setzen, der schon einen hat.
    const rumpf = ohneKommentare(quelle());
    const setzen = /const \{ newPin \}[\s\S]*?const isProd/.exec(rumpf)?.[0] ?? '';
    expect(setzen.length, 'der Setz-Weg ist nicht auffindbar').toBeGreaterThan(200);
    expect(setzen).toMatch(/resolveErstanspruch/);
    expect(
      setzen,
      'der Setz-Weg darf die Anmelde-Auflösung nicht benutzen',
    ).not.toMatch(/resolveCandidateUser/);
  });

  it('es gibt eine Liste, aus der die Oberfläche wählen kann', () => {
    // Ohne sie ist die Wahl nicht benutzbar: die Oberfläche kann keinen
    // Menschen anbieten, den sie nicht kennt.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/'\/api\/auth\/anmeldbare-personen'/);
  });

  it('die Liste zeigt AUCH, wer noch keinen Code hat', () => {
    // ⚠️ 02.08.2026, nach einem Umweg: der erste Anlauf zeigte nur, wer schon
    // einen Code HAT. Das klang sparsam und war eine Sackgasse — ein frisch
    // angelegter Mitarbeiter erschien nirgends, konnte nirgends gewählt werden
    // und kam damit nie zu seinem ersten Code.
    const rumpf = ohneKommentare(quelle());
    const route = /anmeldbare-personen[\s\S]*?\n  \);/.exec(rumpf)?.[0] ?? '';
    expect(route.length, 'die Route ist nicht auffindbar').toBeGreaterThan(300);
    expect(route).toMatch(/hatCode/);
    // Und sie darf NICHT mehr filtern.
    expect(route).not.toMatch(/where\(isNotNull\(users\.posPinHash\)\)/);
  });

  it('die Liste gibt den Hash selbst niemals heraus', () => {
    // Sie liest ihn, um `hatCode` zu bilden. Er darf den Server nicht
    // verlassen.
    const rumpf = ohneKommentare(quelle());
    const route = /anmeldbare-personen[\s\S]*?\n  \);/.exec(rumpf)?.[0] ?? '';
    const antwort = /personen: zeilen\.map[\s\S]*?\}\)\),/.exec(route)?.[0] ?? '';
    expect(antwort.length, 'die Antwortbildung ist nicht auffindbar').toBeGreaterThan(80);
    expect(antwort).toMatch(/hatCode: z\.pinHash !== null/);
    expect(antwort).not.toMatch(/pinHash: z\.pinHash/);
  });

  /**
   * ── DER ERSTE CODE EINES ZWEITEN MENSCHEN ────────────────────────────────
   *
   * Der Inhaber soll den Code seiner Mitarbeiter NIE kennen. Kennte er ihn,
   * wäre die Bedienerzuordnung nach § 146a AO wertlos: jede Buchung des
   * Mitarbeiters könnte ebenso gut von ihm stammen.
   *
   * Deshalb tippt er ihn nicht ein, sondern LÖSCHT ihn. Der Mitarbeiter setzt
   * danach am Tresen seinen eigenen.
   */
  it('der Erstanspruch hat die UMGEKEHRTE Bedingung, in einer eigenen Funktion', () => {
    // `resolveCandidateUser` (Anmelden) verlangt einen VORHANDENEN Code,
    // `resolveErstanspruch` (Erstcode) verlangt KEINEN. Beide Regeln in eine
    // Funktion mit einem Schalter zu giessen wäre kürzer und gefährlich: ein
    // falsch gesetzter Schalter liesse jemanden fremde Codes überschreiben.
    const rumpf = ohneKommentare(quelle());
    const fn = /async function resolveErstanspruch[\s\S]*?\n\}/.exec(rumpf)?.[0] ?? '';
    expect(fn.length, 'resolveErstanspruch fehlt').toBeGreaterThan(200);
    expect(fn).toMatch(/isNull\(users\.posPinHash\)/);
    expect(fn, 'der Erstanspruch darf keinen vorhandenen Code verlangen').not.toMatch(
      /isNotNull\(users\.posPinHash\)/,
    );
  });

  it('das Setzen des Erstcodes nutzt WIRKLICH diese Auflösung', () => {
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/resolveErstanspruch\(app, req\.deviceId, wunsch\)/);
  });

  it('die Liste gibt keine E-Mail und keine Kennzahlen heraus', () => {
    // Nur Kennung, Name und Rolle. Der Name steht ohnehin gleich auf dem Bon.
    const rumpf = ohneKommentare(quelle());
    const route = /anmeldbare-personen[\s\S]*?\n  \);/.exec(rumpf)?.[0] ?? '';
    for (const verboten of ['email', 'posPinHash:', 'duressPinHash', 'FailedAttempts']) {
      expect(route, `die Personenliste darf „${verboten}" nicht herausgeben`).not.toContain(
        verboten,
      );
    }
  });

  it('die Liste hat dasselbe Tor wie die Anmeldung', () => {
    // Ohne gepaartes Gerät gibt es nichts zu sehen.
    const rumpf = ohneKommentare(quelle());
    const route = /anmeldbare-personen[\s\S]*?\n  \);/.exec(rumpf)?.[0] ?? '';
    expect(route).toMatch(/resolveCandidateUser\(app, req\.deviceId\)/);
    expect(route).toMatch(/personen: \[\]/);
  });
});

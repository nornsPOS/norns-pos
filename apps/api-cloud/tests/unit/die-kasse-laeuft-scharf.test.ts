/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ EINE ZEILE HÄLT NEUN RIEGEL — UND SIE STAND UNBEWACHT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 22.08.2026 ─────────────────────────────────────────────
 *
 * Im Dienst steht vor dem Start des Servers EINE Zuweisung:
 *
 *     Object.assign(process.env, { NODE_ENV: 'production', … })
 *
 * An ihr hängen neun Verhaltensweisen, jede sicherheitsrelevant. Ohne sie
 * läuft die Kasse des Händlers im ENTWICKLERMODUS, und zwar still:
 *
 *   • der Sperrliste-Riegel auf den DREI Notausgängen fällt — `123456` käme
 *     als neuer Kassencode durch, genau die Hintertür, die `kassencode-
 *     neusetzen.ts` ausdrücklich nicht sein darf,
 *   • dieselbe Sperrliste auf dem gewöhnlichen Codewechsel und auf dem
 *     Zwangs-Code fällt mit,
 *   • die Oberfläche der Schnittstellenbeschreibung wird eingehängt: der
 *     vollständige Wegeplan eines Systems, das Gold, Bargeld, Ausweisbilder
 *     und Steuerdaten hält — auf dem Rechner im Laden,
 *   • der mTLS-Geräteriegel lockert,
 *   • die Sperren gegen zu viele Anfragen lockern,
 *   • die Sitzungskekse verlieren ihre strenge Herkunftsbindung,
 *   • ⚠️ UND DER RIEGEL, DER DAS ALLES MELDEN SOLLTE, SCHALTET SICH SELBST
 *     AB: `assertNoTestDeviceFingerprintInProd` beginnt mit
 *     `if (env.NODE_ENV !== 'production') return;`. Er weigert sich, mit
 *     einem Prüf-Fingerabdruck zu starten — aber nur, wenn er sich für
 *     scharf hält. Fällt die Zeile, schweigt auch er.
 *
 * ── ⚠️ WARUM KEINE EINZIGE ANDERE PROBE DAS SEHEN KANN ────────────────────
 *
 * Proben laufen mit `NODE_ENV=test`. JEDER dieser neun Zweige wird in der
 * Prüfung also ausschliesslich in seiner LOCKEREN Fassung durchlaufen. Die
 * Wand ist grün, WEIL sie den scharfen Weg nie geht. Vor dieser Datei nannte
 * keine einzige Probe des Motors `NODE_ENV` auch nur (gemessen).
 *
 * ── WAS DIESE PROBE MISST ─────────────────────────────────────────────────
 *
 *   1. Beide Abschriften des Dienstes setzen die Zeile.
 *   2. Sie steht VOR `loadEnv()` und vor `buildApp(` — eine Umgebung, die
 *      nach dem Bau gesetzt wird, kommt zu spät.
 *   3. Das AUSGELIEFERTE Bündel trägt sie ebenfalls. Der Dienst ist eine
 *      vorgebaute Datei; wer nur die Quelle prüft, prüft nicht, was fährt.
 *   4. Die neun Abhängigen stehen namentlich in einer Liste und werden an
 *      der echten Stelle nachgewiesen. Taucht ein NEUER Zweig auf, der nicht
 *      in der Liste steht, wird das gemeldet — sonst wächst der Text oben
 *      still von der Wahrheit weg.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const API = resolve(HIER, '../..');
const WURZEL = resolve(API, '../..');

/** Kommentare weg — durch Leerzeichen ersetzt, damit die Stellen stimmen. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (t: string): string => t.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => `${davor} `);
}

const ABSCHRIFTEN = [
  resolve(API, 'sidecar/norns-sidecar.mjs'),
  resolve(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs'),
];

/** Das gebaute Bündel — das, was auf der Kasse WIRKLICH läuft. */
const BUENDEL = resolve(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar/start.mjs');

describe('⛔ Die ausgelieferte Kasse läuft scharf', () => {
  it.each(ABSCHRIFTEN)('%s setzt NODE_ENV auf production', (pfad) => {
    expect(existsSync(pfad), `${pfad} fehlt`).toBe(true);
    expect(
      readFileSync(pfad, 'utf8'),
      'Ohne diese Zeile läuft die Kasse des Händlers im Entwicklermodus: die ' +
        'Sperrliste auf den Notausgängen fällt, die Schnittstellenbeschreibung ' +
        'wird veröffentlicht, und der Riegel, der davor warnen soll, schaltet ' +
        'sich selbst ab.',
    ).toContain("NODE_ENV: 'production'");
  });

  it.each(ABSCHRIFTEN)('%s setzt sie VOR dem Bau des Servers', (pfad) => {
    /*
     * ⚠️ OHNE KOMMENTARE MESSEN. Der erste Anlauf verglich rohe Stellen und
     * fand `loadEnv()` an Stelle 1538 — im Kopfkommentar der Datei, der den
     * Ablauf BESCHREIBT („Hier bootet `buildApp({ env: loadEnv() })`").
     * Gemessen wurde damit die Erklärung, nicht der Code, und die Probe fiel
     * über einer völlig richtigen Reihenfolge.
     */
    const quelle = ohneKommentare(readFileSync(pfad, 'utf8'));
    const gesetzt = quelle.indexOf("NODE_ENV: 'production'");
    const gebaut = quelle.indexOf('buildApp({');
    const gelesen = quelle.indexOf('loadEnv()');
    expect(gesetzt, 'die Zuweisung fehlt').toBeGreaterThan(-1);
    expect(gebaut, 'der Aufruf von buildApp fehlt').toBeGreaterThan(-1);
    expect(gelesen, 'der Aufruf von loadEnv fehlt').toBeGreaterThan(-1);
    expect(
      gesetzt,
      'Die Umgebung wird erst NACH dem Lesen gesetzt. `loadEnv()` hat den ' +
        'Wert dann schon geprüft und weitergereicht — die Zuweisung kommt zu ' +
        'spät und wirkt auf nichts mehr.',
    ).toBeLessThan(gelesen);
    expect(gesetzt, 'Die Umgebung wird erst NACH `buildApp` gesetzt.').toBeLessThan(gebaut);
  });

  it('⛔ und das GEBAUTE Bündel trägt sie auch', () => {
    /*
     * Der Dienst ist eine vorgebaute Datei (`scripts/buendle-motor.mjs`).
     * Wer die Quelle ändert und nicht neu bündelt, ändert an der Kasse gar
     * nichts — dieselbe Falle, die dieses Haus schon zweimal getroffen hat.
     * Fehlt das Bündel im Baum, wird das GESAGT und nicht übersprungen.
     */
    expect(
      existsSync(BUENDEL),
      `${BUENDEL} fehlt. Ohne das Bündel ist nicht geprüft, was auf der Kasse läuft — \`node scripts/buendle-motor.mjs\`.`,
    ).toBe(true);
    expect(readFileSync(BUENDEL, 'utf8')).toContain('NODE_ENV: "production"');
  });
});

/**
 * Die neun Abhängigen, jede mit der Stelle, an der sie wirklich hängt.
 *
 * ⚠️ `datei` + `merkmal` werden nachgewiesen, nicht behauptet. Verschwindet
 * ein Zweig, fällt sein Eintrag hier auf und der Text oben wird berichtigt —
 * statt jahrelang eine Gefahr zu beschreiben, die es nicht mehr gibt.
 */
const HAENGT_AN_PRODUCTION = [
  {
    datei: 'src/lib/kassencode-neusetzen.ts',
    merkmal: 'enforceBlacklist: process.env.NODE_ENV',
    warum: 'Sperrliste auf allen drei Notausgängen — sonst käme 123456 durch.',
  },
  {
    datei: 'src/routes/auth-pin.ts',
    merkmal: 'enforceBlacklist: isProd',
    warum: 'Sperrliste beim gewöhnlichen Codewechsel und beim Zwangs-Code.',
  },
  {
    datei: 'src/plugins/swagger.ts',
    merkmal: "NODE_ENV !== 'production'",
    warum: 'Sonst hängt der vollständige Wegeplan im Laden offen.',
  },
  {
    datei: 'src/plugins/mtls.ts',
    merkmal: "NODE_ENV === 'production'",
    warum: 'Der Geräteriegel.',
  },
  {
    datei: 'src/plugins/rate-limit.ts',
    merkmal: 'isProd',
    warum: 'Die Sperre gegen zu viele Anfragen.',
  },
  {
    datei: 'src/routes/auth-session.ts',
    merkmal: 'crossSite',
    warum: 'Die strenge Herkunftsbindung der Sitzungskekse.',
  },
  {
    datei: 'src/plugins/metrics.ts',
    merkmal: 'if (!isProd) return;',
    warum: 'Ausserhalb production ist /metrics ohne Nachweis lesbar.',
  },
  {
    datei: 'src/routes/health.ts',
    merkmal: 'if (!isProd) return true;',
    warum: 'Ausserhalb production gibt der Zustandsweg alles ohne Nachweis heraus.',
  },
  {
    datei: 'src/config/env.ts',
    merkmal: "if (env.NODE_ENV !== 'production') return;",
    warum: 'Der Riegel gegen den Prüf-Fingerabdruck — er schaltet sich selbst ab.',
  },
] as const;

describe('⛔ Woran das scharfe Laufen wirklich hängt', () => {
  it.each(HAENGT_AN_PRODUCTION)('$datei — $warum', ({ datei, merkmal }) => {
    const pfad = resolve(API, datei);
    expect(existsSync(pfad), `${datei} gibt es nicht mehr`).toBe(true);
    expect(
      readFileSync(pfad, 'utf8'),
      `${datei} nennt "${merkmal}" nicht mehr. Entweder ist der Zweig weg — dann gehört der Eintrag geprüft statt blind behalten — oder er wurde umgeschrieben und die Erklärung oben stimmt nicht mehr.`,
    ).toContain(merkmal);
  });

  /**
   * Die Vollständigkeitsprobe. Ohne sie wäre die Liste eine Momentaufnahme:
   * jemand baut einen ZEHNTEN Zweig, der Text oben spricht weiter von neun,
   * und niemand merkt, dass eine weitere Sicherung an derselben Zeile hängt.
   */
  it('⛔ und es gibt keinen Zweig, der NICHT in der Liste steht', () => {
    const bekannt = new Set<string>(HAENGT_AN_PRODUCTION.map((h) => h.datei));
    const gefunden = new Set<string>();
    const gehe = (ordner: string): void => {
      for (const e of readdirSync(ordner, { withFileTypes: true })) {
        const p = join(ordner, e.name);
        if (e.isDirectory()) {
          gehe(p);
        } else if (e.name.endsWith('.ts')) {
          if (/NODE_ENV\s*(?:!==|===)\s*'production'/.test(readFileSync(p, 'utf8'))) {
            gefunden.add(p.replace(`${API}/`, ''));
          }
        }
      }
    };
    gehe(resolve(API, 'src'));

    // „null ist nicht grün": findet der Sammler nichts, ist er kaputt.
    expect(gefunden.size, 'Kein einziger Zweig gefunden — der Sammler ist blind.').toBeGreaterThan(
      5,
    );
    expect(
      [...gefunden].filter((f) => !bekannt.has(f)).sort(),
      'Diese Dateien hängen am scharfen Laufen, stehen aber in keinem Eintrag ' +
        'oben. Jede neue Abhängigkeit gehört mit ihrer Begründung in die Liste, ' +
        'damit die Erklärung dieser Datei wahr bleibt.',
    ).toEqual([]);
  });
});

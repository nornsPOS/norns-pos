/**
 * Der Rückweg aus der Stripe-Einrichtung.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ANGRIFF, GEGEN DEN DAS SIGNIERTE ZEICHEN STEHT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der naheliegende Bau wäre `?account=acct_…` gewesen. Die Kontokennung ist
 * aber KEIN Geheimnis: sie steht im Register, in Protokollen und in jeder
 * Antwort der Statusroute.
 *
 * Wer sie kennt, erzeugte sich damit selbst einen Einrichtungslink, trüge
 * **sein eigenes Bankkonto** ein — und die Auszahlungen des Händlers gingen an
 * ihn. Deshalb ist das Zeichen signiert und an genau eine Kennung gebunden.
 *
 * Am 26.07.2026 nachgemessen, was die Route überhaupt nötig macht: ein
 * angefangener Einrichtungslink antwortet danach mit **404**, ein bloss
 * geöffneter bleibt bei **200**. Verbraucht wird er also durch BENUTZUNG.
 * Läuft er ab, schickt Stripe an `refresh_url` — und dort stand zuerst eine
 * erfundene Adresse (404), dann die Ladenseite. Beide Male eine Sackgasse.
 */

import { describe, expect, it } from 'vitest';

import {
  pruefeRueckweg,
  RUECKWEG_TTL_MS,
  zeichneRueckweg,
} from '../../src/routes/stripe-onboarding-rueckweg.js';

const GEHEIM = 'ein-betriebsgeheimnis-nur-fuer-die-pruefung';
const KONTO = 'acct_1TxYbNGmV5FJd1s6';

describe('das signierte Zeichen', () => {
  it('loest sich zur richtigen Kontokennung auf', () => {
    expect(pruefeRueckweg(zeichneRueckweg(KONTO, GEHEIM), GEHEIM)).toBe(KONTO);
  });

  it('⛔ ohne das Geheimnis laesst es sich nicht herstellen', () => {
    // Das ist der ganze Schutz: die Kennung allein genuegt nicht.
    const gefaelscht = zeichneRueckweg(KONTO, 'falsches-geheimnis');
    expect(pruefeRueckweg(gefaelscht, GEHEIM)).toBeNull();
  });

  it('⛔ eine veraenderte Kennung faellt auf', () => {
    // Der Angriff: das eigene Zeichen nehmen und die Kennung austauschen.
    const echt = zeichneRueckweg(KONTO, GEHEIM);
    const [nutzlast, sig] = echt.split('.');
    const roh = Buffer.from(nutzlast!, 'base64url').toString('utf8');
    const getauscht = roh.replace(KONTO, 'acct_FREMDESKONTO');
    const gebastelt = `${Buffer.from(getauscht).toString('base64url')}.${sig}`;
    expect(pruefeRueckweg(gebastelt, GEHEIM)).toBeNull();
  });

  it('⛔ verfaellt nach der Frist', () => {
    const t0 = 1_800_000_000_000;
    const z = zeichneRueckweg(KONTO, GEHEIM, t0);
    expect(pruefeRueckweg(z, GEHEIM, t0 + RUECKWEG_TTL_MS - 1000)).toBe(KONTO);
    expect(pruefeRueckweg(z, GEHEIM, t0 + RUECKWEG_TTL_MS + 1000)).toBeNull();
  });

  it('vierzehn Tage, damit eine Einrichtung ueber ein Wochenende reicht', () => {
    // Kuerzer waere genau die Falle, die diese Datei behebt: wer freitags
    // anfaengt und montags weitermacht, stuende sonst wieder vor einer toten
    // Adresse.
    expect(RUECKWEG_TTL_MS / (24 * 3600 * 1000)).toBe(14);
  });

  it('⛔ Murks wird abgewiesen, ohne zu werfen', () => {
    // ⚠️ `timingSafeEqual` WIRFT bei ungleicher Laenge. Ohne die Laengenpruefung
    // davor waere jede verstuemmelte Eingabe ein 500er statt einer sauberen
    // Ablehnung — und ein 500er unterscheidet sich von einem 400er, also
    // verraet er etwas.
    for (const murks of ['', '.', 'abc', 'a.b.c', 'x.y', Buffer.from('kurz').toString('base64url') + '.z']) {
      expect(() => pruefeRueckweg(murks, GEHEIM), murks).not.toThrow();
      expect(pruefeRueckweg(murks, GEHEIM), murks).toBeNull();
    }
  });

  it('⛔ und etwas, das keine Kontokennung ist, kommt nicht durch', () => {
    // Sonst liesse sich ueber die Form der Nutzlast etwas anderes einschleusen.
    const boese = zeichneRueckweg('../../etwas-anderes', GEHEIM);
    expect(pruefeRueckweg(boese, GEHEIM)).toBeNull();
  });
});

/**
 * ⚠️ Die Wächter gegen ein zu weites Tor.
 */
describe('nur die ZWEI Rueckwege sind offen', () => {
  it('nicht der ganze Stripe-Praefix', async () => {
    // `/api/stripe/connect/` als Praefix haette `account`, `onboarding` und
    // `status` gleich mit geoeffnet — und die legen Konten an.
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/lib/public-routes.ts', import.meta.url),
      'utf8',
    );
    expect(q).toContain("'/api/stripe/connect/refresh'");
    expect(q).toContain("'/api/stripe/connect/fertig'");
    expect(
      q.includes("'/api/stripe/connect/'"),
      'der ganze Stripe-Praefix ist offen — account und onboarding liegen frei',
    ).toBe(false);
  });

  it('die Landeseite behauptet NICHT, alles sei erledigt', async () => {
    // Stripe ruft `return_url` auf, SOBALD der Haendler den Ablauf verlaesst —
    // auch wenn noch etwas fehlt. Eine Seite, die „fertig" sagt, waere dann
    // schlicht falsch, und der Haendler wartet auf etwas, das nie kommt.
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/routes/stripe-onboarding-rueckweg.ts', import.meta.url),
      'utf8',
    );
    expect(q).toContain('Stripe prüft sie jetzt');
    expect(q).toContain('dashboard.stripe.com');
  });
});

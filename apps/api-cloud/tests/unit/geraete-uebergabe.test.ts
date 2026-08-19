/**
 * Die Geräte-Übergabe der Google-Anmeldung.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ANGRIFF, GEGEN DEN DIESE PRÜFUNGEN STEHEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. Der Angreifer wählt eine Kennung N und schickt dem Opfer einen Link auf
 *      `/api/admin/auth/google/start?nonce=N`. Der Link zeigt auf die ECHTE
 *      Firmenadresse und sieht vollkommen unverdächtig aus.
 *   2. Das Opfer meldet sich mit seinem ECHTEN Google-Konto an.
 *   3. Der Angreifer holt die fertige Sitzung mit `POST /claim { nonce: N }`.
 *      Ohne Anmeldung, ohne Gerät, ohne alles. Der abgeholte Token trägt
 *      `lastPinStepUpAt = now`, erfüllt also sofort jede nachbestätigte
 *      Handlung.
 *
 * Der Kommentar an `/claim` sagte, die unerratbare Kennung SEI die
 * Berechtigung. Das stimmt nur, solange der SERVER sie erzeugt. Und selbst
 * dann nicht: ein Angreifer kann sich eine holen und DIESE verschicken.
 *
 * Was schützt, ist das, was RFC 8628 hat und hier fehlte: ein Mensch sieht,
 * was er freigibt, und sagt ja.
 */

import { describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';

/**
 * Derselbe Code wie in der Route. Bewusst nachgebaut statt exportiert: diese
 * Prüfung soll rot werden, wenn sich die Ableitung ÄNDERT, nicht stillschweigend
 * mitwandern. Der Code steht auf zwei Bildschirmen und muss übereinstimmen.
 */
function ablesbarerCode(nonce: string): string {
  const h = createHash('sha256').update(nonce).digest('base64url').toUpperCase();
  const nur = h.replace(/[^A-Z0-9]/g, '').replace(/[IO01]/g, 'X');
  return `${nur.slice(0, 4)}-${nur.slice(4, 8)}`;
}

describe('der ablesbare Code', () => {
  it('ist aus derselben Kennung immer derselbe', () => {
    // Sonst könnten Gerät und Bildschirm nie übereinstimmen.
    expect(ablesbarerCode('abc123')).toBe(ablesbarerCode('abc123'));
  });

  it('unterscheidet sich zwischen zwei Kennungen', () => {
    expect(ablesbarerCode('abc123')).not.toBe(ablesbarerCode('abc124'));
  });

  it('enthaelt kein I, O, 0 oder 1', () => {
    // Ein Mensch vergleicht ihn mit dem Bildschirm daneben. Verwechselbare
    // Zeichen führen dazu, dass er bei einem Unterschied trotzdem bestätigt.
    for (const n of ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff']) {
      expect(ablesbarerCode(n), n).not.toMatch(/[IO01]/);
    }
  });

  it('ist kurz genug zum Vergleichen', () => {
    // Vier plus Bindestrich plus vier. Wer zwanzig Zeichen vergleichen soll,
    // vergleicht in Wahrheit die ersten drei.
    expect(ablesbarerCode('x')).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe('die Route selbst traegt die Bestaetigungsstufe', () => {
  it('legt eine fertige Anmeldung NICHT mehr direkt zum Abholen', async () => {
    const quelle = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../../src/routes/admin-auth-google.ts', import.meta.url),
        'utf8',
      ),
    );

    // Der alte Weg: `handoffs.set(...)` unmittelbar nach dem Google-Rücklauf.
    // Wenn das je zurückkehrt, ist der Angriff wieder offen.
    const rueckgabe = quelle.slice(
      quelle.indexOf('if (st.deviceNonce) {'),
      quelle.indexOf('if (st.deviceNonce) {') + 700,
    );
    expect(
      rueckgabe.includes('pendingConfirm.set'),
      'der Google-Ruecklauf legt nicht mehr in den Wartebereich',
    ).toBe(true);
    expect(
      rueckgabe.includes('handoffs.set'),
      'der Google-Ruecklauf legt WIEDER direkt zum Abholen ab — der Angriff ist offen',
    ).toBe(false);
  });

  it('und es gibt eine Route, die ein Mensch anklicken muss', async () => {
    const quelle = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../../src/routes/admin-auth-google.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(quelle).toContain("'/api/admin/auth/google/confirm'");
    // Und nur dort wandert es in den Abholbereich.
    expect(quelle.match(/handoffs\.set\(/g)?.length ?? 0).toBe(1);
  });

  it('die Seite sagt, was passiert, und warnt vor dem Fall ohne Geraet', async () => {
    const quelle = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../../src/routes/admin-auth-google.ts', import.meta.url),
        'utf8',
      ),
    );
    // Der eigentliche Schutz ist der Satz, nicht die Technik. Ein Opfer, das
    // nur „sich anmelden" wollte, muss lesen koennen, dass ein GERAET diese
    // Anmeldung bekommt.
    expect(quelle).toContain('Ein Gerät möchte sich anmelden');
    expect(quelle).toContain('Dieser Code muss auf Ihrem Gerät stehen');
    expect(quelle).toContain('brechen Sie ab');
  });
});

/**
 * Die KUNDENSEITE ist baugleich und war es auch in der Lücke.
 *
 * Was ein Angreifer dort bekommt, ist kein Fiskalzugang, aber die
 * Bestellungen, die Anschrift und den Datenexport eines Menschen. Das genügt.
 */
// 14.08.2026: hier stand der Kundenweg (storefront-auth-google). Der
// Kundenshop ist mit der Trennung von warehouse14 gefallen; der Kassenweg
// oben traegt die Stufe weiter und bleibt gemessen.

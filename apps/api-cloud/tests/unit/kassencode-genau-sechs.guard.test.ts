/**
 * Der Kassencode hat GENAU sechs Ziffern, in allen Häusern.
 *
 * ── ZWEI ANWEISUNGEN, DIE ZWEITE HEBT DIE ERSTE AUF ────────────────────────
 *
 * 30.07.2026: sechs bis zwölf Ziffern, vom Händler gewählt.
 * 18.08.2026: genau sechs, nicht mehr. Basel hat sich mit der Spanne selbst
 * vertippt und verheddert; die feste Länge macht die Eingabe eindeutig, und
 * die Tastatur schickt beim sechsten Zeichen von selbst ab.
 *
 * ── DIE EINE GEDULDETE AUSNAHME, UND WARUM ─────────────────────────────────
 *
 * NUR die Anmeldung (PinBody) DULDET weiter das Format 6 bis 12: ein vor dem
 * 18.08. gesetzter längerer Code ist gespeicherter Zustand (argon2-Hash),
 * und ein Schema-400 wäre die hässlichste aller Antworten. Sein Ausgang ist
 * der Löschweg (Team, kassencode-loeschen; der Inhaber kommt per
 * Google-Anmeldung hinein, die frischt den Step-up). SETZEN verlangt überall
 * strikt sechs. Dieser Wächter pinnt BEIDE Seiten: die Strenge beim Setzen
 * und die Duldung beim Anmelden. Wer eine von beiden kippt, liest erst hier.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PinPolicy } from '@norns/auth-pin';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(resolve(HIER, '../../src/routes/auth-pin.ts'), 'utf8');
const ANMELDUNG = readFileSync(
  resolve(HIER, '../../../tauri-pos/src/screens/PinLogin.tsx'),
  'utf8',
);
const STUFE = readFileSync(
  resolve(HIER, '../../../tauri-pos/src/app/chrome/StepUpModal.tsx'),
  'utf8',
);

describe('⛔ Der Kassencode hat genau sechs Ziffern', () => {
  it('⛔ SETZEN verlangt genau sechs (PinSetBody), auf dem Server', () => {
    // Der Satz sucht das Schema, nicht die Erwähnung: das newPin-Feld selbst.
    expect(ROUTE).toMatch(
      /newPin:\s*Type\.String\(\{\s*minLength:\s*6,\s*maxLength:\s*6,\s*pattern:\s*'\^\\\\d\{6\}\$'\s*\}\)/,
    );
  });

  it('⛔ die reine Policy kennt nur noch genau sechs', () => {
    expect(PinPolicy.validate('123457', { enforceBlacklist: true })).toBeNull();
    for (const falsch of ['12345', '1234567', '123456789012']) {
      const fehler = PinPolicy.validate(falsch, { enforceBlacklist: false });
      expect(fehler?.code, `${falsch} (${falsch.length} Stellen) ging durch`).toBe('WRONG_LENGTH');
    }
    // Die Schwachliste lebt auch bei fester Länge: der Raum ist jetzt 10^6.
    expect(PinPolicy.validate('123456', { enforceBlacklist: true })?.code).toBe('BLACKLISTED');
    expect(PinPolicy.validate('000000', { enforceBlacklist: true })?.code).toBe('BLACKLISTED');
  });

  it('⚠️ NUR die Anmeldung duldet 6 bis 12, für Codes von vor dem 18.08.2026', () => {
    // Fällt diese Duldung, bekommt ein Altcode ein Schema-400 statt einer
    // ehrlichen Antwort. Fällt umgekehrt die Strenge beim Setzen, wächst die
    // Spanne zurück. Beides soll hier rot werden.
    expect(ROUTE).toMatch(
      /pin:\s*Type\.String\(\{\s*minLength:\s*6,\s*maxLength:\s*12,\s*pattern:\s*'\^\\\\d\{6,12\}\$'\s*\}\)/,
    );
  });

  it('⛔ beide Tastaturen der Kasse zeigen sechs Felder und schicken selbst ab', () => {
    // pinLength={6} OHNE minLength: erst die feste Laenge schaltet in PinPad
    // das Abschicken beim letzten Zeichen frei (festeLaenge, PinPad.tsx).
    expect(ANMELDUNG).toContain('pinLength={6}');
    expect(ANMELDUNG).not.toContain('pinLength={12}');
    expect(STUFE).toContain('pinLength={6}');
    expect(STUFE).not.toContain('pinLength={12}');
    // Und die Spiegelprüfungen sind fest, nicht spannig.
    expect(ANMELDUNG).toContain('/^\\d{6}$/');
    expect(STUFE).toContain('/^\\d{6}$/');
  });

  it('⛔ der Weg heraus steht AUF der Anmeldefläche, nicht nur im Handbuch', () => {
    // Ein vergessener Code ohne sichtbaren Ausgang ist eine Sperre ohne
    // Ausgang, die Hausklasse. Der Satz muss den WIRKLICHEN Weg nennen.
    expect(ANMELDUNG).toContain('Code vergessen?');
    expect(ANMELDUNG).toContain('unter Team');
    // Und der genannte Weg existiert wirklich (Route + Knopf).
    const STAFF = readFileSync(resolve(HIER, '../../src/routes/admin-staff.ts'), 'utf8');
    expect(STAFF).toContain("'/api/admin/staff/:id/kassencode-loeschen'");
    const TEAM = readFileSync(
      resolve(HIER, '../../../tauri-pos/src/screens/team/Team.tsx'),
      'utf8',
    );
    expect(TEAM).toContain('kassencode-loeschen');
    // Der Inhaber selbst kommt über Google hinein: die Google-Anmeldung
    // frischt den Step-up, sonst wäre SEIN vergessener Code eine Sackgasse.
    const GOOGLE = readFileSync(resolve(HIER, '../../src/routes/admin-auth-google.ts'), 'utf8');
    expect(GOOGLE).toContain('lastPinStepUpAt: new Date()');
  });
});

/**
 * Ein Satz, den wir SELBST geschrieben haben, darf nicht unterwegs verloren gehen.
 *
 * ── DIE FALLE, DIE ICH MIR SELBST GESTELLT HABE, 02.08.2026 ────────────────
 *
 * Der Windows-Zweig in `pdf.rs` und `label.rs` lehnt mit einem ganzen deutschen
 * Satz ab: was geschehen ist, und was der Händler tun soll. Er reist als
 * `details` einer `NotConfigured`-Ablehnung.
 *
 * Und genau dort wäre er gestorben. Die Kette lautete:
 *
 *   `isHardwareError(err) ? describeHardwareError(err) : diagnoseAlsZeile(err)`
 *
 * Eine `NotConfigured`-Ablehnung IST ein Hardwarefehler. Also hätte der erste
 * Zweig gegriffen, und der verwirft `details` absichtlich und sagt stattdessen:
 *
 *   „Das Gerät ist noch nicht eingerichtet. Bitte im Gerätemanager konfigurieren."
 *
 * Der Drucker ist aber eingerichtet. Der Gerätemanager hilft nicht. Der Händler
 * hätte wieder einen Satz gelesen, der ihn in die falsche Richtung schickt —
 * dieselbe Klasse Fehler wie „Speicherplatz prüfen", nur eine Schicht später.
 *
 * ── DIE REGEL, DIE DARAUS FOLGT ────────────────────────────────────────────
 *
 * Auf DRUCKWEGEN gilt die Druckerdiagnose, nicht der allgemeine Übersetzer.
 * Sie liest `details`, und die acht allgemeinen Sätze bleiben der letzte
 * Rückfall — nicht der erste Griff.
 */

import { describe, expect, it } from 'vitest';

import { diagnoseAlsZeile, diagnostiziereDrucker } from './drucker-diagnose.js';

/** Wortgleich der Satz aus `src-tauri/src/commands/druckweg.rs`. */
const WINDOWS_SATZ =
  'Das Dokument wurde im Betrachter dieses Rechners geöffnet. Windows kann eine fertige Seite ' +
  'nicht roh an die Warteschlange geben; bitte dort auf Drucken gehen und den gewünschten ' +
  'Drucker wählen. Etiketten mit eigener Druckersprache (Zebra und Verwandte, Bonreihe) druckt ' +
  'die Kasse auf Windows direkt.';

describe('Der Windows-Satz erreicht den Menschen', () => {
  it('die Diagnose gibt unseren Satz weiter, statt ihn durch einen allgemeinen zu ersetzen', () => {
    const zeile = diagnoseAlsZeile({ kind: 'not_configured', details: WINDOWS_SATZ });
    expect(zeile).toContain('Drucken');
    expect(zeile).toContain('Betrachter');
    // ⚠️ Genau das wäre sonst herausgekommen — und es schickt den Händler in
    // einen Gerätemanager, in dem alles bereits richtig steht.
    expect(zeile).not.toContain('noch nicht eingerichtet');
  });

  it('ein KURZES Kürzel bekommt weiterhin den allgemeinen Satz', () => {
    // Die andere Hälfte. Ein Rumpf, der nur `not_configured` ohne Text sendet,
    // oder ein Kürzel wie „ENOENT", hilft niemandem — dort ist der allgemeine
    // Satz die bessere Auskunft, und er muss erhalten bleiben.
    const kurz = diagnostiziereDrucker({ kind: 'not_configured', details: 'ENOENT' });
    expect(kurz.satz).toMatch(/noch nicht eingerichtet/);
    const ohne = diagnostiziereDrucker({ kind: 'not_configured' });
    expect(ohne.satz).toMatch(/noch nicht eingerichtet/);
  });

  it('eine erkannte Ursache schlägt weiterhin ALLES andere', () => {
    // Die Rangfolge darf sich nicht verdrehen: „out of paper" bleibt „Papier
    // einlegen", auch wenn es als langer Satz käme.
    const d = diagnostiziereDrucker({
      kind: 'device',
      details: 'The printer reported that it is out of paper and cannot continue printing now.',
    });
    expect(d.satz).toMatch(/Papier/);
  });
});

/**
 * ToastContainer — die Ebene der Meldungen.
 *
 * Diese Prüfung bewacht den Fund vom 2026-07-26: der Meldungskasten stand auf
 * der nackten Zahl 900 und wurde als gewöhnliches Kind der Anwendungshülle
 * gezeichnet, während jedes Fenster auf 1050 an den Seitenkörper portiert war.
 * Jede Meldung, die während eines offenen Fensters kam, lag damit hinter dessen
 * Schleier — also genau die Sätze, für die der Kasten überhaupt existiert:
 * „Druck fehlgeschlagen", „Terminal nicht konfiguriert", „Beleg ausgegeben,
 * aber der Gutschein wurde nicht verbucht". Am Tresen sah die Kassiererin nur
 * den Bezahldialog und hielt den Vorgang für sauber.
 *
 * Warum die Ebenen hier über den QUELLTEXT und über `tokens.css` geprüft
 * werden und nicht über `getComputedStyle`: jsdom lädt keine Stilblätter und
 * löst keine Gestaltungsmarken auf. Ein `expect(…zIndex).toBe('1500')` wäre in
 * jsdom entweder leer oder eine Selbstbestätigung — es würde grün bleiben,
 * während die Leiter in Wahrheit zusammengefallen ist. Geprüft wird deshalb
 * das, was in jsdom ehrlich beobachtbar ist (das Portal) plus die beiden
 * Tatsachen, die den Fehler ausmachten (nackte Zahlen, Reihenfolge der Leiter).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastContainer } from './ToastContainer.js';
import type { ToastShape } from './Toast.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HIER, '../tokens.css');

/** Die Bausteine, die eine Ebene setzen dürfen — und nur über die Leiter. */
const BAUSTEINE = ['ToastContainer.tsx', 'Dialog.tsx', 'Sheet.tsx', 'Popover.tsx'];

/** Alle Sprossen aus tokens.css als Zahlen. */
function leseLeiter(): Record<string, number> {
  const css = readFileSync(TOKENS, 'utf8');
  const leiter: Record<string, number> = {};
  for (const [, name, wert] of css.matchAll(/--w14-z-([a-zäöüß-]+)\s*:\s*(-?\d+)\s*;/g)) {
    leiter[name] = Number(wert);
  }
  return leiter;
}

function alleDateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const gehe = (pfad: string): void => {
    for (const eintrag of readdirSync(pfad)) {
      if (eintrag === 'node_modules' || eintrag === 'dist') continue;
      const voll = join(pfad, eintrag);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (/\.tsx?$/.test(eintrag)) gefunden.push(voll);
    }
  };
  gehe(wurzel);
  return gefunden;
}

const beispiel: ToastShape = {
  id: 'm1',
  tone: 'alert',
  title: 'Druck fehlgeschlagen',
  body: 'Der Beleg wurde nicht ausgegeben.',
  autoDismissMs: null,
};

describe('Meldungen liegen über allem', () => {
  it('hängt am Seitenkörper und NICHT im Baum der Anwendungshülle', () => {
    // Die Hülle bildet mit ihren eigenen Gestaltungen einen Stapelzusammenhang.
    // Ein Kind darin kann durch KEINE noch so hohe Zahl über ein Fenster
    // steigen, das selbst am Seitenkörper hängt. Nur ein eigenes Portal löst
    // das — deshalb ist die Elternschaft die eigentliche Zusicherung.
    const { container } = render(
      <ToastContainer toasts={[beispiel]} onDismiss={() => {}} />,
    );

    const meldung = screen.getByText('Druck fehlgeschlagen');
    expect(container).not.toContainElement(meldung);
    expect(document.body).toContainElement(meldung);
  });

  it('setzt keine nackte Ebenenzahl — jede Ebene kommt aus der Leiter', () => {
    const suender: string[] = [];
    for (const datei of BAUSTEINE) {
      const quelle = readFileSync(join(HIER, datei), 'utf8');
      for (const [, wert] of quelle.matchAll(/\bzIndex:\s*([^,\n]+)/g)) {
        const roh = wert.trim();
        if (!roh.startsWith("'var(--w14-z-")) suender.push(`${datei}: zIndex ${roh}`);
      }
    }
    expect(suender).toEqual([]);
  });

  it('die Leiter steigt: Fenster < Zweitbestätigung < Meldung < Hinweis', () => {
    const l = leseLeiter();
    for (const sprosse of ['basis', 'klebend', 'schleier', 'fenster', 'anker', 'stufe', 'meldung', 'hinweis']) {
      expect(l[sprosse], `Sprosse --w14-z-${sprosse} fehlt in tokens.css`).toBeTypeOf('number');
    }
    expect(l.basis).toBeLessThan(l.klebend as number);
    expect(l.klebend).toBeLessThan(l.schleier as number);
    expect(l.schleier).toBeLessThan(l.fenster as number);
    expect(l.fenster).toBeLessThan(l.anker as number);
    expect(l.anker).toBeLessThan(l.stufe as number);
    expect(l.stufe).toBeLessThan(l.meldung as number);
    expect(l.meldung).toBeLessThan(l.hinweis as number);
  });

  it('die Blase geht mit ABGANG: erst aria-hidden und ohne Zeiger, onDismiss erst danach', async () => {
    // Die Blase war die einzige Fläche, die schlagartig verschwand. Jetzt
    // spielt sie beim Wegwischen erst ihren Abgang (w14-toast-out) und ruft
    // onDismiss erst am Ende — in jsdom über den Notausgang, weil dort nie
    // ein animationend feuert. Währenddessen ist sie für Leser und Finger
    // bereits weg (aria-hidden, pointer-events none).
    const onDismiss = vi.fn();
    render(<ToastContainer toasts={[beispiel]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByLabelText('Schließen'));
    expect(onDismiss).not.toHaveBeenCalled(); // der Abgang läuft noch

    const zeile = screen.getByText('Druck fehlgeschlagen').closest('[aria-hidden="true"]');
    expect(zeile).not.toBeNull();
    expect((zeile as HTMLElement).style.pointerEvents).toBe('none');
    expect((zeile as HTMLElement).style.animation).toContain('w14-toast-out');

    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('m1'), { timeout: 2000 });
  });

  it('bei reduzierter Bewegung wird SOFORT entlassen — kein Abschiedsbild', () => {
    const echt = window.matchMedia;
    window.matchMedia = ((abfrage: string) =>
      ({
        matches: abfrage.includes('prefers-reduced-motion'),
        media: abfrage,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      const onDismiss = vi.fn();
      render(<ToastContainer toasts={[beispiel]} onDismiss={onDismiss} />);
      fireEvent.click(screen.getByLabelText('Schließen'));
      expect(onDismiss).toHaveBeenCalledWith('m1');
    } finally {
      window.matchMedia = echt;
    }
  });

  it('die Meldung gewinnt gegen jede fremde nackte Zahl in der Kasse', () => {
    // In apps/tauri-pos stehen noch nackte Zahlen (die höchste war 1300, die
    // Assistenten-Hülle). Fällt die Meldungsstufe darunter — oder trägt jemand dort
    // eine noch höhere Zahl nach — ist der ursprüngliche Fehler zurück: die
    // Warnung erscheint, aber niemand sieht sie. Der Wert wird gemessen, nicht
    // geglaubt; fehlt die Kasse (der Baukasten wird auch allein gebaut), gilt
    // die dokumentierte 1300 als Untergrenze und der Ausfall wird gemeldet.
    const kasse = resolve(HIER, '../../../../apps/tauri-pos/src');
    let hoechsteFremde = 1300;
    let gemessen = false;

    if (existsSync(kasse)) {
      gemessen = true;
      for (const datei of alleDateien(kasse)) {
        for (const [, wert] of readFileSync(datei, 'utf8').matchAll(/\bzIndex:\s*(\d+)\b/g)) {
          hoechsteFremde = Math.max(hoechsteFremde, Number(wert));
        }
      }
    }

    const meldung = leseLeiter().meldung as number;
    expect(
      meldung,
      gemessen
        ? `Höchste gemessene fremde Ebene in der Kasse: ${hoechsteFremde}`
        : 'Kasse nicht gefunden — geprüft gegen die dokumentierte Untergrenze 1300',
    ).toBeGreaterThan(hoechsteFremde);
  });
});

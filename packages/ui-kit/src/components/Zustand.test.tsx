/**
 * ZustandFehler + ZustandLeer — der Wächter über die Unterscheidung, die am
 * Tresen Geld und Recht gekostet hat.
 *
 * ── DER FUND ────────────────────────────────────────────────────────────────
 * „Keine Daten" und „der Server hat nicht geantwortet" landeten auf derselben
 * leeren Liste, und die Kasse formulierte diese Leere dann als Tatsache. Der
 * teuerste Fall war die Kundensuche: bei einem Serverfehler stand „Kein
 * Treffer" auf dem Schirm UND daneben die Einladung, einen neuen Kunden
 * anzulegen — bei einem GESPERRTEN Käufer. Eine zweite, blanke Akte hebt die
 * Sperre der ersten auf. Behoben wurde das genau an dieser einen Stelle; neun
 * weitere Flächen haben bis heute einen Ladezustand und keinen Fehlerzweig.
 *
 * Diese Prüfung hält die vier Zusicherungen fest, die die beiden Bauteile zu
 * Bauteilen machen statt zu Verzierung:
 *   1. Der Fehler ist eine MELDUNG (`alert`), die Leere ein BEFUND (`status`).
 *   2. Der Fehlersatz kommt wortgetreu vom Aufrufer — das Bauteil erfindet
 *      und übersetzt nichts.
 *   3. Es gibt einen Weg zurück: der Knopf ruft wirklich zurück.
 *   4. Langer Text bricht um und wird NICHT abgeschnitten.
 *
 * ── WARUM ÜBER `element.style` UND DEN QUELLTEXT ────────────────────────────
 * jsdom rechnet kein Layout und lädt keine Stilblätter. Ein
 * `expect(breite).toBeLessThan(…)` wäre hier eine Selbstbestätigung, und
 * `getComputedStyle(...).minHeight` gäbe die unaufgelöste Marke zurück.
 * Geprüft wird deshalb das, was in jsdom ehrlich beobachtbar ist: die gesetzte
 * Regel am Element, plus der Wert der Marke aus `tokens.css`. Beides zusammen
 * ist die vollständige Kette — dieselbe Bauart wie beim Ebenen-Wächter in
 * `ToastContainer.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZustandFehler } from './ZustandFehler.js';
import { ZustandLeer } from './ZustandLeer.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HIER, '../tokens.css');
const QUELLEN = ['ZustandFehler.tsx', 'ZustandLeer.tsx'] as const;

/** Ein Wort ohne Trennstelle — genau das, was einen schmalen Kasten sprengt. */
const WORTWURM =
  'Verbindungsabbruchbenachrichtigungsdienstschnittstellenzeitueberschreitung';

function quelle(datei: string): string {
  return readFileSync(join(HIER, datei), 'utf8');
}

describe('ZustandFehler — der Fehlschlag sieht wie ein Fehlschlag aus', () => {
  it('ist eine MELDUNG (role=alert), nicht ein stiller Befund', () => {
    render(<ZustandFehler satz="Der Server hat nicht geantwortet." />);
    const meldung = screen.getByRole('alert');
    expect(meldung).toHaveTextContent('Der Server hat nicht geantwortet.');
  });

  it('gibt den Satz des Aufrufers WORTGETREU aus und erfindet keinen zweiten', () => {
    // Der Aufrufer hat describeError. Gäbe es hier eine zweite Übersetzung,
    // stünden zwei Sätze über denselben Fehler auf dem Schirm — und irgendwann
    // zwei verschiedene. Der Text der Meldung darf deshalb aus nichts weiter
    // bestehen als aus Überschrift und übergebenem Satz.
    const satz = 'Die Suche ist gerade nicht erreichbar.';
    render(<ZustandFehler satz={satz} titel="Nicht geladen" />);
    expect(screen.getByRole('alert').textContent).toBe(`Nicht geladen${satz}`);
  });

  it('nennt die Folge, damit niemand aus Unwissen handelt', () => {
    render(
      <ZustandFehler
        satz="Die Suche ist gerade nicht erreichbar."
        folge="Ob dieser Käufer gesperrt ist, lässt sich jetzt nicht sagen."
      />,
    );
    expect(
      screen.getByText('Ob dieser Käufer gesperrt ist, lässt sich jetzt nicht sagen.'),
    ).toBeInTheDocument();
  });

  it('der Knopf ruft zurück — genau einmal', () => {
    const erneut = vi.fn();
    render(<ZustandFehler satz="Zeitüberschreitung." onErneut={erneut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(erneut).toHaveBeenCalledTimes(1);
  });

  it('sperrt den Knopf, solange ein Versuch läuft, und sagt das auch', () => {
    const erneut = vi.fn();
    render(
      <ZustandFehler satz="Zeitüberschreitung." onErneut={erneut} laeuft />,
    );
    const knopf = screen.getByRole('button', { name: 'Versucht…' });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(erneut).not.toHaveBeenCalled();
  });

  it('zeigt keinen Knopf, wenn es nichts zu holen gibt', () => {
    render(<ZustandFehler satz="Kein erneuter Versuch möglich." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sagt es, wenn ältere Daten auf dem Schirm stehen — und schweigt sonst', () => {
    const { unmount } = render(<ZustandFehler satz="Nicht erreichbar." />);
    expect(screen.queryByText(/zuletzt bekannte Stand/)).toBeNull();
    unmount();

    render(
      <ZustandFehler
        satz="Nicht erreichbar."
        zeigtAeltereDaten
        standNotiz={<span>Stand vor 12 s</span>}
      />,
    );
    expect(screen.getByText(/zuletzt bekannte Stand/)).toBeInTheDocument();
    // Die Standmarke liegt IM Meldungsbereich, sonst liest der Vorleser das
    // Alter des Standes nicht mit vor.
    expect(within(screen.getByRole('alert')).getByText('Stand vor 12 s')).toBeInTheDocument();
  });

  it('der Knopf hält die Zielfläche von 44 Pixeln ein', () => {
    render(<ZustandFehler satz="x" onErneut={() => {}} />);
    const knopf = screen.getByRole('button');
    // jsdom löst keine Marken auf; geprüft wird die gesetzte Marke UND ihr
    // Wert in tokens.css. Erst beides zusammen ist ein Beweis.
    expect(knopf.style.minHeight).toBe('var(--w14-touch-min)');
    const treffer = /--w14-touch-min:\s*(\d+)px/.exec(readFileSync(TOKENS, 'utf8'));
    expect(treffer, '--w14-touch-min fehlt in tokens.css').not.toBeNull();
    expect(Number(treffer?.[1])).toBeGreaterThanOrEqual(44);
  });
});

describe('ZustandLeer — Leere mit Ausweg', () => {
  it('ist ein BEFUND (role=status), keine Störung', () => {
    render(<ZustandLeer satz="Noch keine Positionen." wegweiser="Artikel scannen." />);
    const befund = screen.getByRole('status');
    expect(befund).toHaveTextContent('Noch keine Positionen.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nennt was fehlt, warum, und die nächste Handlung', () => {
    render(
      <ZustandLeer
        satz="Kein Treffer."
        hinweis={'Zu „Meier“ ist keine Akte hinterlegt.'}
        wegweiser="Namen kürzen oder nach Telefonnummer suchen."
      />,
    );
    expect(screen.getByText('Kein Treffer.')).toBeInTheDocument();
    expect(screen.getByText('Zu „Meier“ ist keine Akte hinterlegt.')).toBeInTheDocument();
    expect(
      screen.getByText('Namen kürzen oder nach Telefonnummer suchen.'),
    ).toBeInTheDocument();
  });

  it('der Ausweg-Knopf ruft zurück', () => {
    const anlegen = vi.fn();
    render(
      <ZustandLeer
        satz="Kein Treffer."
        handlung={{ text: 'Kunde anlegen', onTun: anlegen }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kunde anlegen' }));
    expect(anlegen).toHaveBeenCalledTimes(1);
  });

  it('ein gesperrter Ausweg nennt seinen Grund, statt stumm nicht zu reagieren', () => {
    const anlegen = vi.fn();
    render(
      <ZustandLeer
        satz="Kein Treffer."
        handlung={{
          text: 'Kunde anlegen',
          onTun: anlegen,
          gesperrt: true,
          gesperrtGrund: 'Anlegen ist gesperrt, solange die Suche schweigt.',
        }}
      />,
    );
    const knopf = screen.getByRole('button', { name: 'Kunde anlegen' });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(anlegen).not.toHaveBeenCalled();
    expect(
      screen.getByText('Anlegen ist gesperrt, solange die Suche schweigt.'),
    ).toBeInTheDocument();
  });

  it('bleibt ohne Ausweg lesbar — es gibt Leeren, deren Weg woanders liegt', () => {
    // Die Belegliste ruft genau so auf: bei einer Suche gibt es den Knopf
    // „Suche zurücksetzen", ohne Suche gibt es ihn nicht, weil „heute noch
    // kein Beleg" durch einen VERKAUF behoben wird und nicht durch einen Knopf
    // in der Liste. Ein erfundener Knopf wäre schlimmer als keiner.
    render(<ZustandLeer satz="Noch kein Beleg an diesem Tag." />);
    expect(screen.getByRole('status')).toHaveTextContent('Noch kein Beleg an diesem Tag.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('der Knopf hält die Zielfläche von 44 Pixeln ein', () => {
    render(<ZustandLeer satz="Leer." handlung={{ text: 'Weiter', onTun: () => {} }} />);
    expect(screen.getByRole('button').style.minHeight).toBe('var(--w14-touch-min)');
  });
});

describe('Schmaler Kasten — langer Text bricht um, nichts wird abgeschnitten', () => {
  it('jeder Absatz beider Zustände trägt eine Umbruchregel und keine Abschneide-Regel', () => {
    const { container } = render(
      <>
        <ZustandFehler
          satz={WORTWURM}
          folge={WORTWURM}
          zeigtAeltereDaten
          onErneut={() => {}}
        />
        <ZustandLeer
          satz={WORTWURM}
          hinweis={WORTWURM}
          wegweiser={WORTWURM}
          handlung={{
            text: 'Weiter',
            onTun: () => {},
            gesperrt: true,
            gesperrtGrund: WORTWURM,
          }}
        />
      </>,
    );

    const absaetze = Array.from(container.querySelectorAll('p'));
    // Ohne diese Zusicherung wäre eine leere Menge grün — die schlimmste Art
    // von grün.
    expect(absaetze.length).toBeGreaterThanOrEqual(7);

    for (const p of absaetze) {
      const stil = p.style;
      expect(stil.overflowWrap, `Absatz ohne Umbruch: ${p.textContent?.slice(0, 24)}`).toBe(
        'anywhere',
      );
      expect(stil.wordBreak).toBe('break-word');
      // Ein Flex-Kind schrumpft ohne min-width:0 nicht unter seine
      // Inhaltsbreite — dann wird der ganze Kasten breiter als seine Spalte.
      //
      // ⚠️ 13.08.2026 — HIER STAND `.toBe('0px')`, UND DAS WAR DIE FALSCHE
      // MESSUNG.
      //
      // Die Quelle schreibt `minWidth: 0` als ZAHL. Wie React daraus eine
      // Zeichenkette macht, haengt an der Fassung, die im jeweiligen
      // Arbeitsbaum aufgeloest wird: die eine schreibt `0px`, die andere `0`.
      // Auf diesem Rechner kam `0px`, auf dem Fliessband `0` — und der
      // Waechter war dort ROT, obwohl die Eigenschaft in beiden Faellen
      // dieselbe ist. Seit dem 10.08.2026 hielt er damit JEDEN Lauf rot,
      // und ein Tor, das immer rot ist, wird weggeschaut.
      //
      // Gemessen wird jetzt die LAENGE, nicht ihre Schreibweise. Der Defekt,
      // den diese Zeile verhindert, ist „das Flex-Kind schrumpft nicht" —
      // und dafuer zaehlt allein, dass die Zahl null ist.
      expect(
        Number.parseFloat(stil.minWidth),
        `minWidth ist nicht null, sondern „${stil.minWidth}"`,
      ).toBe(0);
      expect(stil.maxWidth).toBe('100%');
      // Die drei Wege, auf denen Text „mittendrin abbricht".
      expect(stil.whiteSpace).not.toBe('nowrap');
      expect(stil.textOverflow).toBe('');
      expect(stil.height).toBe('');
    }

    // Der Wortwurm steht vollständig auf dem Schirm, nicht gekürzt.
    expect(container.textContent).toContain(WORTWURM);
  });

  it('der Quelltext kennt keine Abschneide-Regel', () => {
    // Die Prüfung oben sieht nur, was gerendert wurde. Diese hier verhindert,
    // dass jemand später eine Kürzung in einen Zweig einbaut, den kein Fall
    // dieser Datei erreicht.
    // Gesucht wird die DEKLARATION, nicht das Wort: die Kommentare oben
    // sprechen absichtlich über genau diese Regeln, und ein Wortfund darin
    // wäre ein Fehlalarm, der den Wächter unglaubwürdig macht.
    const verboten: readonly RegExp[] = [
      /whiteSpace:\s*'nowrap'/,
      /textOverflow:/,
      /WebkitLineClamp:/,
      /lineClamp:/,
      /-webkit-line-clamp/,
    ];
    const suender: string[] = [];
    for (const datei of QUELLEN) {
      const zeilen = quelle(datei).split('\n');
      zeilen.forEach((zeile, i) => {
        for (const regel of verboten) {
          if (regel.test(zeile)) suender.push(`${datei}:${i + 1} ${zeile.trim()}`);
        }
      });
    }
    expect(suender).toEqual([]);
  });
});

describe('Marken statt Zahlen und Farben', () => {
  it('setzt keine nackte Ebenenzahl', () => {
    const suender: string[] = [];
    for (const datei of QUELLEN) {
      for (const [, wert] of quelle(datei).matchAll(/\bzIndex:\s*([^,\n]+)/g)) {
        const roh = (wert as string).trim();
        if (!roh.startsWith("'var(--w14-z-")) suender.push(`${datei}: zIndex ${roh}`);
      }
    }
    expect(suender).toEqual([]);
  });

  it('nennt keine rohe Farbe — Grössen, Farben und Abstände kommen aus den Marken', () => {
    const suender: string[] = [];
    for (const datei of QUELLEN) {
      const zeilen = quelle(datei).split('\n');
      zeilen.forEach((zeile, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(zeile)) suender.push(`${datei}:${i + 1} Hexfarbe`);
        if (/\b(rgba?|hsla?)\s*\(/.test(zeile)) suender.push(`${datei}:${i + 1} ${zeile.trim()}`);
      });
    }
    expect(suender).toEqual([]);
  });

  it('greift auf mindestens ein Dutzend Marken zu — sonst prüft das hier nichts', () => {
    const benutzt = new Set<string>();
    for (const datei of QUELLEN) {
      for (const [, marke] of quelle(datei).matchAll(/var\(\s*(--w14-[a-z0-9-]+)/g)) {
        benutzt.add(marke as string);
      }
    }
    expect(benutzt.size).toBeGreaterThanOrEqual(12);
  });
});

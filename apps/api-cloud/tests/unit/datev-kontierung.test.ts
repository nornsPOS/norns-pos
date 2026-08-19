/**
 * Die Kasse sieht nur Bargeld — und die Summen stimmen auf den Cent.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Der DATEV-Weg las `transaction_payments` überhaupt nicht: null Treffer in
 * der ganzen Exportroute. Jeder Verkauf ging gegen Konto 1000 Kasse, auch die
 * Kartenzahlung. Konto 1000 wächst dann um Geld, das nie in der Schublade
 * lag, und kann rechnerisch negativ werden — der erste Punkt, den ein Prüfer
 * nachrechnet.
 */
import { describe, expect, it } from 'vitest';

import {
  SOLLKONTO_JE_ZAHLART,
  ZAHLART_KURZ,
  ZahlartNichtKontiertError,
  kreuzeZahlungenMitBehandlungen,
  sollkontoFuerZahlart,
} from '../../src/lib/datev-kontierung.js';
import { vorlagenplan } from '../../src/lib/kontenrahmen.js';

describe('das Sollkonto folgt der Zahlart', () => {
  it('nur BAR beruehrt die Kasse', () => {
    expect(sollkontoFuerZahlart('CASH')).toBe('1000');
    const andere = Object.entries(SOLLKONTO_JE_ZAHLART).filter(([k]) => k !== 'CASH');
    expect(andere.length).toBeGreaterThan(0);
    for (const [zahlart, konto] of andere) {
      expect(konto, `${zahlart} darf nicht auf die Kasse buchen`).not.toBe('1000');
    }
  });

  it('jeder Akzeptanzweg hat sein EIGENES Durchgangskonto', () => {
    // Sonst laesst sich der Bankeingang spaeter nicht zuordnen: der Saldo je
    // Konto ist genau das Geld, das bei diesem Anbieter unterwegs ist.
    const wege = ['ZVT_CARD', 'SUMUP', 'MOLLIE', 'STRIPE', 'EBAY'];
    const konten = wege.map((w) => sollkontoFuerZahlart(w));
    expect(new Set(konten).size).toBe(wege.length);
  });

  it('die Ueberweisung geht auf die Bank, nicht auf den Geldtransit', () => {
    expect(sollkontoFuerZahlart('BANK_TRANSFER')).toBe('1200');
  });

  it('eine nicht kontierte Zahlart BRICHT AB statt auf die Kasse zu fallen', () => {
    // Der stille Rueckfall ist genau der Fehler, den diese Datei behebt.
    for (const offen of ['DEBT', 'TRADE_IN']) {
      expect(() => sollkontoFuerZahlart(offen)).toThrow(ZahlartNichtKontiertError);
    }
    expect(() => sollkontoFuerZahlart('DEBT')).toThrow(/Kundenkonto/);
    expect(() => sollkontoFuerZahlart('TRADE_IN')).toThrow(/Inzahlungnahme/);
  });

  it('der Gutschein bucht auf die Verbindlichkeit, NICHT auf die Kasse (12.08.2026)', () => {
    // Amtlich geprueft: SKR03 1796 / SKR04 3786 "Ausgegebene
    // Geschenkgutscheine", beide ohne Automatikfunktion. Vorher brach ein
    // einziger Gutschein-Beleg die DATEV-Datei des ganzen Tages ab.
    expect(sollkontoFuerZahlart('VOUCHER')).toBe('1796');
    expect(sollkontoFuerZahlart('VOUCHER', vorlagenplan('SKR04'))).toBe('3786');
    // 3270 waere ein Automatikkonto mit fester 16-Prozent-Steuerfunktion.
    expect(sollkontoFuerZahlart('VOUCHER', vorlagenplan('SKR04'))).not.toBe('3270');
    expect(sollkontoFuerZahlart('VOUCHER')).not.toBe(sollkontoFuerZahlart('CASH'));
  });
});

describe('die Zahlart Stripe Terminal (26.07.2026, Koordination §9)', () => {
  it('bucht auf ein EIGENES Durchgangskonto, getrennt vom Web-Shop-Stripe', () => {
    // Terminal-Auszahlungen und Shop-Auszahlungen sind getrennte Stroeme
    // DESSELBEN Anbieters; auf einem gemeinsamen Konto liesse sich der
    // Bankeingang nicht mehr je Weg abstimmen. 1366 ist die fortgefuehrte
    // Reihe 1361 ff. — von Hand hingeschrieben, nicht importiert.
    expect(sollkontoFuerZahlart('STRIPE_TERMINAL')).toBe('1366');
    expect(sollkontoFuerZahlart('STRIPE_TERMINAL')).not.toBe(sollkontoFuerZahlart('STRIPE'));
  });

  it('traegt in SKR04 die fortgefuehrte Reihe 1461 ff.', () => {
    const plan = vorlagenplan('SKR04');
    expect(sollkontoFuerZahlart('STRIPE_TERMINAL', plan)).toBe('1466');
    expect(sollkontoFuerZahlart('STRIPE', plan)).toBe('1464');
  });

  it('hat einen Kurznamen fuer den Buchungstext geteilter Zahlungen', () => {
    // Ohne ihn stuenden bei einem geteilt bezahlten Beleg zwei gleich
    // lautende Zeilen untereinander, und der Berater muesste raten.
    expect(ZAHLART_KURZ.STRIPE_TERMINAL).toBe('Stripe Terminal');
  });
});

describe('Zahlungen und Steuerbehandlungen kreuzen', () => {
  it('eine Zahlart, eine Behandlung — die einfachste und haeufigste Zeile', () => {
    const a = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'CASH', betragEur: '119.00' }],
      [{ code: 'STANDARD_19', cents: 11900n }],
    );
    expect(a).toEqual([
      { zahlart: 'CASH', sollkonto: '1000', behandlungscode: 'STANDARD_19', cents: 11900n },
    ]);
  });

  it('Karte beruehrt die Kasse NICHT', () => {
    const a = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'ZVT_CARD', betragEur: '250.00' }],
      [{ code: 'STANDARD_19', cents: 25000n }],
    );
    expect(a[0]?.sollkonto).toBe('1361');
    expect(a.some((x) => x.sollkonto === '1000')).toBe(false);
  });

  it('geteilte Zahlung: die Summe JE ZAHLART bleibt auf den Cent genau', () => {
    // Auf der Produktion gemessen: einer von 64 Belegen hat mehr als eine
    // Zahlart. Selten, aber nicht null.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '50.00' },
        { zahlart: 'ZVT_CARD', betragEur: '69.00' },
      ],
      [
        { code: 'STANDARD_19', cents: 8900n },
        { code: 'MARGIN_25A', cents: 3000n },
      ],
    );
    const jeZahlart = new Map<string, bigint>();
    for (const a of anteile) {
      jeZahlart.set(a.zahlart, (jeZahlart.get(a.zahlart) ?? 0n) + a.cents);
    }
    expect(jeZahlart.get('CASH')).toBe(5000n);
    expect(jeZahlart.get('ZVT_CARD')).toBe(6900n);
  });

  it('geteilte Zahlung: die Summe JE BEHANDLUNG bleibt auf den Cent genau', () => {
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '50.00' },
        { zahlart: 'ZVT_CARD', betragEur: '69.00' },
      ],
      [
        { code: 'STANDARD_19', cents: 8900n },
        { code: 'MARGIN_25A', cents: 3000n },
      ],
    );
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    // 26.07.2026: hier stand bis heute eine ZUGELASSENE Abweichung von bis zu
    // zwei Cent. Damit war der Defekt als richtig festgeschrieben. Verlangt ist
    // Exaktheit, denn der Pruefer stellt DATEV je Erloeskonto gegen DSFinV-K je
    // Steuerbehandlung — und dort muss beides dieselbe Zahl tragen.
    //
    // Von Hand nachgerechnet, Zahlungen 5000 und 6900, Behandlungen 8900 und
    // 3000, Zahlsumme 11900:
    //   Spaltenziele  8900 und 3000 (Zahlsumme gleich Belegsumme)
    //   bar/STD    5000*8900/11900 = 3739,49...  Boden 3739, Rest 5900
    //   bar/MARGIN 5000*3000/11900 = 1260,50...  Boden 1260, Rest 6000
    //   Kt/STD     6900*8900/11900 = 5160,50...  Boden 5160, Rest 6000
    //   Kt/MARGIN  6900*3000/11900 = 1739,49...  Boden 1739, Rest 5900
    //   Zeilen fehlen je 1, Spalten fehlen je 1, zusammen 2 Cent.
    //   Groesster Rest 6000, Gleichstand -> erste Zeile: bar/MARGIN wird 1261.
    //   Damit ist Zeile bar und Spalte MARGIN voll; der zweite Cent kann nur
    //   noch nach Kt/STD -> 5161.
    //   STANDARD_19 = 3739 + 5161 = 8900,  MARGIN_25A = 1261 + 1739 = 3000.
    const gesamt = [...jeBehandlung.values()].reduce((s, x) => s + x, 0n);
    expect(gesamt).toBe(11900n);
    expect(jeBehandlung.get('STANDARD_19')).toBe(8900n);
    expect(jeBehandlung.get('MARGIN_25A')).toBe(3000n);
  });

  it('die Kreuzprobe des Pruefers: beide Raender stimmen auf den Cent', () => {
    // Der gemessene Fall vom 26.07.2026. Ein Beleg ueber 1,00 Euro, zwei
    // Behandlungen zu je 0,50, bezahlt mit 0,51 bar und 0,49 Karte.
    //
    // Der alte Weg verteilte JEDE Zahlung fuer sich und gab den Divisionsrest
    // jedes Mal in dieselbe Richtung:
    //   bar   51*50/100 = 25,5 -> abgeschnitten 25, Rest an die zweite 26
    //   Karte 49*50/100 = 24,5 -> abgeschnitten 24, Rest an die zweite 25
    //   je Behandlung 49 und 51 — die Abweichung haeuft sich mit jeder Zahlung.
    //
    // Von Hand richtig, ueber die ganze Kreuztabelle:
    //   Spaltenziele 50 und 50; Boeden 25/25 (bar) und 24/24 (Karte);
    //   je Zeile fehlt 1, je Spalte fehlt 1, alle vier Reste sind gleich 50.
    //   Erster Cent an bar/A (Gleichstand geht an die groesste, dann an die
    //   erste Zeile) -> 26. Danach ist nur noch Zeile Karte und Spalte B
    //   offen, also zwangsweise Karte/B -> 25.
    //   bar 26+25 = 51 und Karte 24+25 = 49 — Zahlarten exakt.
    //   A 26+24 = 50 und B 25+25 = 50 — Behandlungen exakt.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '0.51' },
        { zahlart: 'ZVT_CARD', betragEur: '0.49' },
      ],
      [
        { code: 'A', cents: 50n },
        { code: 'B', cents: 50n },
      ],
    );

    const jeZahlart = new Map<string, bigint>();
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      jeZahlart.set(a.zahlart, (jeZahlart.get(a.zahlart) ?? 0n) + a.cents);
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(jeZahlart.get('CASH')).toBe(51n);
    expect(jeZahlart.get('ZVT_CARD')).toBe(49n);
    expect(jeBehandlung.get('A')).toBe(50n);
    expect(jeBehandlung.get('B')).toBe(50n);
  });

  it('drei Zahlarten auf drei Behandlungen: kein Topf laeuft ueber oder leer', () => {
    // Krumme Zahlen, damit sich ein einseitiger Rest sofort zeigt. Beleg
    // 100,03 Euro = 10003 Cent, verteilt auf 3334 + 3334 + 3335 und bezahlt mit
    // 3333 bar, 3335 Karte, 3335 Ueberweisung (Summe 10003).
    // Die Zusage lautet nicht, welche Zelle welchen Cent bekommt, sondern dass
    // BEIDE Raender exakt aufgehen — genau das prueft ein Betriebspruefer.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '33.33' },
        { zahlart: 'ZVT_CARD', betragEur: '33.35' },
        { zahlart: 'BANK_TRANSFER', betragEur: '33.35' },
      ],
      [
        { code: 'X', cents: 3335n },
        { code: 'Y', cents: 3334n },
        { code: 'Z', cents: 3334n },
      ],
    );
    const jeZahlart = new Map<string, bigint>();
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      expect(a.cents).toBeGreaterThan(0n);
      jeZahlart.set(a.zahlart, (jeZahlart.get(a.zahlart) ?? 0n) + a.cents);
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(jeZahlart.get('CASH')).toBe(3333n);
    expect(jeZahlart.get('ZVT_CARD')).toBe(3335n);
    expect(jeZahlart.get('BANK_TRANSFER')).toBe(3335n);
    expect(jeBehandlung.get('X')).toBe(3335n);
    expect(jeBehandlung.get('Y')).toBe(3334n);
    expect(jeBehandlung.get('Z')).toBe(3334n);
  });

  it('krumme Betraege verlieren keinen Cent', () => {
    const anteile = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'CASH', betragEur: '33.33' }],
      [
        { code: 'A', cents: 1111n },
        { code: 'B', cents: 1111n },
        { code: 'C', cents: 1111n },
      ],
    );
    expect(anteile.reduce((s, a) => s + a.cents, 0n)).toBe(3333n);
  });

  it('ein Storno kehrt das Vorzeichen nicht in die Cent-Summe', () => {
    // Die Richtung traegt Feld 2 (Soll/Haben); der Betrag ist immer positiv.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'CASH', betragEur: '-119.00' }],
      [{ code: 'STANDARD_19', cents: -11900n }],
    );
    expect(anteile[0]?.cents).toBe(11900n);
  });

  it('eine Zahlung ueber null erzeugt keine Zeile', () => {
    // DATEV weist eine Buchung ueber 0,00 zurueck.
    expect(
      kreuzeZahlungenMitBehandlungen(
        [{ zahlart: 'CASH', betragEur: '0.00' }],
        [{ code: 'STANDARD_19', cents: 11900n }],
      ),
    ).toEqual([]);
  });

  it('ohne Behandlung gibt es nichts zu buchen', () => {
    expect(kreuzeZahlungenMitBehandlungen([{ zahlart: 'CASH', betragEur: '10.00' }], [])).toEqual(
      [],
    );
  });

  // ── GEGENPROBE 26.07.2026: die Randfaelle der neuen Kreuzverteilung ──────
  // Geschrieben, um die Behebung zu WIDERLEGEN, nicht um sie zu bestaetigen.

  it('eine Behandlung ueber null bekommt KEINEN Cent', () => {
    // Der alte Weg sortierte absteigend und gab den Rest an die LETZTE, also
    // an die kleinste — eine Behandlung ueber 0,00 Euro war damit genau der
    // Topf, in den der Rundungsrest fiel. Von Hand: Beleg 10,01 Euro = 1001
    // Cent, Behandlungen 1001 und 0, bezahlt 500 bar und 501 Karte.
    //   ALT: bar   500*1001/1001 = 500, letzte bekommt 500-500 = 0  -> keine Zeile
    //        Karte 501*1001/1001 = 501, letzte bekommt 501-501 = 0  -> keine Zeile
    //   Hier faellt nichts, weil die Gewichte glatt aufgehen. Der Beweis liegt
    //   in der Zusage selbst: die Spalte NULL muss null bleiben, und beide
    //   Raender muessen aufgehen.
    //   NEU: Spaltenziele 1001 und 0. Zeile bar: 500*1001/1001 = 500 Rest 0,
    //        500*0/1001 = 0. Zeile Karte ebenso 501 und 0. Nichts offen.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '5.00' },
        { zahlart: 'ZVT_CARD', betragEur: '5.01' },
      ],
      [
        { code: 'VOLL', cents: 1001n },
        { code: 'LEER', cents: 0n },
      ],
    );
    expect(anteile.some((a) => a.behandlungscode === 'LEER')).toBe(false);
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(jeBehandlung.get('VOLL')).toBe(1001n);
  });

  it('ein Betrag kleiner als die Zahl der Toepfe erfindet nichts', () => {
    // Ein Cent bar auf drei gleich grosse Behandlungen. Von Hand:
    //   Belegsumme 300, Zahlsumme 1. Spaltenziele: 1*100/300 = 0 dreimal,
    //   Reste je 100, ein Cent offen -> Gleichstand geht an die erste: [1,0,0].
    //   Zeile bar: 1*1/1 = 1 fuer die erste Spalte, 0 fuer die anderen.
    //   Ergebnis: genau EINE Zeile ueber 1 Cent. Kein Cent mehr, keiner weniger.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'CASH', betragEur: '0.01' }],
      [
        { code: 'A', cents: 100n },
        { code: 'B', cents: 100n },
        { code: 'C', cents: 100n },
      ],
    );
    expect(anteile.length).toBe(1);
    expect(anteile[0]?.cents).toBe(1n);
    expect(anteile.reduce((s, a) => s + a.cents, 0n)).toBe(1n);
  });

  it('Teilzahlung: gebucht wird das GEZAHLTE, nicht der Beleg', () => {
    // Beleg 100,00 Euro, aber nur 60,00 Euro liegen als Zahlung vor
    // (Datenschaden oder Anzahlung). Von Hand: Behandlungen 7000 und 3000,
    // Zahlsumme 6000. Spaltenziele 6000*7000/10000 = 4200 und
    // 6000*3000/10000 = 1800, zusammen 6000. Erfundenes Geld entsteht nicht.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [{ zahlart: 'CASH', betragEur: '60.00' }],
      [
        { code: 'STANDARD_19', cents: 7000n },
        { code: 'MARGIN_25A', cents: 3000n },
      ],
    );
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(anteile.reduce((s, a) => s + a.cents, 0n)).toBe(6000n);
    expect(jeBehandlung.get('STANDARD_19')).toBe(4200n);
    expect(jeBehandlung.get('MARGIN_25A')).toBe(1800n);
  });

  it('Storno mit zwei Zahlarten: beide Raender stimmen im Betrag', () => {
    // Dieselbe Kreuzung wie der gemessene Fall, nur negativ. Der Betrag ist
    // immer positiv, die Richtung traegt Feld 2. Erwartet also 51/49 und 50/50.
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '-0.51' },
        { zahlart: 'ZVT_CARD', betragEur: '-0.49' },
      ],
      [
        { code: 'A', cents: -50n },
        { code: 'B', cents: -50n },
      ],
    );
    const jeZahlart = new Map<string, bigint>();
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      expect(a.cents).toBeGreaterThan(0n);
      jeZahlart.set(a.zahlart, (jeZahlart.get(a.zahlart) ?? 0n) + a.cents);
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(jeZahlart.get('CASH')).toBe(51n);
    expect(jeZahlart.get('ZVT_CARD')).toBe(49n);
    expect(jeBehandlung.get('A')).toBe(50n);
    expect(jeBehandlung.get('B')).toBe(50n);
  });

  it('eine Zahlung ueber null zwischen zwei echten verschiebt nichts', () => {
    const anteile = kreuzeZahlungenMitBehandlungen(
      [
        { zahlart: 'CASH', betragEur: '0.51' },
        { zahlart: 'SUMUP', betragEur: '0.00' },
        { zahlart: 'ZVT_CARD', betragEur: '0.49' },
      ],
      [
        { code: 'A', cents: 50n },
        { code: 'B', cents: 50n },
      ],
    );
    expect(anteile.some((a) => a.zahlart === 'SUMUP')).toBe(false);
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(jeBehandlung.get('A')).toBe(50n);
    expect(jeBehandlung.get('B')).toBe(50n);
  });

  it('600 gewuerfelte Kreuzungen: beide Raender gehen IMMER auf', () => {
    // Der eigentliche Angriff auf die Behebung. Gewuerfelt, aber mit festem
    // Startwert, damit ein Fehlschlag reproduzierbar bleibt und der Lauf nie
    // flackert. Geprueft werden die drei Zusagen des Kopfkommentars:
    //   1. Summe je Zahlart = gezahlter Betrag
    //   2. Summe je Behandlung = Spaltenziel (bei voller Zahlung der Beleg)
    //   3. keine Zeile ueber null oder darunter
    // Dazu die Schranke, die aus dem Verfahren folgt: eine Zelle liegt nie
    // unter ihrem abgeschnittenen Anteil und nie mehr als min(Zeilen, Spalten)
    // minus eins darueber — die Zeile kann hoechstens (Spalten-1) Cent
    // nachverteilen, die Spalte hoechstens (Zeilen-1).
    let saat = 20260726n;
    const wuerfel = (grenze: number): number => {
      // Lehmer, ein Einzeiler mit langer Periode. Kein Fliesskomma im Geld.
      saat = (saat * 48271n) % 2147483647n;
      return Number(saat % BigInt(grenze));
    };
    const zahlarten = ['CASH', 'ZVT_CARD', 'SUMUP', 'MOLLIE', 'STRIPE', 'EBAY', 'BANK_TRANSFER'];

    for (let lauf = 0; lauf < 600; lauf++) {
      const anzahlB = 1 + wuerfel(6);
      const anzahlZ = 1 + wuerfel(5);
      const behandlungen = Array.from({ length: anzahlB }, (_, j) => ({
        code: `B${j}`,
        cents: BigInt(wuerfel(50000)),
      }));
      const gesamtB = behandlungen.reduce((s, b) => s + b.cents, 0n);
      if (gesamtB === 0n) continue;
      // Die Zahlungen summieren sich exakt auf den Beleg: der Alltag.
      const teile: bigint[] = [];
      let rest = gesamtB;
      for (let i = 0; i < anzahlZ - 1; i++) {
        const t = BigInt(wuerfel(Number(rest) + 1));
        teile.push(t);
        rest -= t;
      }
      teile.push(rest);
      const zahlungen = teile.map((t, i) => ({
        zahlart: zahlarten[i % zahlarten.length] as string,
        betragEur: `${t / 100n}.${(t % 100n).toString().padStart(2, '0')}`,
      }));
      const gesamtZ = teile.reduce((s, t) => s + t, 0n);
      if (gesamtZ === 0n) continue;

      const anteile = kreuzeZahlungenMitBehandlungen(zahlungen, behandlungen);

      const jeZahlart = new Map<string, bigint>();
      const jeBehandlung = new Map<string, bigint>();
      for (const a of anteile) {
        expect(a.cents, `Lauf ${lauf}: Zeile ueber null oder darunter`).toBeGreaterThan(0n);
        jeZahlart.set(a.zahlart, (jeZahlart.get(a.zahlart) ?? 0n) + a.cents);
        jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
      }
      // 1. je Zahlart. Gleiche Zahlarten in einem Beleg werden zusammengezaehlt.
      const erwartetZahlart = new Map<string, bigint>();
      for (let i = 0; i < zahlungen.length; i++) {
        const k = zahlungen[i]?.zahlart as string;
        erwartetZahlart.set(k, (erwartetZahlart.get(k) ?? 0n) + (teile[i] as bigint));
      }
      for (const [k, soll] of erwartetZahlart) {
        expect(jeZahlart.get(k) ?? 0n, `Lauf ${lauf}: Zahlart ${k}`).toBe(soll);
      }
      // 2. je Behandlung. Zahlsumme gleich Belegsumme, also der Belegbetrag.
      for (const b of behandlungen) {
        expect(jeBehandlung.get(b.code) ?? 0n, `Lauf ${lauf}: Behandlung ${b.code}`).toBe(b.cents);
      }
      // 3. die Gesamtsumme.
      expect(anteile.reduce((s, a) => s + a.cents, 0n), `Lauf ${lauf}: Summe`).toBe(gesamtZ);
      // 4. die Schranke je Zelle.
      const schranke = BigInt(Math.min(zahlungen.length, behandlungen.length) - 1);
      for (const a of anteile) {
        const b = behandlungen.find((x) => x.code === a.behandlungscode);
        const zi = zahlungen.findIndex((x) => x.zahlart === a.zahlart);
        const betrag = teile[zi] as bigint;
        const boden = (betrag * (b?.cents ?? 0n)) / gesamtZ;
        expect(a.cents, `Lauf ${lauf}: Zelle unter dem Boden`).toBeGreaterThanOrEqual(boden);
        expect(a.cents, `Lauf ${lauf}: Zelle ueber der Schranke`).toBeLessThanOrEqual(
          boden + schranke + 1n,
        );
      }
    }
  });

  it('vierzig Zahlungen ueber je einen Cent haengen die Schleife nicht auf', () => {
    // Der Fall, in dem jede einzelne Zeile einen Cent nachverteilen muss:
    // 40 Zahlungen ueber 0,01 Euro auf drei Behandlungen zu 14, 13 und 13.
    // Belegsumme 40, Zahlsumme 40. Jede Zeile hat Boeden 0/0/0 und einen Cent
    // offen; die Spalten muessen am Ende genau 14, 13 und 13 tragen. Der
    // Durchlauf steht in Sekundenbruchteilen, sonst schlaegt die Zeitgrenze zu.
    const zahlungen = Array.from({ length: 40 }, () => ({
      zahlart: 'CASH',
      betragEur: '0.01',
    }));
    const anteile = kreuzeZahlungenMitBehandlungen(zahlungen, [
      { code: 'A', cents: 14n },
      { code: 'B', cents: 13n },
      { code: 'C', cents: 13n },
    ]);
    const jeBehandlung = new Map<string, bigint>();
    for (const a of anteile) {
      expect(a.cents).toBe(1n);
      jeBehandlung.set(a.behandlungscode, (jeBehandlung.get(a.behandlungscode) ?? 0n) + a.cents);
    }
    expect(anteile.length).toBe(40);
    expect(jeBehandlung.get('A')).toBe(14n);
    expect(jeBehandlung.get('B')).toBe(13n);
    expect(jeBehandlung.get('C')).toBe(13n);
  });

  it('eine nicht kontierte Zahlart bricht die GANZE Datei ab', () => {
    // Nicht nur diese Zeile: eine halbe Buchfuehrung ist schlimmer als keine.
    expect(() =>
      kreuzeZahlungenMitBehandlungen(
        [
          { zahlart: 'CASH', betragEur: '50.00' },
          { zahlart: 'DEBT', betragEur: '69.00' },
        ],
        [{ code: 'STANDARD_19', cents: 11900n }],
      ),
    ).toThrow(ZahlartNichtKontiertError);
  });
});

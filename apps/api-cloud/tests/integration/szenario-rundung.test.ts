/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario RUNDUNG — Cent-Treue, Aufteilung und Ausreisser
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Hier geht es um die Arithmetik selbst, nicht um Formate. Gefahren wird gegen
 * ein ECHTES Postgres im Behaelter, mit ALLEN Wanderungen, und die Ausgabewege
 * werden ueber ECHTE HTTP-Aufrufe der Anwendung gezogen:
 *
 *   POST /api/closings/finalize                  — der Tagesabschluss RECHNET
 *   GET  /api/closings/:id/export/datev          — der Buchungsstapel
 *   GET  /api/closings/:id/export/kassenbericht   — das Blatt fuer den Pruefer
 *
 * Keine Attrappe steht in einem Rechenweg. Der Abschluss wird NICHT von Hand
 * gesetzt, sondern von der Route aus den Belegen aggregiert — sonst waere
 * „Summe der Belege gleich Tagessumme" ein Vergleich einer Zahl mit sich selbst.
 *
 * ── DIE BELEGE ─────────────────────────────────────────────────────────────
 * 60 Belege mit krummen Betraegen, Mengen, Rabatten und gemischten
 * Steuerbehandlungen, gezogen aus einem FESTEN linearen Kongruenzgenerator
 * (Saat 20260914). Kein `Math.random`: derselbe Lauf muss morgen dieselben
 * Zahlen bringen, sonst ist ein roter Lauf nicht nachstellbar.
 * Dazu ein Tag mit den Ausreissern (0,01 EUR, 987.654,32 EUR, drei Behandlungen
 * zu je einem Cent) und ein Tag mit einem Storno.
 *
 * ── ZWEI FUNDE, die dieser Lauf MISST — BEIDE BEHOBEN ──────────────────────
 * Ein Test, der `it.fails` traegt, ist KEIN Freibrief und kein „so ist es
 * eben": im Rumpf steht die VON HAND NACHGERECHNETE Sollzahl, und `it.fails`
 * haelt nur fest, dass der Quelltext sie heute verfehlt. Wird der Defekt
 * behoben, wird der Test ROT und muss entfernt werden — der Fund kann also
 * nicht stillschweigend verjaehren. Genau das ist am 26.07.2026 mit beiden
 * Funden geschehen: sie stehen jetzt als NORMALE Tests, mit denselben von
 * Hand nachgerechneten Zahlen. In dieser Datei traegt kein Test mehr
 * `it.fails`.
 *
 *   FUND 1  `src/lib/datev-kontierung.ts`  — BEHOBEN am 26.07.2026
 *           Bei GETEILTER Zahlung verfehlte die Aufteilung die
 *           Behandlungssumme des Belegs um einen Cent. Soll 0,50 / 0,50 —
 *           gemessen 0,49 / 0,51. Damit stand ein Cent Umsatz im falschen
 *           Steuertopf (8400 statt 8200), obwohl der Dateikopf derselben Datei
 *           ausdruecklich zusagt, dass „die Summe je Behandlung auf den Cent
 *           die des Belegs bleibt". Ursache: jede Zahlung wurde fuer sich
 *           verteilt und der Divisionsrest jedes Mal in dieselbe Richtung
 *           gegeben. Behoben durch das Verfahren der groessten Reste ueber die
 *           GANZE Kreuztabelle; die Handrechnung steht am Test unten.
 *
 *   FUND 2  `src/routes/closings-finalize.ts`  — NEU VERMESSEN am 26.07.2026,
 *           die naheliegende Behebung war die FALSCHE Seite der Gleichung.
 *           Der Umsatzblock zeigt Verkauf netto 100,00 neben Umsatzsteuer 0,00
 *           neben Verkauf brutto vor Storno 119,00 — drei Zahlen, die sich
 *           nicht zusammenrechnen lassen. Der Versuch, die Umsatzsteuerabfrage
 *           ebenfalls auf `storno_of_transaction_id IS NULL` zu filtern, ist
 *           GEMESSEN schlechter: das Blatt weist dann 19,00 EUR Umsatzsteuer
 *           fuer einen Tag aus, an dem Umsatz nach Storno und Zahlungen beide
 *           auf 0,00 stehen, und widerspricht DATEV (Erloessaldo 0) und dem
 *           Kopf des DSFinV-K-Buendels (0/0). Die Umsatzsteuer bleibt NACH
 *           Storno; zu beschriften ist die Zeile „Verkauf netto", die als
 *           einzige des Blocks den Zusatz vor/nach Storno nicht traegt. Die
 *           volle Herleitung steht am Test unten.
 *
 * Ausgefuehrt mit vorangestelltem `TESTCONTAINERS_RYUK_DISABLED=true`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BelegAngaben,
  type PositionAngabe,
  type ZahlungAngabe,
  baueFiskalBuehne,
} from '../helfer/fiskal-buehne.js';

// ── Geld: ganze Cent als bigint, niemals Fliesskomma ───────────────────────

/** '123.45' → 12345n. Auch '-1.00' und '0'. */
function zuCent(eur: string): bigint {
  const t = eur.trim();
  const minus = t.startsWith('-');
  const [ganz = '0', bruch = ''] = (minus ? t.slice(1) : t).split('.');
  const wert = BigInt(ganz || '0') * 100n + BigInt((bruch + '00').slice(0, 2));
  return minus ? -wert : wert;
}

/** 12345n → '123.45' — die Schreibweise, die NUMERIC(18,2) erwartet. */
function alsEur(cent: bigint): string {
  const minus = cent < 0n;
  const abs = minus ? -cent : cent;
  return `${minus ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** '1234,56' → 123456n. DATEV schreibt das Komma und nie ein Vorzeichen. */
function datevZuCent(umsatz: string): bigint {
  const treffer = /^(\d+)(?:,(\d{1,2}))?$/.exec(umsatz.trim());
  if (!treffer) throw new Error(`Kein DATEV-Betrag: „${umsatz}"`);
  return BigInt(treffer[1]!) * 100n + BigInt((treffer[2] ?? '').padEnd(2, '0'));
}

/**
 * Kaufmaennisch runden, in ganzen Zahlen: floor(z/n + 1/2) = (2z + n) / 2n.
 * Nur fuer z >= 0 und n > 0 — genau so entstehen die Betraege, die auf einer
 * halben Einheit stehen und den Rundungsfehler ueberhaupt erst sichtbar machen.
 */
function rundeHalbAuf(zaehler: bigint, nenner: bigint): bigint {
  return (2n * zaehler + nenner) / (2n * nenner);
}

// ── Was der Steuerberater vorgibt (aus `datev-kontierung.ts` bzw.
//    `closing-export.ts`; hier WOERTLICH, damit ein stiller Rueckfall auf die
//    Kasse in dieser Datei auffliegt und nicht beim Berater) ────────────────

const GELDKONTO_JE_ZAHLART: Readonly<Record<string, string>> = {
  CASH: '1000', // Kasse — das einzige Konto, das echtes Bargeld sieht
  ZVT_CARD: '1361',
  SUMUP: '1362',
  MOLLIE: '1363',
  STRIPE: '1364',
  BANK_TRANSFER: '1200',
};

const ERLOESKONTO_JE_BEHANDLUNG: Readonly<Record<string, string>> = {
  STANDARD_19: '8400',
  REDUCED_7: '8300',
  MARGIN_25A: '8200',
  INVESTMENT_GOLD_25C: '8150',
  // ⚠️ Seit dem 27.07.2026 zerfaellt JEDE Verkaufsposition nach § 25a in ZWEI
  // Anteile, und deshalb erscheint 8200 bei einem Verkauf gar nicht mehr. Der
  // Grund steht in `closing-export.ts` bei `teileZeileAuf`: bis dahin ging der
  // VOLLE Verkaufspreis auf ein Konto ohne Umsatzsteuer und ohne
  // Buchungsschluessel, gemessen an Romans Daten 5.393,19 EUR Steuer, die in
  // keiner einzigen Buchungszeile vorkam. Der Einkaufsanteil ist gedeckelt auf
  // den Zeilenbetrag, damit ein Verlustverkauf keinen erfundenen Erloes
  // schreibt; die Marge ist der Rest und traegt den Buchungsschluessel.
  MARGIN_25A_EINKAUF: '8193',
  MARGIN_25A_MARGE: '8191',
};

// ── Der feste Zufall ───────────────────────────────────────────────────────

/**
 * Ein linearer Kongruenzgenerator (Numerical Recipes: a = 1664525,
 * c = 1013904223, m = 2^32). Bewusst KEIN `Math.random`: ein Lauf, der sich
 * nicht wiederholen laesst, kann einen Fund nicht belegen.
 */
function baueZufall(saat: number): () => number {
  let z = saat >>> 0;
  return () => {
    z = (Math.imul(1664525, z) + 1013904223) >>> 0;
    return z / 4294967296;
  };
}

// ── Die Buchhaltung des Tests: was WIR angelegt haben ──────────────────────

interface Beleg {
  locator: string;
  richtung: 'VERKAUF' | 'ANKAUF';
  istStorno: boolean;
  /** Vorzeichenbehaftet: beim Storno negativ. */
  nettoCent: bigint;
  ustCent: bigint;
  bruttoCent: bigint;
  /** Je Steuerbehandlung der Positionen, vorzeichenbehaftet. */
  ustJeBehandlung: Map<string, bigint>;
  bruttoJeBehandlung: Map<string, bigint>;
  /** Je Zahlart, vorzeichenbehaftet. */
  zahlungJeArt: Map<string, bigint>;
}

/** Einen Betrag in eine Zuordnung aufaddieren. */
function addiere(karte: Map<string, bigint>, schluessel: string, cent: bigint): void {
  karte.set(schluessel, (karte.get(schluessel) ?? 0n) + cent);
}

// ── Die DATEV-Datei lesen ──────────────────────────────────────────────────

interface Buchungszeile {
  umsatzCent: bigint;
  sollHaben: string;
  konto: string;
  gegenkonto: string;
  buSchluessel: string;
  beleg: string;
  buchungstext: string;
  /** Das rohe Feld 1, ungefiltert — fuer die Vorzeichenprobe. */
  umsatzRoh: string;
  /** Feld 118 — '1' auf einer Generalumkehr, sonst leer. */
  generalumkehr: string;
}

function ohneAnfuehrung(wert: string): string {
  return wert.replace(/^"|"$/g, '');
}

/** Kopfzeile + Spaltenzeile ueberspringen, die Buchungen zerlegen. */
function leseBuchungen(rohBytes: Buffer): Buchungszeile[] {
  // Die Datei ist ANSI (Windows-1252) — deshalb die ROHEN Bytes, nicht payload.
  const text = Buffer.from(rohBytes).toString('latin1');
  return text
    .split('\r\n')
    .filter((z) => z.length > 0)
    .slice(2)
    .map((z) => {
      const f = z.split(';').map(ohneAnfuehrung);
      return {
        umsatzRoh: f[0] ?? '',
        umsatzCent: datevZuCent(f[0] ?? ''),
        sollHaben: f[1] ?? '',
        konto: f[6] ?? '',
        gegenkonto: f[7] ?? '',
        buSchluessel: f[8] ?? '',
        beleg: f[10] ?? '',
        buchungstext: f[13] ?? '',
        generalumkehr: f[117] ?? '',
      };
    });
}

// ── Die Buehne ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 08.08.2026: Dieser Tag lag bis heute in der ZUKUNFT, damit er sich nicht
 * mit anderen Laeufen ueberschneidet. Seit `POST /api/closings/finalize` einen
 * Zukunftstag abweist (siehe `abschlusstag.ts`), geht das nicht mehr — und das
 * ist richtig so: ein festgeschriebener Zukunftstag legt den Laden still.
 *
 * Ein VERGANGENER Tag ist genauso eindeutig und ausserdem der einzige Fall,
 * den ein Haendler wirklich nachholt.
 */
const TAG_ZUFALL = '2025-09-15'; // Montag, Sommerzeit
const TAG_AUSREISSER = '2025-09-16';
const TAG_STORNO = '2025-09-17';

const buehne = baueFiskalBuehne({ geschaeftstag: TAG_ZUFALL });

/** Alles, was der Lauf einmal aufbaut und danach nur noch liest. */
const belegeJeTag = new Map<string, Beleg[]>();
const abschlussJeTag = new Map<string, string>();
const buchungenJeTag = new Map<string, Buchungszeile[]>();
const kassenberichtJeTag = new Map<string, string>();
const barErwartetJeTag = new Map<string, bigint>();

function belege(tag: string): Beleg[] {
  const b = belegeJeTag.get(tag);
  if (b === undefined) throw new Error(`Kein Beleg fuer ${tag} aufgebaut.`);
  return b;
}

function buchungen(tag: string): Buchungszeile[] {
  const b = buchungenJeTag.get(tag);
  if (b === undefined) throw new Error(`Keine Buchungen fuer ${tag} gezogen.`);
  return b;
}

describe('Szenario Rundung — Cent-Treue, Aufteilung und Ausreisser', () => {
  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren();

    const zufall = baueZufall(20260914);
    const ganz = (min: number, max: number): number =>
      min + Math.floor(zufall() * (max - min + 1));

    const BEHANDLUNGEN = [
      'STANDARD_19',
      'REDUCED_7',
      'MARGIN_25A',
      'INVESTMENT_GOLD_25C',
    ] as const;
    const ZAHLARTEN = ['CASH', 'ZVT_CARD', 'SUMUP', 'MOLLIE', 'STRIPE', 'BANK_TRANSFER'] as const;

    /**
     * Einen Beleg anlegen UND von Hand mitschreiben, was in ihm steht.
     * Die Buehne rechnet nichts; sie schreibt, was sie bekommt. Alles hier
     * ist in ganzen Cent gerechnet und erst beim Schreiben in die
     * NUMERIC(18,2)-Zeichenkette gegossen.
     */
    async function legeAn(
      angaben: BelegAngaben,
      mitschrift: Omit<Beleg, 'locator'>,
    ): Promise<Beleg> {
      const { locator } = await buehne.legeBelegAn(angaben);
      return { ...mitschrift, locator };
    }

    // ══ TAG 1: 60 zufaellige Belege ════════════════════════════════════════
    const zufallsbelege: Beleg[] = [];
    for (let nr = 0; nr < 60; nr += 1) {
      // Jeder siebte Beleg ist ein Ankauf — der kennt keine Ausgangsumsatz-
      // steuer und verlangt einen ausweisgeprueften Kunden (GwG).
      const richtung: 'VERKAUF' | 'ANKAUF' = nr % 7 === 6 ? 'ANKAUF' : 'VERKAUF';
      const zeilenzahl = richtung === 'ANKAUF' ? 1 : ganz(1, 3);

      const positionen: PositionAngabe[] = [];
      const ustJeBehandlung = new Map<string, bigint>();
      const bruttoJeBehandlung = new Map<string, bigint>();
      let netto = 0n;
      let ust = 0n;
      let brutto = 0n;
      const codes: string[] = [];

      for (let k = 0; k < zeilenzahl; k += 1) {
        const behandlung = richtung === 'ANKAUF' ? 'MARGIN_25A' : BEHANDLUNGEN[ganz(0, 3)]!;
        const produkt = await buehne.legeProduktAn({ behandlung });

        // Ein krummer Listenpreis und ein krummer Rabatt darauf. Gebucht wird
        // der Preis NACH Rabatt — genau so, wie ihn der Abschlussweg schreibt.
        const listeCent = BigInt(ganz(101, 40000));
        const rabattCent = BigInt(ganz(0, 900));
        const preisCent = listeCent - rabattCent > 1n ? listeCent - rabattCent : 1n;

        let lNetto: bigint;
        let lUst: bigint;
        let lBrutto: bigint;
        let satz: string | null;
        let anschaffung: string | null = null;
        let marge: string | null = null;

        if (behandlung === 'STANDARD_19') {
          // Der Preis ist das NETTO; 19 % darauf, kaufmaennisch gerundet.
          lNetto = preisCent;
          lUst = rundeHalbAuf(lNetto * 19n, 100n);
          lBrutto = lNetto + lUst;
          satz = '0.1900';
        } else if (behandlung === 'REDUCED_7') {
          lNetto = preisCent;
          lUst = rundeHalbAuf(lNetto * 7n, 100n);
          lBrutto = lNetto + lUst;
          satz = '0.0700';
        } else if (behandlung === 'INVESTMENT_GOLD_25C') {
          // Anlagegold ist steuerfrei: netto gleich brutto.
          lNetto = preisCent;
          lUst = 0n;
          lBrutto = preisCent;
          satz = '0.0000';
        } else {
          // § 25a: der Preis ist das BRUTTO, versteuert wird nur die Marge.
          lBrutto = preisCent;
          const einkauf = (preisCent * BigInt(ganz(30, 90))) / 100n;
          const margeCent = lBrutto - einkauf;
          lUst = richtung === 'ANKAUF' ? 0n : rundeHalbAuf(margeCent * 19n, 119n);
          lNetto = lBrutto - lUst;
          satz = null;
          anschaffung = alsEur(richtung === 'ANKAUF' ? lBrutto : einkauf);
          marge = alsEur(richtung === 'ANKAUF' ? 0n : margeCent);
        }

        positionen.push({
          productId: produkt,
          treatment: behandlung,
          vatRate: satz,
          lineSubtotal: alsEur(lNetto),
          lineVat: alsEur(lUst),
          lineTotal: alsEur(lBrutto),
          acquisition: anschaffung,
          margin: marge,
          displayOrder: k,
        });
        codes.push(behandlung);
        netto += lNetto;
        ust += lUst;
        brutto += lBrutto;
        addiere(ustJeBehandlung, behandlung, lUst);
        addiere(bruttoJeBehandlung, behandlung, lBrutto);
      }

      // Jeder dritte Verkauf wird GETEILT bezahlt — auf der Produktion ist es
      // einer von 64, hier absichtlich haeufiger, weil genau dort gerundet wird.
      const zahlungen: ZahlungAngabe[] = [];
      const zahlungJeArt = new Map<string, bigint>();
      if (richtung === 'VERKAUF' && nr % 3 === 1 && brutto > 1n) {
        const erstes = BigInt(ganz(1, Number(brutto) - 1));
        const artA = ZAHLARTEN[ganz(0, ZAHLARTEN.length - 1)]!;
        let artB = ZAHLARTEN[ganz(0, ZAHLARTEN.length - 1)]!;
        if (artB === artA) artB = artA === 'CASH' ? 'ZVT_CARD' : 'CASH';
        zahlungen.push({ method: artA, amount: alsEur(erstes) });
        zahlungen.push({ method: artB, amount: alsEur(brutto - erstes) });
        addiere(zahlungJeArt, artA, erstes);
        addiere(zahlungJeArt, artB, brutto - erstes);
      } else {
        const art = ZAHLARTEN[ganz(0, ZAHLARTEN.length - 1)]!;
        zahlungen.push({ method: art, amount: alsEur(brutto) });
        addiere(zahlungJeArt, art, brutto);
      }

      const kopfCode = new Set(codes).size === 1 ? codes[0]! : 'MIXED';
      zufallsbelege.push(
        await legeAn(
          {
            direction: richtung,
            treatment: kopfCode,
            subtotal: alsEur(netto),
            vat: alsEur(ust),
            total: alsEur(brutto),
            // Ein Ankauf verlangt den ausweisgeprueften Kunden; ein Verkauf
            // unter der GwG-Schwelle von 2.000 EUR braucht keinen.
            customerId: richtung === 'ANKAUF' ? buehne.akteure.kundeId : null,
            finalizedAt: buehne.ts(8 + Math.floor(nr / 6), (nr % 6) * 9, TAG_ZUFALL),
            items: positionen,
            payments: zahlungen,
            tse: true,
          },
          {
            richtung,
            istStorno: false,
            nettoCent: netto,
            ustCent: ust,
            bruttoCent: brutto,
            ustJeBehandlung,
            bruttoJeBehandlung,
            zahlungJeArt,
          },
        ),
      );
    }
    belegeJeTag.set(TAG_ZUFALL, zufallsbelege);

    // ══ TAG 2: die Ausreisser ═════════════════════════════════════════════
    const ausreisser: Beleg[] = [];

    // (a) EIN CENT. 0,01 EUR nach § 25a, bar bezahlt. Anschaffung 0,01,
    //     Marge 0,00, Umsatzsteuer 0,00 — netto gleich brutto gleich 0,01.
    ausreisser.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'MARGIN_25A',
          subtotal: '0.01',
          vat: '0.00',
          total: '0.01',
          customerId: null,
          finalizedAt: buehne.ts(9, 0, TAG_AUSREISSER),
          items: [
            {
              productId: await buehne.legeProduktAn(),
              treatment: 'MARGIN_25A',
              vatRate: null,
              lineSubtotal: '0.01',
              lineVat: '0.00',
              lineTotal: '0.01',
              acquisition: '0.01',
              margin: '0.00',
              displayOrder: 0,
            },
          ],
          payments: [{ method: 'CASH', amount: '0.01' }],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: false,
          nettoCent: 1n,
          ustCent: 0n,
          bruttoCent: 1n,
          ustJeBehandlung: new Map([['MARGIN_25A', 0n]]),
          bruttoJeBehandlung: new Map([['MARGIN_25A', 1n]]),
          zahlungJeArt: new Map([['CASH', 1n]]),
        },
      ),
    );

    // (b) SEHR GROSS. 987.654,32 EUR brutto zu 19 %.
    //     Von Hand: netto 829.961,61 → 82996161 * 19 = 1.576.927.059,
    //     geteilt durch 100 sind 15.769.270,59 Cent, kaufmaennisch gerundet
    //     15.769.271 Cent = 157.692,71 EUR Umsatzsteuer.
    //     82.996.161 + 15.769.271 = 98.765.432 Cent = 987.654,32 EUR. ✓
    //     Ueber der GwG-Schwelle, also mit ausweisgeprueftem Kunden, und
    //     geteilt bezahlt (Ueberweisung 500.000,00 + Karte 487.654,32).
    ausreisser.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'STANDARD_19',
          subtotal: '829961.61',
          vat: '157692.71',
          total: '987654.32',
          customerId: buehne.akteure.kundeId,
          finalizedAt: buehne.ts(10, 0, TAG_AUSREISSER),
          items: [
            {
              productId: await buehne.legeProduktAn({ behandlung: 'STANDARD_19' }),
              treatment: 'STANDARD_19',
              vatRate: '0.1900',
              lineSubtotal: '829961.61',
              lineVat: '157692.71',
              lineTotal: '987654.32',
              displayOrder: 0,
            },
          ],
          payments: [
            { method: 'BANK_TRANSFER', amount: '500000.00' },
            { method: 'ZVT_CARD', amount: '487654.32' },
          ],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: false,
          nettoCent: 82996161n,
          ustCent: 15769271n,
          bruttoCent: 98765432n,
          ustJeBehandlung: new Map([['STANDARD_19', 15769271n]]),
          bruttoJeBehandlung: new Map([['STANDARD_19', 98765432n]]),
          zahlungJeArt: new Map([
            ['BANK_TRANSFER', 50000000n],
            ['ZVT_CARD', 48765432n],
          ]),
        },
      ),
    );

    // (c) DREI BEHANDLUNGEN ZU JE EINEM CENT, geteilt bezahlt mit 0,01 bar
    //     und 0,02 Karte. Die Barzahlung ist KLEINER als die Zahl der
    //     Behandlungen — es kann also gar nicht jede einen Cent bekommen.
    const dreiCent: PositionAngabe[] = [];
    for (const [k, code] of ['STANDARD_19', 'REDUCED_7', 'INVESTMENT_GOLD_25C'].entries()) {
      dreiCent.push({
        productId: await buehne.legeProduktAn({ behandlung: code }),
        treatment: code,
        // 19 % von 0,01 sind 0,0019 EUR, gerundet 0,00 — dasselbe fuer 7 %.
        vatRate: code === 'STANDARD_19' ? '0.1900' : code === 'REDUCED_7' ? '0.0700' : '0.0000',
        lineSubtotal: '0.01',
        lineVat: '0.00',
        lineTotal: '0.01',
        displayOrder: k,
      });
    }
    ausreisser.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'MIXED',
          subtotal: '0.03',
          vat: '0.00',
          total: '0.03',
          customerId: null,
          finalizedAt: buehne.ts(11, 0, TAG_AUSREISSER),
          items: dreiCent,
          payments: [
            { method: 'CASH', amount: '0.01' },
            { method: 'ZVT_CARD', amount: '0.02' },
          ],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: false,
          nettoCent: 3n,
          ustCent: 0n,
          bruttoCent: 3n,
          ustJeBehandlung: new Map([
            ['STANDARD_19', 0n],
            ['REDUCED_7', 0n],
            ['INVESTMENT_GOLD_25C', 0n],
          ]),
          bruttoJeBehandlung: new Map([
            ['STANDARD_19', 1n],
            ['REDUCED_7', 1n],
            ['INVESTMENT_GOLD_25C', 1n],
          ]),
          zahlungJeArt: new Map([
            ['CASH', 1n],
            ['ZVT_CARD', 2n],
          ]),
        },
      ),
    );

    // (d) DER HALBE CENT. 1,00 EUR auf zwei Behandlungen zu je 0,50, bezahlt
    //     mit 0,51 bar und 0,49 Karte. Der genaue Anteil der Barzahlung an
    //     jeder Behandlung ist 51 * 50 / 100 = 25,5 Cent — ein Betrag, der auf
    //     einer halben Einheit endet. Genau hier entscheidet sich, ob die
    //     Behandlungssumme des Belegs erhalten bleibt.
    //     Position 1 (19 %): netto 0,42, USt round(42*19/100) = round(7,98) =
    //                        0,08, brutto 0,50.
    //     Position 2 (§ 25a): brutto 0,50, Einkauf 0,30, Marge 0,20,
    //                        USt round(20*19/119) = round(3,19) = 0,03,
    //                        netto 0,47.
    //     Kopf: netto 0,89 + USt 0,11 = brutto 1,00. ✓
    ausreisser.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'MIXED',
          subtotal: '0.89',
          vat: '0.11',
          total: '1.00',
          customerId: null,
          finalizedAt: buehne.ts(12, 0, TAG_AUSREISSER),
          items: [
            {
              productId: await buehne.legeProduktAn({ behandlung: 'STANDARD_19' }),
              treatment: 'STANDARD_19',
              vatRate: '0.1900',
              lineSubtotal: '0.42',
              lineVat: '0.08',
              lineTotal: '0.50',
              displayOrder: 0,
            },
            {
              productId: await buehne.legeProduktAn(),
              treatment: 'MARGIN_25A',
              vatRate: null,
              lineSubtotal: '0.47',
              lineVat: '0.03',
              lineTotal: '0.50',
              acquisition: '0.30',
              margin: '0.20',
              displayOrder: 1,
            },
          ],
          payments: [
            { method: 'CASH', amount: '0.51' },
            { method: 'ZVT_CARD', amount: '0.49' },
          ],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: false,
          nettoCent: 89n,
          ustCent: 11n,
          bruttoCent: 100n,
          ustJeBehandlung: new Map([
            ['STANDARD_19', 8n],
            ['MARGIN_25A', 3n],
          ]),
          bruttoJeBehandlung: new Map([
            ['STANDARD_19', 50n],
            ['MARGIN_25A', 50n],
          ]),
          zahlungJeArt: new Map([
            ['CASH', 51n],
            ['ZVT_CARD', 49n],
          ]),
        },
      ),
    );

    // (e) DIE GEGENPROBE zu (d): dieselben zwei Behandlungen zu je 0,50, aber
    //     mit EINER Zahlung ueber 1,00. Ohne Teilung ist der Anteil jeder
    //     Behandlung ganzzahlig, und die Aufteilung muss exakt aufgehen.
    ausreisser.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'MIXED',
          subtotal: '0.89',
          vat: '0.11',
          total: '1.00',
          customerId: null,
          finalizedAt: buehne.ts(13, 0, TAG_AUSREISSER),
          items: [
            {
              productId: await buehne.legeProduktAn({ behandlung: 'STANDARD_19' }),
              treatment: 'STANDARD_19',
              vatRate: '0.1900',
              lineSubtotal: '0.42',
              lineVat: '0.08',
              lineTotal: '0.50',
              displayOrder: 0,
            },
            {
              productId: await buehne.legeProduktAn(),
              treatment: 'MARGIN_25A',
              vatRate: null,
              lineSubtotal: '0.47',
              lineVat: '0.03',
              lineTotal: '0.50',
              acquisition: '0.30',
              margin: '0.20',
              displayOrder: 1,
            },
          ],
          payments: [{ method: 'CASH', amount: '1.00' }],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: false,
          nettoCent: 89n,
          ustCent: 11n,
          bruttoCent: 100n,
          ustJeBehandlung: new Map([
            ['STANDARD_19', 8n],
            ['MARGIN_25A', 3n],
          ]),
          bruttoJeBehandlung: new Map([
            ['STANDARD_19', 50n],
            ['MARGIN_25A', 50n],
          ]),
          zahlungJeArt: new Map([['CASH', 100n]]),
        },
      ),
    );
    belegeJeTag.set(TAG_AUSREISSER, ausreisser);

    // ══ TAG 3: ein Beleg und sein Storno ══════════════════════════════════
    const stornotag: Beleg[] = [];
    const produktStorno = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const original = await legeAn(
      {
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: buehne.ts(9, 0, TAG_STORNO),
        items: [
          {
            productId: produktStorno,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payments: [{ method: 'CASH', amount: '119.00' }],
        tse: true,
      },
      {
        richtung: 'VERKAUF',
        istStorno: false,
        nettoCent: 10000n,
        ustCent: 1900n,
        bruttoCent: 11900n,
        ustJeBehandlung: new Map([['STANDARD_19', 1900n]]),
        bruttoJeBehandlung: new Map([['STANDARD_19', 11900n]]),
        zahlungJeArt: new Map([['CASH', 11900n]]),
      },
    );
    stornotag.push(original);

    // Der Storno ist die genaue Verneinung — der Ausloeser aus 0009 rechnet nach.
    const [originalZeile] = await buehne.sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE receipt_locator = ${original.locator}`;
    stornotag.push(
      await legeAn(
        {
          direction: 'VERKAUF',
          treatment: 'STANDARD_19',
          subtotal: '-100.00',
          vat: '-19.00',
          total: '-119.00',
          customerId: null,
          finalizedAt: buehne.ts(10, 0, TAG_STORNO),
          stornoOf: originalZeile!.id,
          items: [
            {
              productId: produktStorno,
              treatment: 'STANDARD_19',
              vatRate: '0.1900',
              lineSubtotal: '-100.00',
              lineVat: '-19.00',
              lineTotal: '-119.00',
              displayOrder: 0,
            },
          ],
          payments: [{ method: 'CASH', amount: '-119.00' }],
          tse: true,
        },
        {
          richtung: 'VERKAUF',
          istStorno: true,
          nettoCent: -10000n,
          ustCent: -1900n,
          bruttoCent: -11900n,
          ustJeBehandlung: new Map([['STANDARD_19', -1900n]]),
          bruttoJeBehandlung: new Map([['STANDARD_19', -11900n]]),
          zahlungJeArt: new Map([['CASH', -11900n]]),
        },
      ),
    );
    belegeJeTag.set(TAG_STORNO, stornotag);

    // ══ Je Tag: Schicht schliessen, Abschluss RECHNEN LASSEN, Ausgaben ziehen ══
    for (const tag of [TAG_ZUFALL, TAG_AUSREISSER, TAG_STORNO]) {
      // Der Wechselgeldbestand am Morgen, plus alles Bargeld des Tages. Der
      // Abschlussweg summiert die geschlossenen Schichten und rechnet die
      // Differenz aus; wir geben ihm einen krummen, von Hand gebildeten Wert.
      const barCent = belege(tag).reduce((s, b) => s + (b.zahlungJeArt.get('CASH') ?? 0n), 0n);
      const erwartet = 50000n + barCent;
      barErwartetJeTag.set(tag, erwartet);
      await buehne.migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                            blind_count_eur, system_expected_eur, closed_by_user_id,
                            opened_at, closed_at)
        VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.inhaberId}, '500.00',
                'CLOSED'::shift_status, ${alsEur(erwartet)}, ${alsEur(erwartet)},
                ${buehne.akteure.inhaberId},
                ${buehne.ts(7, 0, tag)}::timestamptz, ${buehne.ts(21, 0, tag)}::timestamptz)`;

      const antwort = await buehne.sende('/api/closings/finalize', { businessDay: tag });
      if (antwort.statusCode !== 200) {
        throw new Error(`finalize ${tag}: ${antwort.statusCode} ${antwort.payload}`);
      }
      const abschluss = antwort.json() as { id: string };
      abschlussJeTag.set(tag, abschluss.id);

      const datev = await buehne.hol(`/api/closings/${abschluss.id}/export/datev`);
      if (datev.statusCode !== 200) {
        throw new Error(`datev ${tag}: ${datev.statusCode} ${datev.payload}`);
      }
      buchungenJeTag.set(tag, leseBuchungen(datev.rawPayload));

      const bericht = await buehne.hol(`/api/closings/${abschluss.id}/export/kassenbericht`);
      if (bericht.statusCode !== 200) {
        throw new Error(`kassenbericht ${tag}: ${bericht.statusCode} ${bericht.payload}`);
      }
      kassenberichtJeTag.set(tag, bericht.payload);
    }
  }, 240_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  // ── 1. Der Beleg selbst ───────────────────────────────────────────────────

  it('kein Cent geht zwischen Positionen und Belegkopf verloren — bei keinem der 60 Belege', async () => {
    // Nicht aus der Mitschrift, sondern ZURUECKGELESEN aus der Datenbank, und
    // zwar mit der APP-Rolle: was die Anwendung sieht, muss aufgehen.
    const zeilen = await buehne.sql<
      {
        receipt_locator: string;
        subtotal_eur: string;
        vat_eur: string;
        total_eur: string;
        pos_subtotal: string;
        pos_vat: string;
        pos_total: string;
        pos_anzahl: string;
      }[]
    >`
      SELECT t.receipt_locator,
             t.subtotal_eur::text, t.vat_eur::text, t.total_eur::text,
             COALESCE(SUM(i.line_subtotal_eur), 0)::text AS pos_subtotal,
             COALESCE(SUM(i.line_vat_eur), 0)::text      AS pos_vat,
             COALESCE(SUM(i.line_total_eur), 0)::text    AS pos_total,
             COUNT(i.id)::text                           AS pos_anzahl
        FROM transactions t
        LEFT JOIN transaction_items i ON i.transaction_id = t.id
       WHERE berlin_business_day(t.finalized_at) = ${TAG_ZUFALL}::date
       GROUP BY t.id, t.receipt_locator, t.subtotal_eur, t.vat_eur, t.total_eur`;

    expect(zeilen).toHaveLength(60);
    let positionen = 0;
    for (const z of zeilen) {
      positionen += Number(z.pos_anzahl);
      expect({
        beleg: z.receipt_locator,
        netto: zuCent(z.pos_subtotal),
        ust: zuCent(z.pos_vat),
        brutto: zuCent(z.pos_total),
      }).toEqual({
        beleg: z.receipt_locator,
        netto: zuCent(z.subtotal_eur),
        ust: zuCent(z.vat_eur),
        brutto: zuCent(z.total_eur),
      });
      // Und die Bilanzgleichung des Kopfes selbst.
      expect(zuCent(z.subtotal_eur) + zuCent(z.vat_eur)).toBe(zuCent(z.total_eur));
    }
    // Der Korpus ist wirklich breit: mehr Positionen als Belege.
    expect(positionen).toBeGreaterThan(60);
  });

  it('die Buchungszeilen der DATEV-Datei treffen jeden einzelnen Beleg auf den Cent', () => {
    for (const tag of [TAG_ZUFALL, TAG_AUSREISSER, TAG_STORNO]) {
      const jeBeleg = new Map<string, bigint>();
      for (const z of buchungen(tag)) {
        jeBeleg.set(z.beleg, (jeBeleg.get(z.beleg) ?? 0n) + z.umsatzCent);
      }
      for (const b of belege(tag)) {
        const abs = b.bruttoCent < 0n ? -b.bruttoCent : b.bruttoCent;
        expect({ tag, beleg: b.locator, summe: jeBeleg.get(b.locator) }).toEqual({
          tag,
          beleg: b.locator,
          summe: abs,
        });
      }
      // Und kein Beleg, den wir nie angelegt haben.
      expect(jeBeleg.size).toBe(belege(tag).length);
    }
  });

  // ── 2. Der Tag ────────────────────────────────────────────────────────────

  it('die Summe der 60 Belege ist die Tagessumme, die der Abschluss ausrechnet', async () => {
    const meine = belege(TAG_ZUFALL);
    const bruttoVerkauf = meine
      .filter((b) => b.richtung === 'VERKAUF' && !b.istStorno)
      .reduce((s, b) => s + b.bruttoCent, 0n);
    const nettoVerkauf = meine
      .filter((b) => b.richtung === 'VERKAUF' && !b.istStorno)
      .reduce((s, b) => s + b.nettoCent, 0n);
    const bruttoAnkauf = meine
      .filter((b) => b.richtung === 'ANKAUF')
      .reduce((s, b) => s + b.bruttoCent, 0n);

    const [zeile] = await buehne.sql<
      {
        gross_verkauf_eur: string;
        net_verkauf_eur: string;
        gross_ankauf_eur: string;
        verkauf_count: number;
        ankauf_count: number;
        cash_drawer_expected_eur: string;
        cash_drawer_variance_eur: string;
      }[]
    >`
      SELECT gross_verkauf_eur::text, net_verkauf_eur::text, gross_ankauf_eur::text,
             verkauf_count, ankauf_count,
             cash_drawer_expected_eur::text, cash_drawer_variance_eur::text
        FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_ZUFALL)!}`;

    expect({
      brutto: zuCent(zeile!.gross_verkauf_eur),
      netto: zuCent(zeile!.net_verkauf_eur),
      ankauf: zuCent(zeile!.gross_ankauf_eur),
      verkaeufe: zeile!.verkauf_count,
      ankaeufe: zeile!.ankauf_count,
    }).toEqual({
      brutto: bruttoVerkauf,
      netto: nettoVerkauf,
      ankauf: bruttoAnkauf,
      // Ankauf ist jeder Beleg mit Nummer % 7 == 6, also 6, 13, 20, 27, 34,
      // 41, 48 und 55 — von Hand ausgezaehlt ACHT Stueck, und damit 52 Verkaeufe.
      verkaeufe: 52,
      ankaeufe: 8,
    });

    // Der krumme Kassenbestand geht unveraendert durch den Cent-Rechenweg
    // des Abschlusses (toCents/fromCents) — auf den Cent, ohne Abweichung.
    expect(zuCent(zeile!.cash_drawer_expected_eur)).toBe(barErwartetJeTag.get(TAG_ZUFALL));
    expect(zuCent(zeile!.cash_drawer_variance_eur)).toBe(0n);
  });

  it('netto plus Umsatzsteuer ergibt brutto — ueber alle 60 Belege des Tages zusammen', async () => {
    const [zeile] = await buehne.sql<
      { gross_verkauf_eur: string; net_verkauf_eur: string; vat_by_treatment: Record<string, string> }[]
    >`
      SELECT gross_verkauf_eur::text, net_verkauf_eur::text, vat_by_treatment
        FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_ZUFALL)!}`;

    const ustSumme = Object.values(zeile!.vat_by_treatment).reduce(
      (s, wert) => s + zuCent(wert),
      0n,
    );
    // Der Tag hat keinen Storno, also muss die Gleichung des Belegkopfes auch
    // fuer den ganzen Tag gelten: Σ netto + Σ USt = Σ brutto.
    expect(zuCent(zeile!.net_verkauf_eur) + ustSumme).toBe(zuCent(zeile!.gross_verkauf_eur));
  });

  it('die Umsatzsteuer je Behandlung, aus den Positionen nachgerechnet, ist die des Abschlusses', async () => {
    const meine = new Map<string, bigint>();
    for (const b of belege(TAG_ZUFALL)) {
      if (b.richtung !== 'VERKAUF') continue; // der Abschluss zaehlt nur Ausgangsumsatzsteuer
      for (const [code, cent] of b.ustJeBehandlung) addiere(meine, code, cent);
    }

    const [zeile] = await buehne.sql<{ vat_by_treatment: Record<string, string> }[]>`
      SELECT vat_by_treatment FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_ZUFALL)!}`;
    const gemessen = new Map(
      Object.entries(zeile!.vat_by_treatment).map(([code, wert]) => [code, zuCent(wert)]),
    );

    const sortiert = (m: Map<string, bigint>): [string, bigint][] =>
      [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(sortiert(gemessen)).toEqual(sortiert(meine));
    // Alle vier Behandlungen kommen im Korpus wirklich vor.
    expect(gemessen.size).toBe(4);
  });

  it('die Zahlarten des Abschlusses treffen die einzelnen Zahlungsbeine auf den Cent', async () => {
    const meine = new Map<string, bigint>();
    for (const b of belege(TAG_ZUFALL)) {
      if (b.richtung !== 'VERKAUF') continue; // payments_by_method zaehlt nur Verkaeufe
      for (const [art, cent] of b.zahlungJeArt) addiere(meine, art, cent);
    }

    const [zeile] = await buehne.sql<{ payments_by_method: Record<string, string> }[]>`
      SELECT payments_by_method FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_ZUFALL)!}`;
    const gemessen = new Map(
      Object.entries(zeile!.payments_by_method).map(([art, wert]) => [art, zuCent(wert)]),
    );

    const sortiert = (m: Map<string, bigint>): [string, bigint][] =>
      [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(sortiert(gemessen)).toEqual(sortiert(meine));

    // Und die Summe aller Zahlarten ist der Bruttoumsatz des Tages: kein Bein
    // faellt beim Gruppieren heraus.
    const summe = [...gemessen.values()].reduce((s, c) => s + c, 0n);
    const brutto = belege(TAG_ZUFALL)
      .filter((b) => b.richtung === 'VERKAUF')
      .reduce((s, b) => s + b.bruttoCent, 0n);
    expect(summe).toBe(brutto);
  });

  // ── 3. Die Aufteilung einer geteilten Zahlung ─────────────────────────────

  it('jede Zahlung erscheint in der Datei auf ihrem eigenen Geldkonto, auf den Cent genau', () => {
    for (const tag of [TAG_ZUFALL, TAG_AUSREISSER]) {
      for (const b of belege(tag)) {
        const jeKonto = new Map<string, bigint>();
        for (const z of buchungen(tag)) {
          if (z.beleg !== b.locator) continue;
          // Beim VERKAUF steht das Geld im Soll (Konto), beim ANKAUF im Haben
          // (Gegenkonto): „Wareneingang 3200 an Kasse". Die Seite wechselt mit
          // der Richtung, das Geldkonto selbst bleibt das der Zahlart.
          const geldkonto = b.richtung === 'ANKAUF' ? z.gegenkonto : z.konto;
          if (b.richtung === 'ANKAUF') expect(z.konto).toBe('3200');
          jeKonto.set(geldkonto, (jeKonto.get(geldkonto) ?? 0n) + z.umsatzCent);
        }
        const erwartet = new Map<string, bigint>();
        for (const [art, cent] of b.zahlungJeArt) {
          const konto = GELDKONTO_JE_ZAHLART[art];
          expect(konto).toBeDefined();
          addiere(erwartet, konto!, cent);
        }
        expect({ beleg: b.locator, konten: [...jeKonto.entries()].sort() }).toEqual({
          beleg: b.locator,
          konten: [...erwartet.entries()].sort(),
        });
      }
    }
  });

  it('eine Zahlung, die kleiner ist als die Zahl der Behandlungen, erzeugt keine Buchung ueber 0,00', () => {
    // Der Beleg (c): drei Behandlungen zu je einem Cent, bar bezahlt mit 0,01.
    // Ein Drittel von einem Cent gibt es nicht — es darf aber auch keine Zeile
    // ueber null entstehen, die DATEV beim Import zurueckweist.
    const beleg = belege(TAG_AUSREISSER)[2]!;
    const zeilen = buchungen(TAG_AUSREISSER).filter((z) => z.beleg === beleg.locator);
    expect(zeilen.length).toBeGreaterThan(0);
    for (const z of zeilen) {
      expect(z.umsatzCent).toBeGreaterThan(0n);
      expect(z.umsatzRoh).not.toBe('0,00');
    }
    // Und die drei Cent sind vollstaendig da.
    expect(zeilen.reduce((s, z) => s + z.umsatzCent, 0n)).toBe(3n);
  });

  it('bei EINER Zahlung geht die Aufteilung auf die Behandlungen exakt auf', () => {
    // Beleg (e): dieselben zwei Positionen zu je 0,50 wie in (d), aber in einem
    // Stueck bezahlt. Von Hand, MIT der Zerlegung nach § 25a:
    //   Position 1, STANDARD_19, Zeilenbetrag 0,50            → 8400  50 Cent
    //   Position 2, § 25a, Zeilenbetrag 0,50, Einkauf 0,30
    //       Einkaufsanteil min(30, 50) = 30                   → 8193  30 Cent
    //       Marge, der Rest, 50 - 30 = 20                     → 8191  20 Cent
    // Die einzige Zahlung deckt den ganzen Beleg, also faellt bei keiner
    // Gruppe ein Rest an: 100 * 50 / 100, 100 * 30 / 100, 100 * 20 / 100 sind
    // alle drei ganzzahlig. Summe 50 + 30 + 20 = 100 Cent. ✓
    const beleg = belege(TAG_AUSREISSER)[4]!;
    const jeErloeskonto = new Map<string, bigint>();
    for (const z of buchungen(TAG_AUSREISSER)) {
      if (z.beleg !== beleg.locator) continue;
      jeErloeskonto.set(z.gegenkonto, (jeErloeskonto.get(z.gegenkonto) ?? 0n) + z.umsatzCent);
    }
    expect([...jeErloeskonto.entries()].sort()).toEqual([
      [ERLOESKONTO_JE_BEHANDLUNG.MARGIN_25A_MARGE!, 20n],
      [ERLOESKONTO_JE_BEHANDLUNG.MARGIN_25A_EINKAUF!, 30n],
      [ERLOESKONTO_JE_BEHANDLUNG.STANDARD_19!, 50n],
    ]);
  });

  it('die geteilt bezahlte Ein-Euro-Rechnung geht je Zahlart und in der Summe auf', () => {
    // Die Gegenprobe zum Fund darunter: was an Beleg (d) STIMMT, damit ein
    // roter Lauf dort nicht auf einen kaputten Aufbau zurueckgehen kann.
    const beleg = belege(TAG_AUSREISSER)[3]!;
    const zeilen = buchungen(TAG_AUSREISSER).filter((z) => z.beleg === beleg.locator);
    const bar = zeilen.filter((z) => z.konto === '1000').reduce((s, z) => s + z.umsatzCent, 0n);
    const karte = zeilen.filter((z) => z.konto === '1361').reduce((s, z) => s + z.umsatzCent, 0n);
    expect({ bar, karte, summe: bar + karte }).toEqual({ bar: 51n, karte: 49n, summe: 100n });
  });

  /**
   * ── FUND 1, BEHOBEN am 26.07.2026 ────────────────────────────────────────
   * `src/lib/datev-kontierung.ts` verteilte JEDE Zahlung fuer sich auf die
   * Behandlungen und gab den Rest der Division jedes Mal derselben (nach
   * Sortierung kleinsten) Behandlung. Bei zwei Zahlungen wurde der Rest damit
   * zweimal in dieselbe Richtung vergeben, und die Summe je Behandlung
   * verschob sich gegen den Beleg.
   *
   * Von Hand fuer Beleg (d) — 1,00 EUR, Behandlungen 0,50 / 0,50,
   * bezahlt 0,51 bar + 0,49 Karte, VOR der Behebung:
   *     bar:   51 * 50 / 100 = 25,5 → abgeschnitten 25, Rest 51 - 25 = 26
   *     Karte: 49 * 50 / 100 = 24,5 → abgeschnitten 24, Rest 49 - 24 = 25
   *     Erloeskonto 8400 (19 %):  25 + 24 = 49 Cent
   *     Erloeskonto 8200 (§ 25a): 26 + 25 = 51 Cent
   *
   * SOLL sind 50 und 50 — das steht so im Kopf von `datev-kontierung.ts`:
   * „die Summe je Behandlung bleibt auf den Cent genau die des Belegs".
   *
   * Behoben durch das Verfahren der groessten Reste ueber die GANZE
   * Kreuztabelle statt je Zahlung getrennt.
   *
   * ── NACHGERECHNET AM 04.08.2026, mit der Zerlegung nach § 25a ────────────
   * Seit dem 27.07.2026 hat der Beleg nicht mehr zwei, sondern DREI Spalten:
   * die zweite Position zerfaellt in Einkaufsanteil und Marge. Die Handrechnung
   * dazu, Zeilen sind die Zahlungen, Spalten die Buchungsgruppen:
   *
   *     Spaltenziele  8400: 50   8193: 30   8191: 20   (Summe 100)
   *     bar 51  →  25,5      15,3       10,2   Boeden 25 15 10 = 50, fehlt 1
   *     Karte 49 → 24,5      14,7        9,8   Boeden 24 14  9 = 47, fehlt 2
   *     Spaltenboeden  49         29         19   je Spalte fehlt 1
   *
   * Drei Cent sind zu vergeben, und die Zeilen- wie die Spaltenluecken
   * verlangen zusammen ebenfalls drei — die Tabelle geht also in BEIDEN
   * Richtungen auf. Geprueft wird hier die Spaltenrichtung: was auch immer die
   * groessten Reste je Zelle entscheiden, die Summe je Buchungsgruppe muss
   * exakt die des Belegs bleiben. Die Zeilenrichtung, also die Summe je
   * Zahlart, prueft der Test darueber.
   *
   * Bis zur Behebung stand hier `it.fails` mit derselben, von Hand
   * nachgerechneten Zahl im Rumpf. Jetzt ist es ein normaler Test.
   */
  it('bei geteilter Zahlung trifft die Aufteilung die Behandlungssumme des Belegs auf den Cent', () => {
    const beleg = belege(TAG_AUSREISSER)[3]!;
    const jeErloeskonto = new Map<string, bigint>();
    for (const z of buchungen(TAG_AUSREISSER)) {
      if (z.beleg !== beleg.locator) continue;
      jeErloeskonto.set(z.gegenkonto, (jeErloeskonto.get(z.gegenkonto) ?? 0n) + z.umsatzCent);
    }
    expect([...jeErloeskonto.entries()].sort()).toEqual([
      [ERLOESKONTO_JE_BEHANDLUNG.MARGIN_25A_MARGE!, 20n],
      [ERLOESKONTO_JE_BEHANDLUNG.MARGIN_25A_EINKAUF!, 30n],
      [ERLOESKONTO_JE_BEHANDLUNG.STANDARD_19!, 50n],
    ]);
  });

  // ── 4. Ausreisser ────────────────────────────────────────────────────────

  it('ein Beleg ueber 0,01 EUR steht mit genau einem Cent in der Datei', () => {
    const beleg = belege(TAG_AUSREISSER)[0]!;
    const zeilen = buchungen(TAG_AUSREISSER).filter((z) => z.beleg === beleg.locator);
    // Von Hand: Zeilenbetrag 1 Cent, Einkauf 1 Cent. Der Einkaufsanteil ist
    // min(1, 1) = 1, die Marge damit 0 — und ein Anteil ueber null Cent traegt
    // keine Aussage und bekommt deshalb keine Buchungszeile. Genau EINE Zeile,
    // und sie steht auf dem Einkaufsanteil, nicht auf dem alten Sammelkonto.
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.umsatzRoh).toBe('0,01');
    expect(zeilen[0]!.konto).toBe(GELDKONTO_JE_ZAHLART.CASH!);
    expect(zeilen[0]!.gegenkonto).toBe(ERLOESKONTO_JE_BEHANDLUNG.MARGIN_25A_EINKAUF!);
  });

  it('ein Beleg ueber 987.654,32 EUR bricht weder das Format noch den Pruefer der Anwendung', () => {
    // Dass die Datei ueberhaupt ausgeliefert wurde, ist bereits der halbe
    // Beweis: die Route prueft ihre eigene Datei und liefert bei einem Befund
    // 500 statt 200 (closing-export.ts, `pruefeBuchungsstapel`).
    const beleg = belege(TAG_AUSREISSER)[1]!;
    const zeilen = buchungen(TAG_AUSREISSER).filter((z) => z.beleg === beleg.locator);
    expect(zeilen).toHaveLength(2); // zwei Zahlungen, zwei Geldkonten
    const jeKonto = new Map(zeilen.map((z) => [z.konto, z.umsatzRoh]));
    expect(jeKonto.get('1200')).toBe('500000,00'); // Bank
    expect(jeKonto.get('1361')).toBe('487654,32'); // Geldtransit Kartenterminal
    expect(zeilen.reduce((s, z) => s + z.umsatzCent, 0n)).toBe(98765432n);
    // Alle Betraege dieses Tages halten DATEVs Form fuer Feld 1 ein.
    for (const z of buchungen(TAG_AUSREISSER)) {
      expect(z.umsatzRoh).toMatch(/^\d{1,10},\d{2}$/);
    }
  });

  // ── 5. Vorzeichen und Richtung ───────────────────────────────────────────

  it('DATEVs Betragsfeld traegt in keiner Zeile ein Minuszeichen', () => {
    let gezaehlt = 0;
    for (const tag of [TAG_ZUFALL, TAG_AUSREISSER, TAG_STORNO]) {
      for (const z of buchungen(tag)) {
        expect(z.umsatzRoh).toMatch(/^\d{1,10},\d{2}$/);
        expect(z.umsatzCent).toBeGreaterThan(0n);
        expect(['S', 'H']).toContain(z.sollHaben);
        gezaehlt += 1;
      }
    }
    // Der Nachweis ist ueber echte Zeilen gefahren, nicht ueber eine leere Menge.
    expect(gezaehlt).toBeGreaterThan(60);
  });

  it('ein Storno kehrt die Buchung um, statt einen negativen Betrag zu schreiben', () => {
    const [original, storno] = belege(TAG_STORNO) as [Beleg, Beleg];
    const zeilenO = buchungen(TAG_STORNO).filter((z) => z.beleg === original.locator);
    const zeilenS = buchungen(TAG_STORNO).filter((z) => z.beleg === storno.locator);
    expect(zeilenO).toHaveLength(1);
    expect(zeilenS).toHaveLength(1);
    // Gleicher Betrag, gleiche Konten, gleicher Steuerschluessel, GLEICHE
    // Seite — das Minus traegt Feld 118 (Generalumkehr). DATEV Dok.-Nr.
    // 1070379: die Generalumkehr bucht „mit Minuszeichen auf der GLEICHEN
    // Soll-/Haben-Seite"; nur so wachsen die Jahresverkehrszahlen nicht.
    expect({
      betrag: zeilenS[0]!.umsatzRoh,
      konto: zeilenS[0]!.konto,
      gegenkonto: zeilenS[0]!.gegenkonto,
      bu: zeilenS[0]!.buSchluessel,
      seite: zeilenS[0]!.sollHaben,
      marke: zeilenS[0]!.generalumkehr,
    }).toEqual({
      betrag: zeilenO[0]!.umsatzRoh,
      konto: zeilenO[0]!.konto,
      gegenkonto: zeilenO[0]!.gegenkonto,
      bu: zeilenO[0]!.buSchluessel,
      seite: zeilenO[0]!.sollHaben,
      marke: '1',
    });
    expect(zeilenO[0]!.umsatzRoh).toBe('119,00');
    expect(zeilenO[0]!.sollHaben).toBe('S');
    expect(zeilenO[0]!.generalumkehr).not.toBe('1');
    expect(zeilenS[0]!.buchungstext.startsWith('STORNO ')).toBe(true);
  });

  it('der Storno steht mit seinem vollen Betrag in der eigenen Spalte des Abschlusses', async () => {
    const [zeile] = await buehne.sql<
      { storno_count: number; storno_verkauf_eur: string; gross_verkauf_eur: string }[]
    >`
      SELECT storno_count, storno_verkauf_eur::text, gross_verkauf_eur::text
        FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_STORNO)!}`;
    // Wanderung 0112: der Storno gehoert NICHT in den Brutto, sondern als
    // positive Groesse in seine eigene Spalte.
    expect({
      anzahl: zeile!.storno_count,
      storno: zuCent(zeile!.storno_verkauf_eur),
      brutto: zuCent(zeile!.gross_verkauf_eur),
    }).toEqual({ anzahl: 1, storno: 11900n, brutto: 11900n });
  });

  /**
   * ── FUND 2, am 26.07.2026 NEU VERMESSEN ──────────────────────────────────
   * Beobachtung war richtig, die Seite der Gleichung war falsch.
   *
   * Der Umsatzblock des Kassenberichts zeigt „Verkauf brutto vor Storno" und
   * „Verkauf netto" nebeneinander, und die Umsatzsteuer daneben ist NACH
   * Storno — drei Zahlen, die sich nicht zusammenrechnen lassen. Der erste
   * Versuch ergaenzte deshalb die Umsatzsteuerabfrage in `closings-finalize.ts`
   * um `AND t.storno_of_transaction_id IS NULL`, also um denselben Filter, den
   * Brutto und Netto seit Wanderung 0112 tragen. GEMESSEN am Stornotag hier,
   * mit dem Filter — ein Tag mit einem Beleg 119,00 und seinem Vollstorno, an
   * dem am Ende NICHTS verkauft ist:
   *
   *     Umsatz;Verkauf brutto nach Storno und Rücknahme;0,00 EUR
   *     Umsatz;Verkauf netto;100,00 EUR
   *     Umsatzsteuer;Summe;19,00 EUR
   *     Zahlungsart;Summe;0,00 EUR
   *
   * 19,00 EUR Umsatzsteuer auf einem Tag ohne Umsatz und ohne Zahlung. Der
   * Filter ist damit NICHT die Behebung, sondern ein zweiter Defekt.
   *
   * ── DIE HANDRECHNUNG fuer Tag 3 (2026-09-16) ─────────────────────────────
   * Der Tag traegt genau zwei Belege:
   *
   *   Beleg   STANDARD_19, eine Position: netto 100,00, USt 19,00, brutto 119,00
   *           Probe des Satzes: round(10000 Cent * 19 / 100) = round(1900,0)
   *                             = 1900 Cent = 19,00 EUR ✓
   *   Storno  dieselbe Position mit umgekehrtem Vorzeichen, mit
   *           `storno_of_transaction_id`: netto -10000, USt -1900, brutto -11900
   *
   *   gross_verkauf_eur, Stornozeile ausgeschlossen (0112) = 11900 Cent
   *   storno_verkauf_eur, positiv gefuehrt (0112)          = 11900 Cent
   *   Brutto nach Storno = 11900 − 11900                   =     0 Cent
   *   net_verkauf_eur, Stornozeile ausgeschlossen (0112)   = 10000 Cent
   *   SOLL Umsatzsteuer                = 1900 + (-1900)    =     0 Cent
   *
   * SOLL ist die NULL, und zwar aus drei unabhaengigen Richtungen:
   *   • § 17 UStG — die Stornierung mindert die Bemessungsgrundlage; geschuldet
   *     wird an diesem Tag nichts.
   *   • DATEV fuehrt denselben Tag auf Erloeskonto 8400 mit Saldo 0
   *     (11900 im Haben aus dem Original, 11900 im Soll aus der Generalumkehr).
   *     Der Test unten misst diesen Saldo mit.
   *   • Der Kopf des DSFinV-K-Buendels steht auf 0 brutto und 0 netto, also
   *     ebenfalls auf 0 Umsatzsteuer.
   * Am Kreuzprobetag ist es dieselbe Rechnung in gross: 9564 Cent nach Storno
   * gegen 10096 vor Storno, Unterschied 532 Cent — genau die Steuer des einen
   * stornierten Belegs (33,33 brutto = 28,01 netto + 5,32 USt).
   *
   * Und der Leser koennte eine Zahl vor Storno nicht einmal selbst korrigieren:
   * `daily_closings` hat fuer die Stornosteuer KEINE Spalte, 0112 gab dem
   * Storno nur `storno_verkauf_eur` und `storno_ankauf_eur`, beides brutto.
   *
   * ── WAS DAMIT OFFEN BLEIBT, ausdruecklich und unbehoben ──────────────────
   * „Verkauf netto" ist die EINZIGE Zeile des Umsatzblocks ohne die Angabe
   * vor/nach Storno, waehrend Brutto beide Zahlen zeigt. Richtig waere
   * „Verkauf netto vor Storno" PLUS „Verkauf netto nach Storno"; dann geht am
   * Kreuzprobetag 366260 + 9564 = 375824 auf, auf derselben Grundlage wie
   * DATEV, wie `bon_kopf.csv` und wie der Kopf des Buendels. Das ist eine
   * Aenderung in `lib/kassenbericht-export.ts` und gehoert in einen eigenen
   * Auftrag — hier steht sie als gemessener Befund, nicht als Sollzustand.
   */
  it('die Umsatzsteuer des Abschlusses steht NACH Storno, wie DATEV und DSFinV-K', async () => {
    const [zeile] = await buehne.sql<
      {
        gross_verkauf_eur: string;
        storno_verkauf_eur: string;
        net_verkauf_eur: string;
        vat_by_treatment: Record<string, string>;
      }[]
    >`
        SELECT gross_verkauf_eur::text, storno_verkauf_eur::text, net_verkauf_eur::text,
               vat_by_treatment
          FROM daily_closings WHERE id = ${abschlussJeTag.get(TAG_STORNO)!}`;
    const ust = Object.values(zeile!.vat_by_treatment).reduce((s, w) => s + zuCent(w), 0n);

    // 1900 + (-1900) = 0 Cent. Brutto und Netto bleiben die Zahlen VOR Storno,
    // und der stornierte Betrag steht positiv in seiner eigenen Spalte.
    expect({
      netto: zuCent(zeile!.net_verkauf_eur),
      ust,
      brutto: zuCent(zeile!.gross_verkauf_eur),
      storno: zuCent(zeile!.storno_verkauf_eur),
    }).toEqual({ netto: 10000n, ust: 0n, brutto: 11900n, storno: 11900n });

    // Die Steuer steht unter ihrer Behandlung, nicht in einem Sammeltopf —
    // auch wenn sie auf null saldiert.
    expect(zeile!.vat_by_treatment).toEqual({ STANDARD_19: '0.00' });

    // Und die Probe gegen DATEV: der Saldo des Erloeskontos 8400 ueber den
    // ganzen Tag ist 0 Cent, also schuldet der Tag 0 Cent Umsatzsteuer.
    // 11900 im Haben (Original) gegen 11900 im Soll (Generalumkehr).
    let erloesSaldo = 0n;
    for (const z of buchungen(TAG_STORNO)) {
      if (z.konto !== '8400' && z.gegenkonto !== '8400') continue;
      const imHaben = z.gegenkonto === '8400' ? z.sollHaben === 'S' : z.sollHaben === 'H';
      // Die Generalumkehr-Marke dreht die Wirkung auf ihrer Seite um.
      const cent = z.generalumkehr === '1' ? -z.umsatzCent : z.umsatzCent;
      erloesSaldo += imHaben ? cent : -cent;
    }
    expect({ datevErloes: erloesSaldo, abschlussUst: ust }).toEqual({
      datevErloes: 0n,
      abschlussUst: 0n,
    });
  });

  /**
   * Der GEMESSENE Wortlaut des Blattes am Stornotag. Seit dem 26.07.2026 geht
   * der Umsatzblock auch WIRKLICH auf: das Netto trägt jetzt beide Angaben,
   * genau wie das Brutto darüber, und die letzte unstimmige Zeile ist weg.
   *
   * Am Stornotag ist nach dem Storno nichts übrig, also muss ALLES auf null
   * zeigen — bis auf die Zeile vor Storno, die den Vorgang bezeugt:
   *     Verkauf netto vor Storno    100,00
   *     Verkauf netto nach Storno     0,00
   *     Umsatzsteuer Summe            0,00   (§ 17 UStG: Storno mindert)
   *     Verkauf brutto nach Storno    0,00
   * Und die Probe des Prüfers geht auf: 0,00 + 0,00 = 0,00.
   */
  it('das Blatt des Stornotages weist 0,00 EUR Umsatzsteuer aus, nicht 19,00', () => {
    const bericht = kassenberichtJeTag.get(TAG_STORNO)!;
    expect(bericht).toContain('Umsatzsteuer;Summe;0,00 EUR');
    expect(bericht).toContain('Umsatz;Verkauf brutto nach Storno und Rücknahme;0,00 EUR');
    expect(bericht).toContain('Zahlungsart;Summe;0,00 EUR');
    // Der Storno bleibt bezeugt, aber er steht nicht mehr unbeschriftet da.
    expect(bericht).toContain('Umsatz;Verkauf netto vor Storno;100,00 EUR');
    expect(bericht).toContain('Umsatz;Verkauf netto nach Storno;0,00 EUR');
    // Und die Zeile, an der der Befund hing, rechnet sich jetzt zusammen.
    expect(bericht).not.toContain('Umsatz;Verkauf netto;');
  });

  it('der Kassenbericht des Stornotages zeigt genau die Zahlen, die im Abschluss stehen', () => {
    const bericht = kassenberichtJeTag.get(TAG_STORNO)!;
    // Das Blatt gibt den gespeicherten Abschluss wieder, es rechnet nicht neu.
    expect(bericht).toContain('119,00 EUR');
    expect(bericht).toContain('Verkauf brutto nach Storno und Rücknahme');
    // Und es nennt die Behandlung auf Deutsch, nicht als rohen Bezeichner.
    expect(bericht).toContain('Regelsteuersatz 19 %');
    expect(bericht).not.toContain('STANDARD_19');
  });

});

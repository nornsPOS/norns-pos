/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DIE ZEICHNUNGEN DER ERSTINBETRIEBNAHME
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS BEFUND VOM 13.08.2026 ──────────────────────────────────────────
 *
 * Wörtlich: die Erstinbetriebnahme sei „sehr schwach, die Oberfläche blass,
 * keine Tiefe, keine visuelle Identität von Norns, keine Zeichnungen".
 *
 * Nachgemessen war das genau richtig. Die ganze Fläche trug EINE einzige
 * eigene Zeichnung, einen Fortschrittsring aus zwei Kreisen, und sonst nur
 * Formularfelder auf einer flachen Pergamentfläche. Kein Bild, kein Zeichen,
 * keine Tiefe.
 *
 * ── WORAUS DIE TIEFE HIER KOMMT ───────────────────────────────────────────
 *
 * NICHT aus zwei Papiertönen übereinander. Der Unterschied zwischen
 * `--w14-parchment-2` und `--w14-parchment-3` ist gemessen 1,17 zu 1 und
 * damit schwächer als die zarteste tragende Linie des Hauses: auf einem
 * Ladenbildschirm bei Tageslicht verschwindet er ganz.
 *
 * Die Tiefe kommt aus dem GEGENSATZ: helles Papier auf dunkler Tafel, mit
 * einem Schattenwurf dazwischen. Das ist echter Raum und überlebt jedes
 * Licht.
 *
 * ── ⚠️ DREI REGELN, DIE HIER OHNE AUSNAHME GELTEN ────────────────────────
 *
 * 1. KEINE ROHE FARBE. Jeder Strich, jede Fläche nennt eine Hausmarke. Ein
 *    `#c8a34a` hier wäre eine zweite Wahrheit neben `--w14-gilt`, und beim
 *    nächsten Themenwechsel bliebe genau diese Datei zurück. Der Wächter
 *    `zeichnungen-tragen-nur-hausmarken` misst das.
 *
 * 2. KEIN ERFUNDENER INHALT. Der Belegstreifen zeigt die Reihenfolge, die
 *    der Drucker WIRKLICH druckt, und niemals einen Betrag oder einen
 *    Musterartikel. Ein gezeichneter Beleg mit „Goldring 480,00" wäre ein
 *    Versprechen über Zahlen, die es nicht gibt.
 *
 * 3. KEINE NEUE ABHÄNGIGKEIT. Alles ist handgeschriebenes SVG. Ein Bild aus
 *    dem Netz kann eine Kasse nicht laden, die im Laden ohne Netz steht.
 */

import type { CSSProperties } from 'react';

/* ─────────────────────────── Die Leerstelle ─────────────────────────────
 *
 * Das tragende Bildzeichen der ganzen Fläche.
 *
 * Eine Angabe, die noch fehlt, ist keine Lücke im Nichts, sondern ein PLATZ,
 * der schon da ist und auf seinen Inhalt wartet. Sie hält ihre Höhe von
 * Anfang an: beim Ausfüllen springt deshalb kein Layout, und der Händler
 * sieht seinen Beleg wachsen statt zucken.
 */
export interface LeerstelleProps {
  /** Wie breit die spätere Zeile wird, in Bruchteilen der Belegbreite. */
  anteil?: number;
  /** Der Name der Angabe, klein darüber. Leer lassen für eine blosse Linie. */
  name?: string | undefined;
  /** Steht die Angabe schon? Dann wird sie gezeigt statt der Leerstelle. */
  wert?: string | undefined;
  /** Fett und doppelt hoch, wie der Ladenname auf dem echten Papier. */
  gross?: boolean;
}

export function Leerstelle({ anteil = 1, name, wert, gross = false }: LeerstelleProps) {
  const breite = `${Math.round(Math.min(1, Math.max(0.1, anteil)) * 100)}%`;
  if (wert !== undefined && wert.trim() !== '') {
    return (
      <div style={{ ...ZEILE, width: breite }}>
        <span style={gross ? BELEG_GROSS : BELEG_TEXT}>{wert}</span>
      </div>
    );
  }
  return (
    <div style={{ ...ZEILE, width: breite }}>
      {name !== undefined && name !== '' ? <span style={LEER_NAME}>{name}</span> : null}
      <span style={{ ...LEER_LINIE, height: gross ? 3 : 2 }} />
    </div>
  );
}

/* ────────────────────────── Der Belegstreifen ───────────────────────────
 *
 * Das Papier, das neben jeder Frage liegt. Die Reihenfolge ist NICHT
 * ausgedacht: sie folgt dem, was der Thermodrucker wirklich setzt.
 *
 * Der Riss oben und unten ist der Grund, warum es als Papier gelesen wird
 * und nicht als Karte. Neun Zähne, weil weniger nach Zickzack aussieht und
 * mehr nach Säge.
 */
export interface BelegstreifenProps {
  ladenname?: string | undefined;
  strasse?: string | undefined;
  ortszeile?: string | undefined;
  telefon?: string | undefined;
  steuernummer?: string | undefined;
  ustId?: string | undefined;
  /** Das Logo des Hauses als Bildadresse, wenn der Händler eines hochlud. */
  logo?: string | null | undefined;
  style?: CSSProperties | undefined;
}

/** Die Risskante. Ein Pfad, zweimal benutzt, oben und unten gespiegelt. */
function Risskante({ unten = false }: { unten?: boolean }) {
  const zaehne = 9;
  const breite = 100;
  const schritt = breite / zaehne;
  const punkte: string[] = [`0,${unten ? 0 : 6}`];
  for (let i = 0; i < zaehne; i++) {
    punkte.push(`${(i + 0.5) * schritt},${unten ? 6 : 0}`);
    punkte.push(`${(i + 1) * schritt},${unten ? 0 : 6}`);
  }
  return (
    <svg
      viewBox={`0 0 ${breite} 6`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: 6 }}
      aria-hidden="true"
    >
      <polyline points={punkte.join(' ')} fill="none" stroke="var(--w14-tabellenlinie)" strokeWidth={1} />
    </svg>
  );
}

export function Belegstreifen({
  ladenname,
  strasse,
  ortszeile,
  telefon,
  steuernummer,
  ustId,
  logo,
  style,
}: BelegstreifenProps) {
  return (
    <div style={{ ...BELEG_PAPIER, ...style }} className="w14-paper-noise">
      <Risskante />
      <div style={BELEG_INNEN}>
        {/*
         * Die Systemzeile steht auf jedem echten Beleg ganz oben, auch wenn
         * der Händler ein eigenes Logo hat. Sie hier wegzulassen hiesse, ein
         * Papier zu zeigen, das so nie aus dem Drucker kommt.
         */}
        <span style={SYSTEMZEILE}>norns.de</span>

        {logo !== undefined && logo !== null && logo !== '' ? (
          <img src={logo} alt="" style={LOGO_BILD} />
        ) : (
          <Leerstelle name="Ihr Zeichen" anteil={0.42} />
        )}

        <Leerstelle name="Name des Betriebs" wert={ladenname} gross />
        <Leerstelle name="Strasse" wert={strasse} anteil={0.8} />
        <Leerstelle name="Postleitzahl und Ort" wert={ortszeile} anteil={0.72} />
        <Leerstelle name="Telefon" wert={telefon} anteil={0.55} />

        <span style={BELEG_TRENNER} />

        {/*
         * Das Positionsband bleibt IMMER leer und trägt nie einen Betrag.
         * Ein gezeichneter Artikel mit Preis wäre eine erfundene Zahl auf
         * einem Papier, das wie ein echter Beleg aussieht.
         */}
        <div style={POSITIONSBAND}>
          <span style={{ ...LEER_LINIE, width: '58%', height: 2 }} />
          <span style={{ ...LEER_LINIE, width: '22%', height: 2 }} />
        </div>
        <div style={POSITIONSBAND}>
          <span style={{ ...LEER_LINIE, width: '46%', height: 2 }} />
          <span style={{ ...LEER_LINIE, width: '22%', height: 2 }} />
        </div>

        <span style={BELEG_TRENNER} />

        <Leerstelle name="Steuernummer" wert={steuernummer} anteil={0.62} />
        <Leerstelle name="Umsatzsteuer-Identifikationsnummer" wert={ustId} anteil={0.68} />

        {/*
         * Der Platz des Prüfcodes. Ein gezeichnetes Quadrat mit Muster wäre
         * ein QR, den niemand scannen kann; die Fläche sagt deshalb, was
         * dort später steht, und zeigt keinen.
         */}
        <div style={QR_PLATZ}>
          <span style={QR_WORT}>Platz für den Prüfcode</span>
        </div>
      </div>
      <Risskante unten />
    </div>
  );
}

/* ──────────────────────────────── Der Faden ─────────────────────────────
 *
 * Die Etappenleiste. Derselbe Faden, den das Norns-Zeichen durch das N
 * zieht, nur gross gemacht.
 *
 * Der gesponnene Teil ist weinrot und dicker als der offene. Das ist der
 * ganze Trick: Fortschritt wird nicht als Prozentzahl gelesen, sondern als
 * Strecke, die schon gegangen ist.
 */
export interface FadenProps {
  /** Die Namen der Etappen. Vier bis fünf, mehr wird zur Leiste. */
  etappen: readonly string[];
  /** Die laufende Etappe, von 0 an. */
  bei: number;
  style?: CSSProperties | undefined;
}

export function Faden({ etappen, bei, style }: FadenProps) {
  const n = Math.max(1, etappen.length);
  const breite = 640;
  const hoehe = 34;
  const rand = 18;
  const spanne = breite - 2 * rand;
  const x = (i: number) => rand + (n === 1 ? spanne / 2 : (i * spanne) / (n - 1));
  const y = 12;
  // Wie weit der Faden gesponnen ist. Nie über das Ende hinaus.
  const bisX = x(Math.min(Math.max(0, bei), n - 1));

  return (
    <svg
      viewBox={`0 0 ${breite} ${hoehe}`}
      style={{ display: 'block', width: '100%', height: 'auto', ...style }}
      role="img"
      aria-label={`Etappe ${Math.min(bei + 1, n)} von ${n}: ${etappen[Math.min(bei, n - 1)] ?? ''}`}
    >
      {/* Der offene Teil: dünn und blass. */}
      <line
        x1={rand}
        y1={y}
        x2={breite - rand}
        y2={y}
        stroke="var(--w14-tabellenlinie)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Der gesponnene Teil: weinrot und dicker. */}
      <line
        x1={rand}
        y1={y}
        x2={bisX}
        y2={y}
        stroke="var(--w14-weinrot)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {etappen.map((name, i) => {
        const erreicht = i <= bei;
        return (
          <g key={name}>
            {/* Der Knoten ist die Raute der Rautenlinie, in klein. */}
            <rect
              x={x(i) - 4}
              y={y - 4}
              width={8}
              height={8}
              transform={`rotate(45 ${x(i)} ${y})`}
              fill={erreicht ? 'var(--w14-weinrot)' : 'var(--w14-parchment)'}
              stroke={erreicht ? 'var(--w14-weinrot)' : 'var(--w14-tabellenlinie)'}
              strokeWidth={1}
            />
          </g>
        );
      })}
      {/*
       * ── 19.08.2026: NUR die laufende Etappe traegt ihren Namen ──────────
       *
       * Der Kopfsatz dieser Zeichnung sagt es selbst: „Vier bis fuenf, mehr
       * wird zur Leiste." Die Einrichtung fuettert NEUN. Am laufenden Schirm
       * gemessen: die Stationen stehen 67 Einheiten auseinander, „Die
       * technische Sicherheitseinrichtung" ist 149 breit — drei Namen lagen
       * uebereinander, und das erste, was ein neuer Haendler von seiner
       * Kasse sah, war Buchstabenbrei. Genau das Gefuehl „sieht unfertig
       * aus", das der Faden verhindern sollte.
       *
       * Die Rauten erzaehlen weiter die Strecke; den Namen bekommt allein
       * der Ort, an dem man STEHT. Wer alle Namen sucht, hat sie in der
       * Schrittliste direkt darueber. Am Rand wird die Beschriftung
       * eingezogen, damit sie nie aus der Zeichnung faellt.
       */}
      {(() => {
        const i = Math.min(Math.max(0, bei), n - 1);
        const xi = x(i);
        const anker = xi < 90 ? 'start' : xi > breite - 90 ? 'end' : 'middle';
        const tx = xi < 90 ? rand : xi > breite - 90 ? breite - rand : xi;
        return (
          <text
            x={tx}
            y={hoehe - 2}
            textAnchor={anker}
            fill="var(--w14-ink)"
            /*
             * Die Hausmarke, nicht eine rohe 9. Innerhalb des viewBox wird
             * sie mitskaliert, und genau das ist richtig: die Beschriftung
             * waechst mit der Zeichnung statt daneben stehen zu bleiben.
             */
            style={{ fontSize: 'var(--w14-schrift-marke)', letterSpacing: '0.06em' }}
          >
            {etappen[i]}
          </text>
        );
      })()}
    </svg>
  );
}

/* ────────────────────────────── Die Buchseite ───────────────────────────
 *
 * Das Bild des Erststarts. Während die Datenbank wirklich hochfährt, wird
 * ein Geschäftsbuch aufgeschlagen: Bundsteg mit Heftstichen, rechts die
 * Linierung, und die Zeilen füllen sich in dem Takt, in dem die Arbeit
 * WIRKLICH voranschreitet.
 *
 * ⚠️ Die Zahl der gefüllten Zeilen kommt von aussen. Diese Zeichnung
 * erfindet keinen Fortschritt und läuft nicht von selbst weiter: ein
 * Balken, der sich bewegt, während nichts geschieht, ist eine Lüge mit
 * Bewegung.
 */
export interface BuchseiteProps {
  /** Wie viele Zeilen schon geschrieben sind. */
  geschrieben: number;
  /** Wie viele es insgesamt werden. */
  gesamt: number;
  style?: CSSProperties | undefined;
}

export function Buchseite({ geschrieben, gesamt, style }: BuchseiteProps) {
  const zeilen = Math.max(1, gesamt);
  const voll = Math.min(Math.max(0, geschrieben), zeilen);
  const breite = 320;
  const hoehe = 200;
  const oben = 26;
  const abstand = (hoehe - oben - 20) / zeilen;

  return (
    <svg
      viewBox={`0 0 ${breite} ${hoehe}`}
      style={{ display: 'block', width: '100%', height: 'auto', ...style }}
      role="img"
      aria-label={`${voll} von ${zeilen} Schritten des Erststarts erledigt`}
    >
      <rect
        x={1}
        y={1}
        width={breite - 2}
        height={hoehe - 2}
        rx={3}
        fill="var(--w14-parchment-2)"
        stroke="var(--w14-tabellenlinie)"
        strokeWidth={1}
      />
      {/* Der Bundsteg mit sieben Heftstichen in Gold. */}
      <line
        x1={breite / 2}
        y1={8}
        x2={breite / 2}
        y2={hoehe - 8}
        stroke="var(--w14-tabellenlinie)"
        strokeWidth={1}
      />
      {Array.from({ length: 7 }, (_, i) => (
        <line
          key={i}
          x1={breite / 2 - 3}
          y1={20 + i * ((hoehe - 40) / 6)}
          x2={breite / 2 + 3}
          y2={20 + i * ((hoehe - 40) / 6)}
          stroke="var(--w14-gilt)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      {/* Die Zeilen. Gefüllte in Tinte, offene als blasse Linierung. */}
      {Array.from({ length: zeilen }, (_, i) => {
        const y = oben + i * abstand;
        const fertig = i < voll;
        const laenge = breite / 2 - 30 - (i % 3) * 12;
        return (
          <line
            key={i}
            x1={breite / 2 + 14}
            y1={y}
            x2={breite / 2 + 14 + laenge}
            y2={y}
            stroke={fertig ? 'var(--w14-ink-aged)' : 'var(--w14-tabellenlinie)'}
            strokeWidth={fertig ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/* ─────────────────────────────── Die Gestalt ────────────────────────────
 *
 * Alle Masse aus Hausmarken. Die einzigen rohen Zahlen sind Bildmasse
 * innerhalb der SVG, und die sind Geometrie, keine Gestaltung.
 */

const BELEG_PAPIER: CSSProperties = {
  background: 'var(--w14-parchment-2)',
  color: 'var(--w14-ink)',
  boxShadow: 'var(--w14-shadow-lift)',
  width: '100%',
  maxWidth: '19rem',
};

const BELEG_INNEN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
  padding: 'var(--w14-abstand-16)',
};

const ZEILE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--w14-abstand-2)',
};

const LEER_NAME: CSSProperties = {
  fontSize: 'var(--w14-schrift-marke)',
  letterSpacing: '0.08em',
  color: 'var(--w14-ink-faded)',
  textAlign: 'center',
};

const LEER_LINIE: CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'var(--w14-tabellenlinie)',
  borderRadius: 1,
};

const BELEG_TEXT: CSSProperties = {
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-zeile)',
  color: 'var(--w14-ink)',
  textAlign: 'center',
  wordBreak: 'break-word',
};

const BELEG_GROSS: CSSProperties = {
  ...BELEG_TEXT,
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-schrift-titel)',
  lineHeight: 1.15,
};

const SYSTEMZEILE: CSSProperties = {
  fontSize: 'var(--w14-schrift-marke)',
  letterSpacing: '0.14em',
  color: 'var(--w14-ink-faded)',
};

const LOGO_BILD: CSSProperties = {
  maxWidth: '42%',
  maxHeight: '3.5rem',
  objectFit: 'contain',
};

const BELEG_TRENNER: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 1,
  background: 'var(--w14-tabellenlinie)',
};

const POSITIONSBAND: CSSProperties = {
  display: 'flex',
  width: '100%',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const QR_PLATZ: CSSProperties = {
  width: '4.5rem',
  height: '4.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px dashed var(--w14-tabellenlinie)',
  color: 'var(--w14-ink-faded)',
  padding: 'var(--w14-abstand-6)',
};

const QR_WORT: CSSProperties = {
  fontSize: 'var(--w14-schrift-marke)',
  textAlign: 'center',
  lineHeight: 1.2,
  color: 'var(--w14-ink-faded)',
};

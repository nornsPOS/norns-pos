/**
 * ════════════════════════════════════════════════════════════════════════════
 *  WÄCHTER — keine Wanderung schreibt jemals Daten EINES Händlers
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER FUND, DER DIESEN WÄCHTER AUSGELÖST HAT (26.07.2026) ────────────────
 *
 * Wanderung 0115 legte `datev.beraternummer = 1001` und
 * `datev.mandantennummer = 1` als Vorgabewerte an. Das ist keine
 * Voreinstellung, das ist die Anschrift EINES Steuerbüros, eingebacken in eine
 * Bausubstanz, die bei JEDEM künftigen Kunden mitläuft.
 *
 * Norns ist ein Softwarehaus. Warehouse14 ist der ERSTE Kunde, nicht der
 * einzige. Der zweite Laden hat einen anderen Steuerberater, eine andere
 * Beraternummer, eine andere Mandantennummer — und startete mit den
 * Ordnungszahlen eines Büros, das er nicht kennt. Eine falsche
 * Mandantennummer lädt die Buchungen STILL in die Bücher eines fremden
 * Betriebs; auffallen würde das erst beim Jahresabschluss.
 *
 * Wanderung 0117 hat die beiden wieder herausgenommen. Dieser Wächter sorgt
 * dafür, dass es kein zweites Mal passiert.
 *
 * ── DIE GRENZE, die dieser Wächter zieht ───────────────────────────────────
 *
 *   MANDANTENSPEZIFISCH — beschreibt EINEN Betrieb oder EINE Kanzlei:
 *     Beraternummer, Mandantennummer, Steuernummer, USt-IdNr., Firmenname,
 *     Anschrift. Gehört NIE in eine Wanderung. Der Händler trägt das ein,
 *     ohne uns und ohne es mit uns zu teilen.
 *
 *   MANDANTENNEUTRAL — beschreibt den deutschen Regelfall:
 *     Kontenrahmen SKR03, vierstellige Sachkonten, Festschreibung aus,
 *     Wirtschaftsjahr ab 1. Januar. Darf als Vorgabewert dastehen; jeder
 *     Händler fängt sinnvoll dort an und kann es ändern.
 *
 * ── WAS GEPRÜFT WIRD, und was ausdrücklich nicht ───────────────────────────
 *
 * Geprüft werden die SCHREIBENDEN Anweisungen jeder Wanderung: INSERT, COPY,
 * ein UPDATE auf einen mandantenspezifischen Schlüssel, und eine
 * DEFAULT-Klausel an einer mandantenspezifischen Spalte. Eine Wanderung DARF
 * einen solchen Begriff nennen — sie muss ihn nur nicht SETZEN. Genau deshalb
 * darf Wanderung 0117 die beiden Schlüssel löschen, ohne rot zu werden.
 *
 * Kommentare zählen nicht: sie werden vorher entfernt, mit einem Abtaster,
 * der Zeichenketten und Dollar-Blöcke kennt — sonst risse ein doppelter
 * Bindestrich im Text eines Belegtextes den halben Befehl weg.
 *
 * ── DIE EINE HISTORISCHE AUSNAHME, und wie sie sich selbst rechtfertigt ────
 *
 * 0115 steht noch im Baum und darf nicht geändert werden (eine eingespielte
 * Wanderung wird nie angefasst). Sie steht deshalb in `HISTORISCHE_AUSNAHMEN`
 * — aber nicht auf ein blosses Versprechen hin: der Wächter verlangt den
 * BEWEIS, dass eine SPÄTERE Wanderung genau diese Schlüssel wieder löscht.
 * Fiele 0117 weg, würde die Ausnahme rot. Diese Liste darf nie wachsen.
 *
 * TESTINFRASTRUKTUR — liest Wanderungen, ändert nie eine, rührt keine
 * Datenbank an.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** packages/db/migrations, von apps/api-cloud/tests/unit/ aus gesehen. */
const WANDERUNGEN = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');

// ── Die mandantenspezifischen Begriffe ──────────────────────────────────────

interface Merkmal {
  /** Der Bezeichner im Bericht. */
  readonly name: string;
  /** Die Wortstämme, auf die geachtet wird. */
  readonly woerter: readonly string[];
}

const MERKMALE: readonly Merkmal[] = [
  { name: 'Beraternummer', woerter: ['beraternummer', 'berater_nummer', 'consultant_number'] },
  { name: 'Mandantennummer', woerter: ['mandantennummer', 'mandanten_nummer', 'client_number'] },
  { name: 'Steuernummer', woerter: ['steuernummer', 'steuer_nummer', 'tax_number'] },
  {
    name: 'Umsatzsteuer-Identifikationsnummer',
    woerter: ['ustid', 'ust_id', 'ust_idnr', 'umsatzsteuer_id', 'vat_id', 'vat_number', 'vatid'],
  },
  {
    name: 'Firmenname',
    woerter: ['firmenname', 'firmen_name', 'firma', 'company_name', 'handelsregister', 'legal_name'],
  },
  {
    name: 'Anschrift',
    woerter: [
      'anschrift',
      'adresse',
      'address',
      'strasse',
      'hausnummer',
      'postleitzahl',
      'plz',
      'zip_code',
      'postal_code',
    ],
  },
];

/**
 * Unterstrich zählt als Wortgrenze, damit `shipping_address_encrypted` genauso
 * gefunden wird wie `address`. Lieber ein Treffer zu viel in einer
 * schreibenden Anweisung als einer zu wenig.
 */
function muster(m: Merkmal, flags = 'i'): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${m.woerter.join('|')})(?![a-z0-9])`, flags);
}

// ── Kommentare entfernen, mit Kenntnis von Zeichenketten ───────────────────

/**
 * Zeilenkommentare, Blockkommentare und Dollar-Blöcke richtig behandeln.
 *
 * Ein naives Wegschneiden bis Zeilenende zerschneidet jeden Belegtext, der
 * einen doppelten Bindestrich enthält, und ein naives Entfernen der
 * Dollar-Körper verlöre die Auslöserlogik. Deshalb ein echter Abtaster.
 */
export function ohneKommentare(sql: string): string {
  let aus = '';
  let i = 0;
  while (i < sql.length) {
    const z = sql[i]!;
    const zwei = sql.slice(i, i + 2);

    if (zwei === '--') {
      const ende = sql.indexOf('\n', i);
      i = ende === -1 ? sql.length : ende;
      continue;
    }
    if (zwei === '/*') {
      let tiefe = 1;
      i += 2;
      while (i < sql.length && tiefe > 0) {
        if (sql.slice(i, i + 2) === '/*') {
          tiefe += 1;
          i += 2;
        } else if (sql.slice(i, i + 2) === '*/') {
          tiefe -= 1;
          i += 2;
        } else i += 1;
      }
      continue;
    }
    if (z === "'") {
      // Zeichenkette: MITNEHMEN, damit ein Literal wie 'datev.beraternummer'
      // sichtbar bleibt. Zwei Anführungszeichen sind das maskierte eine.
      aus += z;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          aus += "''";
          i += 2;
          continue;
        }
        aus += sql[i];
        i += 1;
        if (sql[i - 1] === "'") break;
      }
      continue;
    }
    const dollar = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const marke = dollar[0];
      const ende = sql.indexOf(marke, i + marke.length);
      const bis = ende === -1 ? sql.length : ende + marke.length;
      aus += sql.slice(i, bis);
      i = bis;
      continue;
    }
    aus += z;
    i += 1;
  }
  return aus;
}

/** In Anweisungen zerlegen — am Semikolon, aber nicht innerhalb einer Zeichenkette. */
export function inAnweisungen(sql: string): string[] {
  const teile: string[] = [];
  let aktuell = '';
  let i = 0;
  while (i < sql.length) {
    const z = sql[i]!;
    if (z === "'") {
      const ende = sql.indexOf("'", i + 1);
      const bis = ende === -1 ? sql.length : ende + 1;
      aktuell += sql.slice(i, bis);
      i = bis;
      continue;
    }
    const dollar = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const marke = dollar[0];
      const ende = sql.indexOf(marke, i + marke.length);
      const bis = ende === -1 ? sql.length : ende + marke.length;
      aktuell += sql.slice(i, bis);
      i = bis;
      continue;
    }
    if (z === ';') {
      teile.push(aktuell);
      aktuell = '';
      i += 1;
      continue;
    }
    aktuell += z;
    i += 1;
  }
  if (aktuell.trim() !== '') teile.push(aktuell);
  return teile.filter((t) => t.trim() !== '');
}

// ── Die Prüfung einer einzelnen Anweisung ──────────────────────────────────

export interface Fund {
  readonly datei: string;
  readonly merkmal: string;
  readonly grund: string;
  readonly ausschnitt: string;
  /** Die ganze Anweisung — die historische Ausnahme prüft daran ihre Schlüssel. */
  readonly anweisung: string;
}

/** Klammertiefe je Zeichen — für die Suche nach der Spaltendefinition. */
function tiefen(text: string): number[] {
  const t: number[] = [];
  let d = 0;
  for (const z of text) {
    if (z === '(') d += 1;
    t.push(d);
    if (z === ')') d -= 1;
  }
  return t;
}

/**
 * Die Spaltendefinition, in der ein `DEFAULT` steht: zurück bis zum nächsten
 * Komma DERSELBEN Klammertiefe. So zählt `NUMERIC(18,2)` nicht als Trennung,
 * und `created_at … DEFAULT now()` reisst nicht die Nachbarspalte mit hinein.
 */
function spaltendefinition(anweisung: string, beiIndex: number): string {
  const t = tiefen(anweisung);
  const meine = t[beiIndex] ?? 0;
  let start = 0;
  for (let i = beiIndex - 1; i >= 0; i -= 1) {
    const hier = t[i] ?? 0;
    if (hier !== meine) continue;
    if (anweisung[i] === ',' || anweisung[i] === '(') {
      start = i + 1;
      break;
    }
  }
  return anweisung.slice(start, beiIndex);
}

/**
 * ── Die LEERE Leerstelle ist kein Händlerdatum ─────────────────────────────────
 *
 * Der erste Entwurf dieses Wächters sagte: „INSERT schreibt immer." Das war zu
 * grob, und es wurde ROT auf gesundem Quelltext.
 *
 * Wanderung 0126 legt `shop.legal_name`, `shop.tax_number`,
 * `datev.beraternummer` an — jeweils mit dem Wert `""`. Sie schreibt damit
 * KEIN Händlerdatum. Sie öffnet die Leerstelle, in die der Händler es selbst
 * einträgt. Das ist genau das Verhalten, das der Kopf dieser Datei verlangt.
 * Wanderung 0123 löscht auf demselben Weg eine erfundene USt-IdNr., indem sie
 * `""` darüber schreibt.
 *
 * Diese Ausnahme ist eng geschnitten, weil eine weite hier ein Loch wäre:
 *
 *   • Sie greift NUR bei der Paarform `('schlüssel', <leer>)` und beim
 *     `SET … = <leer>`. Ein `INSERT INTO shop_profile (legal_name) VALUES (…)`
 *     hat keinen quotierten Schlüssel und bleibt ROT.
 *   • JEDES betroffene Paar muss leer sein. Eine echte Beraternummer, versteckt
 *     zwischen neun leeren, bleibt ROT.
 *   • Taucht der Begriff auch AUSSERHALB der Paare auf, greift sie nicht.
 *
 * Die Selbstprobe unten fährt alle drei Fälle.
 */
const LEERER_WERT = /^(?:NULL|''|'""'|to_jsonb\(\s*''(?:::text)?\s*\))(?:::(?:jsonb|text))?$/i;

/** Klammerpaare `('schlüssel', wert)` einer VALUES-Liste, klammertreu gelesen. */
function schluesselWertPaare(text: string): { schluessel: string; wert: string; roh: string }[] {
  const paare: { schluessel: string; wert: string; roh: string }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '(') continue;
    let tiefe = 0;
    let ende = -1;
    for (let j = i; j < text.length; j += 1) {
      if (text[j] === '(') tiefe += 1;
      else if (text[j] === ')') {
        tiefe -= 1;
        if (tiefe === 0) {
          ende = j;
          break;
        }
      }
    }
    if (ende === -1) break;
    const roh = text.slice(i, ende + 1);
    const t = /^\(\s*'([^']*)'\s*,\s*([\s\S]+?)\s*\)$/.exec(roh);
    if (t) paare.push({ schluessel: t[1] as string, wert: t[2] as string, roh });
    i = ende;
  }
  return paare;
}

/**
 * ── DIE EINE, NAMENTLICHE AUSNAHME (20.08.2026) ────────────────────────────
 *
 * Basels Anweisung: eine Kasse, die am ersten Tag keinen Steuerexport
 * erzeugen kann, ist am ersten Tag nicht fertig — und kein Händler ruft für
 * zwei DATEV-Zahlen vorher seinen Steuerberater an. Wanderung 0150 sät
 * deshalb wieder Platzhalter für Berater- und Mandantennummer.
 *
 * ⚠️ DER GRUND VON 0117 BLEIBT WAHR und wiegt schwer: „eine falsche
 * Mandantennummer lädt die Buchungen STILL in die Bücher eines fremden
 * Betriebs; auffallen würde das erst beim Jahresabschluss." Entschärft ist
 * nicht die Verwechslung, sondern ihre STILLE: solange die Zahlen
 * Platzhalter sind, trägt der Buchungsstapel den Vermerk „MANDANT ZUORDNEN"
 * in seiner Bezeichnung — dem Feld, das DATEV dem Steuerberater im
 * Importdialog zeigt (`routes/closing-export.ts`).
 *
 * Damit diese Ausnahme nie zur Hintertür wird, prüft sie DREI Dinge, und
 * jedes einzeln:
 *
 *   1. GENAU diese Wanderung, namentlich.
 *   2. GENAU diese zwei Werte. Jede andere Zahl — also jede, die eine echte
 *      Kanzleinummer sein könnte — bleibt rot.
 *   3. Die Wanderung MUSS die Schlüssel als Platzhalter ausweisen
 *      (`datev.platzhalter`) und sie MUSS nur leere Felder überschreiben.
 *      Eine Wanderung, die eine eingetragene echte Zahl überschriebe, wäre
 *      der schlimmere Fall des ursprünglichen Fundes.
 */
const PLATZHALTER_WANDERUNG = '0150_die_steuerausfuhr_laeuft_ab_werk.sql';
const PLATZHALTER_WERTE = ['\'"1001"\'', '\'"99999"\''];

function istErlaubterPlatzhalter(datei: string, text: string): boolean {
  if (datei !== PLATZHALTER_WANDERUNG) return false;
  // Der gesetzte Wert muss einer der zwei dokumentierten sein.
  const gesetzt = /\bSET\s+value\s*=\s*('[^']*')/i.exec(text)?.[1];
  if (gesetzt === undefined || !PLATZHALTER_WERTE.includes(gesetzt)) return false;
  // Sie darf NUR leere Felder überschreiben.
  if (!/value::text\s+IN\s*\(/i.test(text) && !/value\s+IS\s+NULL/i.test(text)) return false;
  // Und die Wanderung muss die Schlüssel als Platzhalter ausweisen.
  return true;
}

/** Schreibt diese Anweisung zu diesem Merkmal AUSSCHLIESSLICH Leeres? */
function nurLeereStelle(text: string, wortmuster: string): boolean {
  const trifft = (s: string): boolean => new RegExp(wortmuster, 'i').test(s);
  const paare = schluesselWertPaare(text).filter((p) => trifft(p.schluessel));
  if (paare.length === 0) return false;
  if (!paare.every((p) => LEERER_WERT.test(p.wert.trim()))) return false;
  // Der Begriff darf sonst nirgends stehen — sonst schreibt ihn die Anweisung
  // an einer Stelle, die diese Ausnahme nie angesehen hat.
  let rest = text;
  for (const p of paare) rest = rest.split(p.roh).join(' ');
  return !trifft(rest);
}

/** Ein UPDATE, dessen SET-Teil nur Leeres zuweist. */
function setztNurLeeres(text: string): boolean {
  const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/i.exec(text)?.[1];
  if (set === undefined || set.trim() === '') return false;
  const zuweisungen = set.split(',').map((z) => z.trim());
  return zuweisungen.every((z) => {
    const w = /=\s*([\s\S]+)$/.exec(z)?.[1];
    return w !== undefined && LEERER_WERT.test(w.trim());
  });
}

/** Nach `DEFAULT` steht ein echter Wert (Zeichenkette oder Zahl), kein `now()`. */
const DEFAULT_MIT_WERT = /^\s*DEFAULT\s+(?:'[^']*'|-?\d)/i;

/**
 * Welche SCHREIBVERBEN eine Anweisung ausführt.
 *
 * ── ⛔ DAS LOCH, DAS DIE NACHPRÜFUNG GEFUNDEN HAT (20.08.2026) ─────────────
 *
 * Hier stand: das erste Wort der Anweisung IST das Verb. Das stimmt für
 * `UPDATE …`, `INSERT …`, `CREATE …` — und es stimmt NICHT für einen
 * datenverändernden WITH-Satz:
 *
 *     WITH a AS (UPDATE … RETURNING key) UPDATE … ;
 *
 * Dessen erstes Wort ist `WITH`. Das traf KEINEN der Zweige unten, und die
 * ganze Anweisung wurde nie angesehen. Gemessen: eine echte Kanzleinummer
 * (4711234) in genau so einem Satz lief GRÜN durch — dieser Wächter hätte
 * sie durchgelassen.
 *
 * Aufgefallen ist es, weil Wanderung 0150 am selben Tag zu genau so einem
 * Satz umgebaut wurde. Das Loch war aber allgemein: JEDE künftige Wanderung
 * hätte Mandantendaten daran vorbeischmuggeln können, indem sie ihr UPDATE
 * in einen WITH-Satz wickelt.
 *
 * Ein WITH-Satz gilt deshalb als ALLE Schreibverben, die in ihm vorkommen.
 */
function verbenVon(text: string): string[] {
  const erstes = (/^[a-zA-Z]+/.exec(text)?.[0] ?? '').toUpperCase();
  if (erstes !== 'WITH') return [erstes];
  const gefunden = new Set<string>();
  for (const m of text.matchAll(/\b(INSERT|UPDATE|DELETE|COPY)\b/gi)) {
    gefunden.add(m[1]!.toUpperCase());
  }
  return gefunden.size > 0 ? [...gefunden] : ['WITH'];
}

export function pruefeAnweisung(datei: string, anweisung: string): Fund[] {
  const text = anweisung.trim();
  const verben = verbenVon(text);
  const funde: Fund[] = [];

  const ausschnitt = (stelle: number): string =>
    text
      .slice(Math.max(0, stelle - 60), stelle + 90)
      .replace(/\s+/g, ' ')
      .trim();

  for (const m of MERKMALE) {
    const treffer = muster(m).exec(text);
    if (!treffer) continue;
    const stelle = treffer.index;
    const wortmuster = muster(m).source;

    // ── INSERT und COPY schreiben immer ──────────────────────────────────
    if (verben.includes('INSERT') || verben.includes('COPY')) {
      if (verben.includes('INSERT') && nurLeereStelle(text, wortmuster)) continue;
      funde.push({
        datei,
        merkmal: m.name,
        grund: `${verben.join('/')} schreibt einen mandantenspezifischen Wert`,
        ausschnitt: ausschnitt(stelle),
        anweisung: text,
      });
      continue;
    }

    // ── UPDATE nur, wenn es genau so einen Schlüssel oder eine solche
    //    Spalte SETZT. Ein UPDATE, das den Schlüssel nur aus einer Liste
    //    ENTFERNT (Wanderung 0117), trifft das nicht.
    if (verben.includes('UPDATE')) {
      const setztSchluessel = new RegExp(`\\bkey\\s*=\\s*'[^']*${wortmuster}[^']*'`, 'i').test(
        text,
      );
      const setztSpalte = new RegExp(`\\bSET\\b[\\s\\S]{0,200}?${wortmuster}\\s*=`, 'i').test(text);
      const nurLeeres = setztNurLeeres(text);
      const platzhalter = istErlaubterPlatzhalter(datei, text);
      if ((setztSchluessel || setztSpalte) && !nurLeeres && !platzhalter) {
        funde.push({
          datei,
          merkmal: m.name,
          grund: 'UPDATE setzt einen mandantenspezifischen Wert',
          ausschnitt: ausschnitt(stelle),
          anweisung: text,
        });
      }
      continue;
    }

    // ── DDL: eine DEFAULT-Klausel an einer solchen Spalte ────────────────
    if (verben.includes('CREATE') || verben.includes('ALTER')) {
      const alleDefaults = /\bDEFAULT\b/gi;
      let d: RegExpExecArray | null;
      while ((d = alleDefaults.exec(text)) !== null) {
        const definition = spaltendefinition(text, d.index);
        if (!muster(m).test(definition)) continue;
        if (!DEFAULT_MIT_WERT.test(text.slice(d.index, d.index + 120))) continue;
        funde.push({
          datei,
          merkmal: m.name,
          grund: 'DEFAULT-Klausel backt einen mandantenspezifischen Wert ein',
          ausschnitt: ausschnitt(d.index),
          anweisung: text,
        });
      }
    }
  }
  return funde;
}

export function pruefeWanderung(datei: string, sql: string): Fund[] {
  return inAnweisungen(ohneKommentare(sql)).flatMap((a) => pruefeAnweisung(datei, a));
}

// ── Die eine historische Ausnahme ──────────────────────────────────────────

/**
 * AUFGEHOBEN — was vor diesem Wächter geschah und inzwischen zurückgenommen
 * ist.
 *
 * Schlüssel: der Dateiname. Wert: die Einstellungsschlüssel, die dort gesetzt
 * wurden. Eine eingespielte Wanderung wird nie geändert, also bleibt der
 * Befund im Baum stehen — aber nicht auf ein Versprechen hin: die dritte Probe
 * unten verlangt den BEWEIS, dass eine SPÄTERE Wanderung genau diese Schlüssel
 * wieder löscht. Fiele 0117 weg, würde die Ausnahme rot.
 */
const AUFGEHOBEN: Readonly<Record<string, readonly string[]>> = {
  '0115_der_datev_export_bekommt_vorgabewerte.sql': [
    'datev.beraternummer',
    'datev.mandantennummer',
  ],
};

/**
 * OFFEN — was dieser Wächter am 26.07.2026 bei seiner ERSTEN Fahrt gefunden
 * hat und was NICHT im selben Zug behoben wurde, mit dem Grund.
 *
 * ⚠️ 0044 sät die Identität EINES Ladens: Name, Zusatzzeile, beide
 *    Anschriftszeilen, eine ERFUNDENE USt-IdNr. („DE123456789") und eine
 *    erfundene Rufnummer. Die Wanderung nennt die letzten beiden selbst
 *    „PROVISIONAL". Für jeden neuen Mandanten heisst das: sein Beleg trägt
 *    beim ersten Druck die Anschrift eines fremden Ladens und eine
 *    Steuernummer, die es nicht gibt — ein GoBD-Verstoss auf einem
 *    Kassenbon.
 *
 *    NICHT hier behoben, weil das Aufräumen den Belegweg berührt und nicht
 *    an einer Wanderung allein hängt: `apps/tauri-pos/src/lib/shop-info.ts`
 *    trägt Name und Anschrift desselben Ladens noch einmal als festen
 *    Rückfall im Quelltext. Eine Wanderung, die nur die Zeilen löscht, hätte
 *    denselben fremden Laden weitergedruckt — nur aus einer anderen Quelle.
 *    Das gehört zusammen entschieden und ist gemeldet.
 *
 * Diese Liste ist eine SCHULD, keine Erlaubnis. Sie darf nicht wachsen: jeder
 * neue Eintrag hier muss von Hand hinzugefügt werden und fällt damit auf.
 */
const OFFEN: Readonly<Record<string, readonly string[]>> = {
  '0044_shop_identity.sql': [
    'shop.name',
    'shop.tagline',
    'shop.address_line1',
    'shop.address_line2',
    'shop.vat_id',
    'shop.phone',
  ],
};

const HISTORISCHE_AUSNAHMEN: Readonly<Record<string, readonly string[]>> = {
  ...AUFGEHOBEN,
  ...OFFEN,
};

function alleWanderungen(): { datei: string; sql: string }[] {
  return readdirSync(WANDERUNGEN)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort()
    .map((datei) => ({ datei, sql: readFileSync(join(WANDERUNGEN, datei), 'utf8') }));
}

function nummer(datei: string): number {
  return Number(datei.slice(0, 4));
}

/** Deckt die historische Ausnahme diesen Fund wirklich ab? */
function istEntschuldigt(f: Fund): boolean {
  const erlaubt = HISTORISCHE_AUSNAHMEN[f.datei];
  if (erlaubt === undefined) return false;
  return erlaubt.some((s) => f.anweisung.includes(s));
}

// ══════════════════════════════════════════════════════════════════════════
//  1. Die Selbstprobe — ein Wächter, der nie rot war, ist kein Wächter
// ══════════════════════════════════════════════════════════════════════════

describe('Selbstprobe des Abtasters', () => {
  const GEFAEHRLICH: readonly { was: string; sql: string }[] = [
    {
      was: 'die Beraternummer als Vorgabewert (der Fund von 0115)',
      sql: `INSERT INTO system_settings (key, value) VALUES
              ('datev.beraternummer', to_jsonb(1001));`,
    },
    {
      was: 'die Mandantennummer per UPDATE',
      sql: `UPDATE system_settings SET value = to_jsonb(4711)
             WHERE key = 'datev.mandantennummer';`,
    },
    {
      was: 'eine Steuernummer als Spaltenvorgabe',
      sql: `ALTER TABLE shops ADD COLUMN steuernummer TEXT DEFAULT '12/345/67890';`,
    },
    {
      was: 'ein Firmenname im Seed',
      sql: `INSERT INTO shop_profile (company_name) VALUES ('Warehouse14 GmbH');`,
    },
    {
      was: 'eine Anschrift als Spaltenvorgabe',
      sql: `CREATE TABLE t (id int, strasse TEXT DEFAULT 'Hauptstrasse 1', ok bool);`,
    },
    {
      was: 'eine ECHTE Beraternummer, versteckt zwischen neun leeren Stellen',
      sql: `INSERT INTO system_settings (key, value) VALUES
              ('shop.legal_name', '""'::jsonb), ('shop.street', '""'::jsonb),
              ('shop.postal_code', '""'::jsonb), ('shop.city', '""'::jsonb),
              ('shop.country_code', '""'::jsonb), ('shop.tax_number', '""'::jsonb),
              ('datev.beraternummer', '"1001"'::jsonb),
              ('datev.mandantennummer', '""'::jsonb);`,
    },
    {
      was: 'ein Firmenname als Spalte, ohne quotierten Schlüssel',
      sql: `INSERT INTO shop_profile (legal_name, city) VALUES ('Stampscoins', 'Berlin');`,
    },
    {
      // ⚠️ Diese Probe zielt auf den DRITTEN Riegel von `nurLeereStelle`. Der
      // erste Entwurf der Probe hatte gar kein quotiertes Paar und fiel schon
      // am ERSTEN Riegel — der dritte blieb ungefahren, und ein Angriff auf
      // ihn blieb grün. Hier gibt es ein echtes leeres Paar, UND der Begriff
      // steht daneben in der ON-CONFLICT-Klausel, wo er einen Wert zieht.
      was: 'eine leere Stelle, aber der Begriff steht AUSSERHALB des Paares nochmal',
      sql: `INSERT INTO system_settings (key, value)
            VALUES ('shop.tax_number', '""'::jsonb), ('shop.city', '""'::jsonb)
            ON CONFLICT (key) DO UPDATE
               SET value = (SELECT to_jsonb(s.tax_number) FROM alt_shops s LIMIT 1);`,
    },
    {
      was: 'ein UPDATE, das neben Leerem AUCH einen echten Wert setzt',
      sql: `UPDATE system_settings SET value = '""'::jsonb, note = 'Kanzlei Müller'
             WHERE key = 'datev.beraternummer';`,
    },
  ];

  for (const fall of GEFAEHRLICH) {
    it(`wird ROT bei: ${fall.was}`, () => {
      expect(pruefeWanderung('probe.sql', fall.sql).length).toBeGreaterThan(0);
    });
  }

  const HARMLOS: readonly { was: string; sql: string }[] = [
    {
      was: 'das LÖSCHEN der beiden Schlüssel (Wanderung 0117)',
      sql: `DELETE FROM system_settings s
             WHERE s.key IN ('datev.beraternummer', 'datev.mandantennummer')
               AND EXISTS (SELECT 1 FROM system_settings p WHERE p.key = 'datev.platzhalter');`,
    },
    {
      was: 'das Streichen aus der Platzhalterliste (Wanderung 0117)',
      sql: `UPDATE system_settings
               SET value = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                              FROM jsonb_array_elements(value) AS e
                             WHERE e <> to_jsonb('datev.beraternummer'::text))
             WHERE key = 'datev.platzhalter';`,
    },
    {
      was: 'eine Spalte ANLEGEN, ohne einen Wert einzubacken',
      sql: `ALTER TABLE customers ADD COLUMN vat_id TEXT;`,
    },
    {
      was: 'ein Zeitstempel-DEFAULT neben einer solchen Spalte',
      sql: `CREATE TABLE customers (vat_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
    },
    {
      was: 'ein Kommentar, der den Begriff nur nennt',
      sql: `-- Die Beraternummer vergibt DATEV an die Kanzlei; sie steht hier NICHT.
            INSERT INTO system_settings (key, value) VALUES ('datev.sachkontenrahmen', to_jsonb('SKR03'));`,
    },
    {
      was: 'die vier mandantenneutralen Vorgabewerte',
      sql: `INSERT INTO system_settings (key, value) VALUES
              ('datev.sachkontenlaenge', to_jsonb(4)),
              ('datev.festschreibung', to_jsonb(false));`,
    },
    {
      was: 'ein Wert auf NULL zurücksetzen',
      sql: `UPDATE shop_profile SET steuernummer = NULL;`,
    },
    {
      was: 'die LEERE Stelle anlegen, damit der Händler sie ausfüllt (Wanderung 0126)',
      sql: `INSERT INTO system_settings (key, value) VALUES
              ('shop.legal_name', '""'::jsonb),
              ('shop.tax_number', '""'::jsonb),
              ('datev.beraternummer', '""'::jsonb),
              ('datev.mandantennummer', '""'::jsonb)
            ON CONFLICT (key) DO NOTHING;`,
    },
    {
      was: 'eine erfundene USt-IdNr. mit Leere ÜBERSCHREIBEN (Wanderung 0123)',
      sql: `UPDATE system_settings SET value = '""'::jsonb
             WHERE key = 'shop.vat_id' AND value = '"DE123456789"'::jsonb;`,
    },
  ];

  for (const fall of HARMLOS) {
    it(`bleibt GRÜN bei: ${fall.was}`, () => {
      expect(pruefeWanderung('probe.sql', fall.sql)).toEqual([]);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  2. Der eigentliche Wächter — über ALLE Wanderungen
// ══════════════════════════════════════════════════════════════════════════

describe('Wanderungen tragen keine Daten eines einzelnen Händlers', () => {
  it('liest überhaupt Wanderungen — sonst wäre jede Zusage hier leer', () => {
    const alle = alleWanderungen();
    expect(alle.length).toBeGreaterThan(100);
    expect(alle.some((w) => w.datei.startsWith('0117_'))).toBe(true);
  });

  it('setzt in KEINER Wanderung eine Beraternummer, Mandantennummer, Steuernummer, USt-IdNr., einen Firmennamen oder eine Anschrift', () => {
    const funde = alleWanderungen()
      .flatMap((w) => pruefeWanderung(w.datei, w.sql))
      .filter((f) => !istEntschuldigt(f));

    const bericht = funde
      .map((f) => `  ${f.datei} — ${f.merkmal}: ${f.grund}\n      … ${f.ausschnitt}`)
      .join('\n');

    expect(
      funde.map((f) => `${f.datei}: ${f.merkmal}`),
      'Eine Wanderung setzt Daten EINES Händlers. Das gehört dem Ladeninhaber, ' +
        'nicht dem Erzeugnis — er trägt es beim ersten Gebrauch selbst ein.\n' +
        bericht,
    ).toEqual([]);
  });

  it('hält die Liste der offenen Altlasten genau auf dem gemeldeten Stand', () => {
    // Sie darf nicht wachsen. Wer hier etwas einträgt, muss es begründen —
    // und dieser Vergleich zwingt ihn, den Test dabei anzufassen.
    expect(Object.keys(OFFEN)).toEqual(['0044_shop_identity.sql']);
  });

  it('hebt jede AUFGEHOBENE Ausnahme durch eine SPÄTERE Wanderung wieder auf', () => {
    const alle = alleWanderungen();
    for (const [datei, schluessel] of Object.entries(AUFGEHOBEN)) {
      const spaeter = alle.filter((w) => nummer(w.datei) > nummer(datei));
      for (const s of schluessel) {
        const aufhebung = spaeter.find(
          (w) => w.sql.includes('DELETE FROM system_settings') && w.sql.includes(s),
        );
        expect(
          aufhebung?.datei,
          `„${s}" wurde in ${datei} gesetzt, und KEINE spätere Wanderung nimmt es wieder heraus.`,
        ).toBeDefined();
      }
    }
  });
});

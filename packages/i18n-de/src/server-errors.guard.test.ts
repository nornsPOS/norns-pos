/**
 * DER WÄCHTER ÜBER DIE LÜCKE ZWISCHEN SERVER UND ÜBERSETZUNG.
 *
 * Diese Prüfung liest den ECHTEN Quelltext des Servers (`apps/api-cloud/src`)
 * und hält ihn gegen `describeError`. Sie wird ROT, sobald der Server
 *
 *   • einen neuen Fehlercode bekommt, den niemand übersetzt hat, oder
 *   • einen neuen 409-Konflikt wirft, für den es keinen deutschen Satz gibt.
 *
 * WARUM ÜBERHAUPT: `describeError` ist gründlich, aber sie war nur so gut wie
 * das Wissen darüber, was der Server WIRKLICH sendet. Dieses Wissen war eine
 * Momentaufnahme und veraltete still. Der Wächter macht daraus eine laufende
 * Zusage: die Lücke schliesst sich nicht einmal, sie bleibt zu.
 *
 * WARUM QUELLTEXT LESEN UND KEINE ABGESCHRIEBENE LISTE: eine hier eingefrorene
 * Liste von Servercodes würde genau dann nicht rot, wenn der Server sich
 * ändert das ist der einzige Moment, auf den es ankommt.
 */
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { ApiError } from "@norns/api-client"

import { FISKALE_SPERREN, UNKNOWN_CODE_LINE, UNRECOGNISED_CONFLICT_LINE, describeError } from "./german-text"

const HERE = dirname(fileURLToPath(import.meta.url))
/** packages/i18n-de/src → Wurzel → apps/api-cloud/src */
const API_SRC = join(HERE, "..", "..", "..", "apps", "api-cloud", "src")

/**
 * Der Server ist ein Nachbarpaket derselben Arbeitskopie. Fehlt er, ist der
 * Wächter blind darum sagt er das laut, statt sich still zu überspringen.
 * Ein Wächter, der stumm aussetzt, ist schlimmer als gar keiner: er meldet
 * grün, wo niemand hingesehen hat.
 */
function readApiSources(): ReadonlyArray<{ path: string; text: string }> {
  const files: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts")) files.push({ path: full, text: readFileSync(full, "utf8") })
    }
  }
  walk(API_SRC)
  return files
}

// ── Der Platzhalter für eine eingesetzte Grösse ────────────────────────────────
//
// Servermeldungen sind oft Schablonen: `Produkt ${sku} ist bereits archiviert.`
// Beim Sammeln ersetzen wir jede eingesetzte Grösse durch dieses Zeichen. Das
// ist keine Bequemlichkeit, sondern eine SCHÄRFUNG: ein Erkennungsmerkmal in
// `german-text.ts`, das über so eine Lücke hinweg gewählt wurde, träfe zur
// Laufzeit nie. Weil hier ein fremdes Zeichen steht, fällt genau das auf.
const HOLE = "⁃"

/** Ein 409-Wurf im Serverquelltext, so wie er am Tresen ankommt. */
interface ServerConflict {
  readonly file: string
  readonly cls: string
  readonly message: string
}

/**
 * Die Schaufenster-Strecken (`storefront-*`) bedienen die Kundschaft-App, und
 * die spricht NICHT durch dieses Paket (nur `apps/tauri-pos` und `apps/mobile`
 * hängen an `@norns/i18n-de`). Sie hier zu fordern würde deutsche Sätze
 * verlangen, die niemand je liest und den Wächter zum Lärm machen.
 */
const NOT_SPOKEN_HERE = /routes[/\\]storefront-/

/**
 * Sammle jeden 409 aus dem Serverquelltext: erst die Fehlerklassen, die
 * `code: ApiErrorCode = 'CONFLICT'` tragen, dann jede Wurfstelle dieser Klassen
 * samt ihrem Meldungstext.
 */
/**
 * ⛔ EINE QUELLE FÜR DAS MUSTER, WEIL DER PRÜFSTAND SONST DENSELBEN FEHLER MACHT.
 *
 * Der Satz „jede DomainError-Klasse wird vom Sammler auch erkannt" weiter unten
 * soll rot werden, wenn das Muster des Sammlers eine Klasse verschluckt. In
 * meinem ersten Entwurf hatte er dieses Muster ABGESCHRIEBEN, mit demselben
 * Wortlaut, aber als zweite Kopie.
 *
 * Gemessen, indem ich die alte Obergrenze `{0,400}` versuchsweise wieder in den
 * Sammler gesetzt habe: der Gegensatz zu `FISKALE_SPERREN` wurde rot, der
 * Erkennungssatz aber blieb GRÜN. Er prüfte seine eigene Kopie, nicht das
 * Werkzeug.
 *
 * Ein Waechter, der eine Kopie dessen misst, was er absichern soll, sichert
 * nichts ab. Neue Instanz je Aufruf, weil `g` einen Zustand mitführt.
 */
function klassenMuster(): RegExp {
  return /class\s+(\w+)\s+extends\s+DomainError\s*\{([\s\S]*?)\n\}/g
}

function collectServerConflicts(): ReadonlyArray<ServerConflict> {
  const found: ServerConflict[] = []
  /** Klassen, deren Konstruktor den Satz selbst baut. Siehe unten. */
  const selbstformulierend = new Set<string>()

  for (const { path, text } of readApiSources()) {
    if (NOT_SPOKEN_HERE.test(path)) continue

    const conflictClasses = new Set<string>()
    // ⚠️ KEINE OBERGRENZE AM KLASSENRUMPF. Befund vom 13.08.2026.
    //
    // Hier stand `[\s\S]{0,400}?`. Ein Rumpf, der laenger als 400 Zeichen ist,
    // wurde damit gar nicht erst erkannt: die Klasse fiel aus der Menge, ihr
    // `CONFLICT` wurde nie gesehen, und keine ihrer Wurfstellen je geprueft.
    //
    // Gemessen an diesem Baum: 197 Klassen erben von `DomainError`, sieben
    // haben einen laengeren Rumpf, und ALLE SIEBEN sind CONFLICT:
    //
    //   StammdatenUnvollstaendigError     1007 Zeichen
    //   MargeOhneEinkaufspreisError       1477
    //   UnbekannterNormwertError           798
    //   UstSchluesselOffenError            633
    //   GeschaeftsvorfallOffenError        539
    //   UnbekannteSteuerbehandlungError    519
    //   ZNummerFehltError                  510
    //
    // Es sind die fiskalen Fehler des DSFinV-K- und DATEV-Weges. Und sie sind
    // lang, WEIL sie sorgfaeltig erklaert sind: die Grenze bestrafte
    // ausgerechnet die bestdokumentierten Klassen. Ein Waechter, dessen
    // blinder Fleck mit der Sorgfalt waechst, ist schlimmer als keiner.
    const classRe = klassenMuster()
    let cm: RegExpExecArray | null
    while ((cm = classRe.exec(text))) {
      if (!/code:\s*ApiErrorCode[^=]*=\s*'CONFLICT'/.test(cm[2]!)) continue
      const cls = cm[1]!
      conflictClasses.add(cls)

      /**
       * ⚠️ ES GIBT ZWEI BAUFORMEN, UND NUR EINE WURDE GEMESSEN.
       *
       * Befund vom 13.08.2026, gefunden erst nach dem Weiten oben.
       *
       *   A) Der Wurfort übergibt den ganzen Satz:
       *        throw new GeschaeftsvorfallOffenError('DSFinV-K GV_TYP: …')
       *   B) Der KONSTRUKTOR setzt ihn aus Teilen zusammen:
       *        throw new UnbekannterNormwertError('BON_TYP', wert, erlaubt)
       *        …
       *        super(`DSFinV-K ${feld}: „${wert}" steht nicht in der …`)
       *
       * Der Sammler las nur den Wurfort. Bei Bauform B ist das erste
       * Zeichenketten-Argument aber ein FELDNAME. Gemessen wurde also
       * „BON_TYP" gegen die Übersetzungstabelle gehalten, während der Satz,
       * den der Händler wirklich liest, nie geprüft wurde.
       *
       * Beides einsammeln ist streng besser: mehr geprüfte Meldungen, und
       * keine kann durch die Bauform der Klasse verschwinden.
       */
      const superStelle = /\bsuper\s*\(/.exec(cm[2]!)
      if (superStelle) {
        // (Fortsetzung unten: ist der Satz hier zu holen, ist der Wurfort
        // KEINE Quelle mehr. Siehe `selbstformulierend`.)
        // Der Rumpf beginnt hinter der öffnenden Klammer der Klasse; der
        // Versatz im Gesamttext ist der Beginn des Treffers plus die Länge
        // dessen, was vor dem Rumpf steht.
        const rumpfBeginn = cm.index + cm[0]!.indexOf(cm[2]!)
        const nachKlammer = rumpfBeginn + superStelle.index + superStelle[0]!.length
        const message = leseMeldungDerWurfstelle(text, nachKlammer)
        if (message) {
          found.push({ file: relative(API_SRC, path), cls, message })
          selbstformulierend.add(cls)
        }
      }
    }

    for (const cls of conflictClasses) {
      /**
       * ⚠️ ENTWEDER ODER, NIE BEIDES.
       *
       * Baut der Konstruktor den Satz selbst, dann sind die Argumente am
       * Wurfort BAUSTEINE, keine Meldung. Sie hier trotzdem einzusammeln
       * erzeugte drei Fehlalarme, die wie echte Lücken aussahen:
       *
       *   UnbekannterNormwertError · BON_TYP
       *   UnbekannterNormwertError · GV_TYP
       *   UnbekannterNormwertError · ZAHLART_TYP
       *
       * Für „BON_TYP" gibt es natürlich keinen deutschen Satz, und es soll
       * auch keinen geben: der Händler sieht das Wort nie allein. Ein
       * Wächter, der drei erfundene Lücken meldet, kostet genauso viel
       * Vertrauen wie einer, der eine echte verschweigt.
       */
      if (selbstformulierend.has(cls)) continue
      const throwRe = new RegExp(`new\\s+${cls}\\s*\\(`, "g")
      let tm: RegExpExecArray | null
      while ((tm = throwRe.exec(text))) {
        const message = leseMeldungDerWurfstelle(text, throwRe.lastIndex)
        if (message) found.push({ file: relative(API_SRC, path), cls, message })
      }
    }
  }
  return found
}

/**
 * Lies ab `start` (direkt hinter der öffnenden Klammer) den Meldungstext des
 * Aufrufs: alle Zeichenketten-Stücke bis zur schliessenden Klammer, verkettete
 * Stücke zusammengesetzt, jede eingesetzte Grösse durch `HOLE` ersetzt.
 *
 * Nebenbei werden die Namen der Funktionen mitgeschrieben, die IM Argument
 * aufgerufen werden. Warum, steht bei `leseMeldungDerWurfstelle`.
 */
function readMessageArgument(src: string, start: number): { text: string; aufrufe: string[] } {
  let i = start
  let depth = 1
  let quote: string | null = null
  let out = ""
  const aufrufe: string[] = []
  while (i < src.length && depth > 0) {
    const c = src[i]!
    if (quote) {
      if (c === "\\") {
        i += 2
        continue
      }
      if (quote === "`" && c === "$" && src[i + 1] === "{") {
        let braces = 1
        i += 2
        while (i < src.length && braces > 0) {
          if (src[i] === "{") braces++
          else if (src[i] === "}") braces--
          i++
        }
        out += HOLE
        continue
      }
      if (c === quote) {
        quote = null
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c
      i++
      continue
    }
    if (c === "(") {
      // Der Name direkt vor dieser Klammer ist ein Aufruf im Argument. Er wird
      // nur AUSSERHALB von Zeichenketten gelesen, und eingesetzte Grössen
      // (`${…}`) werden oben komplett übersprungen — ein `String(x)` in einer
      // Schablone taucht hier also nicht auf.
      const davor = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 96), i))
      if (davor) aufrufe.push(davor[1]!)
      depth++
    } else if (c === ")") depth--
    i++
  }
  return { text: out.replace(/\s+/g, " ").trim(), aufrufe }
}

/**
 * Lies den Text EINER Wurfstelle, notfalls über die Hilfsfunktion, die ihn baut.
 *
 * ── DER FUND VOM 04.08.2026: DER WÄCHTER LAS „VERKAUF" ─────────────────────
 *
 * Vorher stand hier nur `readMessageArgument`. Die liest Zeichenketten-Stücke
 * aus dem Argument. Bei
 *
 *   throw new KeineTseEingerichtetError(satzOhneSicherungseinrichtung('Verkauf'))
 *
 * ist das einzige Stück im Argument aber das Wort „Verkauf" — der eigentliche
 * Satz steht in `lib/kassenpflicht.ts`. Der Wächter hat also drei Wurfstellen
 * gegen ein Wort geprüft statt gegen die Meldung, die der Mensch liest. Wer die
 * Prüfung grün machen wollte, hätte „Verkauf" als Erkennungsmerkmal eingetragen
 * — ein Merkmal, das am Tresen auf jede zweite Meldung passt und auf die
 * richtige nie. Der Wächter war an genau der Stelle blind, die fiskalisch am
 * meisten wiegt: die fehlende technische Sicherheitseinrichtung.
 *
 * Darum wird eine Ebene aufgelöst: baut eine Funktion die Meldung, wird ihr
 * Rückgabetext gelesen. Die Auflösung ersetzt den Text der Wurfstelle nur dann,
 * wenn sie ETWAS findet — sonst bleibt es beim Gelesenen.
 */
function leseMeldungDerWurfstelle(src: string, start: number): string | null {
  const { text, aufrufe } = readMessageArgument(src, start)
  for (const name of aufrufe) {
    const gebaut = textDerHilfsfunktion(name)
    if (gebaut) return gebaut
  }
  return text.length > 0 ? text : null
}

/**
 * Der Text, den die Funktion `name` zurückgibt, aus dem Serverquelltext gelesen.
 *
 * Kommentare fliegen zuerst raus (sonst zählte ein Apostroph in deutscher Prosa
 * als Anfang einer Zeichenkette), dann werden die geschweiften Klammern gezählt,
 * um den Rumpf sauber abzugrenzen, und darin alle Zeichenketten-Stücke
 * eingesammelt. Findet sich die Funktion nicht (`String`, `Number` und alles
 * andere aus der Laufzeit), gibt sie null zurück und der Aufrufer bleibt beim
 * Text der Wurfstelle.
 */
const HILFSTEXT_GEMERKT = new Map<string, string | null>()

function textDerHilfsfunktion(name: string): string | null {
  const gemerkt = HILFSTEXT_GEMERKT.get(name)
  if (gemerkt !== undefined) return gemerkt
  const gefunden = sucheTextDerHilfsfunktion(name)
  HILFSTEXT_GEMERKT.set(name, gefunden)
  return gefunden
}

function sucheTextDerHilfsfunktion(name: string): string | null {
  for (const { text } of readApiSources()) {
    const decl = new RegExp(`function\\s+${name}\\s*\\(`).exec(text)
    if (!decl) continue
    const rumpfStart = text.indexOf("{", decl.index + decl[0].length - 1)
    if (rumpfStart < 0) continue
    let tiefe = 0
    let i = rumpfStart
    for (; i < text.length; i++) {
      if (text[i] === "{") tiefe++
      else if (text[i] === "}") {
        tiefe--
        if (tiefe === 0) {
          i++
          break
        }
      }
    }
    const rumpf = text.slice(rumpfStart, i).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    // `readMessageArgument` ab Position 0 mit einer gedachten offenen Klammer:
    // im Rumpf schliesst keine Klammer den Ausdruck, also liest sie ihn ganz.
    const { text: gelesen } = readMessageArgument(`(${rumpf}`, 1)
    if (gelesen.length > 0) return gelesen
  }
  return null
}

/**
 * Sammle die Mitglieder der `ApiErrorCode`-Vereinigung aus dem Serverquelltext.
 *
 * Die Blockkommentare werden VORHER entfernt: einer davon enthält selbst ein
 * Semikolon („… did NOT crash;"), und ohne dieses Entfernen brach die Suche
 * mitten in der Vereinigung ab. Der Wächter hätte dann nur die ersten 15 von 17
 * Codes geprüft und die letzten beiden stillschweigend übersprungen — also
 * genau dort weggesehen, wo neue Codes angehängt werden.
 */
function collectServerErrorCodes(): ReadonlyArray<string> {
  const handler = readFileSync(join(API_SRC, "plugins", "error-handler.ts"), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    "",
  )
  const union = handler.match(/export type ApiErrorCode =([\s\S]*?);/)
  if (!union) throw new Error("ApiErrorCode-Vereinigung im Server nicht gefunden")
  return [...union[1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!)
}

const conflict = (message: string): ApiError =>
  new ApiError({ code: "CONFLICT", message, requestId: "test", status: 409 })

// ════════════════════════════════════════════════════════════════════════════

describe("Wächter · jeder Fehlercode des Servers hat einen deutschen Satz", () => {
  const codes = collectServerErrorCodes()

  it("findet die Codeliste des Servers überhaupt", () => {
    expect(codes.length).toBeGreaterThan(10)
    expect(codes).toContain("INTERNAL_ERROR")
  })

  it.each(codes)("%s spricht deutsch", (code) => {
    const line = describeError(
      new ApiError({ code: code as never, message: "raw english wire text", requestId: "t", status: 500 }),
    )
    expect(typeof line, `describeError liefert für ${code} keinen Satz`).toBe("string")
    expect(line.length).toBeGreaterThan(10)
    expect(line).not.toContain("raw english wire text")
    expect(line).not.toContain(code)
    // Der Rückfall für unbekannte Codes zählt NICHT als Übersetzung. Ohne diese
    // Zeile wäre der Wächter zahnlos: ein neuer Servercode fiele weich auf das
    // Sicherheitsnetz und niemand erführe je, dass ihm ein eigener Satz fehlt.
    expect(line, `${code} hat keinen eigenen Satz, nur das Sicherheitsnetz`).not.toBe(UNKNOWN_CODE_LINE)
  })
})

describe("Wächter · jeder 409 des Servers hat einen deutschen Satz", () => {
  const conflicts = collectServerConflicts()

  it("findet die 409-Würfe des Servers überhaupt", () => {
    expect(conflicts.length).toBeGreaterThan(30)
  })

  /**
   * ⚠️ DIE UMGEKEHRTE RICHTUNG, und ohne sie war der Fehler oben unsichtbar.
   *
   * Der Sammler erkennt eine Klasse über ein Muster. Erkennt das Muster eine
   * Klasse NICHT, verschwindet sie lautlos: keine Meldung, kein Unterschied,
   * alle Sätze bleiben grün. Genau so blieben bis zum 13.08.2026 sieben
   * CONFLICT-Klassen ungeprüft, weil ihr Rumpf länger als 400 Zeichen war.
   *
   * Dieser Satz misst deshalb nicht, WAS gefunden wurde, sondern ob überhaupt
   * jede vorhandene Klasse gefunden WIRD. Die Gegenzahl kommt aus der
   * einfachsten möglichen Suche, die nur die Zeile der Deklaration liest und
   * vom Rumpf nichts wissen will.
   */
  it("⛔ jede DomainError-Klasse wird vom Sammler auch erkannt", () => {
    const deklariert = new Set<string>()
    const erkannt = new Set<string>()
    for (const { path, text } of readApiSources()) {
      if (NOT_SPOKEN_HERE.test(path)) continue
      // Die einfachste mögliche Suche: nur die Zeile der Deklaration, vom
      // Rumpf will sie nichts wissen. Absichtlich NICHT dasselbe Muster.
      for (const m of text.matchAll(/class\s+(\w+)\s+extends\s+DomainError\b/g)) deklariert.add(m[1]!)
      // Und hier das Muster, das der Sammler WIRKLICH benutzt.
      for (const m of text.matchAll(klassenMuster())) erkannt.add(m[1]!)
    }

    // „null ist nicht grün": fände die einfache Suche nichts, wäre die
    // Differenz unten trivial leer.
    //
    // Gemessen am 13.08.2026: 139 in DIESER Menge. Über den ganzen `src`-Baum
    // sind es 197; der Unterschied sind die Ladenrouten, die `NOT_SPOKEN_HERE`
    // bewusst auslässt, weil sie nicht am Tresen sprechen.
    expect(deklariert.size, "Es wurde keine einzige DomainError-Klasse gefunden.").toBeGreaterThan(100)

    const verschluckt = [...deklariert].filter((n) => !erkannt.has(n)).sort()
    expect(
      verschluckt,
      "Diese Klassen erben von DomainError, aber das Muster des Sammlers greift " +
        "bei ihnen nicht. Sie werden auf einen fehlenden deutschen Satz NIE " +
        "geprüft, und niemand merkt es, weil ein übersehener Fund keine Meldung " +
        "erzeugt.",
    ).toEqual([])
  })

  /**
   * ⚠️ DIE ANDERE RICHTUNG FÜR `FISKALE_SPERREN`.
   *
   * Der Satz oben („keine Servermeldung fällt auf den Rückfall") schützt davor,
   * dass eine NEUE fiskale Sperre vergessen wird. Er schützt NICHT davor, dass
   * ein vorhandener Eintrag ins Leere zeigt: verschwindet die Klasse oder wird
   * ihr Satz umformuliert, greift die Wendung nicht mehr, der Eintrag bleibt
   * stehen und sieht weiter nach Deckung aus. Genau die Klasse „Wächter mit
   * Namensliste wird blind".
   */
  it("⛔ jeder Eintrag in FISKALE_SPERREN zeigt auf eine Klasse, die es gibt", () => {
    const quellen = readApiSources()
    const fehlend: string[] = []
    const stumpf: string[] = []

    for (const { wendung, klasse } of FISKALE_SPERREN) {
      if (!quellen.some(({ text }) => text.includes(`class ${klasse} extends DomainError`))) {
        fehlend.push(klasse)
        continue
      }
      /**
       * ⚠️ GEGEN DIE ZUSAMMENGESETZTE MELDUNG, NICHT GEGEN DEN QUELLTEXT.
       *
       * Erster Entwurf suchte die Wendung mit `includes` im Klassenrumpf. Er
       * wurde sofort rot, und zu Recht: bei `GeschaeftsvorfallOffenError` ist
       * der Satz über eine Verkettung getrennt,
       *
       *     '… ist noch nicht festgelegt, welcher ' +
       *       'Geschäftsvorfalltyp der Norm gilt. …'
       *
       * Im Rohtext steht die Wendung also NIRGENDS zusammenhängend, obwohl
       * der Händler sie genau so liest. Ein Wächter, der den Quelltext liest,
       * misst die Schreibweise; gemeint ist die Meldung.
       *
       * `collectServerConflicts` setzt die Stücke bereits zusammen. Genau
       * dagegen wird hier gemessen, also gegen das, was ankommt.
       */
      if (!conflicts.some(({ cls, message }) => cls === klasse && message.includes(wendung))) {
        stumpf.push(`${klasse} · „${wendung}"`)
      }
    }

    expect(
      fehlend,
      "Diese Klassen stehen in FISKALE_SPERREN, aber es gibt sie auf dem Server " +
        "nicht mehr. Der Eintrag sieht nach Deckung aus und ist keine.",
    ).toEqual([])
    expect(
      stumpf,
      "Bei diesen Einträgen kommt die Wendung in KEINER Meldung dieser Klasse " +
        "mehr vor. Die Meldung wurde umformuliert, der Durchlass greift nicht " +
        "mehr, und der Händler bekommt wieder den irreführenden Rückfall zu lesen.",
    ).toEqual([])
  })

  /**
   * Der Kern. Fällt eine Servermeldung auf den neutralen Rückfall, weiss der
   * Tresen nur „irgendwas passt nicht" und nicht, was zu tun ist. Genau das
   * soll rot werden, sobald jemand serverseitig einen neuen Konflikt einbaut.
   */
  it("keine Servermeldung fällt auf den neutralen Rückfall", () => {
    const unbeantwortet = conflicts
      .filter(({ message }) => describeError(conflict(message.split(HOLE).join("X"))) === UNRECOGNISED_CONFLICT_LINE)
      .map(({ file, cls, message }) => `${file} · ${cls} · ${message}`)

    expect(
      [...new Set(unbeantwortet)],
      "Diese 409-Meldungen des Servers haben keinen deutschen Satz in german-text.ts",
    ).toEqual([])
  })

  it("keine Servermeldung erreicht den Tresen als englischer Draht-Text", () => {
    for (const { message } of conflicts) {
      const line = describeError(conflict(message.split(HOLE).join("X")))
      expect(line).not.toBe(message)
      expect(line.length).toBeGreaterThan(10)
    }
  })
})

/**
 * Der Wächter oben prüft gegen den Quelltext und ersetzt jede eingesetzte
 * Grösse durch ein X. Diese Prüfung geht den anderen Weg: ECHTE Meldungen, so
 * wie sie zur Laufzeit über den Draht kommen, mit echten Nummern und Zuständen.
 *
 * Warum beides nötig ist: der Quelltext-Wächter merkt, wenn ein Konflikt NEU
 * dazukommt. Er merkt NICHT, wenn zwei Erkennungsmerkmale einander in die Quere
 * kommen und eine Meldung auf dem falschen Satz landet. „Illegal transition"
 * und „Illegal eBay transition", „already OPEN" bei Schicht und bei Inventur,
 * „already CLOSED" bei Schicht und bei Inventur liegen alle dicht beieinander,
 * und die Tabelle wird der Reihe nach durchsucht — der erste Treffer gewinnt.
 * Ein falscher Satz wäre schlimmer als ein blasser: er schickt den Tresen auf
 * eine Fährte, die es nicht gibt.
 */
describe("Wächter · dicht beieinander liegende Meldungen landen auf dem RICHTIGEN Satz", () => {
  const paare: ReadonlyArray<readonly [string, string]> = [
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
    ["Illegal transition OPEN → DONE", "Dieser Schritt ist nicht mehr möglich"],
    ["A shift is already OPEN on this device.", "Auf diesem Gerät ist bereits eine Schicht geöffnet"],
    ["An inventory session is already OPEN.", "Es läuft bereits eine Inventur"],
    ["Shift is already CLOSED.", "Diese Schicht wurde bereits abgeschlossen"],
    ["Session is already CLOSED.", "Diese Inventur wurde bereits abgeschlossen"],
    ["Inventory session is CLOSED.", "Diese Inventur ist abgeschlossen"],
    ["Product 7 is already archived.", "Dieser Artikel ist bereits archiviert."],
    [
      "Produkt W14-0042 ist bereits archiviert und kann nicht gelöscht werden.",
      "lässt sich nicht mehr löschen",
    ],
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
    ["Der Tagesabschluss für 2026-07-25 besteht bereits.", "besteht bereits"],
    [
      "Der Tagesabschluss für 2026-07-25 ist noch nicht finalisiert und kann nicht als DATEV exportiert werden.",
      "erst nach dem Z-Bon",
    ],
    ["Transaction 12 has already been stornoed (storno id: 44).", "bereits storniert"],
    ["Voucher status is REDEEMED; cannot redeem.", "Gutschein lässt sich nicht einlösen"],
    ["Voucher has expired.", "Gutschein ist abgelaufen"],
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
    // 14.08.2026: Fall fiel mit der Trennung von warehouse14 (Kanal geloescht).
  ]

  it.each(paare)("%s", (message, erwartet) => {
    expect(describeError(conflict(message))).toContain(erwartet)
  })

  /** Kein deutscher Satz darf einen rohen Zustands-Grossbuchstabentoken tragen. */
  it("keine Antwort trägt einen rohen Maschinentoken weiter", () => {
    for (const [message] of paare) {
      const line = describeError(conflict(message))
      expect(line).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/)
      expect(line).not.toContain("shipping_status")
      expect(line).not.toContain("trust_level")
    }
  })
})

describe("Wächter · ein unbekannter Code darf nie undefined auf den Schirm lassen", () => {
  /**
   * DER FUND (26.07.2026): der Servercode kommt ungeprüft vom Draht
   * (`code: e?.code ?? mapHttpStatus(...)` im api-client). Er ist als
   * `ApiErrorCode` GETYPT, aber zur Laufzeit ist es die Zeichenkette, die der
   * Server geschickt hat. Bekam der Server einen Code, den die abgeschriebene
   * Liste im api-client noch nicht kannte, schlug der Nachschlagesatz ins Leere
   * und `describeError` gab `undefined` zurück obwohl sie `string` verspricht.
   * An drei Stellen der Kasse wird das Ergebnis in einen Satz eingesetzt, dort
   * stand dann wörtlich „Eingabe ungültig. undefined" am Tresen.
   */
  it("liefert auch für einen Code, den es hier nicht gibt, einen deutschen Satz", () => {
    const line = describeError(
      new ApiError({ code: "TSE_UNAVAILABLE" as never, message: "TSE offline", requestId: "t", status: 503 }),
    )
    expect(line).toBeTypeOf("string")
    expect(line).not.toContain("undefined")
    expect(line).not.toContain("TSE_UNAVAILABLE")
    expect(line).not.toContain("TSE offline")
  })

  it("setzt sich auch in einen Satz eingesetzt sauber zusammen", () => {
    const line = describeError(
      new ApiError({ code: "SOMETHING_NEW" as never, message: "boom", requestId: "t", status: 500 }),
    )
    expect(`Vorgang fehlgeschlagen. ${line}`).not.toContain("undefined")
  })
})

/**
 * DER WÄCHTER ÜBER DIE ERKENNUNGSMERKMALE SELBST.
 *
 * `server-errors.guard.test.ts` geht die eine Richtung: jede Meldung, die der
 * Server werfen kann, muss hier einen deutschen Satz finden. Diese Prüfung geht
 * die ANDERE Richtung, und die ist genauso wichtig:
 *
 *   1. Jedes Erkennungsmerkmal in `CONFLICT_TOKENS` kommt im Quelltext des
 *      Servers WÖRTLICH vor.
 *   2. Jedes Erkennungsmerkmal ist erreichbar, wird also nicht von einem
 *      früheren, breiteren vollständig verdeckt.
 *
 * ── WARUM DAS EINE EIGENE PRÜFUNG BRAUCHT ──────────────────────────────────
 *
 * Ein Eintrag, der nie trifft, sieht aus wie erledigte Arbeit. Er steht in der
 * Tabelle, er liest sich gut, und am Tresen erscheint trotzdem der Sammelsatz.
 * Das kann auf zwei Wegen passieren, und beide sind still:
 *
 *   • EIN GEIST. Das Merkmal ist vertippt, oder es greift über eine eingesetzte
 *     Grösse hinweg (`Produkt ${sku} ist archiviert`), oder der Server hat seinen
 *     Wortlaut geändert. Genau das war am 04.08.2026 bei „kein Kassensturz"
 *     passiert: der Server sagt längst „keine geschlossene Schicht deckt diesen
 *     Tag ab", das alte Merkmal traf ins Leere, und der Riegel war blass. Punkt 1
 *     fängt alle drei Fälle mit derselben Messung: was im Serverquelltext nicht
 *     wörtlich steht, kann in einer Servermeldung nicht vorkommen.
 *
 *   • EIN SCHATTEN. Die Tabelle wird der Reihe nach durchsucht, der erste
 *     Treffer gewinnt. Ein breites Merkmal weiter oben schluckt damit jedes
 *     engere weiter unten, das es enthält. Der Satz unten wird nie gelesen, und
 *     nichts wird rot. Punkt 2 misst das, indem er jedes Merkmal selbst als
 *     Meldung durch `describeError` schickt und prüft, wer gewinnt.
 *
 * ── WARUM KEINE GETIPPTE LISTE ─────────────────────────────────────────────
 *
 * Beide Prüfungen sammeln ein: die Merkmale aus der ECHTEN Tabelle (darum ist
 * sie exportiert), die Vergleichsmenge aus dem ECHTEN Quelltext. Eine hier
 * abgeschriebene Liste würde genau dann grün bleiben, wenn jemand einen Eintrag
 * hinzufügt oder der Server seinen Wortlaut ändert — also in dem einzigen
 * Moment, auf den es ankommt.
 */
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { ApiError } from "@norns/api-client"

import { CONFLICT_TOKENS, describeError } from "./german-text"

const HERE = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HERE, "..", "..", "..")

/**
 * Wo ein 409-Text herkommen kann: die Routen und Bibliotheken des Servers, und
 * die Wanderungen samt Schema — die Datenbank wirft ihre eigenen Meldungen
 * (Sperrnamen, RAISE-Texte), und die stehen nur dort.
 */
const QUELLORTE = [join(WURZEL, "apps", "api-cloud", "src"), join(WURZEL, "packages", "db")]

/** Dateiendungen, in denen ein Meldungstext stehen kann. */
const LESBAR = /\.(ts|sql|mjs)$/

/**
 * Der gesamte Serverquelltext als ein Text.
 *
 * Fehlt eine Quelle, sagt der Wächter das laut, statt sich still zu
 * überspringen. Ein Wächter, der stumm aussetzt, ist schlimmer als gar keiner:
 * er meldet grün, wo niemand hingesehen hat.
 */
function serverQuelltext(): string {
  let alles = ""
  const laufe = (verzeichnis: string): void => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      if (eintrag.name === "node_modules" || eintrag.name === "dist") continue
      const voll = join(verzeichnis, eintrag.name)
      if (eintrag.isDirectory()) laufe(voll)
      else if (LESBAR.test(eintrag.name)) alles += readFileSync(voll, "utf8")
    }
  }
  for (const ort of QUELLORTE) laufe(ort)
  return alles
}

const konflikt = (message: string): ApiError =>
  new ApiError({ code: "CONFLICT", message, requestId: "test", status: 409 })

// ════════════════════════════════════════════════════════════════════════════

describe("Wächter · kein Erkennungsmerkmal ist ein Geist", () => {
  const quelltext = serverQuelltext()

  it("findet den Serverquelltext überhaupt", () => {
    expect(quelltext.length).toBeGreaterThan(100_000)
    expect(CONFLICT_TOKENS.length).toBeGreaterThan(30)
  })

  /**
   * Der Kern. Ein Merkmal, das im Quelltext nicht vorkommt, kann in keiner
   * Servermeldung vorkommen — sein deutscher Satz ist damit unerreichbar.
   *
   * Das deckt gleich mit ab, dass kein Merkmal über eine eingesetzte Grösse
   * hinweggreift: `Produkt ${sku} ist archiviert` steht im Quelltext mit der
   * Schablone darin, ein Merkmal quer darüber steht darum nirgends wörtlich.
   */
  it("jedes Merkmal steht wörtlich im Serverquelltext", () => {
    const geister = CONFLICT_TOKENS.filter(({ token }) => !quelltext.includes(token)).map(
      ({ token }) => token,
    )
    expect(
      geister,
      "Diese Erkennungsmerkmale kommen im Serverquelltext nicht vor. Sie treffen nie, ihr deutscher Satz wird nie gelesen, und am Tresen erscheint der Sammelsatz.",
    ).toEqual([])
  })
})

describe("Wächter · kein Erkennungsmerkmal wird verdeckt", () => {
  /**
   * Jedes Merkmal, als Meldung eingesetzt, muss SEINEN eigenen Satz bekommen.
   * Gewinnt ein anderer, hat ein früheres, breiteres Merkmal es geschluckt: der
   * Satz weiter unten ist dann tot, und der Tresen liest eine Auskunft, die zu
   * einem anderen Vorgang gehört. Ein falscher Satz ist schlimmer als ein
   * blasser, weil er auf eine Fährte schickt, die es nicht gibt.
   */
  it.each(CONFLICT_TOKENS.map((e) => [e.token, e.line] as const))(
    "%s · gewinnt gegen jedes frühere Merkmal",
    (token, line) => {
      expect(
        describeError(konflikt(token)),
        `Das Merkmal „${token}" wird von einem früheren, breiteren verdeckt. Sein Satz ist tot.`,
      ).toBe(line)
    },
  )

  /** Zweimal dasselbe Merkmal hiesse: der zweite Satz ist von vornherein tot. */
  it("kein Merkmal steht doppelt in der Tabelle", () => {
    const gesehen = new Set<string>()
    const doppelt: string[] = []
    for (const { token } of CONFLICT_TOKENS) {
      if (gesehen.has(token)) doppelt.push(token)
      gesehen.add(token)
    }
    expect(doppelt, "Diese Merkmale stehen mehrfach in der Tabelle").toEqual([])
  })

  /**
   * Kein deutscher Satz darf einen rohen Maschinentoken oder ein Stück der
   * Schablone weitertragen. Der Platzhalter, mit dem der andere Wächter
   * eingesetzte Grössen ersetzt, hat in einer gelesenen Zeile nichts zu suchen.
   */
  it("keine Zeile trägt einen Maschinentoken oder eine Schablonenlücke", () => {
    for (const { token, line } of CONFLICT_TOKENS) {
      expect(line, `Zeile zu „${token}"`).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/)
      expect(line, `Zeile zu „${token}"`).not.toContain("${")
      expect(line.length, `Zeile zu „${token}" ist zu knapp, um zu helfen`).toBeGreaterThan(20)
    }
  })
})

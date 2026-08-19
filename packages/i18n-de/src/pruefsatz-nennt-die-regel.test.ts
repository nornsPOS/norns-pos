/**
 * Der Satz, den der Tresen bei einer abgewiesenen Eingabe liest, muss die
 * REGEL nennen, nicht nur das Feld.
 *
 * ── DER FALL ───────────────────────────────────────────────────────────────
 *
 * Basel, 05.08.2026: „ماقدر اضيف منتج يطلعلي خطا ومدري ايش" — ich kann kein
 * Produkt anlegen, es kommt ein Fehler und ich weiss nicht, welcher.
 *
 * Er hatte das Gewicht einer Feinunze eingetippt, 31,103 g, und bekam
 * „Gewicht ungültig bitte prüfen". Vor ihm lag ein völlig richtiges Gewicht.
 * Der Satz war ehrlich — er log nicht, er nannte sogar das richtige Feld —
 * und trotzdem war er eine Sackgasse: er verschwieg, WAS erlaubt gewesen
 * wäre. Wer die Bedingung nicht kennt, kann nichts korrigieren.
 *
 * Die Ursache (die Prüfung sass auf der Geldregel mit zwei Nachkommastellen)
 * ist behoben. Dieser Test hält die zweite Hälfte fest: dass ein Mensch aus
 * dem Satz allein weiterarbeiten kann.
 *
 * ⚠️ Die Fehlerbeschreibungen hier sind KEINE erfundenen Attrappen. Sie
 * stammen aus der Form, die ajv wirklich liefert — `keyword` und `params` —
 * und wurden am 05.08.2026 gegen den laufenden Motor gemessen:
 *
 *   {"code":"VALIDATION_ERROR",
 *    "message":"body/weightGrams must match pattern \"^\\d{1,16}(\\.\\d{1,2})?$\"",
 *    "details":[{"instancePath":"/weightGrams","keyword":"pattern",
 *                "params":{"pattern":"^\\d{1,16}(\\.\\d{1,2})?$"}}]}
 */

import { ApiError } from "@norns/api-client"
import { describe, expect, it } from "vitest"

import { describeError } from "./german-text"

/** Baut den Fehler so, wie der Server ihn wirklich schickt. */
function abweisung(
  feld: string,
  keyword: string,
  params: Record<string, unknown>,
): ApiError {
  return new ApiError({
    code: "VALIDATION_ERROR",
    message: `body/${feld} must match pattern`,
    httpStatus: 400,
    details: [{ instancePath: `/${feld}`, keyword, params }],
  })
}

describe("Der abgewiesene Wert sagt, was erlaubt gewesen wäre", () => {
  it("nennt bei einem Zahlenmuster die Nachkommastellen", () => {
    const satz = describeError(
      abweisung("weightGrams", "pattern", { pattern: "^\\d{1,6}(\\.\\d{1,4})?$" }),
    )
    expect(satz).toContain("Gewicht")
    expect(satz).toContain("4 Nachkommastellen")
  })

  it("sagt Einzahl, wenn nur eine Stelle erlaubt ist", () => {
    const satz = describeError(
      abweisung("weightGrams", "pattern", { pattern: "^\\d{1,6}(\\.\\d)?$" }),
    )
    expect(satz).toContain("eine Nachkommastelle")
    expect(satz).not.toContain("Nachkommastellen")
  })

  it("nennt bei einer Mindestlänge die Zahl", () => {
    expect(describeError(abweisung("phone", "minLength", { limit: 6 }))).toContain(
      "mindestens 6 Zeichen",
    )
  })

  it("nennt bei einer Höchstlänge die Zahl", () => {
    expect(describeError(abweisung("notes", "maxLength", { limit: 8192 }))).toContain(
      "höchstens 8192 Zeichen",
    )
  })

  it("bleibt beim ruhigen Satz, wenn die Regel sich nicht übersetzen lässt", () => {
    const satz = describeError(abweisung("dateOfBirth", "format", { format: "date" }))
    expect(satz).toBe("Geburtsdatum ungültig bitte prüfen.")
  })

  it("verrät NIE das englische Muster selbst", () => {
    const satz = describeError(
      abweisung("weightGrams", "pattern", { pattern: "^\\d{1,6}(\\.\\d{1,4})?$" }),
    )
    expect(satz).not.toContain("\\d")
    expect(satz).not.toContain("pattern")
    expect(satz).not.toContain("must match")
  })
})

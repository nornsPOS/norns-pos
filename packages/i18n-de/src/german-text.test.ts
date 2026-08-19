import { describe, expect, it } from "vitest"

import { TASK_PRIORITY_LABEL, describeError, germanLabel } from "./german-text"

describe("germanLabel — never leaks a raw token", () => {
  const registry = { HIGH: "Hoch", LOW: "Niedrig" } as const

  it("returns the German label for a known value", () => {
    expect(germanLabel(registry, "HIGH")).toBe("Hoch")
  })

  it("degrades an unknown value to Unbekannt, never the raw token", () => {
    const out = germanLabel(registry, "SOME_NEW_BACKEND_ENUM")
    expect(out).toBe("Unbekannt")
    expect(out).not.toContain("SOME_NEW_BACKEND_ENUM")
  })

  it("respects a custom fallback", () => {
    expect(germanLabel(registry, "NOPE", "—")).toBe("—")
  })

  it("degrades an unknown priority to Unbekannt against the real registry", () => {
    expect(germanLabel(TASK_PRIORITY_LABEL, "SUPER_URGENT")).toBe("Unbekannt")
  })
})

describe("describeError — never echoes a raw English message", () => {
  it("maps an unclassifiable error to a calm German line", () => {
    const out = describeError(new Error("kaboom: null pointer at 0xdead"))
    expect(out).toBe("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.")
    expect(out).not.toContain("kaboom")
  })
})

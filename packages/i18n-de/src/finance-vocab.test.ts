import { describe, expect, it } from "vitest"

import { centsToDecimalString, expenseCategoryLabel, formatCents, profitSteps } from "./finance-vocab"

describe("formatCents", () => {
  it("renders whole cents as a German euro amount", () => {
    expect(formatCents(123456)).toBe("1.234,56 €")
    expect(formatCents(0)).toBe("0,00 €")
    expect(formatCents(5)).toBe("0,05 €")
  })

  it("keeps the sign of a negative amount", () => {
    expect(formatCents(-999)).toBe("-9,99 €")
  })

  it("never throws on a non-finite input", () => {
    expect(formatCents(Number.NaN)).toBe("0,00 €")
  })
})

describe("centsToDecimalString", () => {
  it("produces the wire format MoneyAmount expects", () => {
    expect(centsToDecimalString(123456)).toBe("1234.56")
    expect(centsToDecimalString(-5)).toBe("-0.05")
  })
})

describe("expenseCategoryLabel", () => {
  it("translates every known category", () => {
    expect(expenseCategoryLabel("WARENEINKAUF")).toBe("Wareneinkauf")
    expect(expenseCategoryLabel("BUEROMATERIAL")).toBe("Büromaterial")
  })

  it("never leaks an unknown raw token", () => {
    expect(expenseCategoryLabel("SOMETHING_NEW")).toBe("Sonstiges")
  })
})

describe("profitSteps", () => {
  const p = {
    grossRevenueCents: 100_000,
    grossAnkaufCents: 30_000,
    expensesCents: 10_000,
    fixedCostsAllocatedCents: 5_000,
    netProfitCents: 55_000,
  }

  it("shows deductions as negative and the result last", () => {
    const steps = profitSteps(p)
    expect(steps.map((s) => s.cents)).toEqual([100_000, -30_000, -10_000, -5_000, 55_000])
    expect(steps.at(-1)?.isResult).toBe(true)
  })

  it("reports the server's net verbatim rather than recomputing it", () => {
    // A server that disagrees with naive arithmetic still wins: we display its number.
    const skewed = { ...p, netProfitCents: 1 }
    expect(profitSteps(skewed).at(-1)?.cents).toBe(1)
  })
})

import { closingsTrend } from "./finance-vocab"

describe("closingsTrend", () => {
  const day = (businessDay: string, v: string, a: string, state: "COUNTING" | "FINALIZED" = "FINALIZED") =>
    ({ businessDay, state, netVerkaufEur: v, netAnkaufEur: a })

  it("keeps only finalized days, oldest first", () => {
    const rows = [
      day("2026-07-03", "300", "100"),
      day("2026-07-01", "100", "40"),
      day("2026-07-04", "0", "0", "COUNTING"),
      day("2026-07-02", "200", "50"),
    ]
    const trend = closingsTrend(rows)
    expect(trend.map((t) => t.businessDay)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"])
  })

  it("computes the daily flow as verkauf minus ankauf", () => {
    const trend = closingsTrend([day("2026-07-01", "300", "120")])
    expect(trend[0]).toMatchObject({ verkauf: 300, ankauf: 120, fluss: 180 })
  })

  it("windows to the last N finalized days", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, "0")}`, "10", "5"),
    )
    expect(closingsTrend(rows, 5)).toHaveLength(5)
    expect(closingsTrend(rows, 5)[0]?.businessDay).toBe("2026-07-16")
  })

  it("reads machine format and German display format, and never throws on junk", () => {
    // Server machine format (dot decimal, no thousands separator).
    expect(closingsTrend([day("2026-07-01", "1234.50", "0")])[0]?.verkauf).toBeCloseTo(1234.5, 2)
    // German display format (dot thousands, comma decimal).
    expect(closingsTrend([day("2026-07-02", "1.234,50", "not-a-number")])[0]).toMatchObject({
      verkauf: 1234.5,
      ankauf: 0,
    })
  })
})

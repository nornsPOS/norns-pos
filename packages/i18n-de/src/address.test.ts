import { describe, expect, it } from "vitest"

import { formatCustomerAddress } from "./address"

describe("formatCustomerAddress", () => {
  it("folds a structured JSON address into a German one-liner", () => {
    const raw = JSON.stringify({
      street: "Bahnhofstraße 31",
      postalCode: "79576",
      city: "Weil am Rhein",
      country: "DE",
    })
    expect(formatCustomerAddress(raw)).toBe("Bahnhofstraße 31, 79576 Weil am Rhein, Deutschland")
  })

  it("keeps an unknown country code rather than inventing a name", () => {
    const raw = JSON.stringify({ street: "Rue 1", city: "Dakar", country: "SN" })
    expect(formatCustomerAddress(raw)).toBe("Rue 1, Dakar, SN")
  })

  it("returns a plain string untouched", () => {
    expect(formatCustomerAddress("  Hauptstraße 4  ")).toBe("Hauptstraße 4")
  })

  it("never leaks a raw JSON blob when the object carries no usable field", () => {
    expect(formatCustomerAddress('{"foo":"bar"}')).toBeNull()
  })

  it("falls back to the literal text when the braces are not valid JSON", () => {
    expect(formatCustomerAddress("{nicht wirklich JSON}")).toBe("{nicht wirklich JSON}")
  })

  it("treats empty, blank and nullish input as no address", () => {
    expect(formatCustomerAddress(null)).toBeNull()
    expect(formatCustomerAddress(undefined)).toBeNull()
    expect(formatCustomerAddress("   ")).toBeNull()
  })

  it("omits missing parts instead of leaving empty separators", () => {
    expect(formatCustomerAddress(JSON.stringify({ city: "Berlin" }))).toBe("Berlin")
    expect(formatCustomerAddress(JSON.stringify({ postalCode: "10115", city: "Berlin" }))).toBe(
      "10115 Berlin",
    )
  })
})

/**
 * Kundenadresse — die Anschrift lesbar machen.
 *
 * Das Feld `customers.address` trägt entweder eine schlichte Zeile („Bahnhof-
 * straße 31, 79576 Weil am Rhein") oder ein strukturiertes JSON-Objekt mit
 * englischen Schlüsseln. Ungefiltert landet dieses Objekt als `{"street":…}`
 * vor dem Kassierer. Dieses Modul faltet es in eine deutsche Zeile.
 *
 * Rein und total: wirft nie, liefert null nur bei wirklich leerer Eingabe.
 * Framework-frei, damit Telefon und Kasse dieselbe Anschrift zeigen.
 */

/** ISO-3166 alpha-2 → deutscher Landesname, für die Länder, die wirklich vorkommen. */
const COUNTRY_DE: Readonly<Record<string, string>> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  FR: "Frankreich",
  NL: "Niederlande",
  BE: "Belgien",
  LU: "Luxemburg",
  IT: "Italien",
  ES: "Spanien",
  PL: "Polen",
}

/** Die Form, die ein strukturierter Adress-Block annehmen kann (alles optional). */
type StructuredAddress = {
  street?: unknown
  postalCode?: unknown
  city?: unknown
  country?: unknown
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Faltet ein strukturiertes Adress-Objekt zu einer sauberen deutschen Zeile:
 * „Bahnhofstraße 31, 79576 Weil am Rhein, Deutschland". Das Land steht deutsch
 * (DE wird Deutschland); ein unbekannter Code bleibt roh stehen (immer noch kein
 * englischer Schlüssel). Null, wenn das Objekt kein brauchbares Feld trägt.
 */
function joinStructuredAddress(obj: StructuredAddress): string | null {
  const street = asTrimmed(obj.street)
  const postalCode = asTrimmed(obj.postalCode)
  const city = asTrimmed(obj.city)
  const countryRaw = asTrimmed(obj.country)
  const country = countryRaw ? (COUNTRY_DE[countryRaw.toUpperCase()] ?? countryRaw) : null

  const cityLine = [postalCode, city].filter(Boolean).join(" ")
  const parts = [street, cityLine || null, country].filter(
    (p): p is string => p != null && p.length > 0,
  )
  return parts.length > 0 ? parts.join(", ") : null
}

/**
 * Die Anschrift eines Kunden zur Anzeige. Erkennt und faltet eine strukturierte
 * JSON-Adresse in eine deutsche Zeile, sonst die getrimmte Klartextzeile.
 * `null` bei leerer Eingabe: der Aufrufer entscheidet über den Platzhalter.
 */
export function formatCustomerAddress(address: string | null | undefined): string | null {
  const trimmed = asTrimmed(address)
  if (trimmed == null) return null
  // Nur bei einem echten Objekt-Literal parsen. Eine normale Straßenzeile zahlt
  // so nie den try/catch.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const folded = joinStructuredAddress(parsed as StructuredAddress)
        // Ein JSON-Objekt ohne brauchbares Feld zeigt nichts, statt den rohen
        // Block mit englischen Schlüsseln zu leaken.
        return folded
      }
    } catch {
      // Doch kein gültiges JSON. Die literale Zeile ist die Wahrheit.
    }
  }
  return trimmed
}

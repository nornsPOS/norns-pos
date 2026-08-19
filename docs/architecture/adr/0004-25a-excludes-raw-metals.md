# ADR-0004 — §25a UStG Differenzbesteuerung excludes raw precious metals

- **Status:** Accepted (compliance fact, not a design choice)
- **Date:** 2026-05-23
- **Deciders:** Compliance with German tax law; Technik documented, Basel acknowledged

## Context

Margin taxation (Differenzbesteuerung) per §25a UStG is a key value proposition for a second-hand goods dealer: VAT is computed only on the **margin** (sell price − buy price) rather than on the full sell price. This is what makes antique and used-goods businesses economically viable in Germany.

When Basel initially specified the project, the brief read:

> "Margin Tax (§25a UStG): Automatically calculate VAT only on the profit margin for second-hand goods."

This phrasing implies the §25a treatment applies uniformly. **It does not.** Raw precious metals are explicitly excluded from §25a.

## Decision

Encode the §25a exclusion **at the type level** in the products schema.

Every product has a `tax_treatment` enum:

```
MARGIN_25A           → antiques, collector coins, worked jewelry
INVESTMENT_GOLD_25C  → investment-grade bullion (VAT exempt)
STANDARD_19          → scrap metal for melting, industrial silver
REDUCED_7            → rare reduced-rate items
```

### Rules

1. The Cashier role **MUST NOT** be able to mutate `tax_treatment` after product creation. Admin-only.
2. The Domain layer (`packages/domain/tax`) is the single source of margin-vs-standard logic. UI never computes VAT directly.
3. Audit log records the `tax_treatment` at the time of sale, not "current" — historical accuracy matters for tax audits.
4. Each treatment has its own receipt printing footer (margin sales must include the literal phrase "Gebrauchtgegenstand / Differenzbesteuerung nach § 25a UStG").

## Source

BMF Amtliche Umsatzsteuer-Handausgabe 2024, §25a.1, paragraph 1, sentences 3–6:

> Edelsteine und Edelmetalle sind nach § 25a Abs. 1 Nr. 3 UStG von der Differenzbesteuerung ausgenommen.
> Edelmetalle im Sinne der Vorschrift sind Silber (aus Positionen 7106 und 7112 Zolltarif), Gold (aus Positionen 7108 und 7112 Zolltarif) und Platin einschließlich Iridium, Osmium ...

URL: <https://esth.bundesfinanzministerium.de/usth/2024/A-Umsatzsteuergesetz/VI-Sonderregelungen/Paragraf-25a/ae-25a-1.html>

## Consequences

**Positive:**
- The schema makes incorrect tax treatment a type error, not a runtime bug
- A junior cashier cannot accidentally apply margin tax to a bullion sale
- Audit defense is strong: every sale's tax treatment is timestamped and reproducible

**Negative:**
- Onboarding new products requires categorisation discipline
- Edge cases (e.g. a numismatic coin partially struck from investment-grade metal) need human review

**Mitigations:**
- Admin UI presents `tax_treatment` selection alongside a short rule guide
- Steuerberater (tax advisor) confirms classification at first onboarding
- Quarterly compliance review documented in `docs/compliance/`

## References

- BMF link above
- See `memory.md` §3 for the compliance summary
- See `packages/domain/src/money/money.test.ts` for the working "§25a margin" test

# ADR-0007 — GwG Ankauf policy stricter than the statutory threshold

- **Status:** Accepted (operational policy, not a design choice — encoded in the schema)
- **Date:** 2026-05-23
- **Deciders:** Basel (shop policy), Technik (technical encoding)

## Context

The Geldwäschegesetz (GwG) sets a **€2,000 threshold** above which dealers in precious metals and similar high-value goods must record customer identity for cash transactions. Below the threshold, anonymous purchases (*Tafelgeschäft*) are legally permissible.

Warehouse14 operates in **Schorndorf, Germany (73614)**. Two structural risks follow:

1. **§259 StGB (Hehlerei / receiving stolen goods):** If Warehouse14 accepts gold or coins that turn out to be stolen, the shop's own legal exposure depends substantially on the documentation trail. Anonymous accepts above any value — even at €100 — leave the shop unable to prove good faith.
2. **Structuring / Smurfing:** Customers can deliberately keep transactions just under €2,000 to evade ID requirements. Detection middleware is mandatory (siehe das interne Arbeitsheft, §3).

The statutory minimum is not sufficient for this shop's risk profile.

## Decision

We encode an **asymmetric, stricter-than-statutory GwG policy** in the schema and in the cashier flow:

### Direction matrix

| Direction          | Operation                  | Statutory ID requirement | **Warehouse14 policy**  |
|--------------------|----------------------------|--------------------------|-------------------------|
| **Ankauf** (we buy from customer) | Cash buy of any item       | ≥ €2,000 → ID required   | **ID ALWAYS** — every Euro from €0.01 |
| **Verkauf** (we sell to customer) | Tafelgeschäft (anonymous sale) | < €2,000 anonymous OK | Follow statute: ≥ €2,000 → ID, below = anonymous OK |

### Why asymmetric

- **Ankauf** is where §259 StGB risk materialises. Without ID, we cannot defend ourselves if the goods are later proven stolen. The cost of the extra ID check is low; the cost of an Hehlerei accusation is catastrophic.
- **Verkauf** carries no comparable risk to us. We follow the law (the customer's anonymity is not our problem unless we know or suspect illicit origin).

### Schema encoding

The `transactions` table has a `direction` column:

```
direction ENUM ('ANKAUF', 'VERKAUF')
```

Application-layer policy (enforced in the domain service, not in the UI):

```
fn requireKyc(direction: Direction, amount: Money): boolean {
  if (direction === 'ANKAUF') return amount.greaterThan(Money.zero());  // any positive amount
  if (direction === 'VERKAUF') return amount.greaterThanOrEqual(Money.of('2000.00'));
}
```

The Cashier UI **must** block submission of any `ANKAUF` transaction without a linked `customer_kyc_id`. There is no override path for the Cashier role — only the Admin can lift the block on a per-transaction basis (with reason text written to audit log).

### KYC V1 spec

For Phase 1, KYC capture is **manual data entry assisted by AI vision OCR**:

1. Cashier asks for the customer's ID (Personalausweis, Reisepass, or EU national ID card)
2. Cashier captures a photo via the Tauri camera plugin
3. **Automatische Bilderkennung** (nie gebaut; die Kasse liest die MRZ lokal) suggests the fields: name, address, DOB, ID type, ID number, expiry date
4. Cashier reviews and confirms — **never auto-submit**
5. Photo + structured fields encrypted-at-rest, retained per GDPR data-minimisation (5 years then auto-purge unless the related transaction's GoBD retention is longer)

### Smurfing detection middleware

Cross-border traffic makes structuring attacks realistic. Middleware on the transaction path watches for:

- Same customer, multiple transactions same day approaching €2,000 aggregate
- Multiple customers within a short time window with sequential or similar ID patterns
- Cross-store patterns when multi-shop is reached (Phase 2+)

**Precise rule thresholds remain open** — Steuerberater consultation needed before go-live (vermerkt im internen Arbeitsheft, §7).

## Consequences

**Positive:**
- §259 StGB defense is structurally strong: every gold gram bought has a documented seller
- The store policy is clearly more rigorous than the law — a positive signal to banks (correspondent banking, cash handling) and to insurers (theft policies)
- Cashier flow has no ambiguity for Ankauf — the form simply refuses to submit without KYC

**Negative:**
- Tiny Ankauf transactions (e.g. someone selling a single €5 coin) require full ID capture. Customer friction.
- KYC photos accumulate quickly — storage and retention discipline matter
- Eine externe Bilderkennung haette eine Netzabhaengigkeit auf dem heissen Ankaufweg bedeutet; gebaut wurde stattdessen die lokale MRZ-Lesung (kein Netz noetig)

**Mitigations:**
- Cashier training material explains the "why" — they can articulate to customers that it's shop policy
- Storage budget: ~50KB per ID photo × estimated 30 Ankauf/day × 365 = ~550MB/year. Negligible on R2.
- OCR is *assistive*, not *blocking*: cashier can type fields without the AI suggestion

## Alternatives considered

- **Follow statute exactly (€2,000 threshold both ways):** rejected — leaves the shop exposed to Hehlerei accusations for any sub-€2,000 stolen gold purchase
- **ID for everything both ways:** rejected — Verkauf customers have no obligation to identify themselves below €2,000, asking violates expectations
- **Threshold lower than €2,000 but non-zero (e.g. €100):** considered. The €0.01 threshold is operationally simpler (one rule, no edge cases) and the cost difference is small

## References

- GwG (Geldwäschegesetz) §§ 10 ff. — identification obligations
- §259 StGB — Hehlerei
- BaFin guidance for Güterhändler (goods dealers): <https://www.bafin.de>
- das interne Arbeitsheft, §3 — full compliance summary

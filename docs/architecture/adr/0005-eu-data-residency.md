# ADR-0005 — EU data residency on Hetzner Cloud (Germany)

- **Status:** ⚠️ **Superseded in part by ADR-0012 (Oracle Cloud Frankfurt)** — the EU-residency principle and the Cloudflare R2 / AWS S3 Glacier choices remain valid. The Hetzner provider choice is replaced by Basel's Oracle Cloud server in Frankfurt.
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik

## Context

GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form) requires tax-relevant records be **accessible to German tax authorities** for the legal retention period (10 years for invoices, 6 years for some other records).

Cross-border data hosting raises three problems:
1. **GDPR Article 44** — third-country transfers require legal basis (SCCs, adequacy decisions)
2. **GoBD §146 Abs. 2 AO** — electronic books may be kept abroad only with prior application and approval from the Finanzamt
3. **Practical audit access** — German auditors expect to access records without legal intermediation

Additionally, Warehouse14 has cost constraints (single-shop unit economics) and a strong preference for direct infrastructure ownership (audit defense, no vendor lock-in on fiscal data).

## Decision

**Hetzner Cloud (Germany)** is the primary infrastructure provider for Warehouse14.
*(See ADR-0012 — this provider choice has since been superseded by Basel-owned Oracle Cloud in Frankfurt. The EU-residency reasoning below still applies to the new provider.)*

### Provider mapping

| Service                | Provider                          | Region                       | Why |
|------------------------|-----------------------------------|------------------------------|-----|
| API hosting            | **Hetzner Cloud** (CX/CPX VMs)    | Falkenstein or Nuremberg, DE | EU, cost-effective, direct control |
| PostgreSQL 17          | **Hetzner Cloud** (self-managed or Hetzner Managed PG when available) | DE | Same datacenter as API → < 1ms latency |
| Redis                  | **Hetzner Cloud** (self-managed)  | DE                           | Same DC                            |
| Hot media (CDN)        | **Cloudflare R2**                 | EU jurisdiction              | Zero-egress, GDPR-friendly         |
| Legal archive (10yr)   | **AWS S3 Glacier Deep Archive**   | `eu-central-1` Frankfurt     | Cheapest compliant cold storage    |
| CDN edge               | **Cloudflare**                    | Global (no PII)              | Static assets only                 |
| TSE                    | **Fiskaly Cloud SIGN DE**         | DE                           | Mandatory, EU-domiciled            |
| Email transactional    | Postmark EU / Brevo DE            | EU                           | GDPR-aligned providers             |

### Why Hetzner over managed Postgres providers (Neon, Supabase, RDS)

- **Cost:** Hetzner CX22 + self-managed PG ≈ €5–10/mo. Neon EU Pro ≈ €69+/mo for comparable resources.
- **Audit transparency:** we own the OS image, we own the backup schedule, we own the disk encryption keys. A Finanzamt auditor cannot be told "the database is managed by a US-owned company" — even if that company has EU regions.
- **No CLOUD Act exposure:** Hetzner is German-owned (since 1997). No US legal-process risk on customer data.
- **Operational burden is bounded:** PG 17 self-managed on one VM with WAL-G to S3 Glacier for backups is well-documented and stable. We're not running a fleet.

### Forbidden

- AWS / GCP / Azure regions outside EU
- US-only SaaS (Vercel Functions without EU pinning, etc.)
- Auth0, Clerk hosted in US — drove the better-auth (self-hosted) decision in ADR-0006

### Frontend exceptions

- POS desktop installer (Tauri builds) — may be served from any global CDN. No personal data; safe.
- Storefront static assets — Cloudflare edge cache is fine. SSR/ISR origin remains in Hetzner DE.

## Consequences

**Positive:**
- GDPR Article 44 issue vanishes for the hosted-data path
- GoBD §146 application either unnecessary (all data in DE) or trivially approved
- Cost scales linearly and predictably; no per-million-row pricing surprises
- We can hand a Finanzamt auditor a German contact in our supplier chain

**Negative:**
- We carry the ops burden of self-managed PG (patching, backups, WAL archiving)
- Hetzner's managed services are less polished than Neon/Supabase — fewer dashboards, fewer click-ops
- High-availability across availability zones requires Terraform discipline (Phase 2+)

**Mitigations:**
- `infrastructure/terraform/` will codify Hetzner provisioning in Phase 2
- WAL-G with S3 Glacier targets gives off-site backup + 10-year archive in one pipeline
- Monitoring via self-hosted Grafana + Loki on the same Hetzner node initially
- Move to Hetzner Dedicated Servers later if PG load demands it (still EU, still controlled)

## Alternatives considered

- **Neon EU:** managed PG, branch-per-PR, generous free tier. Rejected on cost at scale and on "US company operating in EU" footprint.
- **Supabase EU:** managed PG + auth + storage. Powerful but rejected for the same reason (Supabase Inc is US-domiciled) and because we already chose better-auth + R2 separately.
- **AWS EU bare** (RDS + EC2 in `eu-central-1`): possible, expensive, CLOUD Act exposure.
- **Strato / IONOS:** German alternatives, considered. Hetzner has stronger developer mindshare and better API.

## References

- GDPR Article 44–49 (international transfers)
- §146 AO — Books kept abroad
- BMF GoBD 2019 (latest amendment)
- Hetzner Cloud: <https://www.hetzner.com/cloud>
- Fiskaly hosting location: <https://www.fiskaly.com>

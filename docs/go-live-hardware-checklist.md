# Go-Live Hardware Validation — Schorndorf (73614)

> **Purpose.** Every hardware integration (TSE, thermal receipt, label, card terminal)
> is *code-complete* but has **never touched a real device**. This checklist is the
> one-day, on-site validation that closes that gap (project task #26). Run it on the
> actual POS terminal in the shop, against the actual printers and the actual Fiskaly
> TSS, **before** taking real customer money.
>
> Mark every step ✅ / ❌ and write the break next to it. A single ❌ on TSE or the
> card terminal blocks go-live until fixed.

---

## 0. Pre-flight (do this the day before)

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | Build a **release** bundle (`pnpm --filter @norns/tauri-pos build`). Release builds default `NORNS_MOCK_HARDWARE=0` — **mocks are OFF**. | `.dmg`/`.app` produced; launching it does NOT print "MOCK" to the log. |
| ☐ | Confirm the env is **not** forcing mocks: `NORNS_MOCK_HARDWARE` is unset or `0`, and `NORNS_MOCK_FAIL_RATE` is unset. | `echo $NORNS_MOCK_HARDWARE` → empty or `0`. |
| ☐ | Fiskaly: decide **sandbox vs production**. For the dry-run use the sandbox: set `NORNS_FISKALY_BASE_URL=https://kassensichv-middleware.fiskaly.com/api/v2` (sandbox) or leave unset for EU production (`https://kassensichv.fiskaly.com/api/v2`). | Variable matches the intended environment. |
| ☐ | Have the real credentials ready: Fiskaly **TSS-ID** + **API key**, the printers' **IP addresses**, and the **card terminal IP**. | Written down / in the Owner Desktop. |
| ☐ | Network: POS terminal, both printers, and the card terminal are on the **same LAN/subnet**; note each device's static IP. | `ping <device-ip>` succeeds from the POS machine. |

---

## 1. Configure the devices (POS → Geräte)

Open the POS, Spotlight → **"Geräte"** (`GeraeteManager`). This writes the hardware
store (`hardware-store.ts`). Fill in and **save**:

| ✓ | Device | Field(s) | Typical |
|---|--------|----------|---------|
| ☐ | **Thermal receipt** | `ip`, `port` | `:9100` |
| ☐ | **Label printer** | `mode` = `tcp` (`ip`,`port :9100`) **or** `system` (`printerName` from CUPS) | Zebra/Brother |
| ☐ | **Card terminal (ZVT)** | `ip`, `port` | `:20007` |
| ☐ | **TSE (Fiskaly)** | `tssId`, `apiKey` | — |

After saving, hit each **"Verbindung prüfen"** button:

| ✓ | Probe | Pass criterion |
|---|-------|----------------|
| ☐ | Thermal printer reachable | status badge → reachable (green) |
| ☐ | Label printer reachable | reachable (green) |
| ☐ | Card terminal reachable (`zvt_check_connection`) | reachable (green) |
| ☐ | TSE status (`tse_status`) | TSS reports operational |

> ❌ here = wrong IP, firewall, or printer off. Fix before continuing — the rest depends on it.

---

## 2. TSE — fiscal signing (KassenSichV) — **BLOCKER**

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | Do **one real CASH sale** of a cheap item end-to-end (open shift → add item → Bezahlen → Bar). | Sale finalizes; no "TSE Ausfall" on screen. |
| ☐ | The printed receipt shows a **TSE signature block** + **QR code** (not the "TSE Ausfall" fallback text). | `signatureValue`, `signatureCounter`, `transactionNumber`, QR all present. |
| ☐ | Scan the receipt QR with a phone. | Decodes to the KassenSichV payload (not empty). |
| ☐ | In the Owner Desktop → **Konformität**, the TSE health is green and the signature counter incremented by exactly 1. | Counter monotonic, +1. |
| ☐ | Owner Desktop → **Kassenabschluss** → export **DSFinV-K**. | Export downloads; the sale appears with its signature. |

**If TSE fails:** the sale still completes (KassenSichV permits a short outage), but you
see "TSE Ausfall" on the receipt. Do **not** go live until a real signature prints —
an unsigned day is a fiscal problem.

---

## 3. Thermal receipt printer (ESC/POS)

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | The receipt from §2 actually printed on paper. | Physical receipt in hand. |
| ☐ | German characters render: **ä ö ü ß €** (PC858 codepage). | No mojibake. |
| ☐ | Layout: shop header, line items, **Rabatt line if discounted**, Zwischensumme/USt/Gesamt, payment, change, TSE block, footer. | All sections legible. |
| ☐ | Paper **cuts** at the end. | Clean full cut. |
| ☐ | Re-print the same receipt (idempotent). | Second copy identical; no crash. |

---

## 4. Label printer (ZPL / ESC/POS) — SKU stickers

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | From **Lager** (or Ankauf intake), print a SKU/QR label for one product. | Sticker prints. |
| ☐ | The label shows the **SKU**, product name, weight/karat, and storage location. | All fields present. |
| ☐ | The **QR carries the SKU** — scan it. | Decodes to the exact SKU (e.g. `W14-AU-750-0012`). |
| ☐ | No unwanted paper cut on sticker roll. | Roll feeds correctly. |

---

## 5. Card terminal (ZVT 1.10) — **BLOCKER, highest risk**

> This is the **single least-proven** integration: a hand-rolled ZVT stack that has
> never spoken to a real terminal. Budget time for protocol surprises. Keep a fallback
> (the standalone SumUp app) ready so you can still take card payments if it fails.

> ⚠️ The ZVT path is currently **gated off** in the checkout (Phase 1 ships CASH only).
> Enabling it is Phase C3 — do that **after** this test passes, not before.

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | (After C3 enable) Start a card sale; the terminal lights up and prompts for the card. | Terminal shows the amount. |
| ☐ | Insert/tap a **real card**, complete a **small real charge** (e.g. €1–2). | Terminal approves; POS shows success. |
| ☐ | POS records only the **masked PAN** (`****1234`) + brand — never the full number. | DB / receipt shows masked only. |
| ☐ | Sale finalizes with a `ZVT_CARD` payment leg; receipt prints with TSE signature. | Full sale completes. |
| ☐ | **Decline drill:** force a decline (wrong PIN / cancelled on terminal). | POS surfaces a clean German error; **no** transaction is finalized. |
| ☐ | **Post-auth failure drill:** approve on the terminal, then kill the network before finalize. | POS warns the card was charged and a **reversal/Storno** is needed; operator can reverse. |
| ☐ | Reverse (`zvt_reverse_payment`) the €1–2 test charge. | Terminal confirms reversal. |

---

## 6. Resilience & end-of-day

| ✓ | Step | Pass criterion |
|---|------|----------------|
| ☐ | Pull the thermal printer's network cable mid-sale. | POS does not freeze (5 s timeout); sale data is safe; reprint works after reconnect. |
| ☐ | Pull the LAN entirely, do a cash sale. | Sale queues offline (TSE signature queued); drains on reconnect. |
| ☐ | End of day: **Z-Bon / Kassenabschluss**. | Z-report prints; totals match the day's sales; DSFinV-K export clean. |
| ☐ | Owner Desktop → Kassenabschluss shows the day's closing with no variance alarm (or an explained one). | Reconciled. |

---

## 7. Sign-off

| Item | Status | Break / note |
|------|--------|--------------|
| TSE signing (§2) | ☐ pass / ☐ fail | |
| Thermal receipt (§3) | ☐ pass / ☐ fail | |
| Label printer (§4) | ☐ pass / ☐ fail | |
| Card terminal (§5) | ☐ pass / ☐ fail | |
| Resilience + Z-Bon (§6) | ☐ pass / ☐ fail | |

**Go-live decision:** TSE ✅ **and** (Card ✅ **or** SumUp-app fallback in place) **and**
thermal ✅ → **GO**. Otherwise **NO-GO**; log every ❌ against task #26 and fix.

---

### Reference — env switches (Tauri Rust side, `config.rs`)

| Var | Effect | Go-live value |
|-----|--------|---------------|
| `NORNS_MOCK_HARDWARE` | `1`/`true` → all hardware faked. Release default = `0`. | unset or `0` |
| `NORNS_MOCK_FAIL_RATE` | `0.0–1.0` → mock failure injection (UI error-path testing only). | unset |
| `NORNS_FISKALY_BASE_URL` | TSE endpoint. Unset = EU production. | sandbox for dry-run, production for go-live |

TCP timeout is 5 s for printers/terminal; Fiskaly HTTPS budget is 10 s.

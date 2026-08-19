# Runbook — Hardware-in-the-loop (HIL) for ZVT + TSE

Two layers prove the hardware command paths. **Layer 1 is the gate; Layer 2 is for
human visual-pressure sessions.**

## Layer 1 — automated, in-repo, CI-runnable (the gate)

In-repo protocol-validating servers exercise the REAL command paths (mock mode
OFF). No external service, no device — runs anywhere `cargo test` runs.

```bash
cd apps/tauri-pos/src-tauri
cargo test                 # lib unit + all HIL integration suites
cargo test --test zvt_hil  # ZVT TCP only
cargo test --test tse_hil  # Fiskaly HTTP only
cargo test --test mock_hardening   # mock now catches real-device errors
```

What it proves (see `tests/zvt_hil.rs`, `tests/tse_hil.rs`, `tests/mock_hardening.rs`):

- **ZVT** — `zvt_authorize_payment` → a TCP server that asserts `06 01` CLASS/INS,
  the `0x04` 6-byte-BCD amount == the cents charged, and a valid CRC-CCITT, then
  returns a realistic `04 0F` completion. Covers approve, decline, peer-EOF
  (→ Device error), and silent-hang (→ Timeout, via `NORNS_ZVT_READ_TIMEOUT_MS`).
- **TSE** — `tse_start/finish_transaction` → a Fiskaly HTTP mock that asserts the
  bearer, `state` transitions, `amount > 0`, `payment_type ∈ {Bar,Unbar}`, and
  returns a monotonic signature counter. Empty config → `NotConfigured`.
- **Mock parity** — `NORNS_MOCK_HARDWARE=1` now rejects the SAME bad input a
  real device would (0/oversized amount, no-creds config, bad payment type), and
  builds its ZVT frame via the same canonical builder as the real path.

## Layer 2 — manual, external emulators (visual pressure sessions)

For a human to watch the full Bezahlen/TSE flow against an independent emulator.
Point the app at the emulator via the same env switches; **mock mode OFF**.

### ESC/POS receipt printer — `escpresso` (Phase 2 scope, listed for completeness)
- Emulator: <https://github.com/local-net/escpresso> (or `receiptline` viewer), TCP `:9100`.
- In the Gerätemanager set the thermal printer IP to the emulator host, port `9100`.

### ZVT card terminal — `panda-zvt-simulator`
- Emulator: a ZVT 1.10/13.13 TCP simulator on `:20007` with REST error injection
  (decline / timeout / partial-frame), e.g. the panda-zvt-simulator from
  <https://github.com/kaplanerkan/kotlin-zvt-library> ("same binary responses as a
  real CCV A920") or the vendor's PA/ZVT test simulator.
- Set the terminal IP/port in the Hardware tab to the simulator. Drive a sale;
  use the simulator's REST endpoint to inject a decline and confirm the POS shows
  "Nochmal versuchen / Bar zahlen", not a crash.

#### ✅ Implemented: the full multi-message authorisation conversation
`zvt_authorize_payment` now drives the real ECR-side dialog (grounded in
`ecrterm transmission/zvt.py` + `base_packets.py::handle_response`): after `06 01`
it loops — `80 00` command-ACK (not re-ACK'd) → zero-or-more `04 FF` intermediate-
status → `04 0F` Status-Information (result captured) → `06 0F` Completion (or
`06 1E` Abort), sending an `80 00` ECR-ACK after every terminal message except the
command-ACK. Each message gets the full read window, so an "insert card / PIN"
wait can't trip a premature timeout. Proven by the HIL suite (approved full-flow,
declined, abort, mid-flow timeout, peer-drop). The response parser is spec-accurate
to the ZVT 13.13 BMP encoding (result BMP 0x27, amount 0x04, PAN 0x22 LLVAR with
`0xE`-masked nibbles, brand 0x8B, receipt-no 0x87, additional-text 0x3C).

#### ⚠️ Still needs a REAL terminal / simulator before go-live (NOT faked)
1. **Exact PAN masking + the acquirer approval code.** We decode BMP 0x22 packed
   BCD with `0xE` = masked and surface the receipt-number (0x87) as the
   reversal/authorisation reference. Whether a given terminal puts the masked PAN
   in BMP 0x22 vs the `0x06` TLV container, and where the 6-digit acquirer
   approval code lands, varies by terminal — **capture the bytes from the
   simulator/A920 and confirm the field locations.**
2. **Real timing + the intermediate-status set.** Our HIL emits a minimal length-0
   `04 FF`; real terminals send a sequence of intermediate statuses with content
   ("Bitte Karte", "PIN", "bitte warten") and real inter-message latency. The
   conversation logic (ACK-each, capture-on-`04 0F`, end-on-`06 0F`/`06 1E`) is
   spec-grounded, but **observe a real run** to confirm the status cadence and
   that 75 s/message is the right cardholder window. The `MAX_MESSAGES=64` guard
   should comfortably cover a real flow — verify.

### TSE — Fiskaly test sandbox
- Use Fiskaly's **test** TSS (not production): set
  `NORNS_FISKALY_BASE_URL=https://kassensichv-middleware.fiskaly.com/api/v2`
  (test base) and store the **sandbox** key/secret via the Hardware tab
  (`tse_store_credentials` → OS keychain). Run a sale and verify the QR + monotonic
  signature counter on the printed receipt against the Fiskaly dashboard.
- Never point a pressure session at the production TSS — it consumes real signatures.

### Env switches (both layers)
| Var | Meaning |
|-----|---------|
| `NORNS_MOCK_HARDWARE` | `0`/`false` = real paths; `1`/`true` = mocks |
| `NORNS_FISKALY_BASE_URL` | TSE endpoint (test sandbox or the in-repo mock) |
| `NORNS_ZVT_READ_TIMEOUT_MS` | cardholder read-timeout (default 75 000) — HIL tests shrink it |
| `NORNS_MOCK_FAIL_RATE` | mock decline/failure injection rate `0.0..=1.0` |

> The automated gate (Layer 1) is the source of truth for "the protocol bytes are
> correct". Layer 2 is for confidence under a human's eyes, not for catching
> protocol regressions — those belong in the in-repo servers.

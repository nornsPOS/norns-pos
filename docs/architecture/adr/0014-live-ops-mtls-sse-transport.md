# ADR-0014 — Live Ops transport: mTLS device identity + SSE event streams over Cloudflare Tunnel and Tailscale

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0008 (audit chain — every Live Ops command is a ledger event), ADR-0012 (network topology and the Caddy/cloudflared/Tailscale containers this ADR uses), ADR-0009 (Control Desktop client to be defined), `docs/memory.md` §2 #30 #33.

## Context

memory.md §2 #33 records Basel's decision: the owner monitors and operates the shop **live from home, as if standing next to the cashier.** This single sentence drives a network and protocol design that V1 must get right because every later choice — multi-shop, scaling, push notifications, remote commands — composes on top of it.

The concrete operational picture:

- The Control Desktop on Basel's home Windows PC must see every sale, every KYC capture, every TSE state change, every system alert **within ~1 second** of it happening at the shop.
- Basel must be able to send remote commands — "approve this high-value sale," "lock terminal 2," "push price update" — and see acknowledgment within the same second.
- The two POS terminals at the shop must continue to function if the cloud link drops, then sync seamlessly on reconnect.
- The Steuerberater (READONLY) may pull reports from any location but never receives Live Ops events.
- Public storefront browsers (Phase 2+) live on an entirely separate trust surface and never see Live Ops traffic.

Constraint set:

1. **Identity at the connection layer.** "Who is connected" must be cryptographically certain — not a bearer token that could be lifted from logs.
2. **Defense in depth.** A compromise of any single layer must not yield the chain.
3. **No public IP on Oracle.** Inherited from ADR-0012.
4. **DSGVO conservative path.** The fewer third parties touching live event data, the better.
5. **Latency budget < 1s end-to-end.** Tunnel + SSE + Caddy add up to small numbers if each is tuned.
6. **Cost: €0 V1.** Cloudflare Tunnel free tier + Tailscale free tier + self-hosted CA.
7. **Failure-mode honesty.** The shop must keep selling when the cloud link dies.

## Decision

### 1. Two-track transport — Cloudflare Tunnel for the world, Tailscale for the spine

```
                                                  ┌──────────────────────────┐
                                                  │  Oracle VM Frankfurt     │
                                                  │  (ADR-0012)              │
                                                  │                          │
   ┌───────────────────────┐                      │  ┌──────┐    ┌──────┐    │
   │  Storefront browser   │ ─── HTTPS ─── CF ───▶│  │Caddy │───▶│ api  │    │
   │  (Phase 2+)           │      Tunnel          │  └──────┘    └──────┘    │
   └───────────────────────┘                      │     ▲                    │
                                                  │     │ mTLS                │
                                                  │     │                    │
   ┌───────────────────────┐                      │  ┌──────┐                │
   │  Control Desktop      │ ─── mTLS ─── CF ───▶ │  │Caddy │                │
   │  (Basel's home PC)    │      Tunnel + CF     │  └──────┘                │
   │                       │      Access mTLS     │     │                    │
   │  (fallback path:)     │                      │     │                    │
   │      Tailscale ──────────────────────────────────▶│ (Tailscale path)   │
   └───────────────────────┘                      │                          │
                                                  │  ┌─────────┐             │
   ┌───────────────────────┐                      │  │step-ca  │  Tailscale  │
   │  POS Desktop          │ ─── Tailscale ──────────▶│         │  network    │
   │  (shop terminal)      │      (in-shop LAN +  │  └─────────┘  only        │
   │                       │       Tailscale)     │                          │
   │  (fallback path:)     │                      │                          │
   │      CF Tunnel + mTLS ─────────────────────────▶│                       │
   └───────────────────────┘                      └──────────────────────────┘
```

- **Public traffic** (storefront, public catalog API in Phase 2+) → Cloudflare Tunnel, bearer-token auth, no mTLS.
- **Live ops + admin traffic** (Control Desktop, POS Desktop) → primary path is **Cloudflare Tunnel + Cloudflare Access mTLS** (free tier supports it up to 50 users); fallback path is **Tailscale**, devices reach Caddy directly via the Tailscale IP.
- **SSH and management traffic** (Basel's terminal, Grafana, step-ca admin) → Tailscale only, never Cloudflare.

The two tracks are not redundant — they have different security properties — but each can carry Live Ops traffic if the other is unavailable. The Control Desktop and POS clients try Cloudflare first (Cloudflare's anycast PoPs are the lowest-latency path from most locations) and fall back to Tailscale on failure within 2 seconds.

### 2. Internal CA via step-ca; one cert per device; lifetimes by role

step-ca runs in a container on the `tailscale` network. It is reachable only from inside the tailnet. Devices enroll by:

1. Owner (Control Desktop, already authenticated) generates a one-time `device_pair_token` (JWT, 5-minute expiry, signed by API).
2. New device joins Tailscale (one-time setup: Basel installs Tailscale on the device, authenticates the device on the Tailscale admin console).
3. New device calls `POST https://step-ca.warehouse14.tailnet/api/enroll` with the `device_pair_token`.
4. step-ca validates the token by calling back to the API, then issues an X.509 client cert with the device's CN encoded as `device_id=UUID,role=CASHIER_POS,shop_id=UUID`.
5. Device stores cert + private key in OS keychain via Tauri's `keyring` plugin. The private key never leaves the device.

Cert lifetimes:

| Role                | Lifetime | Renewal trigger                                | Revocation path                                  |
|---------------------|----------|------------------------------------------------|--------------------------------------------------|
| POS terminal        | 365 d    | auto-renew at 60d remaining                    | OCSP push from step-ca + Cloudflare Access policy update |
| Control Desktop     | 90 d     | prompt user to re-authenticate at 14d remaining | same                                            |
| Worker (server-to-server within tailnet) | 30 d | auto-renew at 7d remaining | same                                |

Step-ca's certificate revocation list (CRL) is pushed to Caddy and to Cloudflare Access daily, and on demand whenever the API marks a device as `decommissioned`.

**Rotation key:** the step-ca root key is generated during bootstrap, stored encrypted in Oracle Vault, and **never** present in plaintext outside the step-ca container's tmpfs. Root rotation requires re-issuing every device cert; we plan to do it once before go-live (after the cert format is fully baked) and not again until a documented incident.

### 3. Authentication is layered, not single-shot

A request to `/api/live/*` or `/api/admin/*` must pass **all four** gates:

| Layer | Mechanism                          | What it proves                                       |
|-------|------------------------------------|------------------------------------------------------|
| 1     | Cloudflare Access service policy   | Request originated from a device whose client cert matches our uploaded CA |
| 2     | mTLS at Caddy                      | The cert's CN matches a known active device in the DB |
| 3     | JWT bearer token in `Authorization` header | A valid session exists for a user (Basel as ADMIN, a CASHIER, or READONLY) |
| 4     | RBAC route guard in Fastify        | The user's role can access this specific endpoint    |

Each layer is necessary. Removing any one of them collapses an attack vector:

- Without (1): a stolen Cloudflare Tunnel hostname is a denial-of-service amplifier.
- Without (2): a stolen JWT works from any browser.
- Without (3): a borrowed device runs without a user identity.
- Without (4): a CASHIER could call admin endpoints by guessing URLs.

Implementation:

```ts
// apps/api-cloud/src/middleware/live-ops-guard.ts (sketch)
async function liveOpsGuard(req: FastifyRequest, reply: FastifyReply) {
  const dn = req.headers['x-client-cert-dn'];           // Caddy forwards this after mTLS validation
  const serial = req.headers['x-client-cert-serial'];

  const device = await db.query.devices.findFirst({
    where: and(
      eq(devices.certSerial, serial),
      eq(devices.status, 'active'),
    ),
  });
  if (!device) return reply.code(401).send({ error: 'device_unknown_or_revoked' });

  // Bearer token: better-auth session validation (already wired)
  const session = req.session;
  if (!session) return reply.code(401).send({ error: 'session_invalid' });

  // RBAC: per-route role assertion is the route handler's job.
  req.deviceContext = { device, session };
}
```

Every authenticated Live Ops request lands in `ledger_events` as `event_type='live_ops.command'` or `'live_ops.subscribe'` with `actor_user_id`, `device_id`, `ip_address`, and the command payload. The chain extends. Auditable forever.

### 4. SSE event model — append-only stream with monotonic IDs

The Live Ops feed is a single Server-Sent Events stream, multiplexed by subscription topic:

```
GET /api/live/events?topics=transactions,inventory,kyc,alerts
Accept: text/event-stream
Authorization: Bearer <session_token>
Last-Event-ID: 4521          ← on reconnect; omitted on first connect
```

Server responses:

```
id: 4522
event: transaction.finalized
data: {"transaction_id":"...","total_eur":"199.99","cashier_user_id":"...","direction":"VERKAUF","shop_id":"..."}

id: 4523
event: kyc.captured
data: {"customer_id":"...","cashier_user_id":"...","quality_score":0.92}

: keep-alive

id: 4524
event: alert.fiscal_health
data: {"severity":"warning","component":"tse","message":"INTENTION queue depth 12"}
```

Design properties:

- **Monotonic `id`** — this is `ledger_events.id`. The Live Ops stream is literally a filtered projection of the ledger. Replay on reconnect is `SELECT * FROM ledger_events WHERE id > :last_event_id ORDER BY id` — trivial, indexable, exact.
- **Event types are namespaced** — `transaction.*`, `inventory.*`, `kyc.*`, `alert.*`, `command.*`, `system.*`. Clients subscribe to namespaces, not individual events.
- **Payloads are stable JSON schemas** — versioned in `packages/shared-types` (Phase 1+). Breaking changes ship as `transaction.finalized.v2` alongside `v1` for a grace period.
- **Heartbeat every 15s** as `: keep-alive` comments — keeps NAT and Cloudflare Tunnel sessions alive without polluting the event log.
- **RBAC filter is server-side**, before the event leaves Redis pub/sub. A CASHIER client cannot accidentally receive an ADMIN-only event because the filter happens upstream of the SSE write.

Backpressure handling (anticipated problem — slow client):

- Per-client Redis subscription has a 1 MB buffer.
- If buffer fills (slow client, paused VPN, etc.), the SSE writer **drops the oldest events** of types tagged `severity=low`. Critical events (`severity=high`) bypass the buffer cap and force the connection to flush or drop.
- On drop, an `event: stream.dropped` is emitted with the list of missed `id`s and `severity` levels. Client requests replay via reconnect with `Last-Event-ID`.

### 5. RBAC filtering at the source — events tagged before publish

Every event is published to Redis pub/sub with a `required_role` field:

```ts
// apps/api-cloud/src/lib/events/publish.ts (sketch)
async function publishEvent(event: LiveEvent) {
  await redis.publish('live-events', JSON.stringify({
    ...event,
    required_role: roleForEventType(event.event_type),
    shop_id: event.shop_id,
  }));
}
```

The SSE writer per session filters:

```ts
async function* eventStreamForSession(session: Session) {
  const sub = redis.subscribe('live-events');
  for await (const raw of sub) {
    const e = JSON.parse(raw);
    if (!canSeeEvent(session.role, e.required_role)) continue;
    if (session.shop_id !== e.shop_id) continue;        // multi-shop guard
    yield e;
  }
}

const ROLE_VISIBILITY: Record<Role, EventType[]> = {
  ADMIN:    ['*'],                                       // everything
  CASHIER:  ['transaction.*', 'inventory.*', 'alert.fiscal_health', 'command.assigned_to_me'],
  READONLY: ['daily_closing.*', 'report.*'],
};
```

A CASHIER never sees admin commands aimed at another terminal; a READONLY never sees real-time sales. This is enforced **at the server**, not by client-side filtering.

### 6. Remote commands — request/response over SSE + reverse HTTP

Commands flow in two halves:

```
1. Basel (ADMIN) on Control Desktop:
       POST /api/admin/commands
       { "type": "approve_high_value_sale", "transaction_id": "...", "approval_pin": "1234" }
   →   API verifies role + audit-logs the command + appends ledger_events row
   →   API publishes `command.dispatched` to Redis with target_device_id

2. POS Desktop (target device) receives over its SSE stream:
       event: command.dispatched
       data: {"command_id":"...","type":"approve_high_value_sale","transaction_id":"...","approver_user_id":"..."}
   →   POS Desktop executes (resumes the paused sale flow)
   →   POS Desktop POSTs back:
       POST /api/live/command-ack
       { "command_id":"...", "outcome":"executed", "details":{...} }
   →   API audit-logs + publishes `command.acknowledged`

3. Control Desktop sees the ack on its own SSE stream and updates UI.
```

Two HTTP requests + one SSE event each direction. No bidirectional WebSocket needed, no protocol complexity. Every step extends the ledger chain, so every remote command is forensically reconstructable years later.

Command types V1 ships:

- `approve_high_value_sale` — when a sale exceeds a threshold, POS pauses and waits for ADMIN approval
- `lock_terminal` — security incident; POS goes to a locked screen, only ADMIN can unlock
- `unlock_terminal`
- `push_price_update` — catalog change reflects immediately on POS (no full re-fetch)
- `force_logout` — kick a CASHIER session from a specific terminal
- `request_health_snapshot` — POS responds with full self-test diagnostics

### 7. Push notifications — Tauri native, encrypted in transit

Critical events also surface as **OS-level notifications** on the Control Desktop via Tauri's `notification` plugin:

```ts
// apps/control-desktop/src/lib/notifyOnEvent.ts (sketch)
const CRITICAL_TYPES = new Set([
  'alert.fiscal_health',
  'alert.tse_failure',
  'alert.smurfing_detected',
  'transaction.high_value_pending_approval',
]);

eventStream.on('event', (e) => {
  if (CRITICAL_TYPES.has(e.event_type)) {
    Notification.requestPermission().then(() =>
      new Notification(titleFor(e), {
        body: bodyFor(e),
        icon: '/assets/warehouse14-badge.png',
        tag: e.id.toString(),         // dedupe
      }),
    );
  }
});
```

Notifications fire only after the SSE event arrives — meaning they've already passed all four authentication layers. No separate push channel, no Apple/Google push services in the loop, no third-party tokens to manage. DSGVO surface is minimal.

### 8. Failure modes — what breaks first and what we do

| Failure                                 | Detected within | Behaviour                                                                                          |
|-----------------------------------------|-----------------|----------------------------------------------------------------------------------------------------|
| Cloudflare Tunnel down                  | 2 s             | Clients failover to Tailscale path. Live Ops continues. Cloudflare Access policy still enforced via cloudflared restart. |
| Tailscale daemon down on a device       | 5 s             | That device falls back to Cloudflare path only. If both down → device offline (see below).         |
| Both Tunnel + Tailscale down on a POS   | < 10 s          | POS detects offline. Sales continue locally — TSE intentions queue in local SQLite. UI shows offline badge. Sync resumes on reconnect; the queue replays into the cloud chain in order. |
| step-ca down                            | next enroll attempt | New device pairings blocked. Existing devices keep working (their certs are already issued and locally cached). |
| Caddy down                              | 5 s by Docker healthcheck | docker compose restarts it within 10s. Existing SSE connections drop and reconnect.       |
| Postgres down                           | 10 s healthcheck | API returns 503 on writes. Worker queues retry with exponential backoff. POS terminals continue offline. |
| Oracle VM down                          | immediate       | Entire cloud surface offline. POS continues offline. RTO from R2 restore: 30 min (ADR-0012 §5).    |
| Owner's home internet down              | n/a             | Owner can't monitor; everything else proceeds. POS continues operating.                            |

The single most important property: **the shop never stops selling because the cloud broke.** TSE compliance is preserved by the local SQLite TSE queue (Oliver's pattern, memory.md §3 "TSE — network-resilient").

### 9. Connection budget for V1

Five active clients maximum:

| Client                       | SSE conn | mTLS cert | Bearer token | Typical bandwidth     |
|------------------------------|----------|-----------|--------------|------------------------|
| 1× Control Desktop (Basel home) | 1     | 1         | 1            | ~5 KB/s sustained      |
| 1× Control Desktop (in-shop secondary, optional) | 1 | 1 | 1 | ~5 KB/s            |
| 2× POS Desktop (shop)        | 2        | 2         | 2            | ~3 KB/s each (less chatty) |
| 1× admin-web browser session | 1        | 0 (cookie-based mTLS via Cloudflare Access) | 1 | ~5 KB/s |

Total sustained: ~25 KB/s. Burst on a busy minute (sale finalized + receipt printed + audit log + acks): ~100 KB/s. Negligible against Oracle's 10 TB/month allowance.

### 10. Defense in depth — five concentric layers

| Layer | Mechanism                                          | What it defeats                                                       |
|-------|----------------------------------------------------|-----------------------------------------------------------------------|
| 1     | No public IP on Oracle; ingress only via Cloudflare Tunnel or Tailscale | Port-scan / direct-attack vectors                       |
| 2     | mTLS at Cloudflare Access (free tier) and again at Caddy (origin) | Stolen bearer token from a non-enrolled device                  |
| 3     | JWT bearer token (better-auth session) over mTLS   | Replay of a captured cert without a live session                      |
| 4     | RBAC filter on event types and shop scope, server-side | Privilege escalation via subscription tampering                     |
| 5     | Every command + connection logged in `ledger_events` (ADR-0008) | Plausible deniability — every action attributable forensically  |

## Consequences

**Positive:**
- Basel sees the shop live without ever exposing the Oracle VM to the public Internet.
- The shop continues to sell when any cloud component fails. The TSE queue keeps GoBD compliance intact during outages and reconciles on reconnect.
- Every remote command, every subscription, every cert issuance lands in the ledger and is reconstructible years later — the audit posture matches the GoBD requirement for "wer hat wann was getan, wo, mit welchem Gerät."
- The system is cost-€0 in V1: Cloudflare free + Tailscale free + self-hosted step-ca + Cloudflare Access free (≤ 50 users).
- The four-layer authentication makes "session token leaks" not a compromise — even with the bearer token, the attacker needs a cert from a still-active device.

**Negative:**
- The setup is more complex than "JWT only." Initial device pairing has more steps (Tailscale auth, cert enrollment, session login).
- Cloudflare Access free tier upper bound is 50 users; we are well under, but multi-shop with many cashiers across many shops will hit it eventually. Documented in Known limits.
- step-ca is one more service to monitor. CA outage blocks new pairings; existing devices unaffected.
- Tailscale free tier limit (5 user accounts, 100 devices) — fine for V1, would constrain a multi-shop expansion.

**Mitigations:**
- The pairing flow is exactly the OnboardingWizard / PairingScreen cherry-pick from Oliver (memory.md §5) — the UX is already designed, we adapt it.
- A scheduled health check (`scripts/verify-live-ops.sh`) runs every hour and tests: mTLS handshake, SSE event arrival within 2s, command round-trip latency, cert renewal pipeline. Alerts on any regression.
- Cloudflare Access paid tier ($3/user/month) is the documented upgrade path; cost remains marginal even at 20 users.

## Alternatives considered

- **WebSockets instead of SSE.** Rejected. WebSockets give bidirectional but break behind some corporate firewalls and add complexity for no benefit — our reverse flow (commands → POS) is HTTP POST + SSE event, simpler than WebSocket framing.
- **MQTT over WebSocket.** Rejected. MQTT broker is another service to run, another protocol to secure, and our scale doesn't need it. Redis pub/sub + SSE covers the use case end-to-end.
- **Bearer-token-only auth (drop mTLS).** Rejected. Bearer tokens are equivalent to passwords; mTLS gives device identity that bearer tokens cannot. The owner's "approve high-value sale" command absolutely requires device-level identity, not just user-level.
- **Self-issued certs without step-ca (openssl scripts).** Rejected. step-ca gives JWT-based ACME, automated renewal, CRL distribution, and audit logs out of the box. Hand-rolled openssl scripts are an audit nightmare.
- **Cloudflare Tunnel + Cloudflare Access exclusively (drop Tailscale).** Considered. Tailscale stays because it gives us a side-channel for SSH, Grafana, and step-ca admin that doesn't share the same blast radius as the public-facing path. Operational redundancy is cheap; the cost is one Tailscale daemon per device.
- **Push notifications via FCM / APNs.** Rejected for V1. Adds Google/Apple to the data path for DSGVO no benefit; Tauri native notifications work for any owner's device on any OS without third-party infrastructure.
- **Per-event encryption (sealed-box) inside the SSE payload.** Considered. Rejected because mTLS already encrypts the channel end-to-end. Application-layer encryption adds complexity with no extra threat model coverage at our scale.

## Known limits & deferred decisions

1. **Cloudflare Access free tier upper bound (50 users).** Sufficient for V1. Mitigation path is paid Access ($3/user/month) or fully self-hosted with Authelia + step-ca, deferred until needed.
2. **Tailscale free tier limit (5 user accounts).** Single-shop is fine. Multi-shop would need Tailscale Personal Pro or replacement with Netbird / Headscale (self-hosted Tailscale).
3. **No event replay beyond `ledger_events.id` window we keep online.** Daily checkpoint snapshots from ADR-0008 §Known limits #2 cover anything beyond ~1 year; reconnecting a client that's been offline for >1 year does a full re-fetch.
4. **No native push notifications on mobile.** V1 is desktop-only (Control Desktop on Windows). A mobile companion app is a Phase 2+ separate ADR.
5. **No multi-tenant shop_id propagation enforcement yet.** Single-shop V1 ships with `shop_id` hardcoded constant; the schema slot is there (ADR-0008 Known limits #5), the SSE filter assumes it from day 1, the migration to multi-shop is just "populate shop_id and add it to JWT claims."
6. **Cert revocation propagation latency.** OCSP/CRL pushed every hour + on demand. A revoked device could in worst case authenticate for up to 60 minutes after revocation. Mitigation: also flip the `devices.status` to `revoked` in Postgres, and `liveOpsGuard` checks the DB on every request (cached for 60 seconds).
7. **No DR for step-ca root.** If the root key is lost (Oracle Vault unavailable + tmpfs cleared + no offline backup), we re-bootstrap the CA and re-enroll every device. Bootstrap backup of the root key encrypted to Basel's Yubikey is a Phase 1 deliverable.

## References

- Cloudflare Access mTLS — https://developers.cloudflare.com/cloudflare-one/identity/devices/access-integrations/mutual-tls-authentication/
- Tailscale free tier — https://tailscale.com/pricing
- step-ca docs — https://smallstep.com/docs/step-ca/
- Caddy mTLS — https://caddyserver.com/docs/caddyfile/directives/tls#client_auth
- HTML Spec — Server-Sent Events — https://html.spec.whatwg.org/multipage/server-sent-events.html
- Oliver Roos cherry-picks: `lib/sseClient.ts`, `hooks/useLiveSessions.ts`, `pages/PairingScreen.tsx`, the trusted-device-pairing pattern in `backend/src/lib/auth/deviceAuth.ts`
- ADR-0008 — Schema architecture (ledger_events is the substrate for the SSE feed)
- ADR-0012 — Hosting (network topology this ADR uses)
- `docs/memory.md` §2 #30 #33, §3 (RBAC), §5 (cherry-picks)

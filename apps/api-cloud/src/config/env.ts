/**
 * Environment validation — TypeBox + Value.Check, fail-fast on boot.
 *
 * The single source of truth for which env vars exist, what shape they take,
 * and what defaults apply. Any access to `process.env.*` outside this module
 * is a bug — call `loadEnv()` and pass the typed object around instead.
 *
 * Strict mode: unknown keys are not removed (they remain on process.env), but
 * the typed `Env` only exposes vetted fields, narrowing the API surface.
 */

import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const NodeEnv = Type.Union(
  [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
  { default: 'development' },
);

const LogLevel = Type.Union(
  [
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
  ],
  { default: 'info' },
);

/**
 * The canonical env schema. Adding a var = adding a key here.
 */
// Exportiert, damit der Waechter `test-umgebung-laeuft-wirklich` die VOLLE
// Breite gegen das Schema misst statt gegen eine von Hand gepflegte Zahl —
// die veraltet bei jedem Zu- oder Rueckbau (zuletzt 14.08.2026, Trennung).
export const EnvSchema = Type.Object({
  NODE_ENV: NodeEnv,
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  LOG_LEVEL: LogLevel,
  DATABASE_URL: Type.String({
    minLength: 1,
    description: 'postgres:// connection string for the warehouse14_app role',
  }),
  /**
   * ⚠️ EINE DIREKTE VERBINDUNG FÜR `LISTEN`, AM VERTEILER VORBEI.
   *
   * `LISTEN` bindet das Abonnement an die SITZUNG. PgBouncer im
   * Transaktionsmodus gibt die Serververbindung nach jedem Befehl weiter: das
   * LISTEN wird angenommen und quittiert, und danach kommt NIE eine Meldung.
   * Kein Fehler, keine Ausnahme, nur Stille — die Anzeige meldet dabei
   * durchgehend grün.
   *
   * Dieselbe Wurzel hat den Worker vier von fünf Takten verwerfen lassen
   * (LOCK_DATABASE_URL in apps/worker). Dort eine Sitzungssperre, hier ein
   * Sitzungsabonnement; beides überlebt den Verteiler nicht.
   *
   * Leer = DATABASE_URL wie bisher, für Aufstellungen ohne Verteiler.
   */
  LISTEN_DATABASE_URL: Type.String({
    default: '',
    description: 'Direkte postgres:// URL für LISTEN/SSE, ohne Pooler. Leer = DATABASE_URL',
  }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 200, default: 10 }),
  NORNS_PII_KEY: Type.String({
    minLength: 16,
    description:
      'Key for pgcrypto pgp_sym_encrypt — injected per request via SET LOCAL warehouse14.pii_key',
  }),
  AUTH_SECRET: Type.String({
    // NO default ON PURPOSE — boot MUST fail if absent. better-auth falls back
    // to the public placeholder secret "better-auth-secret-123456789" when no
    // `secret:` (and no BETTER_AUTH_SECRET / AUTH_SECRET env var) is supplied,
    // which would make staff session tokens forgeable by anyone who knows the
    // library default. Requiring it here — and passing it explicitly to
    // betterAuth({ secret }) — closes that hole. Generate with
    // `openssl rand -base64 32`. Set it in /opt/warehouse14/.env before deploy.
    minLength: 32,
    description:
      'Mandatory better-auth signing/encryption secret (≥32 chars, no default). Boot fails if unset.',
  }),
  TRUSTED_ORIGINS: Type.String({
    default: '',
    description: 'Comma-separated list of allowed origins for CORS + better-auth',
  }),
  TEST_DEVICE_FINGERPRINT: Type.String({
    default: '',
    description:
      'TEST-ONLY pre-mTLS escape hatch. When set (production), device-gated requests ' +
      'with no Cloudflare client cert are treated as coming from this single seeded ' +
      'device fingerprint. Empty = off. MUST be unset once Cloudflare Access mTLS is live.',
  }),
  TRANSACTION_STEP_UP_THRESHOLD_EUR: Type.String({
    default: '1000.00',
    pattern: '^\\d{1,10}(\\.\\d{1,2})?$',
    description:
      'Total amount (EUR) above which POST /transactions/finalize requires a fresh PIN step-up. ' +
      'NUMERIC(18,2) string. ADR-0022 §4c.',
  }),
  // ── Cloudflare R2 (Day 16) ────────────────────────────────────────────
  // R2 is S3-compatible; the AWS SDK speaks to it via a custom endpoint.
  // Empty defaults so dev/test can boot without R2 wired; the photo route
  // refuses if any are unset.
  R2_ACCOUNT_ID: Type.String({
    default: '',
    description: 'Cloudflare account ID for R2 endpoint construction.',
  }),
  R2_BUCKET: Type.String({
    default: '',
    description: 'R2 bucket name (e.g. warehouse14-products).',
  }),
  R2_ACCESS_KEY_ID: Type.String({ default: '', description: 'R2 API token access key id.' }),
  R2_SECRET_ACCESS_KEY: Type.String({ default: '', description: 'R2 API token secret.' }),
  GOOGLE_SERVICE_ACCOUNT_B64: Type.String({
    default: '',
    description: 'Base64 of the Google service-account JSON (Calendar).',
  }),
  GOOGLE_CALENDAR_ID: Type.String({
    default: '',
    description: 'Target Google Calendar id for the shop calendar.',
  }),
  GOOGLE_CALENDAR_IMPERSONATE: Type.String({
    default: '',
    description:
      'Workspace user to impersonate via DWD (e.g. admin@warehouse14.de) so GOOGLE_CALENDAR_ID can be their primary calendar.',
  }),
  CALENDAR_WEBHOOK_URL: Type.String({
    default: '',
    description:
      'Public HTTPS callback for Google Calendar events.watch (e.g. https://api.warehouse14.de/api/calendar/notifications). Domain must be GCP-verified.',
  }),
  CALENDAR_WEBHOOK_TOKEN: Type.String({
    default: '',
    description:
      'Shared secret echoed by Google as X-Goog-Channel-Token; empty disables push (poll only).',
  }),
  R2_PUBLIC_URL_BASE: Type.String({
    default: '',
    description:
      'Public-facing CDN base URL for served R2 objects (e.g. https://media.warehouse14.de).',
  }),
  // ── Local product-photo store (replaces the empty R2 bucket) ───────────
  // Bytes are compressed to WebP and written to local disk under PHOTOS_DIR,
  // sharded by id prefix (e.g. /data/photos/ab/<id>.webp). PHOTOS_DIR must be
  // a Docker volume so photos survive container recreation.
  PHOTOS_DIR: Type.String({
    default: '/data/photos',
    description:
      'Filesystem directory the API writes compressed product-photo WebP bytes to. ' +
      'MUST be a persistent Docker volume in production.',
  }),
  PHOTO_STORE_MAX_BYTES: Type.Integer({
    // 20 GiB — the owner-imposed hard cap for product photos on the limited
    // server disk. Counted against SUM(product_photos.size_bytes) of local rows.
    default: 20 * 1024 * 1024 * 1024,
    minimum: 1024 * 1024,
    description:
      'Hard cap (bytes) for the local product-photo store. Uploads that would exceed it are refused.',
  }),
  PHOTOS_PUBLIC_BASE_URL: Type.String({
    default: 'https://api.warehouse14.de',
    description:
      'Public base URL the POS/storefront reads served photos from. publicUrl is built as ' +
      '<base>/api/photos/<id>/raw. The Tauri CSP already allows the api host for img/connect.',
  }),

  // ── KYC ID-document local store (migration 0074; replaces the empty R2) ─
  // GwG/DSGVO-sensitive Ausweis images. SEPARATE from PHOTOS_DIR — these bytes
  // are AES-256-GCM encrypted at rest and NEVER public.
  KYC_IMAGE_ENCRYPTION_KEY: Type.String({
    // NO default ON PURPOSE — boot MUST fail if absent (mirrors AUTH_SECRET).
    // A 256-bit key, base64-encoded (32 raw bytes → 44 base64 chars). Generate
    // with `openssl rand -base64 32`. NOT the NORNS_PII_KEY passphrase
    // (that is a pgcrypto short-string key). The decoded length is asserted to
    // be exactly 32 bytes at boot (assertKycImageKeyValid). NEVER logged.
    minLength: 43,
    description:
      'Mandatory AES-256-GCM key for KYC image at-rest encryption — base64 of 32 bytes, no ' +
      'default. Boot fails if unset or not 32 bytes. Distinct from NORNS_PII_KEY.',
  }),
  KYC_PHOTOS_DIR: Type.String({
    default: '/data/kyc',
    description:
      'Filesystem directory the API writes AES-256-GCM-encrypted KYC image (.enc) files to, ' +
      'sharded by storage-key prefix. MUST be a persistent Docker volume, separate from ' +
      'PHOTOS_DIR, and the worker mounts the SAME path for the retention purge.',
  }),
  KYC_STORE_MAX_BYTES: Type.Integer({
    // 5 GiB — separate cap so KYC bytes never share the product-photo quota
    // (PHOTO_STORE_MAX_BYTES only SUMs product_photos and would undercount).
    default: 5 * 1024 * 1024 * 1024,
    minimum: 1024 * 1024,
    description:
      'Hard cap (bytes) for the local KYC image store. Uploads that would exceed it are refused.',
  }),

  // ── Stripe — Kartenleser (Terminal) am Tresen ─────────────────────────
  // V1 amendment to memory.md #31 (Mollie primary): Basel overrode 2026-05-25
  // and selected Stripe for the entire payment surface — supports SEPA Direct
  // Debit, Klarna, iDEAL, German cards. Empty defaults so dev/test can boot
  // without Stripe wired; checkout/webhook routes refuse if any are unset
  // when actually invoked.
  STRIPE_SECRET_KEY: Type.String({
    default: '',
    description:
      'Stripe API secret key (sk_test_… or sk_live_…). Used for /checkout PaymentIntent creation.',
  }),
  STRIPE_WEBHOOK_SECRET: Type.String({
    default: '',
    description:
      'Stripe webhook signing secret (whsec_…). Used by the webhook handler to verify ' +
      'Stripe-Signature header HMAC-SHA256 against the raw request body before any business logic runs.',
  }),
  // 14.08.2026: kurz geloescht, weil der Leser fehlte — mit dem Kartenleser-
  // Webhook (routes/stripe-webhook.ts) wieder da. Die Trennung hatte den
  // ganzen Webhook mit dem Kundenshop entsorgt; der Leser braucht ihn.
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: Type.Integer({
    default: 300,
    minimum: 30,
    maximum: 3600,
    description:
      'Maximum age of the Stripe-Signature timestamp (in seconds) accepted by the webhook handler. ' +
      'Stripe recommends 5 minutes (300). Older signatures are refused (replay defense).',
  }),
  STRIPE_API_VERSION: Type.String({
    default: '2024-12-18.acacia',
    description:
      'Pinned Stripe API version to avoid surprise schema changes (Stripe documents version-on-write).',
  }),
  // ── Stripe Connect Standard (das eigene Konto des Händlers) ──────────────
  // Ohne diese Werte bleibt die Kartenzahlung auf dem Plattformkonto. MIT
  // ihnen läuft sie als Direktbelastung auf dem Konto des Händlers, und nur
  // dann ist Norns kein Zahlungsdienst im Sinne des ZAG.
  STRIPE_APPLICATION_FEE_BPS: Type.Integer({
    default: 0,
    minimum: 0,
    maximum: 1000,
    description:
      'Vermittlungsgebühr in Basispunkten (100 = 1,00 %), die die Plattform je Direktbelastung ' +
      'entnimmt. Vorgabe 0: ohne ausdrückliche Festlegung wird KEINE Gebühr erhoben. Pro Laden ' +
      'übersteuerbar über stripe_connected_accounts.application_fee_bps. Obergrenze 10 %.',
  }),
  STRIPE_CONNECT_RETURN_URL: Type.String({
    default: '',
    description:
      'Wohin Stripe den Händler nach abgeschlossener Einrichtung zurückschickt. Die Rückkehr ist ' +
      'KEIN Beweis für eine Freischaltung: der Stand wird danach aktiv bei Stripe abgefragt.',
  }),
  STRIPE_CONNECT_REFRESH_URL: Type.String({
    default: '',
    description:
      'Wohin Stripe den Händler schickt, wenn der Onboarding-Link abgelaufen ist. Diese Seite muss ' +
      'einen frischen Link anfordern, denn ein AccountLink ist einmalig und kurzlebig.',
  }),
  // ── Staff / Owner Google Sign-In (admin OAuth) ───────────────────────
  // A SEPARATE OAuth client from the storefront + Calendar: staff login needs
  // its own "Web application" OAuth 2.0 Client ID. The consent screen is
  // org-restricted (Workspace-internal), so only warehouse14.de accounts can
  // authorise; the server ALSO resolves the verified email against the `users`
  // table and 403s any address that is not a provisioned staff member. Empty
  // defaults -> the admin Google route answers 503 and the app boots fine.
  GOOGLE_STAFF_CLIENT_ID: Type.String({
    default: '',
    description:
      'OAuth 2.0 Web-application Client ID for staff/owner Sign-in-with-Google. Empty -> admin Google login disabled.',
  }),
  GOOGLE_STAFF_CLIENT_SECRET: Type.String({
    default: '',
    description:
      'OAuth client secret for the staff Google login. Server-side only, never sent to the browser.',
  }),
  ADMIN_PUBLIC_URL: Type.String({
    default: '',
    description:
      'Public origin of the API used to build the staff Google redirect URI ' +
      '<origin>/api/admin/auth/google/callback. Must EXACTLY match the URI registered ' +
      'on the Google OAuth client (e.g. https://api.warehouse14.de). Empty -> admin Google login disabled.',
  }),
  /**
   * ── DIE NOTTUER (27.07.2026) ──────────────────────────────────────────
   * Ein langes Geheimnis, das EINE Anmeldung ohne Google erlaubt — fuer den
   * Tag, an dem Google selbst ausfaellt.
   *
   * Anlass, gemessen: Basels Google-Cloud-Projekt wurde geloescht, mit ihm
   * die Marke (der Zustimmungsbildschirm) UND alle sechs OAuth-Klienten.
   * Projekt und Klienten liessen sich wiederherstellen, die Marke nicht,
   * und ohne Marke antwortet Google auf JEDEN Klienten mit `deleted_client`.
   * Die Kasse war damit fuer NIEMANDEN mehr zu betreten — die Identitaet ist
   * seit dem 21.07. ausschliesslich Google.
   *
   * LEER heisst: die Tuer EXISTIERT NICHT. Der Weg antwortet dann 404, so als
   * waere er nie gebaut worden. Das ist die Vorgabe und der Zustand jedes
   * kuenftigen Mandanten.
   *
   * Wer sie setzt, setzt sie kurz und nimmt sie danach wieder heraus. Jede
   * Benutzung schreibt einen lauten Eintrag ins Tagebuch.
   */
  NOTZUGANG_SCHLUESSEL: Type.String({
    default: '',
    description:
      'Notfall-Anmeldung ohne Google. LEER = der Weg existiert nicht (404). Mindestens 32 ' +
      'Zeichen. Nur setzen, solange Google ausfaellt, danach wieder entfernen.',
  }),
  /** Die Kennung des Kontos, das die Nottuer anmeldet. Leer = das erste Inhaberkonto. */
  NOTZUGANG_KONTO: Type.String({
    default: '',
    description: 'E-Mail des Kontos, das ueber die Nottuer angemeldet wird. Leer = erster Inhaber.',
  }),
  STAFF_GOOGLE_HD: Type.String({
    default: '',
    description:
      'Optional Google Workspace domain hint (e.g. warehouse14.de) added as the ' +
      'oauth "hd" parameter to pre-select the org account. UX only, not a security ' +
      'boundary: the org-restricted consent screen and the users-table lookup are.',
  }),
  // ── Telemetry (GlitchTip / Sentry-compatible) ────────────────────────
  // Optional + fail-safe: empty → telemetry disabled, the app boots normally.
  SENTRY_DSN: Type.Optional(Type.String({ default: '' })),
  // ── Prometheus scrape token (plugins/metrics.ts) ─────────────────────
  // Bearer token a scraper must present to read /metrics IN PRODUCTION. This
  // one is fail-SHUT, not fail-safe: empty in production → /metrics answers 404
  // to everyone. That is deliberate. An open /metrics is a free health, traffic
  // and error-rate oracle for anyone probing the shop, and no scraper exists
  // today, so the safe default is closed. Development ignores this entirely.
  METRICS_TOKEN: Type.String({
    default: '',
    description:
      'Bearer token required to scrape /metrics in production. Empty → /metrics is closed (404).',
  }),
  // ── OpenSanctions screening (Epic J — GwG §10 PEP/EU/OFAC matching) ──
  // Empty key → screening is skipped (route returns matched:false, skipped:true)
  // so the app boots + checks out fine without the external service wired.
  OPENSANCTIONS_API_KEY: Type.String({
    default: '',
    description:
      'OpenSanctions hosted match API key (Authorization: ApiKey …). Empty → ' +
      'screening is skipped; a transaction is never blocked by a missing key.',
  }),
  OPENSANCTIONS_SCORE_THRESHOLD: Type.String({
    default: '0.7',
    pattern: '^\\d+\\.\\d+$',
    description:
      'Match score (0.0–1.0) at/above which a customer counts as a sanctions hit. ' +
      'Decimal string, e.g. "0.7". Tunable without code change.',
  }),
  // ── Fiskaly DSFinV-K (Epic K — year-end fiscal export) ───────────────
  // Empty → the DSFinV-K push is skipped (logged "fiskaly not configured");
  // the daily-closing flow is never blocked by a missing/erroring Fiskaly.
  FISKALY_API_KEY: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API key (Basic auth user). Empty → push skipped.',
  }),
  FISKALY_API_SECRET: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API secret (Basic auth password). Empty → push skipped.',
  }),
  // ── Duress PIN silent alarm (Decision #37) ───────────────────────────
  // Optional outbound webhook fired in the background on a duress login.
  // Empty → the alarm still hits audit_log + the alert.duress ledger event.
  DURESS_ALARM_WEBHOOK_URL: Type.String({
    default: '',
    description: 'POST target for the silent duress alarm. Empty → no external webhook.',
  }),
  // 19.08.2026: hier standen drei Schluessel des ausgebauten
  // Sprachassistenten. Weg mit dem Assistenten; kein toter Schluessel
  // bleibt in der Umgebung liegen.
  ENFORCE_DEVICE_BINDING: Type.String({
    default: '',
    description:
      'Security audit 2026-07-24. "true" turns the device-to-token binding (0106) from ' +
      'recorded-only into ENFORCED: a session token presented from a device other than the one ' +
      'it was bound to at login is refused. Keep EMPTY until Cloudflare Access mTLS is provisioned ' +
      '(TEST_DEVICE_FINGERPRINT dropped), because under the bypass every request resolves to the ' +
      'same seeded device and the binding would be a trivial no-op anyway. Flip to "true" at ' +
      'mTLS go-live, together with dropping the fingerprint bypass. The binding code is always ' +
      'present; this flag only decides whether a mismatch REJECTS or is merely logged.',
  }),
  ENFORCE_PIN_BLACKLIST_ON_LOGIN: Type.String({
    default: '',
    description:
      'Security review 2026-07-21. "true" makes pin-login REFUSE a weak/blacklisted PIN (e.g. the ' +
      'legacy 0000 owner seed) with a plain "Invalid PIN", closing the anonymous internet exploit ' +
      'without touching mTLS or mutating any PIN. Keep empty until the owner has set a strong PIN ' +
      '(so his step-up / cashier fallback are not locked out); then set "true". See ' +
      'docs/runbooks/0090-auth-hardening.md. SUPERSEDED by DISABLE_PIN_AUTH when that is "true".',
  }),
  DISABLE_PIN_AUTH: Type.String({
    default: '',
    description:
      "Basel's decision 2026-07-21: the 4-digit PIN is retired. Identity is Google-only. " +
      '"true" makes EVERY PIN endpoint (pin-login, step-up, pin/set, duress-pin/set) refuse with ' +
      '403 PIN_AUTH_DISABLED. The whole PIN mechanism (tables, hashes, argon2, lockout) stays in ' +
      'the code untouched so it can be re-enabled, but no PIN can start or elevate a session while ' +
      'this is on. This is the hard close of the anonymous 0000 internet exploit. LIVE on prod.',
  }),
});

export type Env = Static<typeof EnvSchema>;

/**
 * Read process.env, coerce numeric strings to numbers, apply defaults, and
 * validate the whole thing. Throws an aggregated error on the first failure
 * so the operator sees ALL missing/invalid vars in one shot.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const coerced: Record<string, unknown> = { ...source };
  // Convert EVERY integer/number-typed var from string → number BEFORE
  // validation, because process.env is `Record<string, string | undefined>`.
  // Derived from the schema so a new numeric field can't be forgotten here
  // (the bug that crashed boot when STRIPE_WEBHOOK_TOLERANCE_SECONDS was set).
  for (const [key, propSchema] of Object.entries(EnvSchema.properties)) {
    const t = (propSchema as { type?: string }).type;
    if (
      (t === 'integer' || t === 'number') &&
      typeof coerced[key] === 'string' &&
      coerced[key] !== ''
    ) {
      const n = Number(coerced[key]);
      if (!Number.isNaN(n)) coerced[key] = n;
    }
  }

  const candidate = Value.Default(EnvSchema, coerced);
  const errors = [...Value.Errors(EnvSchema, candidate)];
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path || '/'} — ${e.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }

  const env = candidate as Env;
  // Go-live hardening: fail fast if a production build still carries the
  // pre-mTLS device-gate bypass without an explicit acknowledgement. Runs in
  // every boot path because every entrypoint goes through loadEnv().
  assertNoTestDeviceFingerprintInProd(env, source);

  // KYC image at-rest key must be a valid 32-byte AES-256 key. Fail the boot,
  // never a runtime Ausweis encryption.
  assertKycImageKeyValid(env);

  return env;
}

/**
 * Boot guard — KYC_IMAGE_ENCRYPTION_KEY MUST decode (base64) to exactly 32 bytes
 * (AES-256). A misconfigured key fails the boot, never a runtime Ausweis write.
 * The key value is NEVER included in the error message or any log.
 */
export function assertKycImageKeyValid(env: Env): void {
  const decoded = Buffer.from(env.KYC_IMAGE_ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    throw new Error(
      `FATAL: KYC_IMAGE_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256); got ${decoded.length}. ` +
        'Generate with `openssl rand -base64 32`. Refusing to start.',
    );
  }
}

/**
 * Convenience: `parseOrigins(env)` → string[] for CORS plugin / better-auth.
 */
export function parseOrigins(env: Env): string[] {
  return env.TRUSTED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Day 16 audit fix A-2 — assert the DATABASE_URL points at the
 * `warehouse14_app` role only. If a misconfiguration ever sets the URL to
 * the migrator or another role, refuse to start: a compromised app would
 * inherit too-broad privileges (DELETE on fiscal tables, DDL, etc.).
 *
 * The check is a substring match on the userinfo segment of the URL —
 * `postgres://<user>[:<pass>]@host:port/db`. We do not parse with `URL`
 * because postgres-js URLs sometimes carry colons in passwords that the
 * WHATWG parser mis-classifies.
 *
 * Tests / dev override: set `DATABASE_URL_ROLE_OVERRIDE=1` to bypass the
 * assertion (testcontainers may use the `postgres` superuser temporarily,
 * or a custom role). Production refuses the override flag (see prod-safety
 * Phase 1.5).
 */
export function assertAppRoleInDatabaseUrl(env: Env): void {
  if (process.env.DATABASE_URL_ROLE_OVERRIDE === '1') return;
  const url = env.DATABASE_URL;

  // Extract the user from `postgres://USER:pass@host…` or `postgres://USER@host…`.
  const match = /^postgres(?:ql)?:\/\/([^:@/]+)(?::|@)/.exec(url);
  if (!match) {
    throw new Error(
      'DATABASE_URL does not have the expected `postgres://user:pass@host/db` shape. ' +
        'Refusing to start (audit fix A-2).',
    );
  }
  // biome-ignore lint/style/noNonNullAssertion: the regex above guarantees group 1 when matched.
  const user = decodeURIComponent(match[1]!);

  // ── Warum hier ein MUSTER steht und kein fester Name ────────────────────
  //
  // Diese Prüfung hiess ursprünglich `user !== 'warehouse14_app'`. Ihre Absicht
  // ist richtig und bleibt unverändert: die API darf NIEMALS als Migrator, als
  // Worker oder als Eigentümer laufen, sondern nur mit der am wenigsten
  // privilegierten Rolle.
  //
  // Der feste Name macht daraus aber zusätzlich eine Ein-Mandanten-Annahme.
  // Sobald jeder Händler einen eigenen Anmeldebenutzer bekommt, und das MUSS
  // er, weil sonst das Verbindungsrecht über die gemeinsame Gruppenrolle
  // vererbt wird und jeder Mandant in die Datenbank jedes anderen kommt,
  // heisst die Rolle `t001_app`, `t002_app` und so weiter. Der feste Name
  // liess den Dienst dann beim Start abstürzen. Am 26.07.2026 live erlebt.
  //
  // Das Muster erlaubt genau die Anwendungsrollen und nichts sonst.
  const istAnwendungsrolle = /^(warehouse14|t\d{3,})_app$/.test(user);
  if (!istAnwendungsrolle) {
    throw new Error(
      `DATABASE_URL points at role "${user}" — expected the least-privileged application role ` +
        '("warehouse14_app" or a tenant role like "t001_app"). The API runtime must never run as ' +
        'migrator, worker or owner. Refusing to start (audit fix A-2).',
    );
  }
}

/**
 * Go-live hardening guard — refuse to boot a PRODUCTION build that still
 * carries the pre-mTLS `TEST_DEVICE_FINGERPRINT` escape hatch.
 *
 * `TEST_DEVICE_FINGERPRINT` makes every device-gated request resolve to a
 * single seeded device when no Cloudflare client cert is presented — i.e. it
 * disables the mTLS device gate. That is intentional during test mode, but
 * shipping it to a hardened go-live would silently bypass device
 * authorization for the whole shop. This guard makes that mistake impossible
 * by accident: in production the fingerprint MUST be paired with the explicit
 * opt-in `ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true`, which forces whoever
 * keeps the bypass to acknowledge it in writing (env config + deploy review).
 *
 * Current state: the Schorndorf shop still runs WITH the bypass (mTLS is not
 * yet provisioned), so production deploys set the escape flag. The day mTLS
 * goes live, drop both `TEST_DEVICE_FINGERPRINT` and the escape flag — and a
 * stray fingerprint left in the env will then HARD-FAIL the boot instead of
 * silently re-opening the hole.
 */
export function assertNoTestDeviceFingerprintInProd(
  env: Env,
  source: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.TEST_DEVICE_FINGERPRINT.trim() === '') return;

  const escapeFlag = (source.ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD ?? '').trim().toLowerCase();
  if (escapeFlag === 'true') return;

  throw new Error(
    'FATAL: TEST_DEVICE_FINGERPRINT is set in a production build. This disables the ' +
      'mTLS device gate for every device-gated request and MUST NOT ship to a hardened ' +
      'go-live. Either unset TEST_DEVICE_FINGERPRINT (provision Cloudflare Access mTLS ' +
      'first), or — if you are knowingly still in pre-mTLS test mode — set ' +
      'ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true to acknowledge the bypass. Refusing to start.',
  );
}

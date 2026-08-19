/**
 * ProfileMenu — the operator identity anchor in the header, in place of the old
 * "14" seal. Shows the signed-in Google account (portrait, name, email), the
 * server-assigned role, the live session validity, and is the one place to sign
 * out.
 *
 * Two layers, deliberately split:
 *   • ProfileMenuView — PURE. Takes actor/profile/session + handlers as props and
 *     renders the medallion + popover. No hooks, so it renders in isolation (SSR
 *     preview, tests) exactly as it does in the shell.
 *   • ProfileMenu — the container. Wires the session store, the API client, the
 *     router, outside-click / Escape close, and the sign-out.
 *
 * The portrait + name come from the Google sign-in (cached on this device); the
 * email + role come from the session. When a field is not yet known (a PIN
 * session, or before the profile has been delivered) the medallion carries the
 * Norns mark and the role alone stands — never a broken image, never a guess. Colours come from the brand tokens: `--w14-gilt` is the real gold
 * thread (`--w14-gold` is a legacy name for the quiet ink accent, NOT gold).
 */

import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { type AuthProfile, type SessionActor } from '@norns/api-client';
import { Button, Zwischentitel, NornsZeichen } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { fuehreAbmeldungAus } from '../../lib/sign-out.js';
import { useSessionStore } from '../../state/session-store.js';

function roleLabel(actor: SessionActor): string {
  if (actor.isOwner) return 'Inhaber';
  switch (actor.role) {
    case 'ADMIN':
      return 'Administrator';
    case 'CASHIER':
      return 'Kassierer';
    case 'READONLY':
      return 'Nur Lesen';
    default:
      return actor.role;
  }
}

/** Honest, high-level access scope for the role — the "Berechtigungen" line. */
function scopeLabel(actor: SessionActor): string {
  if (actor.isOwner) return 'Voller Zugriff auf alle Bereiche';
  switch (actor.role) {
    case 'ADMIN':
      return 'Verwaltung, Berichte & Einstellungen';
    case 'CASHIER':
      return 'Kasse, Verkauf & Ankauf';
    case 'READONLY':
      return 'Nur Lesezugriff';
    default:
      return 'Angemeldet';
  }
}

/** "gültig bis 14. August" — the human session horizon, or null if unknown/passed. */
function validUntilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= Date.now()) return null;
  try {
    return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(new Date(t));
  } catch {
    return null;
  }
}

// ── The brass portrait medallion ─────────────────────────────────────────
// A struck-brass disc framing the portrait (or the Norns mark), echoing the "14"
// seal it replaces: a bright gilt rim, a fine inner hairline, an inset shadow
// so the metal reads as raised. The brass gradient is intentionally literal
// (like the Zielkarte instruments) — the theme tokens carry the surrounding
// chrome, the medallion carries the gold.
function Medallion({
  size,
  avatarUrl,
}: {
  size: number;
  avatarUrl: string | null;
}): JSX.Element {
  /*
   * ⚠️ DIE MESSINGSCHEIBE IST WEG (Basel, 05.08.2026):
   * „المفروض تستبدل الدائره بل كامل وتحط الوقو فقط" — ersetz den Kreis
   * vollstaendig und stell nur das Zeichen hin.
   *
   * Vorher lag das Zeichen IN einem gepraegten Goldring. Zwei Marken
   * uebereinander sind eine zu viel: der Ring war ein Erbstueck aus der
   * Zeit des „14"-Siegels und hat mit Norns nichts zu tun. Das Zeichen
   * traegt sich selbst.
   *
   * Ein hinterlegtes Lichtbild braucht weiterhin eine Form, sonst steht
   * ein Rechteck im Kopf; nur DAFUER bleibt ein runder Rahmen.
   */
  const foto: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 auto',
    border: '1px solid var(--w14-rule)',
  };
  if (avatarUrl) {
    return (
      <span style={foto} aria-hidden="true">
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return <NornsZeichen size={size} tinte="var(--w14-ink)" />;
}

export interface ProfileMenuViewProps {
  actor: SessionActor | null;
  profile: AuthProfile | null;
  sessionExpiresAt: string | null;
  open: boolean;
  signingOut: boolean;
  wrapRef?: React.Ref<HTMLDivElement>;
  onToggle: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}

/** The pure view — renders identically in the shell and in isolation. */
export function ProfileMenuView({
  actor,
  profile,
  sessionExpiresAt,
  open,
  signingOut,
  wrapRef,
  onToggle,
  onSettings,
  onSignOut,
}: ProfileMenuViewProps): JSX.Element {
  const name = profile?.displayName?.trim() || profile?.email?.split('@')[0] || 'Angemeldet';
  const email = profile?.email ?? null;
  const avatarUrl = profile?.avatarUrl ?? null;
  const validUntil = validUntilLabel(sessionExpiresAt);
  const isOwner = actor?.isOwner ?? false;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={actor ? `Profil: ${name}` : 'Profil'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 'var(--w14-abstand-2)',
          borderRadius: '50%',
          lineHeight: 0,
        }}
      >
        <Medallion size={34} avatarUrl={avatarUrl} />
      </button>

      {open && (
        <>
          {/* Caret pointing up to the medallion. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 40,
              left: 10,
              width: 12,
              height: 12,
              background: 'var(--w14-parchment-2)',
              borderTop: '1px solid var(--w14-rule)',
              borderLeft: '1px solid var(--w14-rule)',
              transform: 'rotate(45deg)',
              // Eine Stufe ueber dem Menue, damit die Pfeilspitze dessen oberen
              // Rand verdeckt und die Blase eine Form bleibt (27.07.2026).
              zIndex: 'calc(var(--w14-z-anker) + 1)',
            }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 46,
              left: 0,
              // Ebene: Anker (27.07.2026) — vorher die nackte 60, damit lag das
              // Profilmenue UNTER jedem klebenden Tabellenkopf (100) und waere
              // beim Herabklappen ueber einer Liste zerschnitten worden.
              zIndex: 'var(--w14-z-anker)',
              width: 288,
              padding: 'var(--w14-abstand-16)',
              lineHeight: 1.4,
              borderRadius: 'var(--w14-radius-card)',
              background: 'var(--w14-parchment-2)',
              border: '1px solid var(--w14-rule)',
              // Schwebendes Fenster = die Modal-Schatten-Marke, keine eigene Mischung.
              boxShadow: 'var(--w14-shadow-modal)',
              // Soft entrance from the medallion; reuses the shared dialog keyframe
              // and stills itself under prefers-reduced-motion via the global rule.
              transformOrigin: 'top left',
              animation: 'w14-dialog-in var(--w14-dur-fast) var(--w14-ease-curator)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
              <Medallion size={52} avatarUrl={avatarUrl} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--w14-font-display)',
                    fontWeight: 600,
                    fontSize: 'var(--w14-schrift-lead)',
                    color: 'var(--w14-ink)',
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </div>
                {email && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 'var(--w14-schrift-feld)',
                      color: 'var(--w14-ink-aged)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {email}
                  </div>
                )}
              </div>
            </div>

            {actor && (
              <div style={{ marginTop: 13, display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: 'var(--w14-abstand-2) var(--w14-abstand-10)',
                    borderRadius: 'var(--w14-radius-pille)',
                    fontSize: 'var(--w14-schrift-kuerzel)',
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: isOwner ? 'var(--w14-accent-ink)' : 'var(--w14-ink-aged)',
                    background: isOwner
                      ? 'var(--w14-accent)'
                      : 'var(--w14-parchment-3)',
                    border: isOwner ? '1px solid #9a7a34' : '1px solid var(--w14-rule)',
                    boxShadow: isOwner ? '0 1px 0 rgba(255,255,255,0.4) inset' : 'none',
                  }}
                >
                  {roleLabel(actor)}
                </span>
                <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                  {/* ⚠️ 01.08.2026: hier stand „mit Google angemeldet". Auf
                      dieser Kasse meldet sich niemand mit Google an — die
                      Anmeldung ist der Kassencode. Der Name kommt aus dem
                      Benutzerdatensatz, nicht von einem fremden Anbieter. */}
                  {profile?.displayName ? 'angemeldet als ' + profile.displayName : 'angemeldet'}
                </span>
              </div>
            )}

            <Zwischentitel />

            {actor && (
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)' }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    fontSize: 'var(--w14-schrift-marke)',
                    letterSpacing: '0.11em',
                    textTransform: 'uppercase',
                    color: 'var(--w14-ink-faded)',
                    fontWeight: 700,
                  }}
                >
                  Berechtigungen
                </span>
                <span style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)' }}>
                  {scopeLabel(actor)}
                </span>
              </div>
            )}

            {validUntil && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-6)',
                  marginBottom: 12,
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--w14-gilt)',
                    boxShadow: '0 0 0 2px rgb(var(--w14-gilt-rgb) / 0.22)',
                    flex: '0 0 auto',
                  }}
                />
                <span>
                  Sitzung aktiv · gültig bis {validUntil}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
              <Button variant="ghost" size="sm" onClick={onSettings}>
                Einstellungen
              </Button>
              <Button variant="primary" size="sm" onClick={onSignOut} disabled={signingOut}>
                {signingOut ? 'Wird abgemeldet …' : 'Abmelden'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The wired container used in the header. */
export function ProfileMenu(): JSX.Element {
  const navigate = useNavigate();
  const client = useApiClient();
  const qc = useQueryClient();
  const actor = useSessionStore((s) => s.actor);
  const profile = useSessionStore((s) => s.profile);
  const sessionExpiresAt = useSessionStore((s) => s.sessionExpiresAt);

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * Abmelden — die VOLLSTAENDIGE Kaskade, dieselbe wie in den Einstellungen.
   *
   * Bis zum 25.07.2026 stand hier eine eigene, kurze Fassung: Sitzung weg,
   * fertig. Der Verkaufskorb blieb im Speicher, die gelesenen Kundenakten
   * auch, und die serverseitigen Reservierungen blieben OFFEN — ohne
   * Verfallszeit, also fuer immer, bis jemand sie von Hand loeste. Der
   * naechste Mensch am selben Tresen fand den Korb seines Vorgaengers vor.
   */
  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await fuehreAbmeldungAus({ api: client, qc });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ProfileMenuView
      actor={actor}
      profile={profile}
      sessionExpiresAt={sessionExpiresAt}
      open={open}
      signingOut={signingOut}
      wrapRef={wrapRef}
      onToggle={() => setOpen((v) => !v)}
      onSettings={() => {
        setOpen(false);
        navigate('/einstellungen');
      }}
      onSignOut={() => void handleSignOut()}
    />
  );
}

/**
 * AppShellHeader — the 56-px Karteikasten rail.
 *
 *   [Seal-14]   1·Werkstatt  2·Verkauf … 8·Bewertung   ⛑ ● ⚙ ↻ ☾
 *                               ━━━ active gold hairline
 *
 * Right cluster (the only chrome controls, in this order): Support · Status-Dot ·
 * Einstellungen · Update · Darstellung. The old floating footer, the wordy sync
 * badge, the search icon and the sign-out lock were removed — search is Cmd+K,
 * sign-out lives in Einstellungen.
 */

import type { CSSProperties } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import { symbolfarbeFuer } from './symbolfarbe.js';
import { KOPFLEISTE_HOEHE, KOPF_ZIEL } from '../../lib/bedienziele.js';

import { HealthDot } from './HealthDot.js';
import { IconSettings } from './Icons.js';
import { ProfileMenu } from './ProfileMenu.js';
import { SupportButton } from './SupportButton.js';
import { SurfaceChip } from './SurfaceChip.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UpdateButton } from './UpdateButton.js';
import { PRIMARY_SURFACES, visibleSurfaces } from './surface-registry.js';
import { useSessionStore } from '../../state/session-store.js';

export interface AppShellHeaderProps {
  /** Opens the Spotlight palette (Cmd/Ctrl+K). */
  onOpenSpotlight: () => void;
  /** Performs the sign-out — wired in AppShell (now invoked from Einstellungen). */
  onSignOut: () => void;
}

// Search has no icon anymore — it's reachable via Cmd/Ctrl+K, bound globally in
// AppShell. The sign-out lock moved to Einstellungen. Props kept for the
// AppShell call-site compatibility.
export function AppShellHeader(_props: AppShellHeaderProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);
  const railSurfaces = visibleSurfaces(PRIMARY_SURFACES, isOwner);

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: 'var(--space-6)',
    // 26.07.2026: von 56 auf 64 — die Knöpfe rechts wuchsen auf das
    // 44er-Touchziel, und 56 hätte ihnen nur 6 Punkte Luft je Seite gelassen.
    height: KOPFLEISTE_HOEHE,
    padding: '0 var(--space-5)',
    backgroundColor: 'var(--w14-parchment-2)',
    borderBottom: '1px solid var(--w14-rule)',
  };

  return (
    <header style={rowStyle}>
      {/* Bewegung des aktiven Karteireiters — EINMAL hier, nicht in jedem der
          acht SurfaceChips. Der Strich entfaltet sich aus der Mitte, kurz und
          im Haus-Ausklang; unter reduced-motion steht er sofort (keine
          Animation, nicht bloss Dauer 0). Nur transform + opacity. */}
      <style>{`
        @keyframes w14-chip-strich-in {
          from { transform: scaleX(0.4); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
        .w14-chip-strich {
          animation: w14-chip-strich-in var(--w14-dur-fast) var(--w14-ease-curator) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .w14-chip-strich { animation: none; }
        }
      `}</style>
      <ProfileMenu />

      <nav
        aria-label="Karteikasten"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          overflowX: 'auto',
          // 'thin' statt 'none' (27.07.2026): faellt das Fenster unter die
          // Breite, bei der alle acht Reiter stehen, muss der Ueberlauf
          // SICHTBAR sein. Ein unsichtbarer Roller versteckte Reiter 8
          // vollstaendig — niemand rollt, wovon er nichts weiss.
          scrollbarWidth: 'thin',
        }}
      >
        {railSurfaces.map((s) => (
          <SurfaceChip
            key={s.path}
            digit={s.digit ?? 0}
            label={s.label}
            description={s.description}
            icon={s.icon}
            symbolfarbe={symbolfarbeFuer(s.path)}
            active={location.pathname.startsWith(s.path)}
            onActivate={() => navigate(s.path)}
          />
        ))}
      </nav>

      {/* Darstellung · Status-Dot · Einstellungen · Update · Support
          (identity + Abmelden now live in the ProfileMenu on the left). */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <ThemeToggle />
        <HealthDot />
        {/* Der „Alle Flächen"-Knopf ist Geschichte (27.07.2026, Basels
            Ordnung): die sekundären Flächen wohnen jetzt gruppiert in der
            Einstellungs-Spalte — EIN Weg statt zwei Türen nebeneinander.
            Das Zahnrad rechts ist diese eine Tür. */}
        <button
          type="button"
          title="Einstellungen"
          aria-label="Einstellungen"
          onClick={() => navigate('/einstellungen')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: KOPF_ZIEL,
            height: KOPF_ZIEL,
            flex: '0 0 auto',
            color:
              location.pathname === '/einstellungen' ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            background: 'transparent',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            cursor: 'pointer',
            // Der Wechsel auf Gold blendet, statt zu springen — wie der Reiter.
            transition: 'color var(--w14-dur-fast) var(--w14-ease-hover)',
          }}
        >
          <IconSettings size={20} />
        </button>
        <UpdateButton />
        <SupportButton />
      </div>
    </header>
  );
}

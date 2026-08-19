/**
 * UpdateButton — the single ↻ trigger in the header right-cluster.
 *
 * Resting state: a quiet ↻ that opens <UpdateCenter/>. When `useAppUpdate` knows
 * an update is waiting (status 'available' or 'ready'), it turns into a GREEN,
 * gently glowing download glyph (a down-arrow) — a clear „there is a new version,
 * pull it down" cue. A click always opens the one update surface, which lists
 * what changed. All lifecycle logic lives in the hook + the center.
 */

import { useState } from 'react';

import { useAppUpdate } from '../../hooks/useAppUpdate.js';
import { KOPF_ZIEL } from '../../lib/bedienziele.js';
import { IconRefresh } from './Icons.js';
import { UpdateCenter } from './UpdateCenter.js';

const SPIN_KEYFRAMES = '@keyframes w14Spin { to { transform: rotate(360deg); } }';
// The green „an update is waiting" glow — breathes so the eye catches it.
const GLOW_KEYFRAMES =
  '@keyframes w14UpdateGlow {' +
  '0%,100% { box-shadow: 0 0 0 1px rgb(var(--w14-verdigris-rgb) / 0.55), 0 0 6px rgb(var(--w14-verdigris-rgb) / 0.35); }' +
  '50% { box-shadow: 0 0 0 2px rgb(var(--w14-verdigris-rgb) / 0.8), 0 0 15px rgb(var(--w14-verdigris-rgb) / 0.55); }' +
  '}';

/** A „download / pull down the update" glyph (arrow down onto a baseline). */
function IconUpdateDown({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v11" />
      <path d="M7 9.5l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function UpdateButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { status, hasUpdate } = useAppUpdate();
  const spinning = status === 'checking' || status === 'downloading';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          hasUpdate
            ? status === 'ready'
              ? 'Update bereit, jetzt neu starten'
              : 'Update verfügbar'
            : 'Nach Updates suchen'
        }
        aria-label={
          hasUpdate
            ? status === 'ready'
              ? 'Update bereit. Aktualisierungen öffnen'
              : 'Update verfügbar. Aktualisierungen öffnen'
            : 'Nach Updates suchen'
        }
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          // 26.07.2026: 36 → gemeinsames 44er-Touchziel (bedienziele.ts).
          width: KOPF_ZIEL,
          height: KOPF_ZIEL,
          flex: '0 0 auto',
          color: hasUpdate ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
          background: 'transparent',
          border: `1px solid ${hasUpdate ? 'var(--w14-verdigris)' : 'var(--w14-rule)'}`,
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          ...(hasUpdate ? { animation: 'w14UpdateGlow 2s ease-in-out infinite' } : {}),
        }}
      >
        <style>{SPIN_KEYFRAMES + GLOW_KEYFRAMES}</style>
        {hasUpdate ? (
          <IconUpdateDown size={20} />
        ) : (
          <span
            style={{
              display: 'inline-flex',
              ...(spinning ? { animation: 'w14Spin 0.9s linear infinite' } : {}),
            }}
          >
            <IconRefresh size={20} />
          </span>
        )}
      </button>
      <UpdateCenter open={open} onClose={() => setOpen(false)} />
    </>
  );
}

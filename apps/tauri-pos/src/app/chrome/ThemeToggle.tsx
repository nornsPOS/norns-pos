/**
 * ThemeToggle — an icon-only light/dark switch. Renders INLINE (no fixed
 * positioning) so it docks cleanly into the header controls or a login-screen
 * corner instead of floating over the buttons beneath it.
 */

import { KOPF_ZIEL } from '../../lib/bedienziele.js';
import { useTheme } from '../../state/theme-store.js';
import { IconMoon, IconSun } from './Icons.js';

export function ThemeToggle(): JSX.Element {
  // Subscribe to the SINGLE theme store (Phase 7.1) — so this button, the
  // Cmd+Shift+D keybinding, and the boot paint always agree.
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Heller Modus' : 'Dunkler Modus'}
      aria-label="Darstellung umschalten"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 26.07.2026: 36 → gemeinsames 44er-Touchziel (bedienziele.ts).
        width: KOPF_ZIEL,
        height: KOPF_ZIEL,
        flex: '0 0 auto',
        fontSize: 'var(--w14-schrift-grund)',
        lineHeight: 1,
        color: 'var(--w14-ink-faded)',
        background: 'transparent',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {dark ? <IconSun size={20} /> : <IconMoon size={20} />}
    </button>
  );
}

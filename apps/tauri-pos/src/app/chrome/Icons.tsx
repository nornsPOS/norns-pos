/**
 * Icons — a single, consistent line-icon set (24×24, 1.6 stroke, currentColor).
 * One source of truth so every control uses the same visual language instead of
 * ad-hoc glyphs/emoji. Inherits colour from `color` and scales with `size`.
 */

import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
}

function Base({
  size = 20,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * Clean stroke gear (lucide `Settings` geometry, 1.7 stroke — rounded cog
 * lobes, NOT the old spiky star polygon). Slightly heavier than the 1.6 base
 * stroke so the small 18px nav rendering stays crisp.
 */
export function IconSettings(p: IconProps): JSX.Element {
  return (
    <Base strokeWidth={1.7} {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  );
}
export function IconSearch(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-3.8-3.8" />
    </Base>
  );
}
export function IconSun(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Base>
  );
}
export function IconMoon(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Base>
  );
}
export function IconPower(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M12 3v9" />
      <path d="M6.6 6.6a8 8 0 1 0 10.8 0" />
    </Base>
  );
}
export function IconChart(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3.5-4 3 2.5L21 6" />
    </Base>
  );
}
export function IconBox(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </Base>
  );
}
export function IconCamera(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </Base>
  );
}
export function IconTag(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 12.5 13.5 20 3 11.5z" />
      <circle cx="7.5" cy="7.5" r="1.4" />
    </Base>
  );
}
export function IconCash(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9v6M18 9v6" />
    </Base>
  );
}
export function IconCart(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2.2l2.3 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </Base>
  );
}
export function IconCoins(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <ellipse cx="9" cy="7" rx="6" ry="3" />
      <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3" />
      <path d="M15 12.2c2.6.3 4.5 1.4 4.5 2.8 0 1.7-2.7 3-6 3-1.5 0-2.9-.3-4-.7" />
    </Base>
  );
}
export function IconGem(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M6 3h12l3 5-9 13L3 8z" />
      <path d="M3 8h18M9 3l3 5 3-5M8 8l4 13 4-13" />
    </Base>
  );
}
export function IconUsers(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 20a6 6 0 0 0-3-5.2" />
    </Base>
  );
}
export function IconSparkles(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7z" />
    </Base>
  );
}
export function IconServer(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h0M7 16.5h0" />
    </Base>
  );
}
export function IconChat(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </Base>
  );
}
export function IconReceipt(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M5 3h14v18l-3-1.5L13 21l-3-1.5L7 21l-2-1V3z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Base>
  );
}
export function IconCheck(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M4 12.5l5 5 11-11" />
    </Base>
  );
}
export function IconRefresh(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6l2.5 2.4M20.5 12A8.5 8.5 0 0 1 6 18l-2.5-2.4" />
      <path d="M20.5 3v5.5H15M3.5 21v-5.5H9" />
    </Base>
  );
}

/** Life-buoy — the "Support / Hilfe" affordance (lucide life-buoy geometry). */
export function IconSupport(p: IconProps): JSX.Element {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M14.83 9.17 18.36 5.64M4.93 19.07l4.24-4.24" />
    </Base>
  );
}

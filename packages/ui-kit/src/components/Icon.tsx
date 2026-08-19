/**
 * Icon — the generic-action icon wrapper around lucide-react (Feather-style
 * refined line icons). KEEP the brand motifs (Seal, Zwischentitel, MagnifierIcon)
 * for identity; Icon is for universal ACTIONS (delete/close/search/add/print/…).
 *
 * Refined to the parchment/ink aesthetic: a 20px default at a thin 1.75
 * stroke-width that matches the hairline ink rules, colour = currentColor so it
 * inherits the surrounding text/button tone. Decorative by default (aria-hidden)
 * — the accessible name lives on the IconButton / labelled control around it.
 */
import type { ComponentType } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

export interface IconProps extends Omit<LucideProps, 'ref'> {
  /** A lucide-react icon component, e.g. `Trash2`, `Search`, `Plus`. */
  icon: LucideIcon;
}

export function Icon({
  icon: IconComponent,
  size = 20,
  strokeWidth = 1.75,
  ...rest
}: IconProps): JSX.Element {
  // `lucide-react`'s `LucideIcon` types its return against the React types it
  // bundles, whose `ReactNode` predates the `bigint` member added in
  // @types/react 19. This repo compiles ui-kit against the hoisted v19 types, so
  // the two `ReactNode`s are nominally distinct and TS rejects the component as a
  // JSX element (TS2786) — a types-skew artefact only, never a runtime issue (the
  // icon is a plain forwardRef component). Coerce to the local `ComponentType` at
  // the single render site so the JSX constraint resolves; the public `icon` prop
  // stays a `LucideIcon`, so callers are unaffected.
  const Glyph = IconComponent as ComponentType<LucideProps>;
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}

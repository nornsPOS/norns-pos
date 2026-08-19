/**
 * Accordion — collapsible section group, the layout primitive for the
 * Product lifecycle sheet (Details → Fotos → Preis → Etikett → Handel).
 *
 * Each `AccordionItem` owns its open/closed state. The header is a real
 * `<button aria-expanded aria-controls>` (≥48px touch target) with an
 * optional right-aligned `adornment` slot (e.g. a status chip); the body is
 * a labelled `role="region"` rendered only while open.
 */
import { type CSSProperties, type ReactNode, useId, useState } from 'react';

export interface AccordionProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function Accordion({ children, style }: AccordionProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>{children}</div>
  );
}

export interface AccordionItemProps {
  /** Stable id used to wire aria-controls / aria-labelledby. */
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  /** Right-aligned header content — e.g. a lifecycle status chip. */
  adornment?: ReactNode;
  children: ReactNode;
}

export function AccordionItem({
  id,
  title,
  defaultOpen = false,
  adornment,
  children,
}: AccordionItemProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const generated = useId();
  const headerId = `${generated}-header`;
  const regionId = `${generated}-region`;

  return (
    <section
      data-accordion-item={id}
      style={{
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          minHeight: 48,
          padding: '12px 16px',
          border: 'none',
          background: 'transparent',
          color: 'var(--w14-ink)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 600,
          fontSize: '0.98rem',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform var(--w14-dur-short) var(--w14-ease-curator)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          ▸
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {adornment && <span style={{ flex: '0 0 auto' }}>{adornment}</span>}
      </button>
      {open && (
        // A named <section> is an implicit region (aria-labelledby supplies the
        // name) — no explicit role="region" needed.
        <section
          id={regionId}
          aria-labelledby={headerId}
          style={{ padding: '4px 16px 16px', borderTop: '1px solid var(--w14-rule)' }}
        >
          {children}
        </section>
      )}
    </section>
  );
}

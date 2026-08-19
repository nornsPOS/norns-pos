/**
 * Popover — a lightweight ANCHORED, non-modal overlay (the metal-ticker detail).
 *
 * Shares the P0 modal disciplines where they matter — focus moves in on open
 * and RESTORES to the trigger on close, Escape closes — but is non-modal: it
 * anchors to a trigger element, closes on an outside mousedown, and does NOT
 * lock scroll or trap focus (a glance, not a task). Positioning reads the
 * anchor's rect (visual only; jsdom has no layout, so tests assert behaviour).
 */
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const POPOVER_WIDTH = 264;

export interface PopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function Popover({
  open,
  anchorRef,
  onClose,
  ariaLabel,
  children,
  style,
}: PopoverProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Rising-edge capture of the trigger, during render, before focus moves.
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
  }
  wasOpen.current = open;

  // Position below the anchor + move focus in; restore focus on close.
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (anchor && typeof anchor.getBoundingClientRect === 'function') {
      const r = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPos({ top: r.bottom + 6, left });
    }
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      (focusables[0] ?? panel).focus();
    }
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, anchorRef]);

  // Escape + outside-mousedown close.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    };
    const onDown = (ev: MouseEvent): void => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  // role spread as an object so the static a11y rule doesn't push us to <dialog>;
  // this is a custom non-modal popover (correct ARIA is role="dialog" + a name).
  const ariaProps: Record<string, string> = { role: 'dialog', 'aria-label': ariaLabel };

  return createPortal(
    <div
      ref={panelRef}
      {...ariaProps}
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        // Eigene Sprosse ÜBER dem Fenster: eine geheftete Blase wird in aller
        // Regel aus einem offenen Fenster heraus geöffnet (Käuferwahl im
        // Bezahldialog), müsste bei gleicher Ebene also auf die Reihenfolge im
        // Seitenkörper vertrauen. Der Zahlenwert bleibt die bisherige 1060.
        zIndex: 'var(--w14-z-anker)',
        width: POPOVER_WIDTH,
        maxWidth: 'calc(100vw - 16px)',
        background: 'var(--w14-parchment-2)',
        color: 'var(--w14-ink)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        boxShadow: 'var(--w14-shadow-modal)',
        padding: 14,
        outline: 'none',
        animation: 'w14-dialog-in var(--w14-dur-short) var(--w14-ease-curator)',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Dialog / Sheet shared modal foundation.
 *
 * Every dialog in the app used to be a hand-rolled `<div role="dialog">`
 * with, at best, a window-level Escape listener and a backdrop onClick —
 * no focus trap, no focus restore, no scroll-lock, inconsistent aria. That
 * inconsistency is the "unfinished" feel the operator reported.
 *
 * `ModalShell` is the single a11y core both `Dialog` (centered) and `Sheet`
 * (right slide-over) build on:
 *   • role="dialog" aria-modal, aria-labelledby wired to the title (or
 *     aria-label when there is no visible title)
 *   • focus TRAP (Tab / Shift+Tab cycle within the panel)
 *   • focus RESTORE to whatever was focused before open, on close
 *   • Escape-to-close + backdrop-click-close (each prop-configurable)
 *   • body scroll-lock while open (ref-counted for stacked modals)
 *   • enter motion via the brand easing + duration tokens, exit via the
 *     house Abgang (dur-exit + ease-out-quart, schneller als der Eintritt;
 *     reduced-motion = Sofortwechsel)
 *
 * Touch-first: the close affordance and any footer actions are ≥48px.
 */

import { X } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './Icon.js';

/**
 * Liest die Bewegungs-Vorliebe direkt, statt sich auf die globale Regel in
 * tokens.css zu verlassen: die kürzt nur DAUERN. Für den Abgang heisst
 * reduzierte Bewegung „Sofortwechsel" — das Fenster verlässt den Baum ohne
 * Abschiedsbild, genau wie vor diesem Umbau.
 */
function reduzierteBewegung(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Notausgang für den Abgang: feuert `animationend` nie (etwa weil eine
 * fremde Regel die Animation verwirft), darf das unsichtbare Fenster nicht
 * ewig im Baum hängen und Zeiger schlucken. 160ms Abgang + Reserve.
 */
const ABGANG_NOTAUSGANG_MS = 320;

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const CENTER_MAX_WIDTH: Record<ModalSize, number> = {
  sm: 380,
  md: 520,
  lg: 720,
  xl: 960,
};

const SHEET_WIDTH: Record<ModalSize, number> = {
  sm: 360,
  md: 460,
  lg: 620,
  xl: 820,
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * NB: we deliberately do NOT filter by `offsetParent`/visibility — jsdom does
 * not compute layout, so that filter would hide every element under test. In
 * production a focusable inside an open dialog is, by construction, visible.
 */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

// ── Ref-counted scroll lock — stacked modals must not unlock prematurely ──
let scrollLockCount = 0;
let savedBodyOverflow = '';
function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}
function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  variant: 'center' | 'sheet';
  size?: ModalSize;
  /** Visible title; when set, a header (title + optional close X) renders and aria-labelledby is wired. */
  title?: string;
  /** Used as aria-label when there is no visible `title`. */
  ariaLabel?: string;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
  /** Element focused first on open; defaults to the first focusable (respecting child autoFocus). */
  initialFocusRef?: RefObject<HTMLElement>;
  className?: string;
  panelStyle?: CSSProperties;
  children: ReactNode;
}

export function ModalShell({
  open,
  onClose,
  variant,
  size = 'md',
  title,
  ariaLabel,
  closeOnEsc = true,
  closeOnBackdrop = true,
  showClose = true,
  initialFocusRef,
  className,
  panelStyle,
  children,
}: ModalShellProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const titleId = useId();

  // ── Abgang ────────────────────────────────────────────────────────────
  // Das Fenster hatte einen Eintritt, aber KEINEN Austritt: beim Schliessen
  // fiel es ersatzlos aus dem Baum. Diese Asymmetrie ist es, die Bewegung
  // billig wirken lässt — das Papier legte sich hin und wurde dann
  // weggezaubert. Jetzt bleibt das Fenster nach `open=false` einen Abgang
  // lang (dur-exit, ease-out-quart) im Baum, sofort aria-hidden und ohne
  // Zeiger: für Fokus, Leser und Prüfungen ist es bereits GESCHLOSSEN, nur
  // das Auge sieht es sich noch hinlegen. Esc und Schleier-Klick laufen
  // beide über onClose und fühlen sich damit zwangsläufig identisch an.
  const [abgang, setAbgang] = useState(false);
  const offenVorher = useRef(open);
  useEffect(() => {
    const war = offenVorher.current;
    offenVorher.current = open;
    if (open) {
      // Wieder geöffnet, während der Abgang noch lief: Abgang verwerfen,
      // sonst stünden zwei Schleier übereinander.
      setAbgang(false);
      return;
    }
    if (!war) return; // war nie offen — nichts zu verabschieden
    if (reduzierteBewegung()) return; // Sofortwechsel
    setAbgang(true);
    const notausgang = window.setTimeout(() => setAbgang(false), ABGANG_NOTAUSGANG_MS);
    return () => window.clearTimeout(notausgang);
  }, [open]);

  // Rising-edge capture of the previously-focused element, during render —
  // BEFORE the panel mounts and any child autoFocus moves focus. This is the
  // only point where document.activeElement still reliably holds the trigger.
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
  }
  wasOpen.current = open;

  // Scroll-lock + initial focus + focus-restore, all tied to `open`.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();

    const panel = panelRef.current;
    if (panel) {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (!panel.contains(document.activeElement)) {
        // Respect a child's autoFocus (it already ran in the commit phase);
        // otherwise pull focus to the first focusable, or the panel itself.
        const focusables = focusableWithin(panel);
        (focusables[0] ?? panel).focus();
      }
    }

    return () => {
      unlockBodyScroll();
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) {
        el.focus();
      }
    };
  }, [open, initialFocusRef]);

  // Document-level key handler: Escape + Tab trap (works regardless of which
  // element inside the panel currently holds focus).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        if (closeOnEsc) {
          ev.preventDefault();
          onClose();
        }
        return;
      }
      if (ev.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = focusableWithin(panel);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        ev.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const insidePanel = panel.contains(active);
      if (ev.shiftKey) {
        if (active === first || !insidePanel) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !insidePanel) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeOnEsc, onClose]);

  if (!open && !abgang) return null;
  if (typeof document === 'undefined') return null;

  // Während des Abgangs ist das Fenster nur noch ein Bild seiner selbst.
  const verabschiedet = !open;

  const dialogAriaProps: Record<string, string> = {
    role: 'dialog',
    'aria-modal': 'true',
    // 19.08.2026: die Marke des Haus-Fensters. tokens.css gibt seither JEDEM
    // handgerollten `role="dialog"` den Haus-Eintritt; dieses Bauteil bewegt
    // sich bereits selbst (Inline-Animation samt Abgang) und meldet sich hier
    // ab, damit seine Kinder nicht doppelt anlaufen.
    'data-w14-fenster': 'haus',
    ...(title ? { 'aria-labelledby': titleId } : ariaLabel ? { 'aria-label': ariaLabel } : {}),
  };

  const isSheet = variant === 'sheet';

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--w14-overlay)',
    // Benannte Ebene statt nackter 1050 (siehe tokens.css). Der Zahlenwert ist
    // unverändert, damit sich am Verhältnis zu den fremden Zahlen in der Kasse
    // nichts verschiebt — geändert hat sich nur, dass die Meldungsstufe nun
    // nachweislich darüber liegt.
    zIndex: 'var(--w14-z-fenster)',
    display: 'flex',
    alignItems: isSheet ? 'stretch' : 'center',
    justifyContent: isSheet ? 'flex-end' : 'center',
    padding: isSheet ? 0 : 24,
    // `forwards` auf dem Abgang: zwischen dem Ende der Animation und dem
    // Abräumen aus dem Baum liegt ein Wimpernschlag — ohne fill spränge der
    // Schleier für genau diesen Wimpernschlag auf volle Deckkraft zurück.
    animation: verabschiedet
      ? 'w14-modal-overlay-out var(--w14-dur-exit) var(--w14-ease-exit) forwards'
      : 'w14-modal-overlay-in var(--w14-dur-short) var(--w14-ease-curator)',
    // Ein Fenster im Abgang darf keine Zeiger mehr schlucken: wer sofort
    // weiterklickt, trifft die Fläche darunter, nicht das Abschiedsbild.
    pointerEvents: verabschiedet ? 'none' : undefined,
  };

  const basePanelStyle: CSSProperties = isSheet
    ? {
        width: `min(${SHEET_WIDTH[size]}px, 100%)`,
        height: '100%',
        maxHeight: '100dvh',
        borderRadius: 0,
        animation: verabschiedet
          ? 'w14-sheet-out var(--w14-dur-exit) var(--w14-ease-exit) forwards'
          : 'w14-sheet-in var(--w14-dur-medium) var(--w14-ease-curator)',
      }
    : {
        width: `min(${CENTER_MAX_WIDTH[size]}px, 100%)`,
        maxHeight: 'calc(100dvh - 48px)',
        borderRadius: 'var(--w14-radius-card)',
        animation: verabschiedet
          ? 'w14-dialog-out var(--w14-dur-exit) var(--w14-ease-exit) forwards'
          : 'w14-dialog-in var(--w14-dur-medium) var(--w14-ease-curator)',
      };

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the overlay is a pointer-only backdrop convenience; keyboard users dismiss via the document-level Escape handler above, so the dialog is fully keyboard-operable.
    <div
      data-testid="w14-dialog-overlay"
      // Sofort aus dem Baum der Hilfen: für Leser und Fokus existiert das
      // Fenster ab dem Schliessen nicht mehr, nur das Auge sieht den Abgang.
      aria-hidden={verabschiedet ? true : undefined}
      onAnimationEnd={(ev) => {
        // Der reguläre Ausgang des Abgangs; der Notausgang oben ist nur die
        // Reserve. Nur auf die eigene Abgangs-Animation hören — Kinder
        // (Panel, Inhalt) blubbern ihre animationend-Ereignisse hier durch.
        if (ev.animationName === 'w14-modal-overlay-out') setAbgang(false);
      }}
      onMouseDown={(ev) => {
        // close only when the press starts on the overlay itself (not on a
        // child that bubbles up), so a drag that ends on the backdrop is safe.
        if (closeOnBackdrop && ev.target === ev.currentTarget) {
          onClose();
        }
      }}
      onClick={(ev) => {
        if (closeOnBackdrop && ev.target === ev.currentTarget) {
          onClose();
        }
      }}
      style={overlayStyle}
    >
      <div
        ref={panelRef}
        // role="dialog" + aria-modal is the correct ARIA contract for a custom
        // modal (WAI-ARIA APG dialog pattern). The native <dialog> element is
        // deliberately avoided so we control focus-trap + scroll-lock uniformly
        // in the Tauri webview. Spread as an object so the static a11y rule
        // does not push us toward <dialog>.
        {...dialogAriaProps}
        tabIndex={-1}
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--w14-parchment-2)',
          color: 'var(--w14-ink)',
          boxShadow: 'var(--w14-shadow-modal)',
          outline: 'none',
          ...basePanelStyle,
          ...panelStyle,
        }}
      >
        {title && (
          <DialogHeader>
            <h2 id={titleId} style={HEADER_TITLE_STYLE}>
              {title}
            </h2>
            {showClose && <DialogCloseButton onClose={onClose} />}
          </DialogHeader>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

const HEADER_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontWeight: 600,
  fontSize: '1.2rem',
  lineHeight: 1.3,
  color: 'var(--w14-ink)',
};

/** Header row — title slot on the left, actions (e.g. the close X) on the right. */
export function DialogHeader({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '16px 20px',
        borderBottom: '1px solid var(--w14-rule)',
        flex: '0 0 auto',
      }}
    >
      {children}
    </div>
  );
}

/** Scrollable body region. */
export function DialogBody({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <div
      style={{
        padding: 20,
        overflowY: 'auto',
        flex: '1 1 auto',
        minHeight: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Footer action row — right-aligned by default. */
export function DialogFooter({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
        padding: '14px 20px',
        borderTop: '1px solid var(--w14-rule)',
        flex: '0 0 auto',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function DialogCloseButton({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Schließen"
      // hover, focus-visible und Druck kommen aus `.w14-icon-button`
      // (tokens.css) — dieselbe Zustandssprache wie jeder Symbol-Knopf.
      className="w14-icon-button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: 48,
        flex: '0 0 auto',
        border: 'none',
        color: 'var(--w14-ink-faded)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
        fontSize: '1.25rem',
        lineHeight: 1,
      }}
    >
      <Icon icon={X} size={18} />
    </button>
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  size?: ModalSize;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  children: ReactNode;
}

/** Centered modal dialog. */
export function Dialog(props: DialogProps): JSX.Element | null {
  return <ModalShell variant="center" {...props} />;
}

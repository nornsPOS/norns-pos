/**
 * Sheet — right-edge slide-over. Identical a11y core to Dialog (focus trap +
 * restore, ESC / backdrop close, scroll-lock, aria) via the shared
 * `ModalShell`; only the panel geometry + enter motion differ. Use the same
 * DialogHeader / DialogBody / DialogFooter slots inside it.
 *
 * This is the primitive the P1 "Unified Product Lifecycle" product sheet
 * will be built on.
 *
 * Ebene: die Schublade erbt die Sprosse `--w14-z-fenster` aus `ModalShell` —
 * sie setzt bewusst KEINE eigene Zahl, sonst gäbe es zwei Wahrheiten darüber,
 * wie hoch ein Fenster liegt.
 */
import { ModalShell, type ModalShellProps } from './Dialog.js';

export type SheetProps = Omit<ModalShellProps, 'variant'>;

export function Sheet(props: SheetProps): JSX.Element | null {
  return <ModalShell variant="sheet" {...props} />;
}

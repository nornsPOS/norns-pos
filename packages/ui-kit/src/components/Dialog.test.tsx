/**
 * Dialog — behaviour-level a11y contract.
 *
 * These prove the REAL guarantees a hand-rolled `<div role="dialog">` never
 * had: focus trap, focus RESTORE to the trigger, ESC + backdrop close (and
 * their opt-outs), and correct aria wiring. No snapshots.
 */
import { useState } from 'react';

import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogBody, DialogFooter } from './Dialog.js';

/** A realistic open/close harness: a trigger button that owns the dialog. */
function Harness(props: {
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open-trigger
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Test Title"
        closeOnEsc={props.closeOnEsc}
        closeOnBackdrop={props.closeOnBackdrop}
        showClose={props.showClose}
      >
        <DialogBody>
          <button type="button">first</button>
          <button type="button">middle</button>
          <button type="button">last</button>
        </DialogBody>
        <DialogFooter>
          <button type="button">footer-action</button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

describe('Dialog a11y core', () => {
  it('sets aria-modal and links aria-labelledby to the title text', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open-trigger'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    const title = document.getElementById(labelledby as string);
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Test Title');
  });

  it('moves focus into the dialog on open and RESTORES it to the trigger on close', () => {
    render(<Harness />);
    const trigger = screen.getByText('open-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    // focus is now somewhere inside the dialog, not back on the trigger.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    // ESC closes → focus must return to the element that opened it.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ESC closes by default but not when closeOnEsc is false', () => {
    const { rerender } = render(<Harness closeOnEsc={false} />);
    fireEvent.click(screen.getByText('open-trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // stayed open

    rerender(<Harness closeOnEsc={true} />);
    // fresh harness instance — reopen and confirm ESC works
    fireEvent.click(screen.getByText('open-trigger'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('backdrop click closes when enabled, does NOT when disabled, and a panel click never closes', () => {
    // enabled (default)
    render(<Harness />);
    fireEvent.click(screen.getByText('open-trigger'));
    const overlay = screen.getByTestId('w14-dialog-overlay');
    // a click that originates inside the panel must not close
    fireEvent.click(screen.getByText('middle'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // a click on the overlay itself closes
    fireEvent.click(overlay);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT close on backdrop click when closeOnBackdrop is false', () => {
    render(<Harness closeOnBackdrop={false} />);
    fireEvent.click(screen.getByText('open-trigger'));
    fireEvent.click(screen.getByTestId('w14-dialog-overlay'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('traps Tab focus: wraps last→first and Shift+Tab first→last', () => {
    render(<Harness showClose={false} />);
    fireEvent.click(screen.getByText('open-trigger'));
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = '';
    render(<Harness />);
    fireEvent.click(screen.getByText('open-trigger'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    render(
      <Dialog open={false} onClose={onClose} title="Hidden">
        <DialogBody>body</DialogBody>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('spielt beim Schließen einen ABGANG: sofort aria-hidden, dann räumt sich das Fenster ab', async () => {
    // Das Fenster hatte einen Eintritt und KEINEN Austritt — beim Schliessen
    // fiel es ersatzlos aus dem Baum. Jetzt bleibt es einen Abgang lang als
    // Bild stehen. Die Zusicherung hier ist doppelt:
    //   • für Leser, Fokus und Prüfungen ist es SOFORT geschlossen
    //     (aria-hidden → role=dialog verschwindet aus dem Baum der Hilfen);
    //   • das Abschiedsbild verlässt den Baum von selbst — auch wenn
    //     `animationend` nie feuert (jsdom feuert es nie, der Notausgang
    //     räumt ab). Ein unsichtbares Fenster, das ewig liegen bleibt und
    //     Zeiger schluckt, wäre schlimmer als gar kein Abgang.
    render(<Harness />);
    fireEvent.click(screen.getByText('open-trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); // für Hilfen: sofort zu
    expect(screen.getByTestId('w14-dialog-overlay')).toBeInTheDocument(); // fürs Auge: noch da
    // Das Abschiedsbild darf keine Klicks mehr fangen.
    expect(screen.getByTestId('w14-dialog-overlay').style.pointerEvents).toBe('none');

    await waitForElementToBeRemoved(() => screen.queryByTestId('w14-dialog-overlay'), {
      timeout: 2000,
    });
  });

  it('reduzierte Bewegung heißt SOFORTWECHSEL: kein Abschiedsbild im Baum', () => {
    // Die globale Regel in tokens.css kürzt nur Dauern; der Abgang selbst
    // fragt matchMedia. Hier wird die Vorliebe vorgetäuscht und geprüft,
    // dass das Fenster den Baum ohne Zwischenzustand verlässt.
    const echt = window.matchMedia;
    window.matchMedia = ((abfrage: string) =>
      ({
        matches: abfrage.includes('prefers-reduced-motion'),
        media: abfrage,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText('open-trigger'));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByTestId('w14-dialog-overlay')).toBeNull();
    } finally {
      window.matchMedia = echt;
    }
  });
});

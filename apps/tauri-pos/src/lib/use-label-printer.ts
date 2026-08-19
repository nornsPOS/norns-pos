/**
 * useLabelPrinter — one place that turns label payloads into a print call.
 *
 * Reads the configured label printer from the hardware store, dispatches via
 * the Rust bridge (`labelClient.print`), and surfaces a success/error toast.
 * Both the Ankauf receipt and the Bewertung outcome use this.
 */

import { diagnoseAlsZeile } from './drucker-diagnose.js';
import { useCallback } from 'react';

import { useHardwareStore } from '../state/hardware-store.js';
import { useToastStore } from '../state/toast-store.js';
import {
  type LabelConfig,
  type LabelData,
  labelClient,
} from './hardware-client.js';
import { notePrintOutcome } from './hardware-reprobe.js';

export interface LabelPrinter {
  /** Print the given labels; resolves true on success, false on failure. */
  /**
   * Drucken. `groesse` ist der CUPS-Name des gewählten Mediums; fehlt er,
   * gilt die Vorgabe — damit bleibt jeder Aufrufer lauffähig, der die Wahl
   * noch nicht durchreicht.
   */
  print: (labels: LabelData[], groesse?: string) => Promise<boolean>;
  /** True when a label printer has been configured (printer name or IP set). */
  configured: boolean;
}

export function useLabelPrinter(): LabelPrinter {
  const cfg = useHardwareStore((s) => s.config.label);
  const addToast = useToastStore((s) => s.addToast);

  const configured = cfg.mode === 'system' ? cfg.printerName.length > 0 : cfg.ip.length > 0;

  const print = useCallback(
    async (labels: LabelData[], groesse?: string): Promise<boolean> => {
      if (labels.length === 0) return false;
      if (!configured) {
        addToast({
          tone: 'alert',
          title: 'Kein Etikettendrucker konfiguriert',
          body: 'Bitte im Gerätemanager einrichten.',
        });
        return false;
      }
      const config: LabelConfig = {
        mode: cfg.mode,
        ip: cfg.ip || undefined,
        port: cfg.port,
        printerName: cfg.printerName || undefined,
        printerType: cfg.printerType,
      };
      try {
        const n = await labelClient.print(config, labels, groesse);
        // Ein geglueckter Druck ist die staerkste Messung, die es gibt.
        notePrintOutcome('label', null);
        addToast({
          tone: 'success',
          // WORTWAHL (26.07.2026): „gedruckt" war eine Behauptung, die diese
          // Stelle nicht belegen kann. Der Auftrag geht an eine Warteschlange
          // beziehungsweise ueber eine Steckdose hinaus; ob Papier lief, weiss
          // hier niemand. Der Titel sagt jetzt genau das, was passiert ist.
          title: 'Etiketten an den Drucker übergeben',
          body: `${n} Etikett${n === 1 ? '' : 'en'} gesendet.`,
        });
        return true;
      } catch (err) {
        notePrintOutcome('label', err);
        addToast({
          tone: 'alert',
          title: 'Etikettendruck fehlgeschlagen',
          body: diagnoseAlsZeile(err),
        });
        return false;
      }
    },
    [addToast, configured, cfg.mode, cfg.ip, cfg.port, cfg.printerName, cfg.printerType],
  );

  return { print, configured };
}

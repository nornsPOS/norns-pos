/**
 * digit-nav — pure decision logic for number-key surface navigation.
 *
 * The Karteikasten rail labels its chips 1–8 but the keys were never bound
 * (UX-REDESIGN §1 gap 2 — "a promise the UI visibly breaks"). The shell wires
 * the real keydown listener; THIS module owns the decision + its guards so the
 * behaviour is unit-testable without a DOM:
 *   • never hijack when a modifier is held (Cmd/Ctrl+digit are real shortcuts),
 *   • never hijack while a text-entry element is focused (typing into a field),
 *   • never hijack while a dialog / Spotlight is open.
 *
 * Structurally typed over the surface registry (only digit + path are needed),
 * so importing it pulls in no React/screen code.
 */

export interface DigitNavSurface {
  digit?: number;
  path: string;
}

export interface DigitNavContext {
  /** KeyboardEvent.key */
  key: string;
  /** metaKey || ctrlKey || altKey held */
  hasModifier: boolean;
  /** focus is in an <input>/<textarea>/<select>/[contenteditable] */
  isTextEntry: boolean;
  /** a modal dialog or the Spotlight palette is open */
  isDialogOpen: boolean;
}

/**
 * @returns the target surface path for a digit press, or `null` when the press
 * must be ignored (guarded context, non-1..9 key, or no surface at that digit).
 */
export function resolveDigitNavPath(
  ctx: DigitNavContext,
  primarySurfaces: readonly DigitNavSurface[],
): string | null {
  if (ctx.hasModifier) return null;
  if (ctx.isTextEntry) return null;
  if (ctx.isDialogOpen) return null;
  if (!/^[1-9]$/.test(ctx.key)) return null;

  const digit = Number(ctx.key);
  const surface = primarySurfaces.find((s) => s.digit === digit);
  return surface ? surface.path : null;
}

/**
 * ── DER HANDSCANNER BLÄTTERTE DURCH DIE FLÄCHEN (25.07.2026) ───────────────
 * Auf `/lager` ist absichtlich kein Feld fokussiert — man soll einfach scannen
 * können. Damit lief jede Ziffer einer EAN als Ziffernnavigation durch: eine
 * `4001234567890` liess die Kasse neunmal die Fläche wechseln und landete auf
 * einer ganz anderen, während der Scan selbst verlorenging.
 *
 * Der Scanner tippt eine Ziffer je ~16 ms, ein Mensch braucht 100 bis 300 ms.
 * Deshalb wird der Sprung jetzt kurz zurückgehalten: kommt innerhalb dieser
 * Frist eine ZWEITE Taste, war es kein Mensch, und der Sprung wird verworfen.
 * Für die Hand am Tresen sind diese Millisekunden nicht wahrnehmbar; für den
 * Scanner sind sie das sichere Unterscheidungsmerkmal.
 *
 * Etwas mehr als die 50 ms, ab denen der Scanner-Haken seinen Puffer verwirft —
 * sonst fiele genau der Grenzfall durch beide Netze.
 */
export const ZIFFERN_WARTEZEIT_MS = 70;

export interface ZifferSchleuse {
  /**
   * Eine Taste anbieten. Der Sprung erfolgt erst nach der Wartezeit.
   *
   * @returns ob ein Sprung nun ansteht — damit der Bildschirm die Taste sofort
   *          schlucken kann, statt sie doppelt wirken zu lassen.
   */
  taste(ctx: DigitNavContext): boolean;
  /** Alles Anstehende verwerfen (beim Abbau des Bildschirms). */
  abbrechen(): void;
}

/**
 * Die Schleuse zwischen Tastendruck und Flächenwechsel.
 *
 * Bewusst ohne React: sie ist eine reine Zustandsmaschine über zwei Zeitgeber
 * und lässt sich damit ohne Bildschirm prüfen.
 */
export function erstelleZifferSchleuse(opts: {
  primarySurfaces: readonly DigitNavSurface[];
  navigate: (path: string) => void;
  wartezeitMs?: number;
  /** Nur für die Prüfung austauschbar. */
  planen?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  verwerfen?: (t: ReturnType<typeof setTimeout>) => void;
}): ZifferSchleuse {
  const {
    primarySurfaces,
    navigate,
    wartezeitMs = ZIFFERN_WARTEZEIT_MS,
    planen = setTimeout,
    verwerfen = clearTimeout,
  } = opts;

  let anstehend: ReturnType<typeof setTimeout> | null = null;

  const abbrechen = (): void => {
    if (anstehend !== null) {
      verwerfen(anstehend);
      anstehend = null;
    }
  };

  return {
    taste(ctx) {
      // JEDE Taste verwirft einen anstehenden Sprung — auch eine, die selbst
      // keine Ziffer ist. Ein Scan endet mit Enter, und auch der darf den
      // Sprung nicht doch noch auslösen.
      abbrechen();
      const ziel = resolveDigitNavPath(ctx, primarySurfaces);
      if (ziel === null) return false;
      anstehend = planen(() => {
        anstehend = null;
        navigate(ziel);
      }, wartezeitMs);
      return true;
    },
    abbrechen,
  };
}

/** True when the element should swallow digit keys (it's a typing surface). */
export function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** True when any modal dialog (incl. Spotlight) is mounted + open in the DOM. */
export function isAnyDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * @norns/ui-kit — public surface.
 *
 * Six brand primitives ship in Phase 2 Day 2:
 *   Button, ParchmentCard, RomanIndex (+ toRoman), Seal, Zwischentitel, MagnifierIcon
 *
 * Day 3 adds: StatTile, MoneyAmount, LedgerEntry.
 * Day 5 adds: PinPad, Toast, ToastContainer, ErrorBoundary.
 */

export { Button, type ButtonProps } from './components/Button.js';
export { ParchmentCard, type ParchmentCardProps } from './components/ParchmentCard.js';
export { RomanIndex, type RomanIndexProps, toRoman } from './components/RomanIndex.js';
export { Seal, type SealProps } from './components/Seal.js';
export { Zwischentitel, type ZwischentitelProps } from './components/Zwischentitel.js';
export { Fensterboden } from './components/Fensterboden.js';
export { NornsWortmarke, type NornsWortmarkeProps } from './components/NornsWortmarke.js';
export {
  NornsZeichen,
  NORNS_TINTE,
  NORNS_PAPIER,
  NORNS_FADEN,
  type NornsZeichenProps,
} from './components/NornsZeichen.js';
export { MagnifierIcon, type MagnifierIconProps } from './components/MagnifierIcon.js';

// Day 3 primitives
export { StatTile, type StatTileProps } from './components/StatTile.js';
export { MoneyAmount, type MoneyAmountProps } from './components/MoneyAmount.js';
export { LedgerEntry, type LedgerEntryProps } from './components/LedgerEntry.js';

// Money helpers — exact integer-cents → decimal-string (no float).
export { centsToEur } from './money.js';

// Day 5 primitives — Operational Foundations
export { PinPad, type PinPadProps } from './components/PinPad.js';
export { Toast, type ToastProps, type ToastShape, type ToastTone } from './components/Toast.js';
export {
  ToastContainer,
  type ToastContainerProps,
} from './components/ToastContainer.js';
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
} from './components/ErrorBoundary.js';

// UX P0 — Foundation: shared Dialog/Sheet + Form primitives. Every dialog
// used to be hand-rolled; these give one consistent, accessible core.
export {
  Dialog,
  type DialogProps,
  DialogHeader,
  DialogBody,
  DialogFooter,
  ModalShell,
  type ModalShellProps,
  type ModalSize,
} from './components/Dialog.js';
export { Sheet, type SheetProps } from './components/Sheet.js';
export {
  Accordion,
  type AccordionProps,
  AccordionItem,
  type AccordionItemProps,
} from './components/Accordion.js';
export { Popover, type PopoverProps } from './components/Popover.js';
export {
  Sparkline,
  type SparklineProps,
  type SparklineTone,
} from './components/Sparkline.js';

// Generic-action icon system (lucide-react). Brand motifs (Seal, Zwischentitel,
// MagnifierIcon) stay; Icon/IconButton are for universal actions.
export { Icon, type IconProps } from './components/Icon.js';
export { InfoPunkt, type InfoPunktProps } from './components/InfoPunkt.js';
export {
  AmountPad,
  type AmountPadProps,
  type AmountPadKey,
  amountPadReduce,
} from './components/AmountPad.js';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonTone,
} from './components/IconButton.js';
export type { LucideIcon } from 'lucide-react';
// Curated action set — consumers import these from the ui-kit, not lucide directly.
export {
  Trash2,
  Search,
  Plus,
  X,
  ChevronLeft,
  Printer,
  Pencil,
  Check,
  Percent,
  Tag,
  Wallet,
  LogIn,
  Lock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  FileText,
  ShieldCheck,
  TriangleAlert,
  // 26.07.2026, Basels Dekret „Symbole statt Emoji": auf Windows rendern
  // Zeichen wie das Schloss oder die Sanduhr als bunte Segoe-Emoji und
  // zerschneiden die Antiquitaeten-Gestaltung. Diese Icons ersetzen sie.
  Hourglass,
  Camera,
  Sparkles,
  Diamond,
  Image,
  RotateCw,
  RotateCcw,
  // 27.07.2026, Basels Rednerpult-Befund: „die Kasse liest sich wie eine
  // Zeitung". Der Weg heraus sind Zeichen, die für sich selbst sprechen —
  // ein Zahnrad braucht kein Wort. Dieser Block gibt jeder Fläche ihr
  // EINES, allgemein bekanntes Zeichen; die Zuordnung wohnt im
  // surface-registry, nicht verstreut in den Bildschirmen.
  ShoppingCart,
  HandCoins,
  Package,
  Banknote,
  Warehouse,
  Users,
  LayoutDashboard,
  PenLine,
  Settings,
  Inbox,
  ClipboardList,
  ListChecks,
  Gem,
  PiggyBank,
  TrendingUp,
  Globe,
  Store,
  BookOpen,
  CalendarDays,
  Calendar,
  MessageCircle,
  Landmark,
  Target,
  ShieldAlert,
  UserCog,
  Activity,
  MailWarning,
  ReceiptText,
  CircleHelp,
  // Präzisions-Nachschub (30.07.2026, Basels Ordnung „starke, genaue Symbole"):
  // drei Einstellungs-Bereiche teilten sich EIN Server-Symbol, zwei einen
  // Karton. Jeder Bereich bekommt sein eigenes, sofort lesbares Zeichen.
  Cpu,
  Plug,
  KeyRound,
  Boxes,
  Scale,
} from 'lucide-react';
// Ladezustand ist nicht alles: „keine Daten" und „der Server hat nicht
// geantwortet" wurden auf dieselbe leere Liste abgebildet und dann als
// Tatsache formuliert. Diese zwei Flächen trennen die beiden Fälle wieder —
// ZustandFehler meldet den Fehlschlag (mit dem Satz des Aufrufers, nie einem
// eigenen), ZustandLeer nennt die Leere samt nächster Handlung.
export { ZustandFehler, type ZustandFehlerProps } from './components/ZustandFehler.js';
export {
  ZustandLeer,
  type ZustandLeerProps,
  type ZustandHandlung,
} from './components/ZustandLeer.js';
// Der EINE Ladeplatzhalter des Hauses — ersetzt die vier Ladesprachen und
// die sechs Keyframe-Kopien in den Flächen der Kasse (Zählung 26.07.2026).
export {
  Skelett,
  type SkelettProps,
  SkelettZeilen,
  type SkelettZeilenProps,
} from './components/Skelett.js';
export { Field, type FieldProps } from './components/Field.js';
export { Input, type InputProps } from './components/Input.js';
export { Textarea, type TextareaProps } from './components/Textarea.js';
export { Select, type SelectProps } from './components/Select.js';
export { Checkbox, type CheckboxProps } from './components/Checkbox.js';
export { Bewegung, BEWEGUNG } from './components/Bewegung.js';

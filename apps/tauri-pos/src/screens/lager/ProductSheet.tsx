/**
 * ProductSheet — the Unified Product Lifecycle (UX-REDESIGN §4.1).
 *
 * ONE right slide-over (P0 `Sheet`) that both CREATES and MANAGES a product —
 * replacing NeuesProduktDialog + InventoryAdjustmentDialog. The lifecycle is
 * the section order: Details → Fotos → Preis & Veröffentlichen → Etikett →
 * Handel. A pure-derived status chip rides in the header.
 *
 *   • create mode  (productId === null): the manual-stock form. POST /api/products
 *     (DRAFT) → optional publish (PUT status=AVAILABLE) gated by the locked €0
 *     guard → auto-print label → an INTENTIONAL draft round-trips to /fotos and
 *     back to THIS sheet.
 *   • manage mode  (productId set): fetch ProductDetail; collapsible sections for
 *     stock adjustment (audit-safe), publish, Web & SEO, label, photos, eBay.
 *
 * Behaviour parity is the bar — every guard from the two old dialogs is reused
 * verbatim (product-publish.ts, adjustment-notes.ts). Frontend-only; all
 * mutations go through the same endpoints + the step-up interceptor.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  type ApiClient,
  ApiError,
  type InventoryAdjustmentReason,
  type ProductDetail,
  type ProductUpdateBody,
  type TaxTreatmentCode,
  categoriesApi,
  photosApi,
  productsApi,
} from '@norns/api-client';
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Field,
  Icon,
  Input,
  Select,
  Sheet,
  Textarea,
  X,
} from '@norns/ui-kit';

import {
  MIN_ADJUSTMENT_NOTE_LEN,
  adjustmentNoteShortfall,
  isAdjustmentNoteValid,
} from '../../lib/adjustment-notes.js';
import { BLATT_BREITE_ANGEDOCKT, type BlattAnordnung } from './lager-layout.js';
import { useApiClient } from '../../lib/api-context.js';
import { formatEur, formatGrams, isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  CONDITION_OPTIONS,
  type Condition,
  ITEM_TYPE_OPTIONS,
  type ItemType,
  conditionLabel,
  itemTypeLabel,
} from '../../lib/item-type-label.js';
import { type LifecycleStage, deriveLifecycleStage } from '../../lib/product-lifecycle.js';
import { decidePublish, isPositivePrice } from '../../lib/product-publish.js';
import { PRODUCT_STATUS_LABEL } from '../../lib/product-status-label.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type StampErhaltung, formatStampDisplay, sortierTipp } from '../../lib/taxonomy-hints.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';

import {
  BeschreibungDetailsFields,
  CategoryPickerField,
  type CategorySelection,
  type CollectorDetailsDraft,
  EMPTY_COLLECTOR_DETAILS,
  StampAttributeFields,
  buildDetailsUpdate,
  hasCollectorDetails,
  isOriginCountryValid,
  resolveCategorySelection,
  useCategoryTree,
} from './CategoryPicker.js';
import { productDetailQueryKey } from './abfrage-schluessel.js';
import { etikettPlanFuerMedium } from '../../lib/etikett-layout.js';
import { etikettWahl } from '../../lib/etikett-wahl.js';
import { EtikettWahlDialog } from './EtikettWahlDialog.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

/**
 * Stamp attribute columns (stamp_erhaltung / stamp_minr) ship with the
 * Briefmarken taxonomy wave — typed locally until the api-client domain
 * declares them. The PUT for these two fields runs SEPARATELY so a server
 * that does not accept them yet never poisons the rest of a save.
 */
type ProductDetailExt = ProductDetail & {
  stampErhaltung?: StampErhaltung | null;
  stampMinr?: number | null;
};

export interface ProductSheetProps {
  open: boolean;
  /** null ⇒ create mode; a product id ⇒ manage mode. */
  productId: string | null;
  onClose: () => void;
  /**
   * Breitbild (26.07.2026): 'angedockt' stellt das Blatt als feste Spalte
   * NEBEN die Liste (kein Portal, keine Fokusfalle, Liste bleibt bedienbar)
   * — das Gewinnbild des breiten Geräts. Vorgabe 'ueberlagernd' ist die
   * bewährte Schublade; unter der Schwelle ändert sich NICHTS.
   */
  anordnung?: BlattAnordnung;
}

export function ProductSheet({
  open,
  productId,
  onClose,
  anordnung = 'ueberlagernd',
}: ProductSheetProps): JSX.Element | null {
  // After a successful create the sheet stays open and transitions IN-PLACE to
  // manage mode for the new product — no close + re-click. `createdId` holds
  // that just-created id; it resets on close so the next "+ Neues Produkt"
  // opens a fresh create form.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const handleClose = (): void => {
    setCreatedId(null);
    onClose();
  };

  // productId (Lager row-click / ?produkt= deep-open) wins; otherwise a just-
  // created id transitions us into manage mode.
  const manageId = productId ?? createdId;
  const justCreated = productId === null && createdId !== null;

  const inhalt = manageId ? (
    <ManageBody productId={manageId} onClose={handleClose} justCreated={justCreated} />
  ) : (
    <CreateBody onCreated={setCreatedId} onClose={handleClose} />
  );

  if (anordnung === 'angedockt') {
    if (!open) return null;
    return (
      // Angedockt ist das Blatt ein NICHT-modales Nebenfenster: Kopf, Körper
      // und Fuß (DialogHeader/-Body/-Footer) sind schlichte Flex-Kinder und
      // tragen ohne ModalShell. Bewusst keine Fokusfalle und kein Scroll-
      // Riegel — der Sinn des Andockens ist ja, dass die Liste daneben
      // sichtbar UND bedienbar bleibt. Schließen über den ✕-Knopf im Kopf.
      <aside
        aria-label={manageId ? 'Produkt verwalten' : 'Neues Produkt'}
        style={{
          width: BLATT_BREITE_ANGEDOCKT,
          flex: '0 0 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--w14-parchment-2)',
          borderLeft: '1px solid var(--w14-rule)',
          boxShadow: 'var(--w14-shadow-card)',
        }}
      >
        {inhalt}
      </aside>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      ariaLabel={manageId ? 'Produkt verwalten' : 'Neues Produkt'}
      size="lg"
    >
      {inhalt}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Lifecycle chip — pure-derived, header adornment.
// ─────────────────────────────────────────────────────────────────────────

const STAGE_TONE: Record<LifecycleStage, string> = {
  Entwurf: 'var(--w14-ink-faded)',
  Fotos: 'var(--w14-ink-aged)',
  Bepreist: 'var(--w14-gold)',
  Veröffentlicht: 'var(--w14-verdigris)',
  Reserviert: 'var(--w14-gold)',
  Verkauft: 'var(--w14-wax-red)',
};

function LifecycleChip({ stage }: { stage: LifecycleStage }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        padding: 'var(--w14-abstand-4) var(--w14-abstand-12)',
        borderRadius: 'var(--w14-radius-pille)',
        fontSize: 'var(--w14-schrift-zeile)',
        letterSpacing: '0.06em',
        // 19.08.2026: '#fff' mass im Dunkelthema 1,47:1 auf der gold-Marke.
        // Parchment kippt mit dem Thema und traegt alle sechs Stufen.
        color: 'var(--w14-parchment)',
        background: STAGE_TONE[stage],
        whiteSpace: 'nowrap',
      }}
    >
      {stage}
    </span>
  );
}

function SheetHeaderRow({
  title,
  subtitle,
  chip,
  onClose,
}: {
  title: string;
  subtitle?: string | undefined;
  chip?: JSX.Element | undefined;
  onClose: () => void;
}): JSX.Element {
  return (
    <DialogHeader>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-10)',
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 600,
            fontSize: 'var(--w14-schrift-lead)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {chip}
        </div>
        {subtitle && (
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Schließen"
        style={{
          width: 48,
          height: 48,
          flex: '0 0 auto',
          border: 'none',
          background: 'transparent',
          color: 'var(--w14-ink-faded)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          fontSize: 'var(--w14-schrift-titel)',
        }}
      >
        <Icon icon={X} size={18} />
      </button>
    </DialogHeader>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE mode — the manual-stock form (parity with NeuesProduktDialog).
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ `MIXED` fehlt hier mit Absicht (28.07.2026).
 *
 * Es ist kein Steuerschlüssel, sondern ein Gerüstwert am BELEGKOPF: „dieser
 * Beleg trägt mehrere Behandlungen". Ein einzelner Gegenstand kann das nie
 * sein.
 *
 * Solange es hier stand, war der Fehler mit EINEM Griff erreichbar: die
 * Kasse rechnete 0,00 EUR Steuer und wies 0,00 aus, die Buchungszeile ging
 * aber auf Erlöse 19 Prozent. Beleg und Buchhaltung widersprachen sich um
 * den vollen Steuerbetrag, ohne Fehlermeldung.
 *
 * Der Server weist es seit demselben Tag ebenfalls ab
 * (`ProductTaxTreatmentCode`). Zwei Riegel, weil einer vergessen wird.
 */
const TAX_OPTIONS: TaxTreatmentCode[] = [
  'MARGIN_25A',
  'INVESTMENT_GOLD_25C',
  'STANDARD_19',
  'REDUCED_7',
  'REVERSE_CHARGE_13B',
];

const TYPE_PREFIX: Record<ItemType, string> = {
  gold_jewelry: 'GS',
  gold_coin: 'GM',
  gold_bar: 'GB',
  silver_jewelry: 'SS',
  silver_coin: 'SM',
  silver_bar: 'SB',
  platinum_jewelry: 'PS',
  platinum_coin: 'PM',
  platinum_bar: 'PB',
  antique: 'AQ',
  watch: 'UH',
  other: 'XX',
};

function generateSku(t: ItemType): string {
  const p = TYPE_PREFIX[t] ?? 'XX';
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${p}-${ymd}-${rnd}`;
}

interface CreatedResponse {
  id: string;
  sku: string;
  status: string;
}

function CreateBody({
  onCreated,
  onClose,
}: {
  /** Called with the new product id on a successful POST — the sheet then
   *  transitions IN-PLACE to manage mode (no close + re-click). */
  onCreated: (productId: string) => void;
  /** Cancel / header-X — closes the sheet without creating. */
  onClose: () => void;
}): JSX.Element {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);
  const qc = useQueryClient();
  const printer = useLabelPrinter();

  const [name, setName] = useState('');
  const [sku, setSku] = useState(() => generateSku('gold_jewelry'));
  const [itemType, setItemType] = useState<ItemType>('gold_jewelry');
  const [condition, setCondition] = useState<Condition>('USED_GOOD');
  const [tax, setTax] = useState<TaxTreatmentCode>('MARGIN_25A');
  const [weightGrams, setWeightGrams] = useState('');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');
  const [locUnit, setLocUnit] = useState('');
  const [locDrawer, setLocDrawer] = useState('');
  const [locPosition, setLocPosition] = useState('');
  const [publishNow, setPublishNow] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);

  // Kategorie (primaryCategoryId) + Beschreibung + Details +
  // Briefmarken-Merkmale — progressive disclosure, hot path stays calm.
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState<CollectorDetailsDraft>(EMPTY_COLLECTOR_DETAILS);
  const [showBeschreibung, setShowBeschreibung] = useState(false);
  const [stampErhaltung, setStampErhaltung] = useState<StampErhaltung | null>(null);
  const [stampMinr, setStampMinr] = useState('');

  // Progressive disclosure for the cooler fields — the hot path (Bezeichnung,
  // Preis, Kategorie, Foto) stays first and uncluttered; Merkmale (Art/Zustand/
  // Gewicht/Steuerart) and Lagerort open on demand.
  const [showMerkmale, setShowMerkmale] = useState(false);
  const [showLagerort, setShowLagerort] = useState(false);

  const valid =
    name.trim().length > 0 &&
    sku.trim().length > 0 &&
    isMoneyInput(acquisitionCostEur.trim()) &&
    isMoneyInput(listPriceEur.trim()) &&
    (weightGrams.trim().length === 0 || isMoneyInput(weightGrams.trim(), 3)) &&
    isOriginCountryValid(details);

  const pricePositive = isPositivePrice(listPriceEur);
  const willPublish = publishNow && pricePositive;

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        sku: sku.trim(),
        name: name.trim(),
        itemType,
        condition,
        taxTreatmentCode: tax,
        acquisitionCostEur: normalizeDecimal(acquisitionCostEur.trim()),
        listPriceEur: normalizeDecimal(listPriceEur.trim()),
        hallmarkStamps: [],
        isCommission: false,
        listedOnStorefront: false,
      };
      if (weightGrams.trim().length > 0) body.weightGrams = normalizeDecimal(weightGrams.trim(), 3);
      if (locUnit.trim().length > 0) body.locationStorageUnit = locUnit.trim();
      if (locDrawer.trim().length > 0) body.locationDrawer = locDrawer.trim();
      if (locPosition.trim().length > 0) body.locationPosition = locPosition.trim();
      if (description.trim().length > 0) body.descriptionDe = description.trim();

      const res = await client.request<CreatedResponse>('POST', '/api/products', body);

      // ── Non-fatal follow-ups: Kategorie, Details, Briefmarken-Merkmale ──
      // Each runs separately so one missing server feature never undoes the
      // created product; failures surface as honest toasts.
      if (category) {
        try {
          await categoriesApi.setForProduct(client, res.id, {
            categoryIds: [category.id],
            primaryCategoryId: category.id,
          });
        } catch {
          addToast({
            tone: 'alert',
            title: 'Kategorie nicht gespeichert',
            body: `${res.sku}: Kategorie später im Produkt unter „Details" setzen.`,
          });
        }
      }
      if (hasCollectorDetails(details)) {
        const full = buildDetailsUpdate('', details);
        const patch: ProductUpdateBody = {};
        if (full.period) patch.period = full.period;
        if (typeof full.yearMintedFrom === 'number') patch.yearMintedFrom = full.yearMintedFrom;
        if (typeof full.yearMintedTo === 'number') patch.yearMintedTo = full.yearMintedTo;
        if (full.originCountry) patch.originCountry = full.originCountry;
        if (full.catalogReference) patch.catalogReference = full.catalogReference;
        if (Object.keys(patch).length > 0) {
          try {
            await productsApi.update(client, res.id, patch);
          } catch {
            addToast({
              tone: 'alert',
              title: 'Details nicht gespeichert',
              body: `${res.sku}: Epoche/Prägejahr/Herkunft später unter „Details" nachtragen.`,
            });
          }
        }
      }
      if (stampErhaltung !== null || stampMinr.trim().length > 0) {
        const stampPatch: Record<string, unknown> = {};
        if (stampErhaltung !== null) stampPatch.stampErhaltung = stampErhaltung;
        if (stampMinr.trim().length > 0) stampPatch.stampMinr = Number.parseInt(stampMinr, 10);
        try {
          await client.request('PUT', `/api/products/${encodeURIComponent(res.id)}`, stampPatch);
        } catch {
          addToast({
            tone: 'alert',
            title: 'Briefmarken-Merkmale nicht gespeichert',
            body: `${res.sku}: Erhaltung/MiNr. später unter „Details" nachtragen.`,
          });
        }
      }

      // ── DIE KASSE WÄHLT DIE GRÖSSE SELBST (26.07.2026) ────────────────────
      // Beim Anlegen soll niemand gefragt werden — der Mensch hat das Stück in
      // der Hand und will es etikettieren, nicht eine Grösse aussuchen. Also
      // entscheidet `etikettWahl` aus Warenart, Gewicht, Preis und der Länge
      // von Nummer und Namen. Eine Münze bekommt das Kapselfähnchen, ein
      // Armband das Regaletikett.
      //
      // Gewählt wird NUR unter dem, was auch wirklich druckbar ist: passt kein
      // lesbarer Strichcode, ist die Grösse gesperrt und kommt gar nicht in
      // Frage. Lieber die nächstgrössere als ein Etikett, das der eigene
      // Scanner nicht liest.
      if (printer.configured) {
        const loc = [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
          .filter((s) => s.length > 0)
          .join(' · ');
        // Die Werte kommen aus dem FORMULAR, nicht aus der Antwort: der Server
        // gibt hier nur Kennung, Nummer und Stand zurück. Was der Mensch eben
        // eingetippt hat, ist die richtige Quelle für die Grössenwahl.
        const wahl = etikettWahl({
          sku: res.sku,
          name: name.trim(),
          // Der Kurzcode wird beim Anlegen noch nicht vergeben; fehlt er, sperrt
          // `etikettWahl` das Kapselfähnchen von selbst und sagt warum.
          kurzcode: null,
          warenart: itemType,
          gewichtGramm: weightGrams.trim().length > 0 ? weightGrams.trim() : null,
          preisEur: listPriceEur.trim().length > 0 ? listPriceEur.trim() : null,
        });
        void printer.print(
          [
            {
              sku: res.sku,
              productName: name.trim(),
              weightGrams: weightGrams.trim().length > 0 ? weightGrams.trim() : null,
              karat: null,
              storageLocation: loc.length > 0 ? loc : null,
            },
          ],
          wahl.vorschlag ?? undefined,
        );
      }

      // Creation always lands DRAFT; "Sofort verkaufsbereit" flips it to
      // AVAILABLE — but NEVER for a non-positive price (locked guard).
      const decision = decidePublish({ publishNow, listPriceEur });
      let outcome: 'published' | 'publish-failed' | 'no-price' | 'draft' = 'draft';
      let publishErr = '';
      if (decision.kind === 'publish') {
        try {
          await productsApi.update(client, res.id, { status: 'AVAILABLE' });
          outcome = 'published';
        } catch (e) {
          outcome = 'publish-failed';
          publishErr = e instanceof Error ? e.message : '';
        }
      } else if (decision.kind === 'draft-no-price') {
        outcome = 'no-price';
      }

      void qc.invalidateQueries({ queryKey: ['products', 'list'] });

      if (outcome === 'published') {
        addToast({
          tone: 'success',
          title: 'Produkt verkaufsbereit',
          body: `${res.sku}: sofort im Verkauf sichtbar`,
        });
      } else if (outcome === 'publish-failed') {
        addToast({
          tone: 'alert',
          title: 'Angelegt, aber NICHT verkaufsbereit',
          body: `${res.sku} ist nur ein Entwurf. In Lager veröffentlichen.${
            publishErr ? ` (${publishErr})` : ''
          }`,
        });
      } else if (outcome === 'no-price') {
        addToast({
          tone: 'alert',
          title: 'Kein Verkaufspreis, als Entwurf gespeichert',
          body: `${res.sku}: ein Verkaufspreis über 0 € ist nötig, um sofort zu verkaufen.`,
        });
      } else {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt',
          body: printer.configured
            ? `${res.sku} (Entwurf): Etikett gedruckt, jetzt Fotos`
            : `${res.sku} (Entwurf): jetzt Fotos aufnehmen`,
        });
      }

      // Stay open and transition IN-PLACE to manage mode for the just-created
      // product — the operator continues with Fotos / Preis / Etikett in this
      // same sheet (no close + re-click, no auto-navigate to /fotos). Finishing
      // is now explicit via the header close X.
      onCreated(res.id);
    } catch (err) {
      const msg = describeError(err);
      if (/step[_-]?up/i.test(msg)) {
        addToast({
          tone: 'alert',
          title: 'PIN-Bestätigung nötig',
          body: 'Hoher Einkaufswert. Bitte PIN-Freigabe wiederholen.',
        });
      } else {
        addToast({ tone: 'alert', title: 'Anlegen fehlgeschlagen', body: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHeaderRow
        title="Neues Produkt"
        subtitle="Manueller Lagerzugang, wird als Entwurf angelegt"
        chip={<LifecycleChip stage="Entwurf" />}
        onClose={onClose}
      />
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* ── Hot path — the 4 things every product needs, first & uncluttered:
            Bezeichnung · Verkaufspreis (+ Einkaufswert) · Kategorie · (Foto folgt). ── */}
        <Field label="Bezeichnung" required>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Goldring 585 mit Brillant"
          />
        </Field>

        <div style={TWO_COL}>
          <Field label="Verkaufspreis €" required>
            <Input
              mono
              inputMode="decimal"
              value={listPriceEur}
              onChange={(e) => setListPriceEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Einkaufswert €" required>
            <Input
              mono
              inputMode="decimal"
              value={acquisitionCostEur}
              onChange={(e) => setAcquisitionCostEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>

        <CategoryPickerField value={category?.id ?? null} onChange={setCategory} disabled={busy} />
        <StampAttributeFields
          pathSlugs={category?.pathSlugs ?? []}
          erhaltung={stampErhaltung}
          minr={stampMinr}
          onErhaltungChange={setStampErhaltung}
          onMinrChange={setStampMinr}
          disabled={busy}
        />

        {/* SKU is auto-assigned — shown plainly, regenerate on demand. The
            operator rarely edits it, so it sits just below the hot path. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 'var(--space-2)',
            alignItems: 'end',
          }}
        >
          <Field label="SKU / Artikelnr. (automatisch)" required>
            <Input
              mono
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="GS-260604-A3F9"
            />
          </Field>
          <Button
            variant="ghost"
            size="md"
            type="button"
            onClick={() => setSku(generateSku(itemType))}
          >
            ⟳ Neu
          </Button>
        </div>

        {/* ── Merkmale — Art · Zustand · Gewicht · Steuerart (progressive). ── */}
        <button
          type="button"
          aria-expanded={showMerkmale}
          onClick={() => setShowMerkmale((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Merkmale: Art · Zustand · Gewicht · Steuerart
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showMerkmale ? '▾' : '▸'}
          </span>
        </button>
        {showMerkmale && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={TWO_COL}>
              <Field label="Art">
                <Select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
                  {ITEM_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Zustand">
                <Select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as Condition)}
                >
                  {CONDITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={TWO_COL}>
              <Field label="Gewicht (g)">
                <Input
                  mono
                  inputMode="decimal"
                  value={weightGrams}
                  onChange={(e) => setWeightGrams(e.target.value)}
                  placeholder="optional"
                />
              </Field>
              <Field label="Steuerart">
                <Select value={tax} onChange={(e) => setTax(e.target.value as TaxTreatmentCode)}>
                  {TAX_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {TAX_TREATMENT_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        )}

        {/* ── Lagerort (optional, progressive). ── */}
        <button
          type="button"
          aria-expanded={showLagerort}
          onClick={() => setShowLagerort((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Lagerort (optional)
            {locUnit.trim() || locDrawer.trim() || locPosition.trim() ? ' · gesetzt' : ''}
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showLagerort ? '▾' : '▸'}
          </span>
        </button>
        {showLagerort && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-3)',
            }}
          >
            <Input
              mono
              value={locUnit}
              onChange={(e) => setLocUnit(e.target.value)}
              placeholder="Tresor-1"
              aria-label="Lagereinheit"
            />
            <Input
              mono
              value={locDrawer}
              onChange={(e) => setLocDrawer(e.target.value)}
              placeholder="Fach-3"
              aria-label="Fach"
            />
            <Input
              mono
              value={locPosition}
              onChange={(e) => setLocPosition(e.target.value)}
              placeholder="Box-12"
              aria-label="Position"
            />
          </div>
        )}

        {/* Beschreibung & Details — collapsed by default (hot path stays calm). */}
        <button
          type="button"
          aria-expanded={showBeschreibung}
          onClick={() => setShowBeschreibung((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Beschreibung & Details
            {description.trim().length > 0 || hasCollectorDetails(details) ? ' · ausgefüllt' : ''}
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showBeschreibung ? '▾' : '▸'}
          </span>
        </button>
        {showBeschreibung && (
          <BeschreibungDetailsFields
            description={description}
            onDescriptionChange={setDescription}
            details={details}
            onDetailsChange={setDetails}
            defaultDetailsOpen={hasCollectorDetails(details)}
            disabled={busy}
          />
        )}

        <Checkbox
          checked={willPublish}
          disabled={!pricePositive}
          onChange={(e) => setPublishNow(e.target.checked)}
          label="Sofort verkaufsbereit, direkt im Verkauf sichtbar (sonst nur Entwurf)"
        />
        {!pricePositive && (
          <p
            style={{
              margin: 0,
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
            }}
          >
            Ein Verkaufspreis über 0 € ist nötig, um das Produkt sofort verkaufsbereit zu machen.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? 'Speichert…' : willPublish ? 'Anlegen & verkaufsbereit' : 'Als Entwurf anlegen'}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MANAGE mode — fetch ProductDetail; collapsible lifecycle sections.
// ─────────────────────────────────────────────────────────────────────────

function ManageBody({
  productId,
  onClose,
  justCreated = false,
}: { productId: string; onClose: () => void; justCreated?: boolean }): JSX.Element {
  const api = useApiClient();
  const detailQ = useQuery({
    queryKey: productDetailQueryKey(productId),
    queryFn: () => productsApi.get(api, productId),
    staleTime: 10_000,
  });

  const product = detailQ.data;
  // Share the EXACT photos query key FotosSection uses (TanStack dedupes on the
  // key) so the lifecycle chip can reflect real photo presence — a DRAFT with
  // photos but no price is "Fotos", not "Entwurf" — with no second network read.
  const photosQ = useQuery({
    queryKey: ['products', productId, 'photos'],
    queryFn: () => photosApi.listForProduct(api, productId),
    staleTime: 10_000,
  });
  const stage = product
    ? deriveLifecycleStage({
        status: product.status,
        listPriceEur: product.listPriceEur,
        photoCount: photosQ.data?.items.length ?? 0,
      })
    : null;

  return (
    <>
      <SheetHeaderRow
        title={product?.name ?? 'Produkt'}
        subtitle={product?.sku}
        chip={stage ? <LifecycleChip stage={stage} /> : undefined}
        onClose={onClose}
      />
      <DialogBody style={{ paddingTop: 'var(--w14-abstand-12)' }}>
        {detailQ.isLoading ? (
          <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt Produkt…</p>
        ) : detailQ.isError || !product ? (
          <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
            Produkt konnte nicht geladen werden.
          </p>
        ) : (
          <Accordion>
            {justCreated && (
              <div aria-live="polite" style={{ display: 'grid', gap: 'var(--w14-abstand-8)', margin: '0 0 4px' }}>
                <p
                  style={{
                    margin: 0,
                    padding: 'var(--w14-abstand-10) var(--w14-abstand-14)',
                    borderRadius: 'var(--w14-radius-card)',
                    background: 'var(--w14-parchment-3)',
                    border: '1px solid var(--w14-gold)',
                    color: 'var(--w14-ink-aged)',
                    fontSize: 'var(--w14-schrift-text)',
                    lineHeight: 1.4,
                  }}
                >
                  <strong style={{ color: 'var(--w14-ink)' }}>Produkt angelegt.</strong> Es geht
                  hier im selben Fenster weiter: <strong>Fotos</strong>, <strong>Preis</strong>,{' '}
                  <strong>Etikett</strong>. Schließen Sie mit dem ✕ oben, wenn Sie fertig sind.
                </p>
                <EinsortierenHinweis product={product} />
              </div>
            )}
            <AccordionItem id="details" title="Details" defaultOpen={!justCreated}>
              <div style={{ display: 'grid', gap: 'var(--w14-abstand-16)' }}>
                <DetailsSection product={product} />
                <StammdatenEditor key={`stamm-${product.updatedAt}`} product={product} />
                <DetailsEditor key={product.updatedAt} product={product} />
              </div>
            </AccordionItem>
            <AccordionItem id="fotos" title="Fotos" defaultOpen={justCreated}>
              <FotosSection product={product} />
            </AccordionItem>
            <AccordionItem id="preis" title="Preis & Veröffentlichen">
              <PreisSection product={product} onDone={onClose} />
            </AccordionItem>
            <AccordionItem id="bestand" title="Bestand & Lagerort">
              <BestandSection product={product} onDone={onClose} />
            </AccordionItem>
            {/* ⚠️ 01.08.2026 — der Reiter „Web & SEO" ist RAUS. Er schaltete
                ein Stück im Webshop frei und pflegte Suchmaschinentext dafür.
                Norns POS ist die Kasse am Tresen; einen Webshop hat sie nicht. */}
            <AccordionItem id="etikett" title="Etikett">
              <EtikettSection product={product} />
            </AccordionItem>
            {/* 14.08.2026 — der Reiter „Handel (eBay)" ist RAUS, mit dem
                ganzen Kanal bei der Trennung von warehouse14. */}
            {product.status === 'DRAFT' && !product.archivedAt && (
              <AccordionItem id="loeschen" title="Artikel löschen">
                <LoeschenSection product={product} onDeleted={onClose} />
              </AccordionItem>
            )}
          </Accordion>
        )}
      </DialogBody>
    </>
  );
}

function DetailsSection({ product }: { product: ProductDetail }): JSX.Element {
  const ext = product as ProductDetailExt;
  const primary = product.categories.find((c) => c.isPrimary) ?? null;
  const stampLine = formatStampDisplay(ext.stampMinr ?? null, ext.stampErhaltung ?? null);
  const rows: Array<[string, string]> = [
    ['Art', itemTypeLabel(product.itemType)],
    ['Kategorie', primary ? primary.nameDe : '-'],
    ['Zustand', conditionLabel(product.condition)],
    [
      'Steuerart',
      TAX_TREATMENT_LABEL[product.taxTreatmentCode as TaxTreatmentCode] ?? product.taxTreatmentCode,
    ],
    ['Gewicht', product.weightGrams ? `${formatGrams(product.weightGrams)} g` : '-'],
    // Feinheit + Feingewicht tragen die §25c-Einordnung (Anlagegold). Der Server
    // setzt sie beim Anlegen und lässt sie danach nicht mehr ändern, also stehen
    // sie hier als Tatsache, nicht als Feld.
    ...(product.karatCode ? ([['Karat', product.karatCode]] as Array<[string, string]>) : []),
    ...(product.finenessDecimal
      ? ([['Feinheit', formatFeinheit(product.finenessDecimal)]] as Array<[string, string]>)
      : []),
    ...(product.feingewichtGrams
      ? ([
          ['Feingewicht', `${formatGrams(product.feingewichtGrams)} g`],
        ] as Array<[string, string]>)
      : []),
    ['Versandmaße', formatVersandmasse(product)],
    ['Einkaufswert', `${formatEur(product.acquisitionCostEur)} €`],
    ['Verkaufspreis', `${formatEur(product.listPriceEur)} €`],
    [
      'Lagerort',
      [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
        .filter((s): s is string => !!s && s.length > 0)
        .join(' · ') || '-',
    ],
    ...(stampLine ? ([['Briefmarke', stampLine]] as Array<[string, string]>) : []),
  ];
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--w14-abstand-6) var(--w14-abstand-16)', margin: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={MINI_LABEL}>{k}</dt>
          <dd
            className="w14-tabular"
            style={{ margin: 0, fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-text)' }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Feinheit als Promille: „0.9990" liest sich als „999,0 ‰". */
function formatFeinheit(finenessDecimal: string): string {
  const n = Number.parseFloat(finenessDecimal);
  if (!Number.isFinite(n)) return finenessDecimal;
  return `${(n * 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ‰`;
}

/** Die drei Außenmaße als „12 × 8 × 3 cm", oder ehrlich „noch nicht gemessen". */
function formatVersandmasse(product: ProductDetail): string {
  const parts = [product.lengthCm, product.widthCm, product.heightCm];
  if (parts.every((p) => p == null)) return 'noch nicht gemessen';
  const zahl = (raw: string): string => {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : raw;
  };
  return `${parts.map((p) => (p ? zahl(p) : '?')).join(' × ')} cm`;
}

/**
 * StammdatenEditor — correct the three fields a cashier actually gets wrong at
 * intake: the name, the sale price and the condition.
 *
 * Before this existed, a typo in the name or a mispriced item was permanent
 * from the till: manage mode edited only the description, the collector
 * metadata and the SEO block, and PreisSection could merely flip a DRAFT to
 * AVAILABLE. The server has always accepted all three through PUT
 * /api/products/:id.
 *
 * The PUT is a diff: only fields the operator actually changed are sent, so a
 * save never rewrites a value someone else edited in the meantime.
 */
function StammdatenEditor({ product }: { product: ProductDetail }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  // PUT /api/products/:id verlangt die Ladenleitung. Ein Speichern-Knopf, der
  // immer mit 403 endet, wäre eine Lüge: wir sperren die Felder stattdessen.
  const darfBearbeiten = useSessionStore((s) => s.actor?.role === 'ADMIN');

  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(product.listPriceEur);
  const [condition, setCondition] = useState(product.condition);
  // Außenmaße sind nachmessbar: leer heißt „unbekannt", nicht „null Zentimeter".
  const [lengthCm, setLengthCm] = useState(product.lengthCm ?? '');
  const [widthCm, setWidthCm] = useState(product.widthCm ?? '');
  const [heightCm, setHeightCm] = useState(product.heightCm ?? '');
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();
  const nameError = trimmedName.length === 0 ? 'Ein Name ist nötig.' : null;
  const priceError = isMoneyInput(price) ? null : 'Bitte einen Betrag wie 149,90 eingeben.';

  const nextPrice = priceError ? product.listPriceEur : normalizeDecimal(price);
  const masse = [
    ['lengthCm', lengthCm, product.lengthCm] as const,
    ['widthCm', widthCm, product.widthCm] as const,
    ['heightCm', heightCm, product.heightCm] as const,
  ];
  // Ein leeres Feld heißt „unbekannt". Eine Null heißt „null Zentimeter", und
  // das gibt es an keinem Paket. Beides darf nicht dasselbe schreiben.
  const masseError = masse.some(
    ([, raw]) =>
      raw.trim() !== '' && (!isMoneyInput(raw) || Number.parseFloat(normalizeDecimal(raw)) <= 0),
  )
    ? 'Maße bitte in Zentimetern eingeben, z. B. 12,5. Null ist kein Maß.'
    : null;
  const massePatch: ProductUpdateBody = {};
  if (masseError === null) {
    for (const [key, raw, prev] of masse) {
      const next = raw.trim() === '' ? null : normalizeDecimal(raw);
      if (next !== (prev ?? null)) massePatch[key] = next;
    }
  }

  const patch: ProductUpdateBody = {
    ...(trimmedName !== product.name && trimmedName.length > 0 ? { name: trimmedName } : {}),
    ...(nextPrice !== product.listPriceEur ? { listPriceEur: nextPrice } : {}),
    ...(condition !== product.condition ? { condition } : {}),
    ...massePatch,
  };
  const dirty = Object.keys(patch).length > 0;
  const blocked = nameError !== null || priceError !== null || masseError !== null || !darfBearbeiten;

  /** Der Zustand kann ein Wert sein, den die Liste nicht kennt (Altbestand). */
  const conditionKnown = CONDITION_OPTIONS.some((o) => o.value === product.condition);

  async function save(): Promise<void> {
    if (!dirty || blocked || busy) return;
    setBusy(true);
    try {
      const res = await productsApi.update(api, product.id, patch);
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      addToast({
        tone: 'success',
        title: 'Stammdaten gespeichert',
        body:
          res.changedFields.length > 0
            ? res.changedFields.map(stammdatenFeldLabel).join(', ')
            : product.sku,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
      <span style={MINI_LABEL}>Stammdaten bearbeiten</span>

      <Field label="Name" required error={nameError}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          disabled={!darfBearbeiten}
        />
      </Field>

      <div style={TWO_COL}>
        <Field label="Verkaufspreis (€)" required error={priceError}>
          <Input
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)}
            disabled={!darfBearbeiten}
            style={{ fontFamily: 'var(--w14-font-mono)' }}
          />
        </Field>
        <Field label="Zustand">
          <Select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={!darfBearbeiten}
          >
            {!conditionKnown && <option value={product.condition}>{product.condition}</option>}
            {CONDITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Versandmaße in cm (Länge, Breite, Höhe)" error={masseError}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--w14-abstand-8)' }}>
          <Input
            value={lengthCm}
            inputMode="decimal"
            placeholder="Länge"
            aria-label="Länge in Zentimetern"
            onChange={(e) => setLengthCm(e.target.value)}
            disabled={!darfBearbeiten}
            style={{ fontFamily: 'var(--w14-font-mono)' }}
          />
          <Input
            value={widthCm}
            inputMode="decimal"
            placeholder="Breite"
            aria-label="Breite in Zentimetern"
            onChange={(e) => setWidthCm(e.target.value)}
            disabled={!darfBearbeiten}
            style={{ fontFamily: 'var(--w14-font-mono)' }}
          />
          <Input
            value={heightCm}
            inputMode="decimal"
            placeholder="Höhe"
            aria-label="Höhe in Zentimetern"
            onChange={(e) => setHeightCm(e.target.value)}
            disabled={!darfBearbeiten}
            style={{ fontFamily: 'var(--w14-font-mono)' }}
          />
        </div>
      </Field>

      {/*
        Der Preis eines verkauften Artikels darf korrigiert werden, aber der Beleg
        von damals ändert sich dadurch nicht. Das sagen wir laut, statt es zu
        verschweigen.
      */}
      {(product.status === 'SOLD' || product.status === 'RESERVED') && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-feld)',
            lineHeight: 1.5,
            color: 'var(--w14-ink-faded)',
          }}
        >
          {product.status === 'SOLD'
            ? 'Der Artikel ist bereits verkauft. Eine Preisänderung wirkt nur auf künftige Belege, der abgeschlossene Beleg bleibt unverändert.'
            : 'Der Artikel ist gerade reserviert. Eine Preisänderung gilt erst für den nächsten Vorgang.'}
        </p>
      )}

      {!darfBearbeiten && (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', lineHeight: 1.5, color: 'var(--w14-ink-faded)' }}>
          Name, Preis und Zustand ändert nur die Ladenleitung.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || blocked || busy}>
          {busy ? 'Speichert…' : 'Stammdaten speichern'}
        </Button>
      </div>
    </div>
  );
}

/** Serverfeld → deutsches Wort, für die Erfolgsmeldung nach dem Speichern. */
function stammdatenFeldLabel(field: string): string {
  switch (field) {
    case 'name':
      return 'Name';
    case 'listPriceEur':
    case 'list_price_eur':
      return 'Verkaufspreis';
    case 'condition':
      return 'Zustand';
    case 'lengthCm':
      return 'Länge';
    case 'widthCm':
      return 'Breite';
    case 'heightCm':
      return 'Höhe';
    default:
      return 'weitere Angabe';
  }
}

/**
 * EinsortierenHinweis — the "where does it go" answer, shown plainly in the
 * just-created success path: SKU + assigned Lagerort + a one-line Sortier-Tipp
 * derived from the chosen root category. Reads the EXISTING location triplet —
 * no new bin system.
 */
function EinsortierenHinweis({ product }: { product: ProductDetail }): JSX.Element {
  const { roots } = useCategoryTree();
  const primaryId = product.categories.find((c) => c.isPrimary)?.id ?? null;
  const selection = resolveCategorySelection(roots, primaryId);
  const loc = [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' · ');
  const tip = sortierTipp(selection?.rootSlug);

  return (
    <div
      style={{
        padding: 'var(--w14-abstand-10) var(--w14-abstand-14)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        display: 'grid',
        gap: 'var(--w14-abstand-4)',
        fontSize: 'var(--w14-schrift-text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap' }}>
        <span
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600 }}
        >
          {product.sku}
        </span>
        <span>
          <span style={{ color: 'var(--w14-ink-faded)' }}>Lagerort: </span>
          <strong>{loc || 'noch nicht zugewiesen'}</strong>
        </span>
      </div>
      {tip && (
        <span style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Sortier-Tipp: {tip}
        </span>
      )}
    </div>
  );
}

/**
 * DetailsEditor — capture the full product record, post-create:
 * Kategorie (primaryCategoryId), Beschreibung, the Details group
 * (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz) and — for
 * Briefmarken — Erhaltung + MiNr. Keyed by `product.updatedAt` upstream so a
 * fresh detail re-hydrates the drafts.
 */
function DetailsEditor({ product }: { product: ProductDetail }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { roots } = useCategoryTree();
  const ext = product as ProductDetailExt;

  const initialPrimaryId = product.categories.find((c) => c.isPrimary)?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(initialPrimaryId);
  const [description, setDescription] = useState(product.descriptionDe ?? '');
  // 0143: am Lagerblatt nachtragbar — die Nummer wird oft erst am geoeffneten
  // Gehaeuse oder auf dem Makrofoto lesbar. Die Fassung des Ankauftags steht
  // unveraenderlich auf dem gedruckten Beleg.
  const [seriennummer, setSeriennummer] = useState(product.seriennummer ?? '');
  const [gravur, setGravur] = useState(product.gravur ?? '');
  const [details, setDetails] = useState<CollectorDetailsDraft>({
    period: product.period ?? '',
    yearFrom: product.yearMintedFrom != null ? String(product.yearMintedFrom) : '',
    yearTo: product.yearMintedTo != null ? String(product.yearMintedTo) : '',
    originCountry: product.originCountry ?? '',
    catalogReference: product.catalogReference ?? '',
  });
  const [erhaltung, setErhaltung] = useState<StampErhaltung | null>(ext.stampErhaltung ?? null);
  const [minr, setMinr] = useState(ext.stampMinr != null ? String(ext.stampMinr) : '');
  const [busy, setBusy] = useState(false);

  const selection = resolveCategorySelection(roots, categoryId);
  const stampDirty =
    (ext.stampErhaltung ?? null) !== erhaltung ||
    (ext.stampMinr != null ? String(ext.stampMinr) : '') !== minr.trim();
  const canSave = isOriginCountryValid(details) && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    try {
      // 1) Beschreibung + Details — the typed PUT (explicit null clears).
      await productsApi.update(api, product.id, {
        ...buildDetailsUpdate(description, details),
        // 0143: gleiche Halte-Logik wie descriptionDe (leer = leeren via null).
        seriennummer: seriennummer.trim() === '' ? null : seriennummer.trim(),
        gravur: gravur.trim() === '' ? null : gravur.trim(),
      });

      // 2) Kategorie → primaryCategoryId (only when actually changed).
      if (categoryId !== initialPrimaryId) {
        await categoriesApi.setForProduct(api, product.id, {
          categoryIds: categoryId ? [categoryId] : [],
          primaryCategoryId: categoryId,
        });
      }

      // 3) Briefmarken-Merkmale — SEPARATE PUT with its own catch, so an api
      //    that does not yet accept stampErhaltung/stampMinr never undoes 1+2.
      if (stampDirty) {
        try {
          await api.request('PUT', `/api/products/${encodeURIComponent(product.id)}`, {
            stampErhaltung: erhaltung,
            stampMinr: minr.trim().length > 0 ? Number.parseInt(minr, 10) : null,
          });
        } catch {
          addToast({
            tone: 'alert',
            title: 'Briefmarken-Merkmale nicht gespeichert',
            body: 'Erhaltung/MiNr. konnte der Server noch nicht annehmen. Rest ist gespeichert.',
          });
        }
      }

      addToast({ tone: 'success', title: 'Details gespeichert', body: product.sku });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err);
      addToast({ tone: 'alert', title: 'Speichern fehlgeschlagen', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
      <CategoryPickerField
        value={categoryId}
        onChange={(sel) => setCategoryId(sel?.id ?? null)}
        disabled={busy}
      />
      <StampAttributeFields
        pathSlugs={selection?.pathSlugs ?? []}
        erhaltung={erhaltung}
        minr={minr}
        onErhaltungChange={setErhaltung}
        onMinrChange={setMinr}
        disabled={busy}
      />
      {/* 0143: Kennzeichen des Stuecks, GwG-Zuordnung. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--w14-abstand-10)' }}>
        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
          Seriennummer (Uhr, Werk)
          <Input value={seriennummer} onChange={(e) => setSeriennummer(e.target.value)} disabled={busy} mono />
        </label>
        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
          Gravur (wörtlich)
          <Input value={gravur} onChange={(e) => setGravur(e.target.value)} disabled={busy} />
        </label>
      </div>
      <BeschreibungDetailsFields
        description={description}
        onDescriptionChange={setDescription}
        details={details}
        onDetailsChange={setDetails}
        defaultDetailsOpen={hasCollectorDetails(details)}
        disabled={busy}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {busy ? 'Speichert…' : 'Beschreibung & Kategorie speichern'}
        </Button>
      </div>
    </div>
  );
}

/** Round-trip href to the deep photo route that returns to THIS product sheet. */
function fotosHref(productId: string): string {
  const returnTo = `/lager?produkt=${encodeURIComponent(productId)}`;
  return `/fotos?mode=produkt&productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function FotosSection({ product }: { product: ProductDetail }): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();

  const photosQuery = useQuery({
    queryKey: ['products', product.id, 'photos'],
    queryFn: () => photosApi.listForProduct(api, product.id),
    staleTime: 10_000,
  });
  const photos = photosQuery.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-faded)' }}>
        Fotos werden in der Foto-Werkstatt aufgenommen und zugeschnitten. Danach landen Sie wieder
        hier beim Produkt.
      </p>

      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 'var(--w14-abstand-8)',
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: 'var(--w14-radius-card)',
                overflow: 'hidden',
                border: '1px solid var(--w14-rule)',
                background: 'var(--w14-parchment-3)',
              }}
            >
              {p.thumbUrl ?? p.publicUrl ? (
                <img
                  /*
                   * Das DAUMENNAGEL-Bild, nicht das Original.
                   *
                   * Hier stand `p.publicUrl` — die volle Aufnahme — in einem
                   * Raster von 96 Pixeln. Ein Konvolut mit zwölf Handyfotos zu
                   * je 4 MB zog damit 48 MB über die Ladenleitung und
                   * entschlüsselte sie in voller Auflösung, um zwölf winzige
                   * Kacheln zu zeigen. Die Foto-Werkstatt machte es längst
                   * richtig; dieser Reiter nicht.
                   */
                  src={p.thumbUrl ?? p.publicUrl ?? ''}
                  alt={p.altTextDe ?? product.sku}
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
              {p.isPrimary && (
                <span
                  className="w14-smallcaps"
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    background: 'rgb(var(--w14-ink-rgb) / 0.82)',
                    color: 'var(--w14-parchment)',
                    fontSize: 'var(--w14-schrift-marke)',
                    letterSpacing: '0.06em',
                    padding: 'var(--w14-abstand-2) var(--w14-abstand-4)',
                    borderRadius: 'var(--w14-radius-button)',
                  }}
                >
                  Titelbild
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {photosQuery.isSuccess && photos.length === 0 && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-feld)',
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
          }}
        >
          Noch keine Fotos für dieses Produkt.
        </p>
      )}

      <div>
        <Button variant="primary" size="md" onClick={() => navigate(fotosHref(product.id))}>
          Fotos aufnehmen / verwalten
        </Button>
      </div>
    </div>
  );
}

function PreisSection({
  product,
  onDone,
}: {
  product: ProductDetail;
  onDone: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  const canPublish = product.status === 'DRAFT' && isPositivePrice(product.listPriceEur);

  async function publish(): Promise<void> {
    if (!canPublish || busy) return;
    setBusy(true);
    try {
      await productsApi.update(api, product.id, { status: 'AVAILABLE' });
      addToast({
        tone: 'success',
        title: 'Verkaufsbereit',
        body: `${product.sku}: jetzt im Verkauf sichtbar`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      onDone();
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err);
      addToast({ tone: 'alert', title: 'Nicht verkaufsbereit', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
        Verkaufspreis: {formatEur(product.listPriceEur)} €
      </div>
      {product.status === 'DRAFT' ? (
        canPublish ? (
          <div>
            <Button variant="primary" disabled={busy} onClick={() => void publish()}>
              {busy ? 'Wird verkaufsbereit…' : 'Verkaufsbereit machen'}
            </Button>
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
            }}
          >
            Ein Verkaufspreis über 0 € ist nötig, um den Entwurf verkaufsbereit zu machen (im Web &
            SEO oder beim Anlegen setzen).
          </p>
        )
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-verdigris)' }}>
          Bereits verkaufsbereit ({PRODUCT_STATUS_LABEL[product.status]}). Web-Shop-Sichtbarkeit
          unter „Web & SEO".
        </p>
      )}
    </div>
  );
}

const ADJ_REASON_OPTIONS: Array<{ value: InventoryAdjustmentReason; label: string; hint: string }> =
  [
    { value: 'LOCATION_CHANGE', label: 'Lagerort ändern', hint: 'Stück wird physisch verschoben.' },
    { value: 'LOST', label: 'Als verloren markieren', hint: 'Stück fehlt im Bestand.' },
    { value: 'DAMAGED', label: 'Als beschädigt markieren', hint: 'Stück nicht verkaufsfähig.' },
    { value: 'FOUND', label: 'Wiedergefunden', hint: 'Hebt vorherigen Verlust-Vermerk auf.' },
    { value: 'OPERATOR_NOTE', label: 'Notiz hinzufügen', hint: 'Anmerkung ohne Statusänderung.' },
  ];

function BestandSection({
  product,
  onDone,
}: {
  product: ProductDetail;
  onDone: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [reason, setReason] = useState<InventoryAdjustmentReason>('LOCATION_CHANGE');
  const [notes, setNotes] = useState('');
  const [storageUnit, setStorageUnit] = useState(product.locationStorageUnit ?? '');
  const [drawer, setDrawer] = useState(product.locationDrawer ?? '');
  const [position, setPosition] = useState(product.locationPosition ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresLocation = reason === 'LOCATION_CHANGE';
  const locationValid =
    storageUnit.trim().length > 0 && drawer.trim().length > 0 && position.trim().length > 0;
  const notesValid = isAdjustmentNoteValid(notes);
  const notesShortfall = adjustmentNoteShortfall(notes);
  const notesTouched = notes.length > 0;
  const canSubmit = notesValid && (!requiresLocation || locationValid) && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        reason === 'LOCATION_CHANGE'
          ? {
              reason,
              notes: notes.trim(),
              locationStorageUnit: storageUnit.trim(),
              locationDrawer: drawer.trim(),
              locationPosition: position.trim(),
            }
          : { reason, notes: notes.trim() };
      await productsApi.adjustInventory(api, product.id, body);
      addToast({
        tone: reason === 'LOST' || reason === 'DAMAGED' ? 'alert' : 'success',
        title: 'Anpassung protokolliert',
        body: `${product.sku}: ${ADJ_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason}`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else if (err.code === 'NOT_FOUND') {
          setError('Stück nicht mehr vorhanden. Liste wird aktualisiert.');
          void qc.invalidateQueries({ queryKey: ['products', 'list'] });
        } else setError(describeError(err));
      } else setError(ohneApiFehlerSatz(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
        {ADJ_REASON_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 'var(--w14-abstand-10)',
              alignItems: 'baseline',
              padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
              minHeight: 48,
              background: reason === opt.value ? 'var(--w14-parchment-3)' : 'transparent',
              border: `1px solid ${reason === opt.value ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
              borderRadius: 'var(--w14-radius-card)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="adjustment-reason"
              value={opt.value}
              checked={reason === opt.value}
              onChange={() => setReason(opt.value)}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: 'var(--w14-schrift-betont)' }}>{opt.label}</div>
              <div
                style={{ fontStyle: 'italic', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}
              >
                {opt.hint}
              </div>
            </div>
          </label>
        ))}
      </div>

      {requiresLocation && (
        <div>
          <span style={MINI_LABEL}>Neuer Lagerort</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
            }}
          >
            <Input
              mono
              value={storageUnit}
              onChange={(e) => setStorageUnit(e.target.value)}
              placeholder="Tresor-1"
              aria-label="Standort"
            />
            <Input
              mono
              value={drawer}
              onChange={(e) => setDrawer(e.target.value)}
              placeholder="Fach-3"
              aria-label="Fach"
            />
            <Input
              mono
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Pos-12"
              aria-label="Position"
            />
          </div>
          {!locationValid && (
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              Alle drei Felder (Standort · Fach · Position) sind erforderlich.
            </span>
          )}
        </div>
      )}

      <Field
        label={`Notiz (≥ ${MIN_ADJUSTMENT_NOTE_LEN} Zeichen)`}
        error={
          notesTouched && !notesValid
            ? `Noch ${notesShortfall} Zeichen (mind. ${MIN_ADJUSTMENT_NOTE_LEN})`
            : null
        }
        {...(notesValid ? { hint: 'Anmerkung ✓' } : {})}
      >
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1024}
          placeholder="Operator-Begründung für das Audit-Log."
        />
      </Field>

      {error && (
        <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: 'var(--w14-schrift-text)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? 'Protokolliert…' : 'Anpassung protokollieren'}
        </Button>
      </div>
    </div>
  );
}

function EtikettSection({ product }: { product: ProductDetail }): JSX.Element {
  const printer = useLabelPrinter();
  const [wahlOffen, setWahlOffen] = useState(false);
  const loc =
    [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
      .filter((s): s is string => !!s && s.length > 0)
      .join(' · ') || null;
  const printable = product.status !== 'SOLD' && !product.archivedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
      {/* Single, consistent label preview + control (was auto-here/manual-there). */}
      <div
        style={{
          border: '1px dashed var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          padding: 'var(--w14-abstand-12)',
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-text)',
          display: 'grid',
          gap: 'var(--w14-abstand-2)',
        }}
      >
        <div className="w14-tabular">{product.sku}</div>
        <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 600 }}>{product.name}</div>
        <div className="w14-tabular" style={{ color: 'var(--w14-ink-faded)' }}>
          {product.weightGrams ? `${formatGrams(product.weightGrams)} g · ` : ''}
          {formatEur(product.listPriceEur)} €{loc ? ` · ${loc}` : ''}
        </div>
      </div>
      <div>
        {/*
          * ── DIE WAHL VOR DEM DRUCK (26.07.2026) ──────────────────────────
          * Bis hierher druckte dieser Knopf SOFORT, immer in derselben
          * Grösse. Der Mensch sah erst auf dem Papier, was herauskam, und
          * eine Rolle ist verbraucht, sobald sie durch ist.
          *
          * Jetzt öffnet er die Wahl: der Vorschlag steht vorn und ist
          * begründet, jede Grösse zeigt eine massstäbliche Vorschau, und was
          * nicht geht, ist gesperrt und sagt warum.
          */}
        <Button
          variant="primary"
          disabled={!printer.configured || !printable}
          onClick={() => setWahlOffen(true)}
        >
          Etikett drucken …
        </Button>
        <EtikettWahlDialog
          open={wahlOffen}
          onClose={() => setWahlOffen(false)}
          artikel={{
            sku: product.sku,
            name: product.name,
            kurzcode: product.barcode ?? null,
            warenart: product.itemType ?? null,
            gewichtGramm: product.weightGrams,
            preisEur: product.listPriceEur,
          }}
          planFuer={(g) =>
            etikettPlanFuerMedium(
              {
                sku: product.sku,
                name: product.name,
                gewichtGramm: product.weightGrams ?? undefined,
                lagerort: loc ?? undefined,
                preisEur: product.listPriceEur ?? undefined,
                kurzcode: product.barcode ?? undefined,
              },
              g,
            )
          }
          // Der Haken kennt keinen Laufzustand — lieber weglassen als einen
          // erfinden, der immer falsch ist.
          laeuft={false}
          onDrucken={(g) => {
            setWahlOffen(false);
            void printer.print(
              [
                {
                  sku: product.sku,
                  productName: product.name,
                  weightGrams: product.weightGrams,
                  karat: null,
                  storageLocation: loc,
                },
              ],
              g,
            );
          }}
        />
        {!printer.configured && (
          <span style={{ marginLeft: 10, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
            Kein Etikettendrucker konfiguriert.
          </span>
        )}
      </div>
    </div>
  );
}

// 14.08.2026: hier stand HandelSection, die eBay-Pipeline am Produktblatt.
// Der eBay-Kanal fiel mit der Trennung von warehouse14.
function LoeschenSection({
  product,
  onDeleted,
}: {
  product: ProductDetail;
  onDeleted: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const armed = confirmText.trim().toUpperCase() === product.sku.toUpperCase();

  async function remove(): Promise<void> {
    if (!armed || busy) return;
    setBusy(true);
    try {
      await productsApi.remove(api, product.id);
      addToast({
        tone: 'success',
        title: 'Artikel gelöscht',
        body: `${product.sku} wurde dauerhaft entfernt.`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      onDeleted();
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err);
      addToast({ tone: 'alert', title: 'Löschen nicht möglich', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-12)',
        padding: 'var(--w14-abstand-14)',
        border: '1px solid var(--w14-wax-red)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
      }}
    >
      <p style={{ margin: 0, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--w14-wax-red)' }}>Achtung:</strong> Dieser Entwurf wird{' '}
        <strong>endgültig gelöscht</strong>. Fotos, eBay-Verlauf und Kategorie-Zuordnung
        inbegriffen. Dies ist nur für noch nicht verkaufte Entwürfe möglich und kann nicht
        rückgängig gemacht werden.
      </p>
      <Field label={`Zur Bestätigung die SKU eingeben: ${product.sku}`}>
        <Input
          mono
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={product.sku}
          aria-label="SKU zur Bestätigung"
        />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="destructive" disabled={!armed || busy} onClick={() => void remove()}>
          {busy ? 'Wird gelöscht…' : 'Artikel endgültig löschen'}
        </Button>
      </div>
    </div>
  );
}

const TWO_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};
const DISCLOSE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-10)',
  width: '100%',
  minHeight: 48,
  padding: '0 var(--w14-abstand-12)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  cursor: 'pointer',
  textAlign: 'left',
};
const MINI_LABEL: CSSProperties = {
  display: 'block',
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};

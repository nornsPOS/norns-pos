/**
 * NeuesProduktDialog — manual "Produkt anlegen" (Lager-Direkterfassung).
 *
 * The POS could only create products via the AI intake pipeline or the Ankauf
 * flow; this dialog gives the operator a focused way to enter shop-original /
 * manual stock: a STAGED form → `POST /api/products` (the api-client step-up
 * middleware prompts for a PIN when the acquisition cost crosses the
 * threshold). Creation always lands as DRAFT — the operator then opts into
 * "Zum Verkauf freigeben" here, gated by the locked €0 price guard
 * (`product-publish.ts`), or finishes the lifecycle (Foto → Etikett) from Lager.
 *
 * UX (design-ux-brief §1 progressive disclosure, §3 EAS repeat-entry, §5 sizing
 * + calm copy):
 *   • progressive disclosure — three stages (Eckdaten → Preis & Steuer →
 *     Foto · Etikett · Freigeben), never one giant form;
 *   • shared ui-kit primitives → modern-clean neutral surface, focus trap,
 *     ESC/backdrop close, ≥48px targets; a ≥56px primary CTA;
 *   • German-comma money fields (lib/decimal) that echo a live `1.234,56 €`
 *     as the operator types — money stays a string end-to-end, never a float;
 *   • "Speichern & weiteres anlegen" carries forward the sticky context
 *     (Art / Zustand / Steuerart / Lagerort / Freigabe) and clears only the
 *     item-unique fields → item N+1 is a 3-field form for fast bulk entry;
 *   • an OBVIOUS "Zum Verkauf freigeben" affordance, price-gated;
 *   • a clear next-steps path: anlegen → Foto → Etikett/Barcode → freigeben.
 *
 * Frontend-only: every create/publish guard is reused verbatim from the shared
 * libs (decimal.ts, product-publish.ts). The €0 publish guard is NOT weakened.
 */

import { type CSSProperties, useMemo, useState } from 'react';

import {
  ApiError,
  type ApiClient,
  type ProductUpdateBody,
  type TaxTreatmentCode,
  categoriesApi,
  productsApi,
} from '@norns/api-client';
import {
  Button,
  Check,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  Select,
  Tag,
  X,
} from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { grundZeile, hinweise, wasFehltNoch } from './was-fehlt-noch.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  CONDITION_OPTIONS,
  type Condition,
  ITEM_TYPE_OPTIONS,
  type ItemType,
} from '../../lib/item-type-label.js';
import { decidePublish, isPositivePrice } from '../../lib/product-publish.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type StampErhaltung, formatStampDisplay, sortierTipp } from '../../lib/taxonomy-hints.js';
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
} from './CategoryPicker.js';

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE BARRE DARF NIE IN DIE MARGENBESTEUERUNG (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 25a Abs. 1 Nr. 3 UStG nimmt Edelmetalle nach Zolltarif (71 06, 71 08,
 * 71 10) vom Verfahren aus — Rohmetall in Barrenform, ohne Wahlrecht.
 *
 * Dieses Formular stellte bis heute für JEDE Warenart `MARGIN_25A` vor. Wer
 * eine Silberbarre anlegte und das Steuerfeld nicht anfasste, verkaufte sie
 * mit 31,93 EUR Steuer statt 159,66 (bei EK 800 / VK 1.000) — je Barre
 * 127,73 EUR zu wenig erklärt. Der Server lehnt so einen Verkauf seit heute
 * ab (`marge-nachrechnen.ts`); dieses Formular sorgt dafür, dass die
 * Ablehnung gar nicht erst nötig wird.
 *
 * Münzen und Schmuck (Positionen 71 18 und 71 13) nennt die Vorschrift
 * nicht — für die bleibt § 25a der Regelfall des Ankaufsgeschäfts.
 */
const BARREN: ReadonlySet<ItemType> = new Set(['gold_bar', 'silver_bar', 'platinum_bar'] as ItemType[]);

/** Der fachlich richtige Vorschlag je Warenart — der Mensch darf ihn ändern. */
function steuerVorschlag(art: ItemType): TaxTreatmentCode {
  // Goldbarren sind meist Anlagegold (§ 25c, steuerfrei ab 995er Feinheit);
  // Silber und Platin kennen keine solche Befreiung → Regelbesteuerung.
  if (art === 'gold_bar') return 'INVESTMENT_GOLD_25C';
  if (BARREN.has(art)) return 'STANDARD_19';
  return 'MARGIN_25A';
}

/** Live German money echo (1.234,56 €) of what the operator just typed.
 *  Display-only — the value sent to the API is the canonical dot-decimal
 *  STRING (`normalizeDecimal`), never this float. */
const EUR_FMT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function formatEuroEcho(raw: string, maxFrac = 2): string | null {
  if (!isMoneyInput(raw, maxFrac)) return null;
  const n = Number(normalizeDecimal(raw, maxFrac));
  return Number.isFinite(n) ? EUR_FMT.format(n) : null;
}

/* ── Stage model (progressive disclosure — brief §1/§3) ─────────────────── */
type Stage = 0 | 1 | 2;
const STAGES: ReadonlyArray<{ key: Stage; label: string }> = [
  { key: 0, label: 'Eckdaten' },
  { key: 1, label: 'Preis & Steuer' },
  { key: 2, label: 'Foto · Etikett · Freigabe' },
];

interface CreatedResponse {
  id: string;
  sku: string;
  status: string;
  /** Bei stueckzahl > 1: alle entstandenen Stuecke. */
  created?: Array<{ id: string; sku: string; status: string }>;
}

export function NeuesProduktDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after every successful POST so the Lager list refetches — fires
   *  for each item in a "Speichern & weiteres" bulk session, too. */
  onCreated: () => void;
}): JSX.Element | null {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);

  const [stage, setStage] = useState<Stage>(0);

  // Item-unique fields — cleared between bulk entries.
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  // 19.08.2026: Stueckzahl — N identische Stuecke, je eigene Zeile mit
  // Laufnummern-SKU. Text-Zustand, damit das Feld leer beginnen darf.
  const [stueckzahl, setStueckzahl] = useState('1');
  const [weightGrams, setWeightGrams] = useState('');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');

  // Sticky context — carried forward across "Speichern & weiteres".
  const [itemType, setItemType] = useState<ItemType>('gold_jewelry');
  const [condition, setCondition] = useState<Condition>('USED_GOOD');
  const [tax, setTax] = useState<TaxTreatmentCode>('MARGIN_25A');
  const [locUnit, setLocUnit] = useState('');
  const [locDrawer, setLocDrawer] = useState('');
  const [locPosition, setLocPosition] = useState('');
  const [publishNow, setPublishNow] = useState(false);

  // Kategorie + Beschreibung + Details + Briefmarken-Merkmale.
  // Sticky for bulk entry: Kategorie, Erhaltung, Details (a tray of same-era
  // pieces shares them); item-unique: Beschreibung + MiNr.
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState<CollectorDetailsDraft>(EMPTY_COLLECTOR_DETAILS);
  const [showBeschreibung, setShowBeschreibung] = useState(false);
  const [showMerkmale, setShowMerkmale] = useState(false);
  const [stampErhaltung, setStampErhaltung] = useState<StampErhaltung | null>(null);
  const [stampMinr, setStampMinr] = useState('');

  const [busy, setBusy] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  // The list price drives BOTH the publish gate and the margin readout.
  // A price ≤ €0,00 may never be freigegeben — the locked €0 guard lives
  // in product-publish.ts (`isPositivePrice` / `decidePublish`), reused as-is.
  const canPublish = isPositivePrice(listPriceEur);
  // Keep the toggle honest even if the price is later cleared/zeroed.
  const effectivePublish = publishNow && canPublish;

  // Calm, string-based margin readout (no float money math sent anywhere).
  const marginEcho = useMemo(() => {
    if (!isMoneyInput(acquisitionCostEur) || !isMoneyInput(listPriceEur)) return null;
    const acq = Number(normalizeDecimal(acquisitionCostEur));
    const list = Number(normalizeDecimal(listPriceEur));
    if (!Number.isFinite(acq) || !Number.isFinite(list)) return null;
    const cents = Math.round(list * 100) - Math.round(acq * 100);
    return { positive: cents >= 0, text: EUR_FMT.format(cents / 100) };
  }, [acquisitionCostEur, listPriceEur]);

  if (!open) return null;

  /** Full reset — clears everything including the carry-forward context. */
  const resetAll = (): void => {
    setName('');
    setSku('');
    setWeightGrams('');
    setAcquisitionCostEur('');
    setListPriceEur('');
    setItemType('gold_jewelry');
    setCondition('USED_GOOD');
    setTax('MARGIN_25A');
    setLocUnit('');
    setLocDrawer('');
    setLocPosition('');
    setPublishNow(false);
    setCategory(null);
    setDescription('');
    setDetails(EMPTY_COLLECTOR_DETAILS);
    setShowBeschreibung(false);
    setStampErhaltung(null);
    setStampMinr('');
    setStage(0);
  };

  /** Fast repeat-entry: keep the sticky context (Art / Zustand / Steuerart /
   *  Lagerort / Freigabe / Kategorie / Erhaltung / Details), clear only
   *  item-unique fields → item N+1 is a 3-field form. */
  const resetForNext = (): void => {
    setName('');
    setSku('');
    setWeightGrams('');
    setAcquisitionCostEur('');
    setListPriceEur('');
    setDescription('');
    setStampMinr('');
    setStage(0);
  };

  const handleClose = (): void => {
    resetAll();
    setSessionCount(0);
    onClose();
  };

  /**
   * ⚠️ EINE Rechnung fuer den Knopf UND fuer den Satz darunter.
   *
   * Basels Beschwerde vom 02.08.2026: ein Produkt liess sich nicht ins Lager
   * aufnehmen. Nichts war kaputt, der Knopf war nur grau, und NICHTS sagte
   * warum. Das fehlende Feld wohnte auf einer Stufe, die der Mensch schon
   * verlassen hatte, oder in einem zugeklappten Abschnitt.
   *
   * Zwei getrennte Rechnungen driften; dann sagt der Satz „alles vollstaendig",
   * waehrend der Knopf grau bleibt. Deshalb fragen beide dieselbe Liste.
   */
  const luecken = wasFehltNoch(
    {
      name,
      sku,
      herkunftsland: details.originCountry,
      einkaufspreis: acquisitionCostEur,
      verkaufspreis: listPriceEur,
      gewichtGramm: weightGrams,
    },
    isMoneyInput,
  );
  const valid = luecken.length === 0;
  // Kein Riegel, ein Satz: was die Kasse mit der Eingabe TUT, bevor sie es tut.
  const anmerkungen = hinweise({
    name,
    sku,
    herkunftsland: details.originCountry,
    einkaufspreis: acquisitionCostEur,
    verkaufspreis: listPriceEur,
    gewichtGramm: weightGrams,
  });
  const stage0Valid = !luecken.some((l) => l.stufe === 0);
  const stage1Valid = !luecken.some((l) => l.stufe === 1);

  const reachable = (key: Stage): boolean =>
    key === 0 || (key === 1 && stage0Valid) || (key === 2 && valid);

  async function submit(keepOpen: boolean): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // The locked €0 guard: only flag for the storefront with a real price > 0.
      const decision = decidePublish({ publishNow, listPriceEur });
      const willPublish = decision.kind === 'publish';

      const body: Record<string, unknown> = {
        sku: sku.trim(),
        name: name.trim(),
        itemType,
        condition,
        taxTreatmentCode: tax,
        acquisitionCostEur: normalizeDecimal(acquisitionCostEur),
        listPriceEur: normalizeDecimal(listPriceEur),
        hallmarkStamps: [],
        isCommission: false,
        listedOnStorefront: willPublish,
      };
      const anzahl = Math.max(1, Math.min(200, Number.parseInt(stueckzahl, 10) || 1));
      if (anzahl > 1) body.stueckzahl = anzahl;
      if (weightGrams.trim().length > 0) body.weightGrams = normalizeDecimal(weightGrams, 3);
      if (locUnit.trim().length > 0) body.locationStorageUnit = locUnit.trim();
      if (locDrawer.trim().length > 0) body.locationDrawer = locDrawer.trim();
      if (locPosition.trim().length > 0) body.locationPosition = locPosition.trim();
      if (description.trim().length > 0) body.descriptionDe = description.trim();

      const res = await client.request<CreatedResponse>('POST', '/api/products', body);

      // ── Non-fatal follow-ups (Kategorie / Details / Briefmarke) — each in
      // its own try so one missing server feature never undoes the create. ──
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
            body: `${res.sku}: Kategorie später in Lager nachtragen.`,
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
              body: `${res.sku}: Epoche/Prägejahr/Herkunft später in Lager nachtragen.`,
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
            body: `${res.sku}: Erhaltung/MiNr. später in Lager nachtragen.`,
          });
        }
      }

      // Where does it go — SKU + Lagerort + Sortier-Tipp, plainly in the
      // success path (reuses the EXISTING location triplet, no new bins).
      const locLine = [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
        .filter((s) => s.length > 0)
        .join(' · ');
      const tip = sortierTipp(category?.rootSlug);
      const woHin = `Lagerort: ${locLine || 'noch nicht zugewiesen'}.${tip ? ` Sortier-Tipp: ${tip}` : ''}`;

      // 14.08.2026: Hier stand „im Online-Shop" und „online sichtbar" — die
      // Sprache der gelöschten W14-Welt. In Norns heisst Freigeben: das
      // Stück ist AN DER KASSE verkaufbar (Status VERFÜGBAR statt Entwurf).
      const familie =
        res.created && res.created.length > 1
          ? `${res.created.length} Stücke, ${res.created[0]?.sku} bis ${res.created[res.created.length - 1]?.sku}`
          : res.sku;
      if (willPublish) {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt & verkaufbar',
          body: `${familie}: ab sofort an der Kasse verkaufbar. ${woHin}`,
        });
      } else if (decision.kind === 'draft-no-price') {
        addToast({
          tone: 'alert',
          title: 'Als Entwurf gespeichert',
          body: `${res.sku}: ein Verkaufspreis über 0,00 € ist nötig, um es zum Verkauf freizugeben. ${woHin}`,
        });
      } else {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt',
          body: `${familie} (Entwurf): jetzt Foto & Etikett in Lager. ${woHin}`,
        });
      }

      onCreated();
      if (keepOpen) {
        setSessionCount((c) => c + 1);
        resetForNext();
      } else {
        handleClose();
      }
    } catch (err) {
      // ⚠️ HIER STAND EIN ENGLISCHER GRIFF IN EINEN DEUTSCHEN SATZ.
      //
      // Der Zweig lautete `/step[_-]?up/i.test(describeError(err))`. Geprüft
      // wurde damit der ÜBERSETZTE Satz — und der heisst „PIN-Bestätigung
      // erforderlich.". Darin kommt „step up" nicht vor, also hat der Zweig
      // NIE getroffen. Wer den Gerätecode abbrach, las „Anlegen
      // fehlgeschlagen", als wäre etwas kaputt.
      //
      // Jetzt wird der CODE gelesen, nicht der Satz. Der Code ist der
      // Vertrag, der Satz ist Anzeige; wer den Satz abfragt, koppelt Logik an
      // Formulierung, und die nächste Umformulierung schaltet den Zweig
      // stillschweigend ab.
      if (isStepUpCancelled(err)) {
        addToast({
          tone: 'alert',
          title: 'Abgebrochen',
          body: 'Der Lagerzugang wurde nicht gespeichert. Nichts ist verloren, die Eingaben stehen noch.',
        });
      } else if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        addToast({
          tone: 'alert',
          title: 'Bestätigung nötig',
          body: 'Hoher Einkaufswert. Bitte den Gerätecode eingeben, dann erneut speichern.',
        });
      } else {
        addToast({ tone: 'alert', title: 'Anlegen fehlgeschlagen', body: describeError(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      ariaLabel="Neues Produkt anlegen"
      size="md"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      {/* ── Heading + bulk-session counter + close ─────────────────────── */}
      <div style={HEAD_ROW}>
        <div style={{ minWidth: 0 }}>
          <h2 style={HEAD_TITLE}>Neues Produkt</h2>
          <p style={HEAD_SUB}>
            Manueller Lagerzugang, Schritt für Schritt. Wird als Entwurf angelegt.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', flexShrink: 0 }}>
          {sessionCount > 0 && (
            <span aria-live="polite" style={SESSION_BADGE}>
              <Icon icon={Check} size={14} aria-hidden /> {sessionCount} angelegt
            </span>
          )}
          <button type="button" onClick={handleClose} aria-label="Schließen" style={CLOSE_BTN}>
            <Icon icon={X} size={18} aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Stage rail (progressive disclosure) ────────────────────────── */}
      <nav aria-label="Fortschritt" style={STAGE_RAIL}>
        {STAGES.map((s, i) => {
          const isReachable = reachable(s.key);
          const isActive = s.key === stage;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!isReachable || busy}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => isReachable && setStage(s.key)}
              style={{
                ...STAGE_TAB,
                background: isActive ? 'var(--w14-parchment-3)' : 'transparent',
                borderColor: isActive ? 'var(--w14-accent)' : 'var(--w14-rule)',
                color: isReachable ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                opacity: isReachable ? 1 : 0.55,
                fontWeight: isActive ? 600 : 500,
                cursor: isReachable && !busy ? 'pointer' : 'not-allowed',
              }}
            >
              <span aria-hidden style={STAGE_NUM}>
                {i + 1}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>

      <DialogBody style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {/* ── Stage 0 — Eckdaten ───────────────────────────────────────── */}
        {stage === 0 && (
          <>
            {/* Hot path first: Bezeichnung → Kategorie. The cooler fields move
                into a 'Merkmale' disclosure so Stage 0 opens uncluttered. */}
            <Field label="Bezeichnung" required>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Goldring 585 mit Brillant"
              />
            </Field>

            <CategoryPickerField
              value={category?.id ?? null}
              onChange={setCategory}
              disabled={busy}
            />
            <StampAttributeFields
              pathSlugs={category?.pathSlugs ?? []}
              erhaltung={stampErhaltung}
              minr={stampMinr}
              onErhaltungChange={setStampErhaltung}
              onMinrChange={setStampMinr}
              disabled={busy}
            />

            <Field label="SKU / Artikelnr." required>
              <Input
                mono
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="RING-585-001"
              />
            </Field>

            <Field label="Stückzahl">
              <Input
                mono
                inputMode="numeric"
                value={stueckzahl}
                onChange={(e) => setStueckzahl(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1"
              />
            </Field>
            {(() => {
                const n = Math.max(1, Math.min(200, Number.parseInt(stueckzahl, 10) || 1));
                if (n === 1) return null;
                const basis = sku.trim() || 'SKU';
                return (
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
                    Es entstehen {n} Stücke, {basis}-01 bis {basis}-{String(n).padStart(2, '0')},
                    jedes einzeln etikettierbar und verkäuflich.
                  </p>
                );
              })()}

            {/* Merkmale — Art · Zustand · Gewicht (progressive disclosure). */}
            <button
              type="button"
              aria-expanded={showMerkmale}
              onClick={() => setShowMerkmale((o) => !o)}
              style={DISCLOSE_ROW}
            >
              <span style={{ color: 'var(--w14-ink-aged)' }}>
                Merkmale: Art · Zustand · Gewicht
              </span>
              <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
                {showMerkmale ? '▾' : '▸'}
              </span>
            </button>
            {showMerkmale && (
              <>
                <div style={TWO_COL}>
                  <Field label="Art">
                    <Select
                      value={itemType}
                      onChange={(e) => {
                        const art = e.target.value as ItemType;
                        setItemType(art);
                        // Die Steuerart folgt der Warenart, solange der Mensch
                        // sie nicht selbst angefasst hat — eine Barre darf nie
                        // mit dem 25a-Vorschlag dastehen (siehe BARREN oben).
                        setTax((bisher) =>
                          bisher === steuerVorschlag(itemType) ? steuerVorschlag(art) : bisher,
                        );
                      }}
                    >
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
                <Field label="Gewicht (g)">
                  <Input
                    mono
                    inputMode="decimal"
                    value={weightGrams}
                    onChange={(e) => setWeightGrams(e.target.value)}
                    placeholder="optional"
                  />
                </Field>
              </>
            )}

            {/* Beschreibung & Details — collapsed: the hot path stays calm. */}
            <button
              type="button"
              aria-expanded={showBeschreibung}
              onClick={() => setShowBeschreibung((o) => !o)}
              style={DISCLOSE_ROW}
            >
              <span style={{ color: 'var(--w14-ink-aged)' }}>
                Beschreibung & Details
                {description.trim().length > 0 || hasCollectorDetails(details)
                  ? ' · ausgefüllt'
                  : ''}
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
          </>
        )}

        {/* ── Stage 1 — Preis & Steuer ─────────────────────────────────── */}
        {stage === 1 && (
          <>
            <div style={TWO_COL}>
              <Field
                label="Einkaufswert €"
                required
                {...(formatEuroEcho(acquisitionCostEur)
                  ? { hint: formatEuroEcho(acquisitionCostEur) as string }
                  : {})}
              >
                <Input
                  mono
                  inputMode="decimal"
                  value={acquisitionCostEur}
                  onChange={(e) => setAcquisitionCostEur(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
              <Field
                label="Verkaufspreis €"
                required
                {...(formatEuroEcho(listPriceEur)
                  ? { hint: formatEuroEcho(listPriceEur) as string }
                  : {})}
              >
                <Input
                  mono
                  inputMode="decimal"
                  value={listPriceEur}
                  onChange={(e) => setListPriceEur(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
            </div>

            {/* Calm margin readout — its own quiet zone, no box-in-box. */}
            {marginEcho && (
              <div style={MARGIN_ROW}>
                <span style={MINI_LABEL}>Marge (kalkulatorisch)</span>
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-grund)',
                    fontWeight: 600,
                    color: marginEcho.positive ? 'var(--w14-verdigris)' : 'var(--w14-wax-red)',
                  }}
                >
                  {marginEcho.text}
                </span>
              </div>
            )}

            <Field label="Steuerart">
              <Select value={tax} onChange={(e) => setTax(e.target.value as TaxTreatmentCode)}>
                {TAX_OPTIONS.map((t) => (
                  // § 25a ist für Barren gesperrt (§ 25a Abs. 1 Nr. 3 UStG) —
                  // ausgegraut statt versteckt, damit der Grund sichtbar bleibt.
                  <option key={t} value={t} disabled={BARREN.has(itemType) && t === 'MARGIN_25A'}>
                    {TAX_TREATMENT_LABEL[t]}
                    {BARREN.has(itemType) && t === 'MARGIN_25A' ? ' (für Barren ausgeschlossen)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <span style={MINI_LABEL}>Lagerort (optional)</span>
              <div style={THREE_COL}>
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
            </div>
          </>
        )}

        {/* ── Stage 2 — Foto · Etikett · Online ────────────────────────── */}
        {stage === 2 && (
          <>
            {/* Recognition-over-recall summary before the commit — incl. the
                "where does it go" facts: Kategorie + Lagerort + Briefmarke. */}
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
              <SummaryRow label="Bezeichnung" value={name.trim() || '-'} />
              <SummaryRow label="SKU" value={sku.trim() || '-'} mono />
              <SummaryRow label="Verkaufspreis" value={formatEuroEcho(listPriceEur) ?? '-'} mono />
              <SummaryRow
                label="Kategorie"
                value={category ? category.pathNames.join(' › ') : '-'}
              />
              <SummaryRow
                label="Lagerort"
                value={
                  [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
                    .filter((s) => s.length > 0)
                    .join(' · ') || 'noch nicht zugewiesen'
                }
                mono
              />
              {formatStampDisplay(
                stampMinr.trim().length > 0 ? Number.parseInt(stampMinr, 10) : null,
                stampErhaltung,
              ) && (
                <SummaryRow
                  label="Briefmarke"
                  value={
                    formatStampDisplay(
                      stampMinr.trim().length > 0 ? Number.parseInt(stampMinr, 10) : null,
                      stampErhaltung,
                    ) as string
                  }
                />
              )}
            </div>

            {/* The clear add → Foto → Etikett/Barcode → veröffentlichen path. */}
            <ol style={NEXT_STEPS}>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Check} size={15} aria-hidden /> Produkt anlegen (Entwurf)
              </li>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Tag} size={15} aria-hidden /> In Lager: Foto aufnehmen, dann Etikett /
                Barcode drucken
              </li>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Tag} size={15} aria-hidden /> Freigeben: hier sofort verkaufbar oder
                später aus dem Lager
              </li>
            </ol>

            {/* OBVIOUS online-shop affordance — price-gated (the €0 guard).
                The Checkbox owns the <label> + input; this box is just the
                gold-bordered, state-reactive container around it. */}
            <div
              style={{
                ...PUBLISH_BOX,
                borderColor: effectivePublish ? 'var(--w14-verdigris)' : 'var(--w14-rule)',
                background: effectivePublish ? 'var(--w14-parchment-3)' : 'transparent',
                opacity: canPublish ? 1 : 0.65,
              }}
            >
              <Checkbox
                checked={effectivePublish}
                disabled={!canPublish || busy}
                onChange={(e) => setPublishNow(e.target.checked)}
                label={
                  <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--w14-ink)' }}>
                      Zum Verkauf freigeben
                    </span>
                    <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
                      {canPublish
                        ? 'Sofort an der Kasse verkaufbar, statt nur als Entwurf im Lager.'
                        : 'Erst möglich, wenn ein Verkaufspreis über 0,00 € hinterlegt ist.'}
                    </span>
                  </span>
                }
              />
            </div>
          </>
        )}
      </DialogBody>

      {/*
        ⚠️ DER SATZ UNTER DEM GRAUEN KNOPF.
        Ein grauer Knopf ohne Begruendung ist keine Fuehrung, sondern eine
        Wand. Basel stand am 02.08.2026 davor und hielt es fuer einen Defekt.
        Der Satz nennt die STUFE mit, denn die Ursache liegt oft HINTER dem
        Menschen: er steht auf der letzten Stufe, und das fehlende Feld wohnt
        auf der ersten oder in einem zugeklappten Abschnitt.
      */}
      {anmerkungen.length > 0 && !busy
        ? anmerkungen.map((satz) => (
            <div
              key={satz}
              role="status"
              style={{
                margin: '0 var(--space-5) var(--space-2)',
                padding: 'var(--space-3)',
                border: '1px solid var(--w14-rule)',
                borderRadius: 'var(--w14-radius-fein)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {satz}
            </div>
          ))
        : null}

      {luecken.length > 0 && !busy ? (
        <div
          role="status"
          style={{
            margin: '0 var(--space-5) var(--space-2)',
            padding: 'var(--space-3)',
            border: '1px solid var(--w14-gold-deep)',
            borderRadius: 'var(--w14-radius-fein)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink)',
          }}
        >
          {grundZeile(luecken)}
        </div>
      ) : null}

      {/* ── Footer: quiet ghost left, big CTAs right (reverse-Fitts) ────── */}
      <DialogFooter style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" disabled={busy} onClick={handleClose}>
          Abbrechen
        </Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {stage > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setStage((s) => (s - 1) as Stage)}
            >
              Zurück
            </Button>
          )}

          {stage < 2 ? (
            <Button
              variant="primary"
              size="lg"
              disabled={busy || (stage === 0 ? !stage0Valid : !stage1Valid)}
              style={{ minHeight: 56, minWidth: 140 }}
              onClick={() => setStage((s) => (s + 1) as Stage)}
            >
              Weiter
            </Button>
          ) : (
            <>
              {/* Fast repeat-entry: save and immediately start the next item. */}
              <Button variant="ghost" disabled={!valid || busy} onClick={() => void submit(true)}>
                {busy ? 'Speichert…' : 'Speichern & weiteres'}
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={!valid || busy}
                style={{ minHeight: 56, minWidth: 150 }}
                onClick={() => void submit(false)}
              >
                {busy ? 'Speichert…' : effectivePublish ? 'Anlegen & online' : 'Anlegen'}
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div style={SUMMARY_ROW}>
      <span style={MINI_LABEL}>{label}</span>
      <span
        className={mono ? 'w14-tabular' : undefined}
        style={{
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
          fontSize: 'var(--w14-schrift-betont)',
          color: 'var(--w14-ink)',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '60%',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
const HEAD_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-12)',
  padding: 'var(--w14-abstand-16) var(--w14-abstand-20) 0',
};
const HEAD_TITLE: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontWeight: 600,
  fontSize: 'var(--w14-schrift-titel)',
};
const HEAD_SUB: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-text)',
};
const SESSION_BADGE: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-4)',
  fontSize: 'var(--w14-schrift-zeile)',
  fontFamily: 'var(--w14-font-mono)',
  color: 'var(--w14-verdigris)',
  border: '1px solid var(--w14-verdigris)',
  borderRadius: 'var(--w14-radius-button)',
  padding: 'var(--w14-abstand-4) var(--w14-abstand-8)',
  whiteSpace: 'nowrap',
};
const CLOSE_BTN: CSSProperties = {
  width: 48,
  height: 48,
  flex: '0 0 auto',
  border: 'none',
  background: 'transparent',
  color: 'var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const STAGE_RAIL: CSSProperties = {
  display: 'flex',
  gap: 'var(--w14-abstand-6)',
  padding: 'var(--w14-abstand-14) var(--w14-abstand-20) 0',
};
const STAGE_TAB: CSSProperties = {
  flex: 1,
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--w14-abstand-8)',
  padding: '0 var(--w14-abstand-8)',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-button)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-feld)',
  transition:
    'background-color var(--w14-dur-short) var(--w14-ease-curator),' +
    ' border-color var(--w14-dur-short) var(--w14-ease-curator)',
};
const STAGE_NUM: CSSProperties = {
  fontFamily: 'var(--w14-font-mono)',
  fontSize: 'var(--w14-schrift-zeile)',
  color: 'var(--w14-ink-faded)',
};
const TWO_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};
const THREE_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
};
const MINI_LABEL: CSSProperties = {
  display: 'block',
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const MARGIN_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-12)',
  padding: 'var(--w14-abstand-10) 0',
  borderTop: '1px solid var(--w14-rule)',
  borderBottom: '1px solid var(--w14-rule)',
};
const SUMMARY_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-12)',
};
const NEXT_STEPS: CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-8)',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink-aged)',
};
const NEXT_STEP_LI: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
};
const PUBLISH_BOX: CSSProperties = {
  display: 'block',
  padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-card)',
  transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator)',
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

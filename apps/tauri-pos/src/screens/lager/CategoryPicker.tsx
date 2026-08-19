/**
 * CategoryPicker — calm cascading category capture for the product forms.
 *
 *   • Breadcrumb-led level navigation: 'Alle › Briefmarken › Altdeutschland'
 *     chips + a 'Zurück' step-up; tapping a tile with children DRILLS IN,
 *     tapping a leaf SELECTS (one obvious tap). Tree from GET /api/categories
 *     (cached under the same TanStack key as WebSeoPanel: ['categories','tree']).
 *   • Prominent search across ALL levels — each hit shows its parent path.
 *   • MiNr-range hints for stamp categories (lib/taxonomy-hints constants,
 *     falling back to the node's seeded descriptionDe), shown calmly.
 *   • Selection = primaryCategoryId.
 *
 * Also exports the shared progressive-disclosure field groups both product
 * forms reuse (smallest-diff wiring in NeuesProduktDialog + ProductSheet):
 *   • StampAttributeFields    — Erhaltung segmented control + MiNr input
 *   • BeschreibungDetailsFields — Beschreibung + 'Details' group
 *     (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz)
 *
 * German UI, ≥44px targets, soft validation only (a save is never blocked
 * by a MiNr plausibility warning).
 */

import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import {
  type CategoryNode,
  type CategoryTreeResponse,
  type ProductUpdateBody,
  categoriesApi,
} from '@norns/api-client';
import { Check, ChevronLeft, Field, Icon, Input, Search, Textarea } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import {
  ERHALTUNG_OPTIONS,
  STAMP_ROOT_SLUG,
  type StampErhaltung,
  formatRangeHint,
  isStampPath,
  minrWarning,
  stampRangeForPath,
  stampRangeForSlug,
} from '../../lib/taxonomy-hints.js';

// ─────────────────────────────────────────────────────────────────────────
// Tree access + selection resolution
// ─────────────────────────────────────────────────────────────────────────

/** Same key WebSeoPanel uses — one cached tree for the whole Lager screen. */
export const categoryTreeKey: readonly unknown[] = ['categories', 'tree'];

export function useCategoryTree(): {
  roots: CategoryNode[];
  isLoading: boolean;
  isError: boolean;
} {
  const api = useApiClient();
  const q = useQuery<CategoryTreeResponse>({
    queryKey: categoryTreeKey,
    queryFn: () => categoriesApi.tree(api),
    staleTime: 5 * 60_000,
  });
  return { roots: q.data?.roots ?? [], isLoading: q.isLoading, isError: q.isError };
}

export interface CategorySelection {
  id: string;
  slug: string;
  nameDe: string;
  /** Root → selected node. */
  pathNames: string[];
  pathSlugs: string[];
  rootSlug: string;
  rootNameDe: string;
}

function toSelection(path: CategoryNode[]): CategorySelection | null {
  const leaf = path[path.length - 1];
  const root = path[0];
  if (!leaf || !root) return null;
  return {
    id: leaf.id,
    slug: leaf.slug,
    nameDe: leaf.nameDe,
    pathNames: path.map((n) => n.nameDe),
    pathSlugs: path.map((n) => n.slug),
    rootSlug: root.slug,
    rootNameDe: root.nameDe,
  };
}

function findPath(roots: CategoryNode[], id: string): CategoryNode[] | null {
  const walk = (nodes: CategoryNode[], trail: CategoryNode[]): CategoryNode[] | null => {
    for (const n of nodes) {
      const next = [...trail, n];
      if (n.id === id) return next;
      const hit = walk(n.children, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots, []);
}

/** Resolve a category id (e.g. the product's primary category) to a full selection. */
export function resolveCategorySelection(
  roots: CategoryNode[],
  id: string | null,
): CategorySelection | null {
  if (!id || roots.length === 0) return null;
  const path = findPath(roots, id);
  return path ? toSelection(path) : null;
}

/** MiNr subtext for a stamp node — constants first, seeded descriptionDe as fallback. */
function nodeRangeText(node: CategoryNode, underStamps: boolean): string | null {
  const hint = stampRangeForSlug(node.slug);
  if (hint)
    return `MiNr. ${hint.min} bis ${hint.max ?? 'laufend'}${hint.blocks ? ` · ${hint.blocks}` : ''}`;
  if (underStamps && node.descriptionDe) return node.descriptionDe;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// CategoryPicker — the cascading picker itself
// ─────────────────────────────────────────────────────────────────────────

export interface CategoryPickerProps {
  /** Selected category id (primaryCategoryId) or null. */
  value: string | null;
  onChange: (selection: CategorySelection | null) => void;
  disabled?: boolean;
}

interface FlatEntry {
  node: CategoryNode;
  path: CategoryNode[];
}

export function CategoryPicker({ value, onChange, disabled }: CategoryPickerProps): JSX.Element {
  const { roots, isLoading, isError } = useCategoryTree();
  const [query, setQuery] = useState('');

  // The path we are BROWSING (root→current parent). Drilling into a node with
  // children pushes it here WITHOUT selecting; "Zurück" pops one level. This is
  // separate from the SELECTED value so the operator can navigate freely.
  const [browse, setBrowse] = useState<CategoryNode[]>([]);

  // When a value is set from outside (hydrate / edit), open the picker AT that
  // node's parent level so the selection is visible in context.
  const selectedPath = useMemo(() => (value ? (findPath(roots, value) ?? []) : []), [roots, value]);
  useEffect(() => {
    if (selectedPath.length > 0) setBrowse(selectedPath.slice(0, -1));
  }, [selectedPath]);

  const flat = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    const walk = (nodes: CategoryNode[], trail: CategoryNode[]): void => {
      for (const n of nodes) {
        const path = [...trail, n];
        out.push({ node: n, path });
        walk(n.children, path);
      }
    };
    walk(roots, []);
    return out;
  }, [roots]);

  const q = query.trim().toLowerCase();
  const hits = useMemo<FlatEntry[]>(() => {
    if (q.length === 0) return [];
    return flat
      .filter(
        (e) =>
          e.node.nameDe.toLowerCase().includes(q) ||
          e.node.slug.includes(q) ||
          (e.node.descriptionDe ?? '').toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [flat, q]);

  // The nodes shown at the current browse level + the trail that leads there.
  const parent = browse[browse.length - 1] ?? null;
  const levelNodes = parent ? parent.children : roots;
  const underStamps = browse.some((p) => p.slug === STAMP_ROOT_SLUG);

  /** Select a node (one tap = chosen). Clears the search if running. */
  const pick = (path: CategoryNode[]): void => {
    if (disabled) return;
    setQuery('');
    onChange(toSelection(path));
  };

  /** Drill into a node WITH children — browse without selecting. */
  const drill = (node: CategoryNode): void => {
    if (disabled) return;
    setBrowse((b) => [...b, node]);
  };

  /** Tap a tile: leaves select; parents drill in. */
  const tapTile = (node: CategoryNode): void => {
    if (node.children.length > 0) drill(node);
    else pick([...browse, node]);
  };

  /** Jump the breadcrumb to a given depth (0 = Alle / Hauptkategorien). */
  const jumpTo = (depth: number): void => {
    if (disabled) return;
    setQuery('');
    setBrowse((b) => b.slice(0, depth));
  };

  if (isLoading) {
    return <p style={QUIET_TEXT}>Kategorien werden geladen…</p>;
  }
  if (isError || roots.length === 0) {
    return <p style={QUIET_TEXT}>Keine Kategorien verfügbar. Später erneut versuchen.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
      {/* Prominent search — matches across ALL levels, shows the parent path. */}
      <div style={SEARCH_WRAP}>
        <span aria-hidden style={SEARCH_ICON}>
          <Icon icon={Search} size={18} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kategorie suchen, z. B. Baden, Goldmünzen, Sachsen…"
          aria-label="Kategorie über alle Ebenen suchen"
          disabled={disabled === true}
          style={SEARCH_INPUT}
        />
      </div>

      {q.length > 0 ? (
        // ── Search results across all levels (parent path shown) ───────
        hits.length === 0 ? (
          <p style={QUIET_TEXT}>Keine Kategorie passt zu „{query.trim()}“.</p>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)' }}>
            {hits.map((e) => {
              const range = nodeRangeText(
                e.node,
                e.path.some((p) => p.slug === STAMP_ROOT_SLUG),
              );
              const isSel = e.node.id === value;
              const trail = e.path.slice(0, -1);
              return (
                <button
                  key={e.node.id}
                  type="button"
                  disabled={disabled === true}
                  onClick={() => pick(e.path)}
                  style={{ ...HIT_ROW, ...(isSel ? TILE_SELECTED : {}) }}
                >
                  <span style={HIT_NAME}>
                    {isSel && <Icon icon={Check} size={15} aria-hidden style={{ flexShrink: 0 }} />}
                    {e.node.nameDe}
                  </span>
                  <span style={HIT_PATH}>
                    {trail.length > 0
                      ? `in ${trail.map((p) => p.nameDe).join(' › ')}`
                      : 'Hauptkategorie'}
                    {range ? ` · ${range}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        // ── Browse: breadcrumb path + Zurück + larger tiles ────────────
        <>
          {/* Breadcrumb chips: 'Alle › Briefmarken › Altdeutschland' — each a
              tap-target back to that level. */}
          <nav aria-label="Kategorie-Pfad" style={CRUMB_ROW}>
            <button
              type="button"
              disabled={disabled === true}
              onClick={() => jumpTo(0)}
              aria-current={browse.length === 0 ? 'true' : undefined}
              style={{ ...CRUMB_CHIP, ...(browse.length === 0 ? CRUMB_CHIP_ACTIVE : {}) }}
            >
              Alle
            </button>
            {browse.map((n, i) => (
              <span key={n.id} style={CRUMB_SEG}>
                <span aria-hidden style={CRUMB_SEP}>
                  ›
                </span>
                <button
                  type="button"
                  disabled={disabled === true}
                  onClick={() => jumpTo(i + 1)}
                  aria-current={i === browse.length - 1 ? 'true' : undefined}
                  style={{ ...CRUMB_CHIP, ...(i === browse.length - 1 ? CRUMB_CHIP_ACTIVE : {}) }}
                >
                  {n.nameDe}
                </button>
              </span>
            ))}
          </nav>

          {/* Zurück — step up one level (only when we have somewhere to go). */}
          {parent && (
            <button
              type="button"
              disabled={disabled === true}
              onClick={() => jumpTo(browse.length - 1)}
              style={BACK_BTN}
            >
              <Icon icon={ChevronLeft} size={18} aria-hidden />
              Zurück
              <span style={BACK_SUB}>
                {browse.length > 1 ? (browse[browse.length - 2]?.nameDe ?? 'Alle') : 'Alle'}
              </span>
            </button>
          )}

          <span style={LEVEL_LABEL}>
            {parent ? `${parent.nameDe} wählen` : 'Hauptkategorie wählen'}
          </span>
          <div style={TILE_WRAP}>
            {levelNodes.map((n) => {
              const range = nodeRangeText(n, underStamps || n.slug === STAMP_ROOT_SLUG);
              const hasKids = n.children.length > 0;
              const isSel = n.id === value;
              return (
                <button
                  key={n.id}
                  type="button"
                  disabled={disabled === true}
                  aria-pressed={isSel}
                  onClick={() => tapTile(n)}
                  style={{ ...TILE, ...(isSel ? TILE_SELECTED : {}) }}
                >
                  <span style={TILE_TOP}>
                    {isSel && <Icon icon={Check} size={15} aria-hidden style={{ flexShrink: 0 }} />}
                    <span style={TILE_NAME}>{n.nameDe}</span>
                    {hasKids && (
                      <span aria-hidden style={TILE_CHEVRON}>
                        ›
                      </span>
                    )}
                  </span>
                  {range && <span style={TILE_SUB}>{range}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CategoryPickerField — collapsed trigger row + expandable picker.
// The hot path shows ONE calm row; the cascade appears on demand.
// ─────────────────────────────────────────────────────────────────────────

export interface CategoryPickerFieldProps {
  value: string | null;
  onChange: (selection: CategorySelection | null) => void;
  disabled?: boolean;
}

export function CategoryPickerField({
  value,
  onChange,
  disabled,
}: CategoryPickerFieldProps): JSX.Element {
  const { roots } = useCategoryTree();
  const [open, setOpen] = useState(false);

  const selection = useMemo(() => resolveCategorySelection(roots, value), [roots, value]);
  const rangeHint = selection ? stampRangeForPath(selection.pathSlugs) : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
      {/* 14.08.2026: Hier stand „(Online-Shop)" — die Welt ist seit 0.4.0
          gelöscht. Die Kategorie ordnet den Bestand des Hauses. */}
      <span style={LEVEL_LABEL}>Kategorie</span>
      <button
        type="button"
        disabled={disabled === true}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={TRIGGER_ROW}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selection ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
            fontWeight: selection ? 600 : 400,
          }}
        >
          {selection ? selection.pathNames.join(' › ') : 'Kategorie wählen…'}
        </span>
        <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
          {open ? 'Ändern ▾' : selection ? 'Ändern ▸' : '▸'}
        </span>
      </button>

      {/* MiNr-Bereich calmly shown for a chosen stamp category (collapsed). */}
      {selection && rangeHint && !open && (
        <span style={QUIET_TEXT}>Bereich: {formatRangeHint(rangeHint)}</span>
      )}

      {open && (
        <div style={PICKER_BOX}>
          <CategoryPicker
            value={value}
            onChange={(sel) => {
              onChange(sel);
              // A leaf ends the cascade — collapse; a parent stays open to refine.
              if (sel) {
                const path = findPath(roots, sel.id);
                const leaf = path?.[path.length - 1];
                if (leaf && leaf.children.length === 0) setOpen(false);
              }
            }}
            disabled={disabled === true}
          />
          {selection && (
            <div style={SELECTED_BAR}>
              <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
                <span style={SELECTED_LABEL}>Ausgewählt</span>
                <span style={SELECTED_PATH}>{selection.pathNames.join(' › ')}</span>
                {rangeHint && <span style={QUIET_TEXT}>Bereich: {formatRangeHint(rangeHint)}</span>}
              </span>
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={disabled === true}
                style={CLEAR_BTN}
              >
                Entfernen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// StampAttributeFields — only rendered when the category is under Briefmarken.
// Erhaltung segmented control (owner's dealer notation as hints) + MiNr with
// a SOFT range plausibility warning (never blocks).
// ─────────────────────────────────────────────────────────────────────────

export interface StampAttributeFieldsProps {
  pathSlugs: readonly string[];
  erhaltung: StampErhaltung | null;
  /** Raw digits string ('' = unset). */
  minr: string;
  onErhaltungChange: (v: StampErhaltung | null) => void;
  onMinrChange: (v: string) => void;
  disabled?: boolean;
}

export function StampAttributeFields({
  pathSlugs,
  erhaltung,
  minr,
  onErhaltungChange,
  onMinrChange,
  disabled,
}: StampAttributeFieldsProps): JSX.Element | null {
  if (!isStampPath(pathSlugs)) return null;

  const range = stampRangeForPath(pathSlugs);
  const minrNum = minr.trim().length > 0 ? Number.parseInt(minr, 10) : Number.NaN;
  const warning = Number.isFinite(minrNum) ? minrWarning(pathSlugs, minrNum) : null;

  return (
    <div style={STAMP_BOX}>
      <span style={LEVEL_LABEL}>Briefmarke: Erhaltung</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-6)' }}>
        {ERHALTUNG_OPTIONS.map((o) => {
          const active = erhaltung === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled === true}
              aria-pressed={active}
              onClick={() => onErhaltungChange(active ? null : o.value)}
              style={{ ...TILE, ...(active ? TILE_SELECTED : {}) }}
            >
              <span>
                {o.label}
                {o.stars ? ` ${o.stars}` : ''}
              </span>
              {o.notation && <span style={TILE_SUB}>Notation {o.notation}</span>}
            </button>
          );
        })}
      </div>
      <span style={QUIET_TEXT}>Händler-Notation: ** postfrisch · * Falz · (,) gestempelt</span>

      <div style={{ maxWidth: 220 }}>
        <Field
          label="MiNr. (Michel)"
          {...(range ? { hint: formatRangeHint(range) } : {})}
          error={warning}
        >
          <Input
            mono
            inputMode="numeric"
            value={minr}
            onChange={(e) => onMinrChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="z. B. 27"
            disabled={disabled === true}
          />
        </Field>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BeschreibungDetailsFields — Beschreibung + collapsible Details
// (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz).
// ─────────────────────────────────────────────────────────────────────────

export interface CollectorDetailsDraft {
  period: string;
  yearFrom: string;
  yearTo: string;
  /** ISO-3166-1 alpha-2 — auto-uppercased; '' = unset. */
  originCountry: string;
  catalogReference: string;
}

export const EMPTY_COLLECTOR_DETAILS: CollectorDetailsDraft = {
  period: '',
  yearFrom: '',
  yearTo: '',
  originCountry: '',
  catalogReference: '',
};

export function hasCollectorDetails(d: CollectorDetailsDraft): boolean {
  return Object.values(d).some((v) => v.trim().length > 0);
}

/** '' or a valid 2-letter code — anything else is a (soft-stop) form error. */
export function isOriginCountryValid(d: CollectorDetailsDraft): boolean {
  const t = d.originCountry.trim();
  return t.length === 0 || /^[A-Z]{2}$/.test(t);
}

function intOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * PUT patch for description + Details — explicit `null` clears a field
 * (the form is hydrated from the detail, so the draft IS the truth).
 */
export function buildDetailsUpdate(
  description: string,
  d: CollectorDetailsDraft,
): ProductUpdateBody {
  return {
    descriptionDe: description.trim(),
    period: d.period.trim() || null,
    yearMintedFrom: intOrNull(d.yearFrom),
    yearMintedTo: intOrNull(d.yearTo),
    originCountry:
      isOriginCountryValid(d) && d.originCountry.trim() ? d.originCountry.trim() : null,
    catalogReference: d.catalogReference.trim() || null,
  };
}

export interface BeschreibungDetailsFieldsProps {
  description: string;
  onDescriptionChange: (v: string) => void;
  details: CollectorDetailsDraft;
  onDetailsChange: (d: CollectorDetailsDraft) => void;
  /** Open the Details group initially (e.g. when hydrated values exist). */
  defaultDetailsOpen?: boolean;
  disabled?: boolean;
}

export function BeschreibungDetailsFields({
  description,
  onDescriptionChange,
  details,
  onDetailsChange,
  defaultDetailsOpen,
  disabled,
}: BeschreibungDetailsFieldsProps): JSX.Element {
  const [openDetails, setOpenDetails] = useState(defaultDetailsOpen === true);
  const set = (patch: Partial<CollectorDetailsDraft>): void =>
    onDetailsChange({ ...details, ...patch });

  const countryError = isOriginCountryValid(details)
    ? null
    : 'Zwei-Buchstaben-Code, z. B. DE oder AT.';

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
      <Field
        label="Beschreibung"
        hint="Kurz und konkret. Sie steht in der Produktakte und hilft beim Wiederfinden."
      >
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={8192}
          placeholder="z. B. Sauber erhaltene Goldmünze, Originalpatina, aus Sammlungsauflösung."
          disabled={disabled === true}
        />
      </Field>

      <button
        type="button"
        aria-expanded={openDetails}
        onClick={() => setOpenDetails((o) => !o)}
        style={TRIGGER_ROW}
      >
        <span style={{ color: 'var(--w14-ink-aged)' }}>
          Details: Epoche · Prägejahr · Herkunft · Katalog
        </span>
        <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
          {openDetails ? '▾' : '▸'}
        </span>
      </button>

      {openDetails && (
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
          <div style={GRID_2}>
            <Field label="Epoche / Periode">
              <Input
                value={details.period}
                onChange={(e) => set({ period: e.target.value })}
                placeholder="z. B. Kaiserreich"
                maxLength={128}
                disabled={disabled === true}
              />
            </Field>
            <Field label="Katalog-Referenz">
              <Input
                value={details.catalogReference}
                onChange={(e) => set({ catalogReference: e.target.value })}
                placeholder="z. B. Jaeger 489"
                maxLength={128}
                disabled={disabled === true}
              />
            </Field>
          </div>
          <div style={GRID_3}>
            <Field label="Prägejahr von">
              <Input
                mono
                inputMode="numeric"
                value={details.yearFrom}
                onChange={(e) =>
                  set({ yearFrom: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })
                }
                placeholder="1871"
                disabled={disabled === true}
              />
            </Field>
            <Field label="Prägejahr bis">
              <Input
                mono
                inputMode="numeric"
                value={details.yearTo}
                onChange={(e) => set({ yearTo: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
                placeholder="1918"
                disabled={disabled === true}
              />
            </Field>
            <Field label="Herkunftsland" hint="ISO-Code" error={countryError}>
              <Input
                mono
                value={details.originCountry}
                onChange={(e) =>
                  set({
                    originCountry: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z]/g, '')
                      .slice(0, 2),
                  })
                }
                placeholder="DE"
                disabled={disabled === true}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles — modern clean neutral, ≥44px targets.
// ─────────────────────────────────────────────────────────────────────────

const LEVEL_LABEL: CSSProperties = {
  display: 'block',
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  marginBottom: 6,
};

const TILE_WRAP: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--w14-abstand-8)',
};

// ── Prominent search box (icon + borderless input on a bordered shell) ──────
const SEARCH_WRAP: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
  minHeight: 48,
  padding: '0 var(--w14-abstand-14)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment-2)',
};
const SEARCH_ICON: CSSProperties = {
  display: 'inline-flex',
  flexShrink: 0,
  color: 'var(--w14-ink-faded)',
};
const SEARCH_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 46,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-betont)',
};

// ── Breadcrumb path chips ───────────────────────────────────────────────────
const CRUMB_ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--w14-abstand-2)',
};
const CRUMB_SEG: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-2)',
};
const CRUMB_SEP: CSSProperties = {
  color: 'var(--w14-ink-faded)',
  padding: '0 var(--w14-abstand-2)',
  fontSize: 'var(--w14-schrift-text)',
};
const CRUMB_CHIP: CSSProperties = {
  minHeight: 32,
  padding: 'var(--w14-abstand-4) var(--w14-abstand-10)',
  border: '1px solid transparent',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-feld)',
  cursor: 'pointer',
};
const CRUMB_CHIP_ACTIVE: CSSProperties = {
  borderColor: 'var(--w14-rule)',
  background: 'var(--w14-parchment-3)',
  color: 'var(--w14-ink)',
  fontWeight: 600,
};

// ── Zurück (step up one level) ──────────────────────────────────────────────
const BACK_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
  alignSelf: 'flex-start',
  minHeight: 44,
  padding: '0 var(--w14-abstand-14) 0 var(--w14-abstand-10)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  cursor: 'pointer',
};
const BACK_SUB: CSSProperties = {
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-feld)',
};

const GRID_2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};

const GRID_3: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 'var(--space-3)',
};

const TILE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: 'var(--w14-abstand-2)',
  minHeight: 52,
  padding: 'var(--w14-abstand-10) var(--w14-abstand-14)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-betont)',
  cursor: 'pointer',
  textAlign: 'left',
};

const TILE_SELECTED: CSSProperties = {
  borderColor: 'var(--w14-accent, var(--w14-gold))',
  background: 'var(--w14-parchment-3)',
  fontWeight: 600,
};

const TILE_TOP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-6)',
};

const TILE_NAME: CSSProperties = {
  fontWeight: 500,
};

const TILE_CHEVRON: CSSProperties = {
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-grund)',
  lineHeight: 1,
};

const TILE_SUB: CSSProperties = {
  fontSize: 'var(--w14-schrift-zeile)',
  fontWeight: 400,
  color: 'var(--w14-ink-faded)',
  fontFamily: 'var(--w14-font-mono)',
};

const HIT_ROW: CSSProperties = {
  ...TILE,
  width: '100%',
  alignItems: 'stretch',
};

const HIT_NAME: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-6)',
  fontWeight: 600,
};

const HIT_PATH: CSSProperties = {
  fontSize: 'var(--w14-schrift-zeile)',
  color: 'var(--w14-ink-faded)',
};

const TRIGGER_ROW: CSSProperties = {
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

const PICKER_BOX: CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-10)',
  padding: 'var(--w14-abstand-12)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-parchment-2)',
};

const STAMP_BOX: CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-8)',
  padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
};

const CLEAR_BTN: CSSProperties = {
  flexShrink: 0,
  minHeight: 44,
  padding: '0 var(--w14-abstand-14)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-wax-red)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-feld)',
  cursor: 'pointer',
};

const SELECTED_BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-12)',
  padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
  border: '1px solid var(--w14-accent, var(--w14-gold))',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment-3)',
};

const SELECTED_LABEL: CSSProperties = {
  fontSize: 'var(--w14-schrift-kuerzel)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};

const SELECTED_PATH: CSSProperties = {
  fontWeight: 600,
  color: 'var(--w14-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const QUIET_TEXT: CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-feld)',
  color: 'var(--w14-ink-faded)',
  fontStyle: 'italic',
};

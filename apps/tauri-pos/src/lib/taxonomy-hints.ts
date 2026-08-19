/**
 * taxonomy-hints — pure constants + helpers mirroring the owner's category
 * list (Schorndorf shop taxonomy, seeded server-side via /api/categories).
 *
 *   • MiNr-range hints for the Briefmarken branch (Michel catalogue numbers),
 *     e.g. 'Baden · MiNr. 1–25' — used as a SOFT plausibility hint in the
 *     product forms (never blocks a save).
 *   • Erhaltung (stamp condition) options incl. the owner's dealer notation:
 *     Postfrisch = ⭐⭐ (**), Falz = ⭐ (*), Gestempelt = (,), Auf Brief.
 *   • Sortier-Tipps per root category — the one-line "where does it go"
 *     answer shown in the save success path.
 *
 * Pure data/functions only — no React, no API calls.
 */

// ── Stamp branch slugs ───────────────────────────────────────────────────

export const STAMP_ROOT_SLUG = 'briefmarken';
export const ALTDEUTSCHLAND_SLUG = 'altdeutschland';

// ── Erhaltung (stamp condition) ──────────────────────────────────────────

export type StampErhaltung = 'POSTFRISCH' | 'FALZ' | 'GESTEMPELT' | 'AUF_BRIEF';

export interface ErhaltungOption {
  value: StampErhaltung;
  /** German label shown on the segmented control. */
  label: string;
  /** Star shorthand shown next to the label ('' when none). */
  stars: string;
  /** The owner's dealer notation ('' when none). */
  notation: string;
}

export const ERHALTUNG_OPTIONS: readonly ErhaltungOption[] = [
  { value: 'POSTFRISCH', label: 'Postfrisch', stars: '⭐⭐', notation: '**' },
  { value: 'FALZ', label: 'Falz', stars: '⭐', notation: '*' },
  { value: 'GESTEMPELT', label: 'Gestempelt', stars: '', notation: '(,)' },
  { value: 'AUF_BRIEF', label: 'Auf Brief', stars: '', notation: '' },
];

export function erhaltungLabel(value: StampErhaltung): string {
  return ERHALTUNG_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Display string, e.g. 'MiNr. 27 · Postfrisch'. Returns null when empty. */
export function formatStampDisplay(
  minr: number | null | undefined,
  erhaltung: StampErhaltung | null | undefined,
): string | null {
  const parts: string[] = [];
  if (typeof minr === 'number' && Number.isFinite(minr)) parts.push(`MiNr. ${minr}`);
  if (erhaltung) parts.push(erhaltungLabel(erhaltung));
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── MiNr ranges (Michel) — mirrors the owner's list exactly ─────────────

export interface StampRangeHint {
  /** Display name, e.g. 'Baden'. */
  name: string;
  min: number;
  /** null = 'laufend' (open-ended, e.g. Bund). */
  max: number | null;
  /** Optional block-range note, e.g. 'Block 1–11'. */
  blocks?: string;
}

/**
 * Keyed by category slug. Altdeutschland states are keyed by their bare
 * state slug — `stampRangeForSlug` also tolerates seeded prefix variants
 * (`briefmarken-…` / `altdeutschland-…`).
 */
export const STAMP_MINR_RANGES: Readonly<Record<string, StampRangeHint>> = {
  'briefmarken-deutsches-reich': {
    name: 'Deutsches Reich',
    min: 1,
    max: 910,
    blocks: 'Block 1 bis 11',
  },
  'briefmarken-berlin': { name: 'Berlin (West)', min: 1, max: 879, blocks: 'Block 1 bis 8' },
  'briefmarken-bund': { name: 'Bund', min: 111, max: null, blocks: 'Block 2 bis laufend' },
  'briefmarken-ddr': { name: 'DDR', min: 242, max: 3365, blocks: 'Block 7 bis 100' },
  // Altdeutschland (18 states)
  baden: { name: 'Baden', min: 1, max: 25 },
  bayern: { name: 'Bayern', min: 1, max: 191 },
  bergedorf: { name: 'Bergedorf', min: 1, max: 5 },
  braunschweig: { name: 'Braunschweig', min: 1, max: 20 },
  bremen: { name: 'Bremen', min: 1, max: 19 },
  hamburg: { name: 'Hamburg', min: 1, max: 20 },
  hannover: { name: 'Hannover', min: 1, max: 25 },
  helgoland: { name: 'Helgoland', min: 1, max: 20 },
  luebeck: { name: 'Lübeck', min: 1, max: 20 },
  'mecklenburg-schwerin': { name: 'Mecklenburg-Schwerin', min: 1, max: 25 },
  'mecklenburg-strelitz': { name: 'Mecklenburg-Strelitz', min: 1, max: 6 },
  oldenburg: { name: 'Oldenburg', min: 1, max: 19 },
  preussen: { name: 'Preußen', min: 1, max: 32 },
  sachsen: { name: 'Sachsen', min: 1, max: 21 },
  'schleswig-holstein': { name: 'Schleswig-Holstein', min: 1, max: 15 },
  'thurn-und-taxis': { name: 'Thurn und Taxis', min: 1, max: 54 },
  wuerttemberg: { name: 'Württemberg', min: 1, max: 52 },
  'norddeutscher-postbezirk': { name: 'Norddeutscher Postbezirk', min: 1, max: 26 },
};

/** 'Baden · MiNr. 1–25' / 'Bund · MiNr. 111–laufend · Block 2–laufend'. */
export function formatRangeHint(hint: StampRangeHint): string {
  const range = `MiNr. ${hint.min} bis ${hint.max ?? 'laufend'}`;
  return [hint.name, range, hint.blocks].filter(Boolean).join(' · ');
}

/** Resolve a range hint for one category slug (tolerates seeder prefixes). */
export function stampRangeForSlug(slug: string): StampRangeHint | null {
  const direct = STAMP_MINR_RANGES[slug];
  if (direct) return direct;
  for (const prefix of ['briefmarken-', 'altdeutschland-']) {
    if (slug.startsWith(prefix)) {
      const stripped = STAMP_MINR_RANGES[slug.slice(prefix.length)];
      if (stripped) return stripped;
    }
  }
  return null;
}

/** Deepest node wins — pass the slug path root→leaf. */
export function stampRangeForPath(pathSlugs: readonly string[]): StampRangeHint | null {
  for (let i = pathSlugs.length - 1; i >= 0; i -= 1) {
    const slug = pathSlugs[i];
    if (!slug) continue;
    const hit = stampRangeForSlug(slug);
    if (hit) return hit;
  }
  return null;
}

/** True when the chosen category path lies under Briefmarken. */
export function isStampPath(pathSlugs: readonly string[]): boolean {
  return pathSlugs.includes(STAMP_ROOT_SLUG);
}

/**
 * SOFT plausibility check — returns a warning string when the MiNr falls
 * outside the category's usual range, otherwise null. NEVER blocks a save.
 */
export function minrWarning(pathSlugs: readonly string[], minr: number): string | null {
  if (!Number.isFinite(minr) || minr <= 0) return null;
  const hint = stampRangeForPath(pathSlugs);
  if (!hint) return null;
  const tooLow = minr < hint.min;
  const tooHigh = hint.max !== null && minr > hint.max;
  if (!tooLow && !tooHigh) return null;
  return `Außerhalb des üblichen Bereichs (${formatRangeHint(hint)}). Speichern ist trotzdem möglich.`;
}

// ── Sortier-Tipps (where does it go) per root category ──────────────────

const SORTIER_TIPP: Readonly<Record<string, string>> = {
  gold: 'Edelmetall, direkt in den Tresor.',
  silber: 'Edelmetall, in den Tresor bzw. das Silberfach.',
  platin: 'Edelmetall, direkt in den Tresor.',
  palladium: 'Edelmetall, direkt in den Tresor.',
  muenzen: 'In Münzkapseln/Tabletts, nach Gebiet und Jahrgang sortiert.',
  briefmarken: 'In Steckbücher/Klemmtaschen, nach Gebiet und MiNr. einsortieren.',
  schmuck: 'In die Schmuckvitrine, hochwertige Stücke in den Tresor.',
  barren: 'Barren mit Zertifikat zusammenhalten, in den Tresor.',
  medaillen: 'Zu den Medaillen-Tabletts, nach Anlass/Material sortiert.',
  banknoten: 'In Banknotenhüllen, liegend und lichtgeschützt lagern.',
  postkarten: 'In Archivboxen, nach Region/Motiv sortiert.',
  militaria: 'Ins Militaria-Regal, Herkunft dokumentieren.',
  antiquitaeten: 'In den Antiquitäten-Bereich, stoßsicher abstellen.',
  uhren: 'In die Uhrenvitrine, Werte in den Tresor.',
  'orden-ehrenzeichen': 'In die Orden-Vitrine, mit Band/Etui zusammenhalten.',
  'orden-und-ehrenzeichen': 'In die Orden-Vitrine, mit Band/Etui zusammenhalten.',
  ansichtskarten: 'In Archivboxen, nach Ort/Region einsortieren.',
  konvolute: 'Als Posten zusammenhalten, Konvolut-Regal.',
  neuheiten: 'Zur Neuheiten-Präsentation an der Theke.',
  ankauf: 'In die Ankauf-Zwischenablage, zeitnah bewerten.',
};

/** One-line 'Sortier-Tipp' for the chosen root category (null when unknown). */
export function sortierTipp(rootSlug: string | null | undefined): string | null {
  if (!rootSlug) return null;
  return SORTIER_TIPP[rootSlug] ?? null;
}

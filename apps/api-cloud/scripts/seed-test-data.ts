/**
 * seed-test-data.ts — populates the dev database with realistic content
 * so every screen of the Tauri POS / Werkstatt shows real rows.
 *
 * Idempotent: every INSERT either checks existence first or uses
 * ON CONFLICT DO NOTHING. Safe to re-run against a partially-seeded DB.
 *
 * What this is NOT:
 *   • Not part of `pnpm dev` (dev-bootstrap covers minimal boot needs).
 *   • Not a production seeder — refuses to run in NODE_ENV=production.
 *   • Not a migration — it only writes data rows, no schema DDL.
 *
 * Run:
 *   pnpm --filter @norns/api-cloud exec tsx scripts/seed-test-data.ts
 *   pnpm --filter @norns/api-cloud run dev:seed
 *
 * Connection: uses MIGRATOR_DATABASE_URL (same role as dev-bootstrap) so
 * we can write to columns the app role is explicitly REVOKEd from
 * (cumulative_spend_eur, ledger_events.*, reference tables).
 *
 * PII discipline:
 *   • Customer encrypted columns (BYTEA) are written via the SQL helpers
 *     `encrypt_pii()` / `blind_index()` inside a transaction where
 *     `warehouse14.pii_key` is set with `set_config(..., LOCAL)`. The key
 *     comes from process.env.NORNS_PII_KEY — same key the API will
 *     use at runtime so the rows are decryptable end-to-end.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';

// ─────────────────────────────────────────────────────────────────────────
// .env loader — same .env file dev-bootstrap reads via process.env
// (root .env already sets MIGRATOR_DATABASE_URL + NORNS_PII_KEY).
// We only pull the keys we care about; everything else is ignored.
// ─────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, '.env');
  let text: string;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return; // .env optional — process.env may already have everything
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

// ─────────────────────────────────────────────────────────────────────────
// Logging helpers — match dev-bootstrap's prefix shape so output is
// recognisable in a `pnpm dev` console.
// ─────────────────────────────────────────────────────────────────────────

function log(step: string, msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${step}: ${msg}`);
}

function fatal(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[seed] FATAL: ${msg}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// Domain types — narrow row shapes for the queries we run. Kept local so
// the script doesn't pull the full @norns/db type graph (it has a
// vector(1536) column that gets fiddly through raw postgres-js).
// ─────────────────────────────────────────────────────────────────────────

type Uuid = string;
type Numeric = string; // postgres NUMERIC always crosses the wire as text

interface Counts {
  taxCodes: number;
  categories: number;
  locations: number;
  products: number;
  customers: number;
  metalPriceCurrent: number;
  metalPriceHistory: number;
  tasks: number;
  belegtext: number;
  ledgerEvents: number;
}

const COUNTS: Counts = {
  taxCodes: 0,
  categories: 0,
  locations: 0,
  products: 0,
  customers: 0,
  metalPriceCurrent: 0,
  metalPriceHistory: 0,
  tasks: 0,
  belegtext: 0,
  ledgerEvents: 0,
};

// ─────────────────────────────────────────────────────────────────────────
// 1. Production guard
// ─────────────────────────────────────────────────────────────────────────
function refuseInProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    fatal('seed-test-data.ts must NOT run in NODE_ENV=production');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Tax treatment codes (additive — migration 0005 seeds 4; we add a 5th)
// ─────────────────────────────────────────────────────────────────────────
async function seedTaxTreatmentCodes(sql: Sql): Promise<void> {
  // Codes are TEXT primary keys; migration 0005 already seeds the four
  // production-relevant codes (MARGIN_25A, INVESTMENT_GOLD_25C,
  // STANDARD_19, REDUCED_7). We additionally insert EXPORT_TAX_FREE for
  // a more interesting UX dropdown — §6 UStG real export exemption.
  const rows = await sql<{ code: string }[]>`
    INSERT INTO tax_treatment_codes (code, description_de, description_en, effective_vat_rate, legal_reference)
    VALUES (
      'EXPORT_TAX_FREE',
      'Steuerfreie Ausfuhrlieferung',
      'Tax-free export delivery',
      0.0000,
      '§6 UStG'
    )
    ON CONFLICT (code) DO NOTHING
    RETURNING code`;
  if (rows.length > 0) log('tax', '  ✓ added EXPORT_TAX_FREE');
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tax_treatment_codes`;
  COUNTS.taxCodes = totals[0]?.n ?? 0;
  log('tax', `  total tax codes: ${COUNTS.taxCodes}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Reference data (karat + hallmarks) — fully seeded by migration 0005
//    and the app role is REVOKE'd from INSERT. Migrator can write but
//    there's nothing meaningful to add. Just no-op for clarity.
// ─────────────────────────────────────────────────────────────────────────
async function noteReferenceData(sql: Sql): Promise<void> {
  const k = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM karat_grades`;
  const h = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hallmarks`;
  log(
    'reference',
    `  karat_grades: ${k[0]?.n ?? 0}, hallmarks: ${h[0]?.n ?? 0} (migration-seeded; no-op)`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Business locations
// ─────────────────────────────────────────────────────────────────────────
interface SeedLocation {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
}

const LOCATIONS: SeedLocation[] = [
  {
    name: 'Hauptlager',
    street: 'Schillerstraße 17',
    postalCode: '79576',
    city: 'Weil am Rhein',
    phone: '+49 7621 1234567',
    email: 'hauptlager@warehouse14.de',
    isPrimary: true,
  },
  {
    name: 'Schaufenster',
    street: 'Hauptstraße 42',
    postalCode: '79576',
    city: 'Weil am Rhein',
    phone: '+49 7621 7654321',
    email: 'schaufenster@warehouse14.de',
    isPrimary: false,
  },
];

async function seedBusinessLocations(sql: Sql): Promise<void> {
  // No natural unique key besides id, but (city, name) is effectively unique
  // for our two seed rows. We check existence by name + city.
  for (const loc of LOCATIONS) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM business_locations
       WHERE name = ${loc.name} AND city = ${loc.city}
       LIMIT 1`;
    if (existing.length > 0) continue;

    await sql`
      INSERT INTO business_locations (
        name, street, postal_code, city, country_code,
        phone, email, is_primary, active,
        schema_org_business_type
      ) VALUES (
        ${loc.name}, ${loc.street}, ${loc.postalCode}, ${loc.city}, 'DE',
        ${loc.phone ?? null}, ${loc.email ?? null}, ${loc.isPrimary}, TRUE,
        'JewelryStore'
      )`;
    log('locations', `  ✓ ${loc.name} (${loc.city})`);
  }
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM business_locations`;
  COUNTS.locations = totals[0]?.n ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Categories — 2-level taxonomy
// ─────────────────────────────────────────────────────────────────────────
interface SeedCategory {
  slug: string;
  nameDe: string;
  nameEn: string;
  parentSlug: string | null;
}

const CATEGORIES: SeedCategory[] = [
  // Roots
  { slug: 'muenzen', nameDe: 'Münzen', nameEn: 'Coins', parentSlug: null },
  { slug: 'schmuck', nameDe: 'Schmuck', nameEn: 'Jewelry', parentSlug: null },
  { slug: 'antiquitaeten', nameDe: 'Antiquitäten', nameEn: 'Antiques', parentSlug: null },
  { slug: 'edelmetalle', nameDe: 'Edelmetalle', nameEn: 'Precious Metals', parentSlug: null },

  // Münzen
  { slug: 'kruegerrand', nameDe: 'Krügerrand', nameEn: 'Krugerrand', parentSlug: 'muenzen' },
  { slug: 'maple-leaf', nameDe: 'Maple Leaf', nameEn: 'Maple Leaf', parentSlug: 'muenzen' },
  {
    slug: 'wiener-philharmoniker',
    nameDe: 'Wiener Philharmoniker',
    nameEn: 'Vienna Philharmonic',
    parentSlug: 'muenzen',
  },
  {
    slug: 'sonderpraegungen',
    nameDe: 'Sonderprägungen',
    nameEn: 'Commemorative Coins',
    parentSlug: 'muenzen',
  },

  // Schmuck
  { slug: 'ringe', nameDe: 'Ringe', nameEn: 'Rings', parentSlug: 'schmuck' },
  { slug: 'ketten', nameDe: 'Ketten', nameEn: 'Necklaces', parentSlug: 'schmuck' },
  { slug: 'armbaender', nameDe: 'Armbänder', nameEn: 'Bracelets', parentSlug: 'schmuck' },
  { slug: 'ohrringe', nameDe: 'Ohrringe', nameEn: 'Earrings', parentSlug: 'schmuck' },

  // Antiquitäten
  { slug: 'uhren', nameDe: 'Uhren', nameEn: 'Watches', parentSlug: 'antiquitaeten' },
  {
    slug: 'silberbesteck',
    nameDe: 'Silberbesteck',
    nameEn: 'Silver Cutlery',
    parentSlug: 'antiquitaeten',
  },
  { slug: 'porzellan', nameDe: 'Porzellan', nameEn: 'Porcelain', parentSlug: 'antiquitaeten' },

  // Edelmetalle
  { slug: 'goldbarren', nameDe: 'Goldbarren', nameEn: 'Gold Bars', parentSlug: 'edelmetalle' },
  {
    slug: 'silberbarren',
    nameDe: 'Silberbarren',
    nameEn: 'Silver Bars',
    parentSlug: 'edelmetalle',
  },
];

async function seedCategories(sql: Sql): Promise<Map<string, Uuid>> {
  const slugToId = new Map<string, Uuid>();

  // Pass 1: roots
  for (const cat of CATEGORIES.filter((c) => c.parentSlug === null)) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM categories WHERE slug = ${cat.slug} LIMIT 1`;
    if (existing[0]) {
      slugToId.set(cat.slug, existing[0].id);
      continue;
    }
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO categories (slug, name_de, name_en, schema_org_type, display_order, hidden_from_storefront)
      VALUES (${cat.slug}, ${cat.nameDe}, ${cat.nameEn}, 'Product', 0, FALSE)
      RETURNING id`;
    if (inserted[0]) {
      slugToId.set(cat.slug, inserted[0].id);
      log('categories', `  ✓ root: ${cat.nameDe}`);
    }
  }

  // Pass 2: children
  for (const cat of CATEGORIES.filter((c) => c.parentSlug !== null)) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM categories WHERE slug = ${cat.slug} LIMIT 1`;
    if (existing[0]) {
      slugToId.set(cat.slug, existing[0].id);
      continue;
    }
    // biome-ignore lint/style/noNonNullAssertion: seed data; a missing parent is handled by the next guard.
    const parentId = slugToId.get(cat.parentSlug!);
    if (!parentId) {
      log('categories', `  ✗ skip ${cat.slug} — parent ${cat.parentSlug} not found`);
      continue;
    }
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO categories (slug, name_de, name_en, parent_id, schema_org_type, display_order, hidden_from_storefront)
      VALUES (${cat.slug}, ${cat.nameDe}, ${cat.nameEn}, ${parentId}::uuid, 'Product', 0, FALSE)
      RETURNING id`;
    if (inserted[0]) {
      slugToId.set(cat.slug, inserted[0].id);
    }
  }
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM categories`;
  COUNTS.categories = totals[0]?.n ?? 0;
  log('categories', `  total: ${COUNTS.categories}`);
  return slugToId;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Products — 20 realistic items split across gold / silver / jewelry / antiques
// ─────────────────────────────────────────────────────────────────────────
type ItemTypeEnum =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

type ConditionEnum =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

interface SeedProduct {
  sku: string;
  name: string;
  descriptionDe: string;
  itemType: ItemTypeEnum;
  metal: 'gold' | 'silver' | 'platinum' | 'palladium' | null;
  karatCode: string | null; // e.g. '24K' — must exist in karat_grades
  finenessDecimal: Numeric | null; // e.g. '0.9990'
  weightGrams: Numeric | null;
  hallmarkStamps: string[];
  taxTreatmentCode: string;
  acquisitionCostEur: Numeric;
  listPriceEur: Numeric;
  condition: ConditionEnum;
  categorySlug: string;
  storageUnit: string;
  drawer: string;
  yearMintedFrom?: number;
  originCountry?: string;
}

// Realistic Weil am Rhein gold dealer pricing — spot ~63 €/g for gold,
// ~0.90 €/g silver. Premiums applied per item type.
const PRODUCTS: SeedProduct[] = [
  // ── 5 Gold ───────────────────────────────────────────────────────────
  {
    sku: 'KRG-2023-001',
    name: 'Krügerrand 1 oz 2023',
    descriptionDe: 'Original südafrikanische Goldmünze, 1 Unze (31,103 g), Feingehalt 916/1000.',
    itemType: 'gold_coin',
    metal: 'gold',
    karatCode: '22K',
    finenessDecimal: '0.9160',
    weightGrams: '33.9300',
    hallmarkStamps: ['916'],
    taxTreatmentCode: 'INVESTMENT_GOLD_25C',
    acquisitionCostEur: '1850.00',
    listPriceEur: '1980.00',
    condition: 'USED_EXCELLENT',
    categorySlug: 'kruegerrand',
    storageUnit: 'Tresor A',
    drawer: 'Schublade 1',
    yearMintedFrom: 2023,
    originCountry: 'ZA',
  },
  {
    sku: 'ML-2024-001',
    name: 'Maple Leaf 1 oz 2024',
    descriptionDe: 'Royal Canadian Mint, 1 Unze (31,103 g), Feingehalt 999,9/1000.',
    itemType: 'gold_coin',
    metal: 'gold',
    karatCode: '24K',
    finenessDecimal: '0.9990',
    weightGrams: '31.1030',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'INVESTMENT_GOLD_25C',
    acquisitionCostEur: '1880.00',
    listPriceEur: '2010.00',
    condition: 'NEW',
    categorySlug: 'maple-leaf',
    storageUnit: 'Tresor A',
    drawer: 'Schublade 1',
    yearMintedFrom: 2024,
    originCountry: 'CA',
  },
  {
    sku: 'BAR-HM-100G-001',
    name: 'Heimerle+Meule Goldbarren 100g',
    descriptionDe: 'Geprägter Goldbarren 100g, Feingehalt 999,9/1000, mit Zertifikat.',
    itemType: 'gold_bar',
    metal: 'gold',
    karatCode: '24K',
    finenessDecimal: '0.9990',
    weightGrams: '100.0000',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'INVESTMENT_GOLD_25C',
    acquisitionCostEur: '6250.00',
    listPriceEur: '6480.00',
    condition: 'NEW',
    categorySlug: 'goldbarren',
    storageUnit: 'Tresor A',
    drawer: 'Schublade 2',
    originCountry: 'DE',
  },
  {
    sku: 'BAR-HE-50G-001',
    name: 'Heraeus Goldbarren 50g',
    descriptionDe: 'Gegossener Goldbarren 50g Heraeus, Feingehalt 999,9/1000, mit Seriennummer.',
    itemType: 'gold_bar',
    metal: 'gold',
    karatCode: '24K',
    finenessDecimal: '0.9990',
    weightGrams: '50.0000',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'INVESTMENT_GOLD_25C',
    acquisitionCostEur: '3120.00',
    listPriceEur: '3245.00',
    condition: 'NEW',
    categorySlug: 'goldbarren',
    storageUnit: 'Tresor A',
    drawer: 'Schublade 2',
    originCountry: 'DE',
  },
  {
    sku: 'REICH-20M-1888',
    name: '20 Mark Reichsgoldmünze 1888 Wilhelm II',
    descriptionDe:
      'Historische 20-Mark-Goldmünze, Wilhelm II., Preußen, 7,965 g, Feingehalt 900/1000.',
    itemType: 'gold_coin',
    metal: 'gold',
    karatCode: '22K',
    finenessDecimal: '0.9000',
    weightGrams: '7.9650',
    hallmarkStamps: ['900'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '420.00',
    listPriceEur: '595.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'sonderpraegungen',
    storageUnit: 'Vitrine 3',
    drawer: 'Fach links',
    yearMintedFrom: 1888,
    originCountry: 'DE',
  },

  // ── 5 Silver ─────────────────────────────────────────────────────────
  {
    sku: 'BAR-GE-1KG-001',
    name: 'Geiger Silberbarren 1kg',
    descriptionDe: 'Geprägter Silberbarren 1 kg, Geiger Edelmetalle, Feingehalt 999/1000.',
    itemType: 'silver_bar',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.9990',
    weightGrams: '1000.0000',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '895.00',
    listPriceEur: '1050.00',
    condition: 'NEW',
    categorySlug: 'silberbarren',
    storageUnit: 'Tresor B',
    drawer: 'Regal 1',
    originCountry: 'DE',
  },
  {
    sku: 'BAR-MO-100G-001',
    name: 'Münze Österreich Silberbarren 100g',
    descriptionDe: 'Münze Österreich Silberbarren 100g, Feingehalt 999/1000.',
    itemType: 'silver_bar',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.9990',
    weightGrams: '100.0000',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '92.00',
    listPriceEur: '118.00',
    condition: 'NEW',
    categorySlug: 'silberbarren',
    storageUnit: 'Tresor B',
    drawer: 'Regal 1',
    originCountry: 'AT',
  },
  {
    sku: 'KRG-AG-SET5',
    name: 'Silber-Krügerrand Set 5x 1oz',
    descriptionDe:
      'Fünf-teiliges Set Silber-Krügerrand, je 1 Unze, Feingehalt 999/1000, Jahrgang 2022-2024.',
    itemType: 'silver_coin',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.9990',
    weightGrams: '155.5150',
    hallmarkStamps: ['999'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '155.00',
    listPriceEur: '215.00',
    condition: 'USED_EXCELLENT',
    categorySlug: 'kruegerrand',
    storageUnit: 'Vitrine 2',
    drawer: 'Fach Mitte',
    yearMintedFrom: 2022,
    originCountry: 'ZA',
  },
  {
    sku: 'SBK-WMF-12T',
    name: 'WMF Silberbesteck 12 Teile',
    descriptionDe:
      'Antikes Tafelbesteck WMF, 12-teilig (4 Gabeln, 4 Messer, 4 Löffel), 800er Silber, ca. 1920.',
    itemType: 'antique',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.8000',
    weightGrams: '620.0000',
    hallmarkStamps: ['800', 'WMF'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '380.00',
    listPriceEur: '595.00',
    condition: 'ANTIQUE_RESTORED',
    categorySlug: 'silberbesteck',
    storageUnit: 'Vitrine 1',
    drawer: 'Fach oben',
    yearMintedFrom: 1920,
    originCountry: 'DE',
  },
  {
    sku: 'TEAPOT-VICT-001',
    name: 'Viktorianische Silberteekanne',
    descriptionDe: 'Englische Teekanne, Sterling Silber 925, gepunzt London 1887, ca. 480g.',
    itemType: 'antique',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.9250',
    weightGrams: '480.0000',
    hallmarkStamps: ['925', 'London 1887'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '420.00',
    listPriceEur: '750.00',
    condition: 'ANTIQUE_RESTORED',
    categorySlug: 'silberbesteck',
    storageUnit: 'Vitrine 1',
    drawer: 'Fach oben',
    yearMintedFrom: 1887,
    originCountry: 'GB',
  },

  // ── 5 Jewelry ────────────────────────────────────────────────────────
  {
    sku: 'RING-750-SAPH-001',
    name: 'Goldring 750 mit Saphir',
    descriptionDe: 'Ring 750/1000 Gelbgold, ovaler Ceylon-Saphir ca. 1,5 ct, RW 56, mit Expertise.',
    itemType: 'gold_jewelry',
    metal: 'gold',
    karatCode: '18K',
    finenessDecimal: '0.7500',
    weightGrams: '6.8000',
    hallmarkStamps: ['750'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '480.00',
    listPriceEur: '895.00',
    condition: 'USED_EXCELLENT',
    categorySlug: 'ringe',
    storageUnit: 'Vitrine 4',
    drawer: 'Tablett 1',
    originCountry: 'DE',
  },
  {
    sku: 'CHAIN-585-50CM',
    name: 'Goldkette 585 50cm',
    descriptionDe: 'Panzerkette 585/1000 Gelbgold, Länge 50 cm, Federringverschluss, ca. 9,2g.',
    itemType: 'gold_jewelry',
    metal: 'gold',
    karatCode: '14K',
    finenessDecimal: '0.5850',
    weightGrams: '9.2000',
    hallmarkStamps: ['585'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '210.00',
    listPriceEur: '385.00',
    condition: 'USED_GOOD',
    categorySlug: 'ketten',
    storageUnit: 'Vitrine 4',
    drawer: 'Tablett 2',
    originCountry: 'IT',
  },
  {
    sku: 'RING-DIAM-VINT-001',
    name: 'Vintage Diamantring 1960',
    descriptionDe: 'Solitärring 750 Weißgold, Brillant ca. 0,5 ct (Si1, H), Fassung sechs Krappen.',
    itemType: 'gold_jewelry',
    metal: 'gold',
    karatCode: '18K',
    finenessDecimal: '0.7500',
    weightGrams: '4.1000',
    hallmarkStamps: ['750'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '780.00',
    listPriceEur: '1450.00',
    condition: 'ANTIQUE_RESTORED',
    categorySlug: 'ringe',
    storageUnit: 'Vitrine 4',
    drawer: 'Tablett 1',
    yearMintedFrom: 1960,
    originCountry: 'DE',
  },
  {
    sku: 'BROOCH-DECO-001',
    name: 'Art-Deco Brosche',
    descriptionDe: 'Brosche 585 Weißgold mit Onyx und Achtkant-Diamanten, ca. 1925, ca. 14g.',
    itemType: 'gold_jewelry',
    metal: 'gold',
    karatCode: '14K',
    finenessDecimal: '0.5850',
    weightGrams: '14.0000',
    hallmarkStamps: ['585'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '420.00',
    listPriceEur: '780.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'ohrringe',
    storageUnit: 'Vitrine 4',
    drawer: 'Tablett 3',
    yearMintedFrom: 1925,
    originCountry: 'DE',
  },
  {
    sku: 'CUFF-GOLD-585',
    name: 'Goldmanschettenknöpfe 585',
    descriptionDe: 'Paar Manschettenknöpfe 585/1000 Gelbgold, ovales Design, ca. 8g.',
    itemType: 'gold_jewelry',
    metal: 'gold',
    karatCode: '14K',
    finenessDecimal: '0.5850',
    weightGrams: '8.0000',
    hallmarkStamps: ['585'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '160.00',
    listPriceEur: '295.00',
    condition: 'USED_GOOD',
    categorySlug: 'ohrringe',
    storageUnit: 'Vitrine 4',
    drawer: 'Tablett 3',
    originCountry: 'DE',
  },

  // ── 5 Antiques ───────────────────────────────────────────────────────
  {
    sku: 'WATCH-GLAS-PKT-001',
    name: 'Glashütte Taschenuhr ca. 1910',
    descriptionDe:
      'Original Glashütte Sa Taschenuhr, Sprungdeckel, 585 Gelbgold, mechanisches Werk, läuft.',
    itemType: 'watch',
    metal: 'gold',
    karatCode: '14K',
    finenessDecimal: '0.5850',
    weightGrams: '92.0000',
    hallmarkStamps: ['585', 'Glashütte'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '1450.00',
    listPriceEur: '2680.00',
    condition: 'ANTIQUE_RESTORED',
    categorySlug: 'uhren',
    storageUnit: 'Vitrine 5',
    drawer: 'Fach links',
    yearMintedFrom: 1910,
    originCountry: 'DE',
  },
  {
    sku: 'MEIS-FIG-SHEP-001',
    name: 'Meissen Porzellanfigur Schäferin',
    descriptionDe: 'Meissen Schäferinnen-Figur, Modell 18. Jh., Marke Schwerter mit Punkt, H 22cm.',
    itemType: 'antique',
    metal: null,
    karatCode: null,
    finenessDecimal: null,
    weightGrams: null,
    hallmarkStamps: [],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '380.00',
    listPriceEur: '720.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'porzellan',
    storageUnit: 'Vitrine 1',
    drawer: 'Fach unten',
    yearMintedFrom: 1870,
    originCountry: 'DE',
  },
  {
    sku: 'COMP-BRASS-1875',
    name: 'Messing-Kompass um 1875',
    descriptionDe:
      'Antiker Schiffskompass, vermessing, kardanisch aufgehängt, im Holzkasten, voll funktionsfähig.',
    itemType: 'antique',
    metal: null,
    karatCode: null,
    finenessDecimal: null,
    weightGrams: null,
    hallmarkStamps: [],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '180.00',
    listPriceEur: '340.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'uhren',
    storageUnit: 'Vitrine 5',
    drawer: 'Fach rechts',
    yearMintedFrom: 1875,
    originCountry: 'GB',
  },
  {
    sku: 'STEIN-BIER-1890',
    name: 'Bierkrug Silber-Auflage 1890',
    descriptionDe: 'Süddeutscher Bierkrug, Steingut mit 925er Silberauflage und Zinndeckel, 0,5 l.',
    itemType: 'antique',
    metal: 'silver',
    karatCode: null,
    finenessDecimal: '0.9250',
    weightGrams: '180.0000',
    hallmarkStamps: ['925'],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '95.00',
    listPriceEur: '180.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'silberbesteck',
    storageUnit: 'Vitrine 1',
    drawer: 'Fach Mitte',
    yearMintedFrom: 1890,
    originCountry: 'DE',
  },
  {
    sku: 'OIL-PORTRAIT-1860',
    name: 'Öl-Porträt deutscher Meister 1860',
    descriptionDe:
      'Öl auf Leinwand, Damenporträt, signiert "F. Müller 1860", Original-Goldrahmen, 60x80cm.',
    itemType: 'antique',
    metal: null,
    karatCode: null,
    finenessDecimal: null,
    weightGrams: null,
    hallmarkStamps: [],
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '650.00',
    listPriceEur: '1280.00',
    condition: 'ANTIQUE_AS_FOUND',
    categorySlug: 'porzellan',
    storageUnit: 'Lager Wand',
    drawer: 'Rahmen 3',
    yearMintedFrom: 1860,
    originCountry: 'DE',
  },
];

async function seedProducts(sql: Sql, slugToCategoryId: Map<string, Uuid>): Promise<void> {
  for (const p of PRODUCTS) {
    // sku is UNIQUE — check existence first
    const existing = await sql<
      { id: string }[]
    >`SELECT id FROM products WHERE sku = ${p.sku} LIMIT 1`;
    if (existing.length > 0) continue;

    // products_non_draft_is_published requires published_at NOT NULL when
    // status != 'DRAFT'. We seed everything as AVAILABLE so set published_at.
    try {
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO products (
          sku, status, tax_treatment_code, item_type, metal, karat_code,
          fineness_decimal, weight_grams, hallmark_stamps,
          acquisition_cost_eur, list_price_eur,
          name, description_de, marketing_attributes,
          condition, is_commission,
          location_storage_unit, location_drawer, location_assigned_at,
          year_minted_from, origin_country,
          slug, seo_title, seo_description,
          is_published_to_web, published_at
        ) VALUES (
          ${p.sku}, 'AVAILABLE'::product_status, ${p.taxTreatmentCode},
          ${p.itemType}::item_type, ${p.metal}, ${p.karatCode},
          ${p.finenessDecimal}, ${p.weightGrams}, ${p.hallmarkStamps},
          ${p.acquisitionCostEur}, ${p.listPriceEur},
          ${p.name}, ${p.descriptionDe}, '[]'::jsonb,
          ${p.condition}::product_condition, FALSE,
          ${p.storageUnit}, ${p.drawer}, now(),
          ${p.yearMintedFrom ?? null}, ${p.originCountry ?? null},
          ${slugify(p.sku)}, ${`${p.name} kaufen | Warehouse14`},
          ${p.descriptionDe.slice(0, 155)},
          TRUE, now()
        )
        RETURNING id`;

      const productId = inserted[0]?.id;
      if (!productId) continue;

      // Link to category via product_categories M:N
      const categoryId = slugToCategoryId.get(p.categorySlug);
      if (categoryId) {
        await sql`
          INSERT INTO product_categories (product_id, category_id)
          VALUES (${productId}::uuid, ${categoryId}::uuid)
          ON CONFLICT DO NOTHING`;
      }
    } catch (err) {
      log('products', `  ✗ skip ${p.sku} — ${(err as Error).message.split('\n')[0]}`);
    }
  }
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM products`;
  COUNTS.products = totals[0]?.n ?? 0;
  log('products', `  total products: ${COUNTS.products}`);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Customers — 5 with KYC at varying levels, PII encrypted
// ─────────────────────────────────────────────────────────────────────────
type KycStatusEnum = 'NOT_REQUIRED' | 'PENDING' | 'CAPTURED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
type TrustLevelEnum = 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';

interface SeedCustomer {
  fullName: string;
  email: string;
  phone: string;
  address: string; // JSON string — encrypted as a single blob
  notes: string | null;
  dateOfBirth: string | null; // ISO date, e.g. '1965-03-12'
  kycStatus: KycStatusEnum;
  trustLevel: TrustLevelEnum;
  cumulativeSpendEur: Numeric;
  cumulativeAnkaufEur: Numeric;
  isKycVerified: boolean;
}

const CUSTOMERS: SeedCustomer[] = [
  {
    fullName: 'Hans Müller',
    email: 'hans.mueller@example.de',
    phone: '+4976211234567',
    address: JSON.stringify({
      street: 'Hauptstraße 12',
      postalCode: '79576',
      city: 'Weil am Rhein',
      country: 'DE',
    }),
    notes: 'Stammkunde seit 2022. Sammelt Krügerrand-Goldmünzen.',
    dateOfBirth: '1965-03-12',
    kycStatus: 'VERIFIED',
    trustLevel: 'VERIFIED',
    cumulativeSpendEur: '750.00',
    cumulativeAnkaufEur: '0.00',
    isKycVerified: true,
  },
  {
    fullName: 'Anna Schmidt',
    email: 'anna.schmidt@example.de',
    phone: '+4976212345678',
    address: JSON.stringify({
      street: 'Lerchenweg 5',
      postalCode: '79576',
      city: 'Weil am Rhein',
      country: 'DE',
    }),
    notes: 'Heute neu registriert; Ausweis noch nicht eingescannt.',
    dateOfBirth: null,
    kycStatus: 'PENDING',
    trustLevel: 'NEW',
    cumulativeSpendEur: '0.00',
    cumulativeAnkaufEur: '0.00',
    isKycVerified: false,
  },
  {
    fullName: 'Klaus Bauer',
    email: 'klaus.bauer@example.de',
    phone: '+4976213456789',
    address: JSON.stringify({
      street: 'Eichendorffstraße 22',
      postalCode: '79576',
      city: 'Weil am Rhein',
      country: 'DE',
    }),
    notes: 'Ausweis aufgenommen, wartet auf finale Prüfung.',
    dateOfBirth: '1972-11-08',
    kycStatus: 'CAPTURED',
    trustLevel: 'NEW',
    cumulativeSpendEur: '0.00',
    cumulativeAnkaufEur: '0.00',
    isKycVerified: false,
  },
  {
    fullName: 'Maria Weber',
    email: 'maria.weber@example.de',
    phone: '+4976214567890',
    address: JSON.stringify({
      street: 'Goethestraße 8',
      postalCode: '79576',
      city: 'Weil am Rhein',
      country: 'DE',
    }),
    notes: 'Stammkundin, kauft regelmäßig Schmuck. Interesse an Diamanten.',
    dateOfBirth: '1958-07-21',
    kycStatus: 'VERIFIED',
    trustLevel: 'VERIFIED',
    cumulativeSpendEur: '3450.00',
    cumulativeAnkaufEur: '180.00',
    isKycVerified: true,
  },
  {
    fullName: 'Yusuf Demir',
    email: 'yusuf.demir@example.de',
    phone: '+4976215678901',
    address: JSON.stringify({
      street: 'Bahnhofstraße 31',
      postalCode: '79576',
      city: 'Weil am Rhein',
      country: 'DE',
    }),
    notes: 'Laufkunde — keine KYC erforderlich (Bagatell-Beträge).',
    dateOfBirth: null,
    kycStatus: 'NOT_REQUIRED',
    trustLevel: 'NEW',
    cumulativeSpendEur: '0.00',
    cumulativeAnkaufEur: '0.00',
    isKycVerified: false,
  },
];

async function seedCustomers(sql: Sql, ownerUserId: Uuid): Promise<void> {
  const piiKey = process.env.NORNS_PII_KEY;
  if (!piiKey || piiKey.length < 16) {
    log('customers', '  ✗ skip — NORNS_PII_KEY missing or too short');
    return;
  }

  for (const c of CUSTOMERS) {
    // Idempotency: blind_index over normalized email is UNIQUE among
    // non-soft-deleted rows. We check first by computing the blind index
    // ourselves inside a tiny transaction (still need the key set).
    const normalizedEmail = c.email.trim().toLowerCase();
    const normalizedPhone = c.phone.trim();

    let inserted = false;
    try {
      await sql.begin(async (tx) => {
        // Set the PII key (LOCAL — auto-cleared at COMMIT/ROLLBACK)
        await tx`SELECT set_config('warehouse14.pii_key', ${piiKey}, true)`;

        // Existence check by blind index
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM customers
           WHERE email_blind_index = blind_index(${normalizedEmail})
             AND soft_deleted_at IS NULL
           LIMIT 1`;
        if (existing.length > 0) {
          return; // already seeded
        }
        inserted = true;

        // Verified customers need both kyc_completed_at + kyc_expires_at.
        // VERIFIED trust requires kyc_verified_at + kyc_verified_by_user_id.
        const kycCompletedSql =
          c.kycStatus === 'VERIFIED' ? sql`now() - INTERVAL '30 days'` : sql`NULL`;
        const kycExpiresSql =
          c.kycStatus === 'VERIFIED' ? sql`now() + INTERVAL '5 years'` : sql`NULL`;
        const kycVerifiedAtSql = c.isKycVerified ? sql`now() - INTERVAL '30 days'` : sql`NULL`;
        const kycVerifiedByUserSql = c.isKycVerified ? sql`${ownerUserId}::uuid` : sql`NULL`;

        await tx`
          INSERT INTO customers (
            full_name_encrypted,
            date_of_birth_encrypted,
            email_encrypted,
            phone_encrypted,
            address_encrypted,
            notes_encrypted,
            email_blind_index,
            phone_blind_index,
            preferred_language,
            kyc_status,
            kyc_completed_at,
            kyc_expires_at,
            trust_level,
            kyc_verified_at,
            kyc_verified_by_user_id,
            cumulative_spend_eur,
            cumulative_ankauf_eur,
            retention_until
          ) VALUES (
            encrypt_pii(${c.fullName}),
            encrypt_pii(${c.dateOfBirth}),
            encrypt_pii(${normalizedEmail}),
            encrypt_pii(${normalizedPhone}),
            encrypt_pii(${c.address}),
            encrypt_pii(${c.notes}),
            blind_index(${normalizedEmail}),
            blind_index(${normalizedPhone}),
            'de',
            ${c.kycStatus}::kyc_status,
            ${kycCompletedSql},
            ${kycExpiresSql},
            ${c.trustLevel}::customer_trust_level,
            ${kycVerifiedAtSql},
            ${kycVerifiedByUserSql},
            ${c.cumulativeSpendEur},
            ${c.cumulativeAnkaufEur},
            (CURRENT_DATE + INTERVAL '10 years')::date
          )`;
      });
      if (inserted) {
        log('customers', `  ✓ ${c.fullName} (${c.kycStatus} / trust=${c.trustLevel})`);
      }
    } catch (err) {
      log('customers', `  ✗ skip ${c.fullName} — ${(err as Error).message.split('\n')[0]}`);
    }
  }
  const totals = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM customers WHERE soft_deleted_at IS NULL`;
  COUNTS.customers = totals[0]?.n ?? 0;
  log('customers', `  total active customers: ${COUNTS.customers}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Metal prices — current + 30 days of history per metal
// ─────────────────────────────────────────────────────────────────────────
const METAL_SPOT_EUR_PER_GRAM: Record<string, number> = {
  gold: 63.0,
  silver: 0.92,
  platinum: 30.0,
  palladium: 28.0,
};

async function seedMetalPrices(sql: Sql, ownerUserId: Uuid): Promise<void> {
  for (const [metal, spot] of Object.entries(METAL_SPOT_EUR_PER_GRAM)) {
    // Is there already a CURRENT row?
    const current = await sql<{ id: string }[]>`
      SELECT id FROM metal_prices
       WHERE metal = ${metal} AND valid_to IS NULL
       LIMIT 1`;

    // Always insert historical rows if none exist for this metal at all —
    // makes the sparkline interesting on first run.
    const histExists = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM metal_prices WHERE metal = ${metal}`;
    const haveHistory = (histExists[0]?.n ?? 0) > 1;

    if (current.length === 0) {
      // Build 30 days of historical points + 1 current
      // valid_from runs from 30 days ago to now in 5-day strides
      const points = 6; // ~6 historical + 1 current
      const sourcePayload = { source: 'test_seed', note: 'Initial dev seed' };

      for (let i = points; i > 0; i--) {
        const daysAgo = i * 5;
        const variance = Math.sin(i) * 0.03 + 1; // ±3%
        const price = (spot * variance).toFixed(4);

        await sql`
          INSERT INTO metal_prices (
            metal, price_per_gram_eur, source,
            fetched_at, valid_from, valid_to,
            source_payload,
            manual_override_by_user_id, manual_override_reason
          ) VALUES (
            ${metal}, ${price}, 'MANUAL'::metal_price_source,
            now() - (${daysAgo} * INTERVAL '1 day'),
            now() - (${daysAgo} * INTERVAL '1 day'),
            now() - ((${daysAgo} - 5) * INTERVAL '1 day'),
            ${sql.json(sourcePayload)}::jsonb,
            ${ownerUserId}::uuid, 'Test seed historical point'
          )`;
        COUNTS.metalPriceHistory++;
      }

      // Current row
      await sql`
        INSERT INTO metal_prices (
          metal, price_per_gram_eur, source,
          fetched_at, valid_from, valid_to,
          source_payload,
          manual_override_by_user_id, manual_override_reason
        ) VALUES (
          ${metal}, ${spot.toFixed(4)}, 'MANUAL'::metal_price_source,
          now(), now(), NULL,
          ${sql.json(sourcePayload)}::jsonb,
          ${ownerUserId}::uuid, 'Test seed current spot'
        )`;
      COUNTS.metalPriceCurrent++;
      log('metals', `  ✓ ${metal} @ ${spot.toFixed(4)} €/g (+ ${points} historical)`);
    } else if (!haveHistory) {
      log('metals', `  ~ ${metal} current exists; skipping history backfill`);
    } else {
      log('metals', `  ~ ${metal} current+history already present`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Internal tasks — 8 owner-flavoured sample tasks
// ─────────────────────────────────────────────────────────────────────────
type TaskStatusEnum = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
type TaskPriorityEnum = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

interface SeedTask {
  title: string;
  description: string;
  priority: TaskPriorityEnum;
  status: TaskStatusEnum;
  dueOffsetDays: number | null; // 0 = today, null = no due date
}

const TASKS: SeedTask[] = [
  {
    title: 'Tagesabschluss durchführen',
    description: 'Kasse zählen, Z-Bon ausdrucken, Differenzen prüfen.',
    priority: 'HIGH',
    status: 'OPEN',
    dueOffsetDays: 0,
  },
  {
    title: 'Edelmetallpreise prüfen',
    description: 'LBMA-Spot vergleichen, Sammleraufschläge anpassen.',
    priority: 'NORMAL',
    status: 'IN_PROGRESS',
    dueOffsetDays: 0,
  },
  {
    title: 'GoBD-Export für Steuerberater vorbereiten',
    description: 'DSFinV-K Export Q1, Belege ZIP-en, Mail an Wagner & Partner.',
    priority: 'URGENT',
    status: 'OPEN',
    dueOffsetDays: 3,
  },
  {
    title: 'Schaufensterdekoration erneuern',
    description: 'Themenwechsel auf Frühlingsschmuck — neue Vitrinen-Tableaus.',
    priority: 'LOW',
    status: 'OPEN',
    dueOffsetDays: 14,
  },
  {
    title: 'Versicherungsanpassung Inventar',
    description: 'Inventarwert an Allianz übermittelt, neue Police erhalten.',
    priority: 'NORMAL',
    status: 'DONE',
    dueOffsetDays: -1,
  },
  {
    title: 'Kundenrückfrage Müller beantworten',
    description: 'Hans Müller möchte Krügerrand 2022 — Verfügbarkeit prüfen.',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    dueOffsetDays: 1,
  },
  {
    title: 'Neue Münzkategorie anlegen',
    description: 'Kategorie "Sonderprägungen" in Webshop integriert.',
    priority: 'LOW',
    status: 'DONE',
    dueOffsetDays: -3,
  },
  {
    title: 'Punzen-Datenbank aktualisieren',
    description: 'Neue tschechische Punzen recherchieren und ins Lexikon einpflegen.',
    priority: 'NORMAL',
    status: 'OPEN',
    dueOffsetDays: 21,
  },
];

async function seedInternalTasks(sql: Sql, ownerUserId: Uuid): Promise<void> {
  for (const t of TASKS) {
    // Title uniqueness (per-assignee) isn't enforced by the schema, but
    // we use it as a logical idempotency key.
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM internal_tasks
       WHERE title = ${t.title} AND assigned_to_user_id = ${ownerUserId}::uuid
       LIMIT 1`;
    if (existing.length > 0) continue;

    const startedAt =
      t.status === 'IN_PROGRESS' || t.status === 'DONE'
        ? sql`now() - INTERVAL '2 days'`
        : sql`NULL`;
    const completedAt = t.status === 'DONE' ? sql`now() - INTERVAL '1 day'` : sql`NULL`;
    const dueDate =
      t.dueOffsetDays === null
        ? sql`NULL`
        : sql`(CURRENT_DATE + (${t.dueOffsetDays} || ' days')::interval)::date`;

    try {
      await sql`
        INSERT INTO internal_tasks (
          title, description, priority, status,
          assigned_to_user_id, created_by_user_id,
          due_date, started_at, completed_at
        ) VALUES (
          ${t.title}, ${t.description}, ${t.priority}::task_priority, ${t.status}::task_status,
          ${ownerUserId}::uuid, ${ownerUserId}::uuid,
          ${dueDate}, ${startedAt}, ${completedAt}
        )`;
      log('tasks', `  ✓ ${t.status.padEnd(11)} ${t.priority.padEnd(7)} ${t.title}`);
    } catch (err) {
      log('tasks', `  ✗ skip ${t.title} — ${(err as Error).message.split('\n')[0]}`);
    }
  }
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM internal_tasks`;
  COUNTS.tasks = totals[0]?.n ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Belegtext templates — migration 0024 already seeds 7 default rows.
//     We don't add more — just count.
// ─────────────────────────────────────────────────────────────────────────
async function countBelegtextTemplates(sql: Sql): Promise<void> {
  const totals = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM belegtext_templates WHERE valid_to IS NULL`;
  COUNTS.belegtext = totals[0]?.n ?? 0;
  log('belegtext', `  total active templates: ${COUNTS.belegtext} (migration-seeded; no-op)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Ledger events — emit a representative spread so Tagebuch + Werkstatt
//     feed have content. The BEFORE INSERT trigger computes prev_hash and
//     row_hash; we leave those off the column list.
// ─────────────────────────────────────────────────────────────────────────
// Narrow JSON-serializable shape so postgres-js sql.json() accepts it.
type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [k: string]: JsonValue };

interface SeedLedgerEvent {
  eventType: string;
  entityTable: string;
  entityId: Uuid; // any uuid — does not need to FK
  payload: { [k: string]: JsonValue };
}

async function seedLedgerEvents(sql: Sql, ownerUserId: Uuid): Promise<void> {
  // Pick a real product id (first AVAILABLE) for inventory.adjusted entries
  const firstProduct = await sql<{ id: string; sku: string }[]>`
    SELECT id, sku FROM products WHERE status = 'AVAILABLE' ORDER BY created_at LIMIT 1`;
  const productId = firstProduct[0]?.id ?? '00000000-0000-0000-0000-000000000000';
  const productSku = firstProduct[0]?.sku ?? 'UNKNOWN';

  // Pick a real customer too
  const firstCustomer = await sql<{ id: string }[]>`SELECT id FROM customers LIMIT 1`;
  const customerId = firstCustomer[0]?.id ?? '00000000-0000-0000-0000-000000000000';

  const events: SeedLedgerEvent[] = [
    {
      eventType: 'auth.pin_login',
      entityTable: 'users',
      entityId: ownerUserId,
      payload: { device_class: 'POS_TERMINAL', success: true },
    },
    {
      eventType: 'metal_price.set',
      entityTable: 'metal_prices',
      entityId: productId,
      payload: { metal: 'gold', price_per_gram_eur: '63.0000', source: 'MANUAL' },
    },
    {
      eventType: 'metal_price.set',
      entityTable: 'metal_prices',
      entityId: productId,
      payload: { metal: 'silver', price_per_gram_eur: '0.9200', source: 'MANUAL' },
    },
    {
      eventType: 'inventory.adjusted',
      entityTable: 'products',
      entityId: productId,
      payload: { sku: productSku, reason: 'Zählkorrektur Tresor A', delta: 0 },
    },
    {
      eventType: 'product.listed',
      entityTable: 'products',
      entityId: productId,
      payload: { sku: productSku, channel: 'storefront' },
    },
    {
      eventType: 'customer.created',
      entityTable: 'customers',
      entityId: customerId,
      payload: { trust_level: 'VERIFIED' },
    },
    {
      eventType: 'customer.kyc_verified',
      entityTable: 'customers',
      entityId: customerId,
      payload: { verified_by: ownerUserId },
    },
    {
      eventType: 'task.completed',
      entityTable: 'internal_tasks',
      entityId: productId,
      payload: { title: 'Versicherungsanpassung Inventar' },
    },
    {
      eventType: 'auth.pin_login',
      entityTable: 'users',
      entityId: ownerUserId,
      payload: { device_class: 'POS_TERMINAL', success: true },
    },
    {
      eventType: 'belegtext.updated',
      entityTable: 'belegtext_templates',
      entityId: productId,
      payload: { kind: 'MARGIN_25A' },
    },
  ];

  // Idempotency: count rows where actor = owner and event_type IN our set.
  // If we already have ≥10 such rows we treat it as seeded.
  const existing = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ledger_events
     WHERE actor_user_id = ${ownerUserId}::uuid`;
  if ((existing[0]?.n ?? 0) >= 10) {
    log('ledger', `  ~ owner already has ${existing[0]?.n} events; skipping`);
    const tot = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ledger_events`;
    COUNTS.ledgerEvents = tot[0]?.n ?? 0;
    return;
  }

  for (const ev of events) {
    try {
      await sql`
        INSERT INTO ledger_events (
          event_type, entity_table, entity_id, actor_user_id, payload
        ) VALUES (
          ${ev.eventType}, ${ev.entityTable}, ${ev.entityId}::uuid, ${ownerUserId}::uuid,
          ${sql.json(ev.payload)}::jsonb
        )`;
    } catch (err) {
      log('ledger', `  ✗ skip ${ev.eventType} — ${(err as Error).message.split('\n')[0]}`);
    }
  }
  const totals = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ledger_events`;
  COUNTS.ledgerEvents = totals[0]?.n ?? 0;
  log('ledger', `  total events: ${COUNTS.ledgerEvents}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log('start', `Warehouse14 seed-test-data — NODE_ENV=${process.env.NODE_ENV ?? 'development'}`);
  refuseInProduction();

  const migratorUrl =
    process.env.MIGRATOR_DATABASE_URL ??
    'postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14_dev';
  const sql = postgres(migratorUrl, { max: 1, onnotice: () => {} });

  try {
    // Owner user (basel@warehouse14.local) — created by dev-bootstrap
    const owner = await sql<{ id: string; email: string }[]>`
      SELECT id, email FROM users WHERE email = 'basel@warehouse14.local' LIMIT 1`;
    if (owner.length === 0) {
      fatal('Owner user basel@warehouse14.local not found — run dev-bootstrap first');
    }
    // biome-ignore lint/style/noNonNullAssertion: guarded by the owner.length check above (fatal exits otherwise).
    const ownerUserId = owner[0]!.id;
    // biome-ignore lint/style/noNonNullAssertion: same owner.length guard.
    log('owner', `  using ${owner[0]!.email} (${ownerUserId.slice(0, 8)}…)`);

    await seedTaxTreatmentCodes(sql);
    await noteReferenceData(sql);
    await seedBusinessLocations(sql);
    const slugToCategoryId = await seedCategories(sql);
    await seedProducts(sql, slugToCategoryId);
    await seedCustomers(sql, ownerUserId);
    await seedMetalPrices(sql, ownerUserId);
    await seedInternalTasks(sql, ownerUserId);
    await countBelegtextTemplates(sql);
    await seedLedgerEvents(sql, ownerUserId);

    // One-line summary
    // eslint-disable-next-line no-console
    console.log(
      `[seed] ✓ ${COUNTS.taxCodes} tax codes, ${COUNTS.categories} categories, ` +
        `${COUNTS.locations} locations, ${COUNTS.products} products, ` +
        `${COUNTS.customers} customers, ${COUNTS.metalPriceCurrent} current metal prices ` +
        `(+${COUNTS.metalPriceHistory} historical), ${COUNTS.tasks} tasks, ` +
        `${COUNTS.belegtext} belegtext, ${COUNTS.ledgerEvents} ledger events`,
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[seed] fatal:', err);
  process.exit(1);
});

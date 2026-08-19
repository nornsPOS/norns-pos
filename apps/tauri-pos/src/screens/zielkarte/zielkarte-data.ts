/**
 * Zielkarte — the live data layer for the desktop "treasure board" of owner goals.
 *
 * The SAME honest fan-out the Übersicht dashboard runs (bridge · finance ·
 * inventory · metals · fixed costs), folded into the gauge metrics the board
 * draws. Ported from apps/mobile/src/warehouse14/goals/treasure-data.ts — the
 * axes, denominators and honesty rules are identical, so a desktop gauge can
 * never disagree with the mobile Schatzkammer about the same number.
 *
 * Honesty: every VALUE is a real number from a real endpoint. A source that is
 * not readable yields `available: false` → the instrument renders a calm locked
 * state, never a 0 or a fabricated win. The Fixkosten budget is the one local
 * reference (no endpoint goal yet); it is labelled a Richtwert, not a Ziel.
 */

import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  bridgeApi,
  dashboard as dashboardApi,
  financeApi,
  type FixedCostRow,
  fixedCostsApi,
} from '@norns/api-client';

import { useApiClient } from '../../lib/api-context.js';

/**
 * House reference denominators (mirror mobile GAUGE_TARGETS).
 *
 * ⚠️ 19.08.2026, Basels Frage: „auf welcher Basis sind meine Ziele gesetzt?"
 * Ehrliche Antwort: auf KEINER — das hier sind Hauskonstanten, die nie
 * jemand gewaehlt hat. Deshalb heissen sie auf der Karte seit heute
 * durchgehend „Richtwert", nicht mehr „Ziel": ein Ziel gibt es erst, wenn
 * der Inhaber eines setzt. Der naechste Ausbau (gemessen vorbereitet):
 * kuratierte `ziel.*`-Schluessel in EDITABLE_SETTINGS plus ein
 * Vorschlags-Endpunkt aus dem Median der letzten 30 FINALIZED-Tage von
 * `daily_closings` — Vorschlag ja, stille Vorgabe nein.
 */
export const GAUGE_TARGETS = {
  revenueEur: 1000,
  ankaufCount: 10,
  soldCount: 20,
  appraisals: 10,
  netProfitDayEur: 300,
  monthRevenueEur: 25000,
  inventoryValueEur: 50000,
  goldGrams: 500,
  silverGrams: 2000,
} as const;

/** A local Richtwert (reference), not an endpoint goal: the monthly fixed-cost
 *  budget the thermometer fills toward. Honest label: „Richtwert", not „Ziel". */
export const FIXKOSTEN_BUDGET_EUR = 7500;

/**
 * Wieviele Fixkostenzeilen auf einmal geholt werden.
 *
 * 200 ist die Obergrenze, die der Server ueberhaupt annimmt
 * (`apps/api-cloud/src/schemas/finance.ts`, `maximum: 200`). Wer mehr
 * anfordert, bekommt von Fastify einen Schemafehler statt Zeilen — und dann
 * stuende auf der Zielkarte GAR keine Fixkostenachse mehr.
 */
export const FIXKOSTEN_SEITE = 200;

const POLL_MS = 30_000;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// ── formatting ───────────────────────────────────────────────────────────────

const eur0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatEurCents(cents: number): string {
  return `${eur0.format(Math.round(cents / 100))} €`;
}
export function formatEurAmount(eurValue: number): string {
  return `${eur0.format(Math.round(eurValue))} €`;
}
/** Grams as g under 1 kg, else kg with one decimal ("350 g", "22,4 kg"). */
export function formatWeight(grams: number): string {
  if (grams >= 1000) return `${num1.format(grams / 1000)} kg`;
  return `${eur0.format(Math.round(grams))} g`;
}
export function formatPct(ratio: number): string {
  return `${Math.round(clamp01(ratio) * 100)}%`;
}

// ── metric model ─────────────────────────────────────────────────────────────

export type GoalKind = 'arc' | 'ring' | 'thermo' | 'tank' | 'chest' | 'scale' | 'lens';

export interface GoalMetric {
  id: string;
  title: string;
  zielText: string;
  valueText: string;
  pctText: string | null;
  ratio: number;
  available: boolean;
  kind: GoalKind;
  /** Only the two tank metals differ; carried so the instrument can tint itself. */
  metal?: 'gold' | 'silver';
}

export interface MonthlyBar {
  label: string;
  ratio: number;
  available: boolean;
}

export interface TreasureBoard {
  metrics: GoalMetric[];
  monthlyBars: MonthlyBar[];
  overall: number;
  overallAvailable: boolean;
  isFirstLoad: boolean;
  isFetching: boolean;
}

interface Axis {
  ratio: number;
  available: boolean;
}

function metric(
  id: string,
  title: string,
  kind: GoalKind,
  zielText: string,
  valueText: string,
  axis: Axis,
  metal?: 'gold' | 'silver',
): GoalMetric {
  const ratio = axis.available ? clamp01(axis.ratio) : 0;
  return {
    id,
    title,
    kind,
    zielText,
    valueText: axis.available ? valueText : '-',
    pctText: axis.available ? formatPct(ratio) : null,
    ratio,
    available: axis.available,
    ...(metal ? { metal } : {}),
  };
}

function monthStartDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Total active monthly Fixkosten in CENTS for `monthStart` (mirror mobile). */
function monthlyFixedCostCents(rows: FixedCostRow[], monthStart: string): number {
  return rows
    .filter((r) => r.activeFrom <= monthStart && (r.activeTo === null || r.activeTo >= monthStart))
    .reduce((sum, r) => sum + r.monthlyAmountCents, 0);
}

/**
 * The live treasure board. Reuses the dashboard's exact sources + denominators.
 * Polls every 30 s so the instruments feel live.
 */
export function useZielkarteBoard(): TreasureBoard {
  const client = useApiClient();

  const common = { staleTime: 20_000, refetchInterval: POLL_MS } as const;
  const bridgeQ = useQuery({
    queryKey: ['ziel', 'bridge'],
    queryFn: () => bridgeApi.summary(client),
    ...common,
  });
  const dashQ = useQuery({
    queryKey: ['ziel', 'dash'],
    queryFn: () => dashboardApi.summary(client),
    ...common,
  });
  const profitDayQ = useQuery({
    queryKey: ['ziel', 'profit-day'],
    queryFn: () => financeApi.profit(client, { period: 'day' }),
    ...common,
  });
  const monthRevQ = useQuery({
    queryKey: ['ziel', 'month-rev'],
    queryFn: () => financeApi.monthRevenue(client),
    ...common,
  });
  const invValueQ = useQuery({
    queryKey: ['ziel', 'inv-value'],
    queryFn: () => financeApi.inventoryValue(client),
    ...common,
  });
  const metalsQ = useQuery({
    queryKey: ['ziel', 'metals'],
    queryFn: () => financeApi.metalWeights(client),
    ...common,
  });
  const fixedQ = useQuery({
    queryKey: ['ziel', 'fixed'],
    /*
     * ── WARUM 200 UND NICHT 50 (13.08.2026) ──────────────────────────────
     *
     * Hier stand `limit: 50`. Diese Zeilen werden nicht bloss angezeigt, sie
     * werden SUMMIERT (`monthlyFixedCostCents`) und tragen eine Achse der
     * Zielkarte. Ein Laden mit mehr als fuenfzig laufenden Fixkosten bekam
     * damit eine zu KLEINE Summe — und eine Gewinnschwelle, die zu leicht
     * aussieht. Das ist kein zu kurzer Ausschnitt, das ist eine falsche Zahl.
     *
     * 200 ist die Obergrenze, die der Server ueberhaupt hergibt
     * (`schemas/finance.ts`, `maximum: 200`). Mehr anzufordern beantwortet
     * Fastify mit einem Schemafehler statt mit Zeilen.
     *
     * Die Obergrenze allein genuegt nicht: `hasMore` sagt, ob sie zugebissen
     * hat. Faellt sie, gilt die Achse als NICHT verfuegbar, statt eine zu
     * niedrige Zahl zu zeigen. Bekannte Hausklasse: eine Liste mit fester
     * Obergrenze ohne Gesamtzahl kann „steht nicht auf dieser Seite" nicht
     * von „gibt es nicht" unterscheiden.
     */
    queryFn: () => fixedCostsApi.list(client, { activeOnly: true, limit: FIXKOSTEN_SEITE }),
    ...common,
  });

  const bridge = bridgeQ.data ?? null;
  const dash = dashQ.data ?? null;
  const profitDay = profitDayQ.data ?? null;
  const monthRev = monthRevQ.data ?? null;
  const invValue = invValueQ.data ?? null;
  const metals = metalsQ.data ?? null;
  const fixedCostsRows = fixedQ.data?.items ?? null;
  /**
   * Hat die Obergrenze zugebissen? Dann ist die Summe unvollstaendig, und
   * eine unvollstaendige Summe ist auf einer Zielkarte schlimmer als gar
   * keine: sie sieht aus wie eine Messung.
   */
  const fixkostenUnvollstaendig = fixedQ.data?.hasMore === true;

  const isFetching =
    bridgeQ.isFetching ||
    dashQ.isFetching ||
    profitDayQ.isFetching ||
    monthRevQ.isFetching ||
    invValueQ.isFetching ||
    metalsQ.isFetching ||
    fixedQ.isFetching;

  return useMemo<TreasureBoard>(() => {
    const monthStart = monthStartDay(new Date());
    const fixedCostCents = fixedCostsRows ? monthlyFixedCostCents(fixedCostsRows, monthStart) : 0;

    const dayRevEur = bridge ? bridge.todayRevenueCents / 100 : 0;
    const aTagesumsatz: Axis = { available: !!bridge, ratio: dayRevEur / GAUGE_TARGETS.revenueEur };

    const monthRevEur = monthRev ? monthRev.monthToDateRevenueCents / 100 : 0;
    const aMonatsumsatz: Axis = {
      available: !!monthRev,
      ratio: monthRevEur / GAUGE_TARGETS.monthRevenueEur,
    };

    const hasFixed =
      fixedCostsRows !== null && fixedCostCents > 0 && !fixkostenUnvollstaendig;
    const aFixkosten: Axis = {
      available: hasFixed,
      ratio: fixedCostCents / 100 / FIXKOSTEN_BUDGET_EUR,
    };

    const aSilber: Axis = {
      available: !!metals,
      ratio: metals ? metals.silverGrams / GAUGE_TARGETS.silverGrams : 0,
    };
    const aGold: Axis = {
      available: !!metals,
      ratio: metals ? metals.goldGrams / GAUGE_TARGETS.goldGrams : 0,
    };

    const dayProfitEur = profitDay ? profitDay.netProfitCents / 100 : 0;
    const aGewinn: Axis = {
      available: !!profitDay,
      ratio: dayProfitEur / GAUGE_TARGETS.netProfitDayEur,
    };

    const aAnkauf: Axis = {
      available: !!bridge,
      ratio: bridge ? bridge.todayAnkaufCount / GAUGE_TARGETS.ankaufCount : 0,
    };
    const aVerkauf: Axis = {
      available: !!bridge,
      ratio: bridge ? bridge.todaySalesCount / GAUGE_TARGETS.soldCount : 0,
    };

    const invEur = invValue ? invValue.listValueCents / 100 : 0;
    const aLager: Axis = {
      available: !!invValue,
      ratio: invEur / GAUGE_TARGETS.inventoryValueEur,
    };

    const aExpertisen: Axis = {
      available: !!dash,
      ratio: dash ? dash.pendingAppraisals / GAUGE_TARGETS.appraisals : 0,
    };

    const metrics: GoalMetric[] = [
      metric(
        'tagesumsatz',
        'TAGESUMSATZ',
        'arc',
        `Richtwert: ${formatEurAmount(GAUGE_TARGETS.revenueEur)}`,
        formatEurCents(bridge?.todayRevenueCents ?? 0),
        aTagesumsatz,
      ),
      metric(
        'monatsumsatz',
        'MONATSUMSATZ',
        'ring',
        `Richtwert: ${formatEurAmount(GAUGE_TARGETS.monthRevenueEur)}`,
        formatEurCents(monthRev?.monthToDateRevenueCents ?? 0),
        aMonatsumsatz,
      ),
      metric(
        'gewinn',
        'GEWINN HEUTE',
        'arc',
        `Richtwert: ${formatEurAmount(GAUGE_TARGETS.netProfitDayEur)}`,
        `${dayProfitEur >= 0 ? '+' : ''}${formatEurCents(profitDay?.netProfitCents ?? 0)}`,
        aGewinn,
      ),
      metric(
        'fixkosten',
        'FIXKOSTEN',
        'thermo',
        `Richtwert: ${formatEurAmount(FIXKOSTEN_BUDGET_EUR)}`,
        formatEurCents(fixedCostCents),
        aFixkosten,
      ),
      metric(
        'gold',
        'GOLDBESTAND',
        'tank',
        `Referenz: ${formatWeight(GAUGE_TARGETS.goldGrams)}`,
        formatWeight(metals?.goldGrams ?? 0),
        aGold,
        'gold',
      ),
      metric(
        'silber',
        'SILBERBESTAND',
        'tank',
        `Referenz: ${formatWeight(GAUGE_TARGETS.silverGrams)}`,
        formatWeight(metals?.silverGrams ?? 0),
        aSilber,
        'silver',
      ),
      metric(
        'ankauf',
        'ANKÄUFE HEUTE',
        'chest',
        `Richtwert: ${GAUGE_TARGETS.ankaufCount} Kunden`,
        `${bridge?.todayAnkaufCount ?? 0} / ${GAUGE_TARGETS.ankaufCount}`,
        aAnkauf,
        'gold',
      ),
      metric(
        'verkauf',
        'VERKAUFTE ARTIKEL',
        'chest',
        `Richtwert: ${GAUGE_TARGETS.soldCount} Stück`,
        `${bridge?.todaySalesCount ?? 0} / ${GAUGE_TARGETS.soldCount}`,
        aVerkauf,
        'silver',
      ),
      metric(
        'lager',
        'LAGERWERT',
        'scale',
        `Referenz: ${formatEurAmount(GAUGE_TARGETS.inventoryValueEur)}`,
        formatEurCents(invValue?.listValueCents ?? 0),
        aLager,
      ),
      metric(
        'expertisen',
        'EXPERTISEN',
        'lens',
        `Richtwert: ${GAUGE_TARGETS.appraisals}`,
        `${dash?.pendingAppraisals ?? 0} / ${GAUGE_TARGETS.appraisals}`,
        aExpertisen,
      ),
    ];

    const monthlyBars: MonthlyBar[] = [
      { label: 'Umsatz', ratio: clamp01(aMonatsumsatz.ratio), available: aMonatsumsatz.available },
      { label: 'Silber', ratio: clamp01(aSilber.ratio), available: aSilber.available },
      { label: 'Gold', ratio: clamp01(aGold.ratio), available: aGold.available },
      { label: 'Ankäufe', ratio: clamp01(aAnkauf.ratio), available: aAnkauf.available },
      { label: 'Expertisen', ratio: clamp01(aExpertisen.ratio), available: aExpertisen.available },
    ];

    const readable = monthlyBars.filter((b) => b.available);
    const overallAvailable = readable.length > 0;
    const overall = overallAvailable
      ? readable.reduce((s, b) => s + b.ratio, 0) / readable.length
      : 0;

    return {
      metrics,
      monthlyBars,
      overall,
      overallAvailable,
      isFirstLoad: bridgeQ.isLoading && bridge === null,
      isFetching,
    };
  }, [
    bridge,
    dash,
    profitDay,
    monthRev,
    invValue,
    metals,
    fixedCostsRows,
    fixkostenUnvollstaendig,
    bridgeQ.isLoading,
    isFetching,
  ]);
}

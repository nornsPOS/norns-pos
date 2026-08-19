/**
 * TradingTerminal — a professional, trading-desk style price terminal for one
 * precious metal, built on real Warehouse 14 price history (no chart library).
 *
 * Features
 *   • Two render modes: Fläche (area) + Kerzen (candlestick / OHLC).
 *   • Time-range selector: 1T · 1W · 1M · 6M · 1J (true-scale x-axis).
 *   • Live: the latest spot is appended at "now" and a pulse marks it; the
 *     viewport auto-follows the right edge until the user pans/zooms.
 *   • Crosshair + rich tooltip: Datum/Uhrzeit, Spot, Verkauf, Ankauf, Marge
 *     (and O/H/L/C in candle mode).
 *   • Green / red trend coloring (verdigris ↑ / wax-red ↓).
 *   • Zoom (wheel / pinch) + Pan (drag) — mouse and touch via Pointer Events.
 *
 * The buy/sell model mirrors the rest of the app:
 *   Spot  = melt price per gram (the market value we read from the feed).
 *   Verkauf = Spot (the melt sell baseline).
 *   Ankauf  = Spot × (1 − Sicherheitsmarge).
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';

import type { MetalPriceHistoryRow } from '@norns/api-client';

// ── Geometry ────────────────────────────────────────────────────────────────
const W = 1000;
const H = 420;
const PAD_L = 10;
const PAD_R = 66; // room for the right-hand price axis + last-price pill
const PAD_T = 16;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const DAY = 86_400_000;
const UP = 'var(--w14-verdigris)';
const DOWN = 'var(--w14-wax-red)';

export type ChartMode = 'area' | 'candle';

interface RangeDef {
  key: string;
  label: string;
  spanMs: number;
  bucketMs: number;
}

const RANGES: readonly RangeDef[] = [
  { key: '1T', label: '1T', spanMs: DAY, bucketMs: 15 * 60_000 }, // 15-minute candles
  { key: '1W', label: '1W', spanMs: 7 * DAY, bucketMs: 60 * 60_000 }, // hourly
  { key: '1M', label: '1M', spanMs: 30 * DAY, bucketMs: DAY }, // daily
  { key: '6M', label: '6M', spanMs: 182 * DAY, bucketMs: DAY }, // daily
  { key: '1J', label: '1J', spanMs: 365 * DAY, bucketMs: 7 * DAY }, // weekly
];
const DEFAULT_RANGE: RangeDef = RANGES[0] as RangeDef;

interface Tick {
  t: number; // epoch ms
  spot: number; // €/g
}
interface Candle {
  t: number; // bucket start epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
}

interface Props {
  metalLabel: string;
  accent: string;
  /** History rows for this metal, DESC (newest first). */
  history: readonly MetalPriceHistoryRow[];
  /** Current spot per gram as a decimal string, or null. */
  currentPrice: string | null;
  /**
   * Ankauf safety margin fraction (0.18 = 18 %). `null` heisst NICHT BEKANNT
   * — dann wird keine Ankauflinie gezeichnet und keine Marge behauptet.
   */
  safetyMarginPct: number | null;
  fetching?: boolean;
}

function fmtEur(n: number, frac = 2): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: frac, maximumFractionDigits: 4 });
}
function fmtDateTime(t: number, withTime: boolean): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function TradingTerminal({
  metalLabel,
  accent,
  history,
  currentPrice,
  safetyMarginPct,
  fetching = false,
}: Props): JSX.Element {
  const gradId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [rangeKey, setRangeKey] = useState<string>('1T');
  const [mode, setMode] = useState<ChartMode>('area');
  // Absolute viewport [min,max] in epoch ms. null = auto (follow right edge).
  const [view, setView] = useState<{ min: number; max: number } | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // Pointer bookkeeping for pan + pinch (mouse + touch unified).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panRef = useRef<{ startX: number; min: number; max: number } | null>(null);
  const pinchRef = useRef<{ dist: number; min: number; max: number } | null>(null);

  const range = RANGES.find((r) => r.key === rangeKey) ?? DEFAULT_RANGE;
  /*
   * ── ⛔ HIER STAND `?? 0.1` — EINE ERFUNDENE ANKAUFMARGE ─────────────────
   *
   * DER BEFUND (Tiefenjagd 11.08.2026, drei von drei Stimmen): fiel die
   * Abfrage `/api/metal-prices/rates` aus, war `safetyMarginPct` null, und
   * dieser Rückfall machte daraus zehn Prozent. Das Diagramm zeichnete dann
   * eine gestrichelte Ankauflinie, das Fadenkreuz zeigte „Ankauf 56,21 EUR"
   * und die Legende „Ankauf (−10,0 %)" — drei Zahlen, die aus dem Quelltext
   * stammten und nicht aus den Einstellungen des Hauses.
   *
   * Gemessen mit hinterlegten 18 Prozent: auf 100 g Feingold zeigte das
   * Diagramm 5620,50 EUR statt 5120,90 EUR, also 499,60 EUR zu viel.
   *
   * Besonders heimtückisch, weil `/current` und `/rates` ZWEI Abfragen sind:
   * fällt nur die zweite aus, bleibt der Spotkurs richtig stehen und nur die
   * Ankauflinie lügt. Der Bildschirm sieht vollständig aus.
   *
   * Der Kursbildschirm ist die Fläche, auf die der Händler schaut, BEVOR er
   * einen Preis nennt. Hausklasse „fabricate-when-unconfigured": ist die
   * Marge nicht bekannt, wird nichts erfunden — die Ankauflinie bleibt weg
   * und die Legende sagt, warum.
   */
  const margin = safetyMarginPct;
  const margeBekannt = margin != null;

  // ── Build the tick series (ASC) from history + the live current spot ──────
  const ticks = useMemo<Tick[]>(() => {
    const rows = history
      .map((r) => ({
        t: new Date(r.validFrom).getTime(),
        spot: Number.parseFloat(r.pricePerGramEur),
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.spot))
      .sort((a, b) => a.t - b.t);
    const cur = currentPrice != null ? Number.parseFloat(currentPrice) : Number.NaN;
    const now = Date.now();
    if (Number.isFinite(cur)) {
      const last = rows[rows.length - 1];
      // Append a live point at "now" so the line reaches the right edge.
      if (!last || now - last.t > 30_000 || last.spot !== cur) {
        rows.push({ t: now, spot: cur });
      }
    }
    return rows;
  }, [history, currentPrice]);

  const now = Date.now();
  const firstTick = ticks[0];
  const lastTickRow = ticks[ticks.length - 1];
  const dataMin = firstTick ? firstTick.t : now - range.spanMs;
  const dataMax = lastTickRow ? Math.max(lastTickRow.t, now) : now;

  // Full window for the chosen range, clamped to data on the left so a short
  // history fills the width instead of hugging the right edge.
  const fullMin = Math.max(now - range.spanMs, Math.min(dataMin, now - range.bucketMs * 2));
  const fullMax = dataMax;
  const vMin = view ? view.min : fullMin;
  const vMaxRaw = view ? view.max : fullMax;
  const vMax = vMaxRaw <= vMin ? vMin + range.bucketMs : vMaxRaw;

  // Visible ticks for the area mode + y-domain.
  const visTicks = useMemo(
    () => ticks.filter((p) => p.t >= vMin - range.bucketMs && p.t <= vMax + range.bucketMs),
    [ticks, vMin, vMax, range.bucketMs],
  );

  // Candles (bucketed OHLC) for the whole tick series, then filtered to view.
  const candles = useMemo<Candle[]>(() => {
    if (mode !== 'candle' || ticks.length === 0) return [];
    const byBucket = new Map<number, Candle>();
    for (const p of ticks) {
      const b = Math.floor(p.t / range.bucketMs) * range.bucketMs;
      const c = byBucket.get(b);
      if (!c) byBucket.set(b, { t: b, o: p.spot, h: p.spot, l: p.spot, c: p.spot });
      else {
        c.h = Math.max(c.h, p.spot);
        c.l = Math.min(c.l, p.spot);
        c.c = p.spot;
      }
    }
    return [...byBucket.values()].sort((a, b) => a.t - b.t);
  }, [ticks, mode, range.bucketMs]);

  const visCandles = useMemo(
    () => candles.filter((c) => c.t >= vMin - range.bucketMs && c.t <= vMax + range.bucketMs),
    [candles, vMin, vMax, range.bucketMs],
  );

  // y-domain from whatever is visible (include the Ankauf line).
  const yDomain = useMemo(() => {
    const vals: number[] = [];
    if (mode === 'candle') {
      for (const c of visCandles) {
        vals.push(c.h, c.l);
      }
    } else {
      for (const p of visTicks) {
        vals.push(p.spot);
        if (margin != null) vals.push(p.spot * (1 - margin));
      }
    }
    if (vals.length === 0) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || hi * 0.01 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [mode, visCandles, visTicks, margin]);

  const enoughData = mode === 'candle' ? visCandles.length >= 1 : visTicks.length >= 2;

  // ── Scales ────────────────────────────────────────────────────────────────
  const xOf = useCallback(
    (t: number): number => PAD_L + ((t - vMin) / (vMax - vMin)) * PLOT_W,
    [vMin, vMax],
  );
  const yOf = useCallback(
    (p: number): number => {
      if (!yDomain) return PAD_T + PLOT_H / 2;
      return PAD_T + (1 - (p - yDomain.min) / (yDomain.max - yDomain.min)) * PLOT_H;
    },
    [yDomain],
  );

  // Trend (first vs last visible close) → green / red.
  const trend = useMemo(() => {
    const seq = mode === 'candle' ? visCandles.map((c) => c.c) : visTicks.map((p) => p.spot);
    const f = seq[0];
    const l = seq[seq.length - 1];
    if (seq.length < 2 || f === undefined || l === undefined) return { up: true, color: accent };
    const up = l >= f;
    return { up, color: up ? UP : DOWN };
  }, [mode, visCandles, visTicks, accent]);

  // ── Interaction (pointer events: pan + pinch + crosshair) ─────────────────
  const clientToTime = useCallback(
    (clientX: number): number => {
      const el = wrapRef.current;
      if (!el) return vMin;
      const rect = el.getBoundingClientRect();
      const vbX = ((clientX - rect.left) / rect.width) * W;
      const frac = (vbX - PAD_L) / PLOT_W;
      return vMin + Math.max(0, Math.min(1, frac)) * (vMax - vMin);
    },
    [vMin, vMax],
  );

  const applyZoom = useCallback(
    (factor: number, anchorT: number) => {
      const span = vMax - vMin;
      const minSpan = range.bucketMs * 3;
      const maxSpan = range.spanMs;
      const newSpan = Math.max(minSpan, Math.min(maxSpan, span * factor));
      const ratio = (anchorT - vMin) / span;
      let newMin = anchorT - ratio * newSpan;
      let newMax = newMin + newSpan;
      const lo = now - range.spanMs;
      if (newMin < lo) {
        newMin = lo;
        newMax = lo + newSpan;
      }
      if (newMax > now) {
        newMax = now;
        newMin = now - newSpan;
      }
      setView({ min: newMin, max: newMax });
    },
    [vMin, vMax, range.bucketMs, range.spanMs, now],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY > 0 ? 1.18 : 0.84, clientToTime(e.clientX));
    },
    [applyZoom, clientToTime],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        panRef.current = { startX: e.clientX, min: vMin, max: vMax };
      } else if (pointers.current.size === 2) {
        const pts = [...pointers.current.values()];
        const a = pts[0];
        const b = pts[1];
        if (a && b) {
          pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, min: vMin, max: vMax };
          panRef.current = null;
        }
      }
    },
    [vMin, vMax],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Hover crosshair when no button is pressed.
      if (pointers.current.size === 0) {
        setHoverT(clientToTime(e.clientX));
        return;
      }
      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      if (pointers.current.size === 2 && pinchRef.current) {
        const pts = [...pointers.current.values()];
        const a = pts[0];
        const b = pts[1];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const factor = pinchRef.current.dist / dist; // fingers apart → zoom in
        const span0 = pinchRef.current.max - pinchRef.current.min;
        const minSpan = range.bucketMs * 3;
        const maxSpan = range.spanMs;
        const newSpan = Math.max(minSpan, Math.min(maxSpan, span0 * factor));
        const midX = (a.x + b.x) / 2;
        const frac = ((midX - rect.left) / rect.width - PAD_L / W) / (PLOT_W / W);
        let newMin = pinchRef.current.min + Math.max(0, Math.min(1, frac)) * span0 - frac * newSpan;
        let newMax = newMin + newSpan;
        const lo = now - range.spanMs;
        if (newMin < lo) {
          newMin = lo;
          newMax = lo + newSpan;
        }
        if (newMax > now) {
          newMax = now;
          newMin = now - newSpan;
        }
        setView({ min: newMin, max: newMax });
        setHoverT(null);
        return;
      }

      if (pointers.current.size === 1 && panRef.current) {
        const dx = e.clientX - panRef.current.startX;
        const span = panRef.current.max - panRef.current.min;
        const dt = -(dx / rect.width) * (W / PLOT_W) * span;
        let newMin = panRef.current.min + dt;
        let newMax = panRef.current.max + dt;
        const lo = now - range.spanMs;
        if (newMin < lo) {
          newMin = lo;
          newMax = lo + span;
        }
        if (newMax > now) {
          newMax = now;
          newMin = now - span;
        }
        setView({ min: newMin, max: newMax });
        setHoverT(null);
      }
    },
    [clientToTime, range.bucketMs, range.spanMs, now],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      panRef.current = null;
      setHoverT(null);
    }
  }, []);

  const resetRange = (key: string): void => {
    setRangeKey(key);
    setView(null);
    setHoverT(null);
  };

  // ── Hover read-out ────────────────────────────────────────────────────────
  const hover = useMemo(() => {
    if (hoverT == null || !enoughData) return null;
    if (mode === 'candle') {
      let best: Candle | null = null;
      let bd = Number.POSITIVE_INFINITY;
      for (const c of visCandles) {
        const d = Math.abs(c.t + range.bucketMs / 2 - hoverT);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best) return null;
      const spot = best.c;
      return {
        t: best.t,
        x: xOf(best.t + range.bucketMs / 2),
        spot,
        ySpot: yOf(spot),
        candle: best,
      };
    }
    let best: Tick | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const p of visTicks) {
      const d = Math.abs(p.t - hoverT);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    return { t: best.t, x: xOf(best.t), spot: best.spot, ySpot: yOf(best.spot), candle: null };
  }, [hoverT, enoughData, mode, visCandles, visTicks, range.bucketMs, xOf, yOf]);

  // ── Render paths ──────────────────────────────────────────────────────────
  const sellLine = visTicks.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.spot).toFixed(1)}`);
  // Ohne bekannte Marge gibt es keine Ankauflinie — eine gezeichnete Linie
  // waere eine Behauptung ueber einen Preis, den niemand hinterlegt hat.
  const buyLine =
    margin == null
      ? []
      : visTicks.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.spot * (1 - margin)).toFixed(1)}`);
  const firstVis = visTicks[0];
  const lastVis = visTicks[visTicks.length - 1];
  const baseY = (PAD_T + PLOT_H).toFixed(1);
  const areaFill =
    firstVis && lastVis && visTicks.length >= 2
      ? `M${sellLine.join(' L')} L${xOf(lastVis.t).toFixed(1)},${baseY} L${xOf(firstVis.t).toFixed(1)},${baseY} Z`
      : '';
  // Das Band spannt zwischen Verkaufs- und Ankauflinie. Ohne bekannte Marge
  // gibt es keine Ankauflinie, also auch kein Band.
  const spreadBand =
    visTicks.length >= 2 && buyLine.length > 0
      ? `M${sellLine.join(' L')} L${[...buyLine].reverse().join(' L')} Z`
      : '';

  // y-axis ticks
  const yTicks = yDomain
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => yDomain.min + f * (yDomain.max - yDomain.min))
    : [];
  // x-axis ticks
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => vMin + f * (vMax - vMin));

  const lastTick = visTicks[visTicks.length - 1];
  const lastClose = mode === 'candle' ? visCandles[visCandles.length - 1]?.c : lastTick?.spot;

  const candleW = Math.max(2, (range.bucketMs / (vMax - vMin)) * PLOT_W * 0.66);
  const hoverRightSide = hover ? hover.x > PAD_L + PLOT_W * 0.6 : false;

  return (
    <div style={{ width: '100%' }}>
      {/* ── Toolbar: mode + range ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--w14-abstand-10)',
          marginBottom: 10,
        }}
      >
        <SegToggle
          options={[
            { key: 'area', label: 'Fläche' },
            { key: 'candle', label: 'Kerzen' },
          ]}
          value={mode}
          onChange={(k) => setMode(k as ChartMode)}
        />
        <SegToggle
          options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
          value={rangeKey}
          onChange={resetRange}
        />
      </div>

      <div
        ref={wrapRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        style={{
          position: 'relative',
          width: '100%',
          touchAction: 'none',
          cursor: pointers.current.size ? 'grabbing' : 'crosshair',
          userSelect: 'none',
        }}
      >
        <style>{`@keyframes w14-tt-pulse{0%{r:4;opacity:.5}70%{r:13;opacity:0}100%{r:13;opacity:0}}
          @keyframes w14-tt-fade{from{opacity:0}to{opacity:1}}`}</style>

        {!enoughData ? (
          <div
            style={{
              height: 260,
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-card)',
              background: 'var(--w14-parchment-2)',
              padding: 'var(--w14-abstand-24)',
            }}
          >
            Für {metalLabel} im Zeitraum {range.label} wird der Verlauf noch aufgebaut.
            <br />
            Die Kurse werden alle 15&nbsp;Minuten live erfasst.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Kursverlauf ${metalLabel}, Zeitraum ${range.label}`}
            style={{ display: 'block', animation: 'w14-tt-fade var(--w14-dur-medium) var(--w14-ease-hover)' }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: trend.color, stopOpacity: 0.2 }} />
                <stop offset="100%" style={{ stopColor: trend.color, stopOpacity: 0.015 }} />
              </linearGradient>
            </defs>

            {/* horizontal gridlines + right-axis price labels */}
            {yTicks.map((tv) => {
              const y = yOf(tv);
              return (
                <g key={`y-${tv}`}>
                  <line
                    x1={PAD_L}
                    x2={PAD_L + PLOT_W}
                    y1={y.toFixed(1)}
                    y2={y.toFixed(1)}
                    stroke="var(--w14-rule)"
                    strokeWidth={0.5}
                    opacity={0.55}
                  />
                  <text
                    x={PAD_L + PLOT_W + 6}
                    y={(y + 3).toFixed(1)}
                    fontSize={11}
                    fontFamily="var(--w14-font-mono)"
                    fill="var(--w14-ink-faded)"
                  >
                    {fmtEur(tv)}
                  </text>
                </g>
              );
            })}

            {/* vertical time gridlines + x labels */}
            {xTicks.map((tt, i) => {
              const x = xOf(tt);
              return (
                <g key={`x-${tt}`}>
                  <line
                    x1={x.toFixed(1)}
                    x2={x.toFixed(1)}
                    y1={PAD_T}
                    y2={PAD_T + PLOT_H}
                    stroke="var(--w14-rule)"
                    strokeWidth={0.4}
                    opacity={0.35}
                  />
                  <text
                    x={Math.max(PAD_L, Math.min(PAD_L + PLOT_W, x)).toFixed(1)}
                    y={H - 9}
                    fontSize={11}
                    fontFamily="var(--w14-font-mono)"
                    fill="var(--w14-ink-faded)"
                    textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                  >
                    {fmtDateTime(tt, range.spanMs <= 7 * DAY)}
                  </text>
                </g>
              );
            })}

            {mode === 'area' ? (
              <>
                {spreadBand && <path d={spreadBand} fill={`url(#${gradId})`} opacity={0.85} />}
                {areaFill && <path d={areaFill} fill={`url(#${gradId})`} opacity={0.5} />}
                {/* Ankauf (buy) — muted dashed. Nur bei bekannter Marge. */}
                {buyLine.length > 0 && (
                <polyline
                  points={buyLine.join(' ')}
                  fill="none"
                  stroke="var(--w14-ink-faded)"
                  strokeWidth={1.1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.75}
                />
                )}
                {/* Verkauf (spot) — trend colored */}
                <polyline
                  points={sellLine.join(' ')}
                  fill="none"
                  stroke={trend.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : (
              <>
                {visCandles.map((c) => {
                  const up = c.c >= c.o;
                  const col = up ? UP : DOWN;
                  const cx = xOf(c.t + range.bucketMs / 2);
                  const yO = yOf(c.o);
                  const yC = yOf(c.c);
                  const top = Math.min(yO, yC);
                  const bodyH = Math.max(1.2, Math.abs(yC - yO));
                  return (
                    <g key={c.t}>
                      <line
                        x1={cx.toFixed(1)}
                        x2={cx.toFixed(1)}
                        y1={yOf(c.h).toFixed(1)}
                        y2={yOf(c.l).toFixed(1)}
                        stroke={col}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      <rect
                        x={(cx - candleW / 2).toFixed(1)}
                        y={top.toFixed(1)}
                        width={candleW.toFixed(1)}
                        height={bodyH.toFixed(1)}
                        fill={col}
                        opacity={up ? 0.92 : 1}
                      />
                    </g>
                  );
                })}
              </>
            )}

            {/* live pulse on the latest point */}
            {lastTick && lastClose != null && (
              <>
                <circle
                  cx={xOf(lastTick.t).toFixed(1)}
                  cy={yOf(lastClose).toFixed(1)}
                  fill={trend.color}
                >
                  <animate attributeName="r" values="4;13;13" dur="1.8s" repeatCount="indefinite" />
                  <animate
                    attributeName="opacity"
                    values="0.5;0;0"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle
                  cx={xOf(lastTick.t).toFixed(1)}
                  cy={yOf(lastClose).toFixed(1)}
                  r={3.6}
                  fill={trend.color}
                >
                  {fetching && (
                    <animate
                      attributeName="opacity"
                      values="1;0.35;1"
                      dur="1.1s"
                      repeatCount="indefinite"
                    />
                  )}
                </circle>
                {/* last-price pill on the right axis */}
                <g>
                  <rect
                    x={PAD_L + PLOT_W + 2}
                    y={(yOf(lastClose) - 9).toFixed(1)}
                    width={PAD_R - 4}
                    height={18}
                    rx={3}
                    fill={trend.color}
                  />
                  <text
                    x={PAD_L + PLOT_W + 5}
                    y={(yOf(lastClose) + 4).toFixed(1)}
                    fontSize={10.5}
                    fontFamily="var(--w14-font-mono)"
                    fontWeight={700}
                    fill="var(--w14-parchment)"
                  >
                    {fmtEur(lastClose)}
                  </text>
                </g>
              </>
            )}

            {/* crosshair */}
            {hover && (
              <g pointerEvents="none">
                <line
                  x1={hover.x.toFixed(1)}
                  x2={hover.x.toFixed(1)}
                  y1={PAD_T}
                  y2={PAD_T + PLOT_H}
                  stroke="var(--w14-ink)"
                  strokeWidth={0.7}
                  strokeDasharray="3 3"
                  opacity={0.5}
                />
                <line
                  x1={PAD_L}
                  x2={PAD_L + PLOT_W}
                  y1={hover.ySpot.toFixed(1)}
                  y2={hover.ySpot.toFixed(1)}
                  stroke="var(--w14-ink)"
                  strokeWidth={0.7}
                  strokeDasharray="3 3"
                  opacity={0.4}
                />
                <circle
                  cx={hover.x.toFixed(1)}
                  cy={hover.ySpot.toFixed(1)}
                  r={4}
                  fill={trend.color}
                  stroke="var(--w14-parchment-2)"
                  strokeWidth={1.5}
                />
              </g>
            )}
          </svg>
        )}

        {/* ── Tooltip (HTML overlay) ──────────────────────────────────────── */}
        {hover && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: `${(hover.x / W) * 100}%`,
              transform: `translateX(${hoverRightSide ? 'calc(-100% - 14px)' : '14px'})`,
              pointerEvents: 'none',
              background: 'var(--w14-parchment-1, var(--w14-parchment-2))',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-button)',
              boxShadow: 'var(--w14-shadow-modal)',
              padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
              fontSize: 'var(--w14-schrift-zeile)',
              minWidth: 168,
              zIndex: 6,
            }}
          >
            <div
              className="w14-smallcaps"
              style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.05em', marginBottom: 5 }}
            >
              {fmtDateTime(hover.t, range.spanMs <= 7 * DAY)}
            </div>
            {hover.candle && (
              <TipRow
                label="O / S"
                value={`${fmtEur(hover.candle.o)} / ${fmtEur(hover.candle.c)} €`}
                color="var(--w14-ink)"
              />
            )}
            {hover.candle && (
              <TipRow
                label="H / T"
                value={`${fmtEur(hover.candle.h)} / ${fmtEur(hover.candle.l)} €`}
                color="var(--w14-ink-faded)"
              />
            )}
            <TipRow label="Spot" value={`${fmtEur(hover.spot)} €`} color="var(--w14-ink)" strong />
            <TipRow label="Verkauf" value={`${fmtEur(hover.spot)} €`} color={accent} />
            <TipRow
              label="Ankauf"
              value={margin == null ? 'nicht geladen' : `${fmtEur(hover.spot * (1 - margin))} €`}
              color="var(--w14-wax-red)"
            />
            <TipRow
              label="Marge"
              value={
                margin == null
                  ? 'nicht geladen'
                  : `${(margin * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %  ·  ${fmtEur(
                      hover.spot * margin,
                    )} €`
              }
              color="var(--w14-ink-faded)"
            />
          </div>
        )}
      </div>

      <p
        style={{
          margin: '8px 2px 0',
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-ink-faded)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--w14-abstand-8)',
        }}
      >
        <span>
          <span style={{ color: trend.color }}>{trend.up ? '▲ steigend' : '▼ fallend'}</span>
          {'  ·  '}
          <span style={{ color: accent }}>● Verkauf (Spot)</span>
          {'   '}
          <span>
            {margeBekannt ? (
              <>┄ Ankauf (−{(margin * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %)</>
            ) : (
              'Ankauflinie: Marge nicht geladen'
            )}
          </span>
        </span>
        <span style={{ fontStyle: 'italic' }}>Scrollen = Zoom · Ziehen = Verschieben</span>
      </p>
    </div>
  );
}

function TipRow({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--w14-abstand-14)', lineHeight: 1.7 }}>
      <span style={{ color: 'var(--w14-ink-faded)' }}>{label}</span>
      <span
        className="w14-tabular"
        style={{ fontFamily: 'var(--w14-font-mono)', color, fontWeight: strong ? 700 : 500 }}
      >
        {value}
      </span>
    </div>
  );
}

function SegToggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        overflow: 'hidden',
      }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className="w14-smallcaps"
            style={{
              padding: 'var(--w14-abstand-4) var(--w14-abstand-12)',
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.05em',
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--w14-ink)' : 'transparent',
              color: active ? 'var(--w14-parchment)' : 'var(--w14-ink-faded)',
              transition: 'background var(--w14-dur-press) var(--w14-ease-hover)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

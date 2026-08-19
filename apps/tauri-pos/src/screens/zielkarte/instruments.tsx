/**
 * Zielkarte instruments — pure DOM-SVG (no baked plates).
 *
 * The mobile board lays high-fidelity pre-rendered PNG plates with live SVG
 * overlays; on the desktop we draw every instrument as resolution-independent
 * vector art so it stays crisp on any monitor and ships no assets. Each tile is
 * a self-contained SVG — a brass case with a milled bezel, a dark engine-turned
 * glass face, a blued-steel or brass live element and the red→amber→green ramp —
 * plus a uniform engraved value line below. The two feature panels are aged
 * parchment (real grain, a treasure map with a galleon along the route).
 *
 * WebKit note: Tauri on macOS renders through WKWebView, which does NOT animate
 * SVG geometry attributes (x/width/cx/r) via CSS. So every live element animates
 * only `transform`, `stroke-dashoffset` or `opacity` — all WebKit-safe — and
 * reduced-motion turns the transitions off entirely.
 */

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';

import type { GoalMetric, MonthlyBar } from './zielkarte-data.js';

/** A deliberate dark instrument-panel palette, independent of the app theme. */
export const C = {
  page: '#0c0b08',
  panel: '#15130e',
  panelTop: '#1e1a12',
  edge: '#2c271e',
  edgeTop: '#3b3120',
  edgeBottom: '#0a0806',
  ink: '#f1ead9',
  inkMuted: '#a99b81',
  inkFaint: '#6f6757',
  gilt: '#c9a55c',
  giltBright: '#e6c878',
  giltDeep: '#876a2c',
  green: '#83c46f',
  amber: '#e6ac44',
  red: '#dd5f42',
  coral: '#c96f5d',
  silver: '#c4c9d0',
  silverDeep: '#7e858f',
  gold: '#d9b154',
  goldDeep: '#9c7a2e',
  glass: '#080706',
  parchment: '#d7c59c',
  parchmentInk: '#3b3020',
} as const;

function toneFor(ratio: number): string {
  if (ratio >= 0.75) return C.green;
  if (ratio >= 0.4) return C.amber;
  return C.red;
}
function bandColor(f: number): string {
  if (f < 0.34) return C.red;
  if (f < 0.66) return C.amber;
  return C.green;
}
function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
const r2 = (n: number): number => Math.round(n * 100) / 100;
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number, sweep = 1): string {
  const p = polar(cx, cy, r, a0);
  const q = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${r2(p.x)} ${r2(p.y)} A ${r2(r)} ${r2(r)} 0 ${large} ${sweep} ${r2(q.x)} ${r2(q.y)}`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// ─────────────────────────────────────────────────────────────────────────────
// Shared defs + engraving helpers
// ─────────────────────────────────────────────────────────────────────────────

const brassDefs = (
  <defs>
    <linearGradient id="ziel_brass" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stopColor="#fbeab0" />
      <stop offset="0.32" stopColor="#e6cd82" />
      <stop offset="0.6" stopColor="#caa055" />
      <stop offset="1" stopColor="#37280f" />
    </linearGradient>
    <linearGradient id="ziel_bezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#fff0bd" />
      <stop offset="0.18" stopColor="#e7c977" />
      <stop offset="0.5" stopColor="#8a6a2c" />
      <stop offset="0.82" stopColor="#4a3714" />
      <stop offset="1" stopColor="#2a1e0b" />
    </linearGradient>
    <linearGradient id="ziel_bezel_lo" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stopColor="#fff0bd" />
      <stop offset="0.2" stopColor="#e7c977" />
      <stop offset="0.55" stopColor="#7a5d26" />
      <stop offset="1" stopColor="#2a1e0b" />
    </linearGradient>
    <radialGradient id="ziel_face" cx="0.5" cy="0.28" r="1.08">
      <stop offset="0" stopColor="#1c160d" />
      <stop offset="0.55" stopColor="#100c07" />
      <stop offset="1" stopColor="#0a0806" />
    </radialGradient>
    <radialGradient id="ziel_spec" cx="0.42" cy="0.14" r="0.75">
      <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
      <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.07" />
      <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
    </radialGradient>
    <linearGradient id="ziel_steel" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0" stopColor="#141d2e" />
      <stop offset="0.5" stopColor="#6178a0" />
      <stop offset="0.82" stopColor="#e4eefb" />
      <stop offset="1" stopColor="#ffffff" />
    </linearGradient>
    <linearGradient id="ziel_gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffe9a3" />
      <stop offset="0.32" stopColor="#f2d281" />
      <stop offset="0.7" stopColor="#d3ab4f" />
      <stop offset="1" stopColor="#8f6f28" />
    </linearGradient>
    <linearGradient id="ziel_silver" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stopColor="#f7faff" />
      <stop offset="0.26" stopColor="#d3dae4" />
      <stop offset="0.52" stopColor="#aab2be" />
      <stop offset="0.74" stopColor="#7b8290" />
      <stop offset="1" stopColor="#565d6a" />
    </linearGradient>
    <linearGradient id="ziel_merc" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stopColor="#7a1d0f" />
      <stop offset="0.5" stopColor="#df4028" />
      <stop offset="1" stopColor="#ff8f6c" />
    </linearGradient>
    <linearGradient id="ziel_glasscol" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#2a2118" />
      <stop offset="0.5" stopColor="#0d0a06" />
      <stop offset="1" stopColor="#040302" />
    </linearGradient>
    <linearGradient id="ziel_wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#7c5a31" />
      <stop offset="0.5" stopColor="#5a3f22" />
      <stop offset="1" stopColor="#3a2814" />
    </linearGradient>
    <linearGradient id="ziel_woodlid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#8a663a" />
      <stop offset="1" stopColor="#4d3619" />
    </linearGradient>
    <filter id="ziel_shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2.2" stdDeviation="2.4" floodColor="#000" floodOpacity="0.55" />
    </filter>
    <filter id="ziel_glow" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="2.6" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
);

/** Engine-turned guilloché: faint concentric rings + a radial burst, clipped. */
function Guilloche({ cx, cy, rO, rI, clip }: { cx: number; cy: number; rO: number; rI: number; clip: string }): JSX.Element {
  const rings: JSX.Element[] = [];
  for (let r = rI; r <= rO; r += 3) {
    rings.push(<circle key={`r${r}`} cx={cx} cy={cy} r={r2(r)} fill="none" stroke="#d8b878" strokeWidth={0.5} opacity={0.05} />);
  }
  const burst: JSX.Element[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 360;
    const p = polar(cx, cy, rI, a);
    const q = polar(cx, cy, rO, a);
    burst.push(<line key={`b${i}`} x1={r2(p.x)} y1={r2(p.y)} x2={r2(q.x)} y2={r2(q.y)} stroke="#c9a866" strokeWidth={0.4} opacity={0.035} />);
  }
  return (
    <g clipPath={`url(#${clip})`}>
      {burst}
      {rings}
    </g>
  );
}

/** Milled/knurled bezel edge as short radial teeth over an angle span. */
function knurl(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number, count: number): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (let i = 0; i <= count; i++) {
    const a = a0 + (i / count) * (a1 - a0);
    const p = polar(cx, cy, rI, a);
    const q = polar(cx, cy, rO, a);
    const bright = i % 2 === 0;
    out.push(
      <line
        key={i}
        x1={r2(p.x)}
        y1={r2(p.y)}
        x2={r2(q.x)}
        y2={r2(q.y)}
        stroke={bright ? '#f4dd97' : '#4b3817'}
        strokeWidth={0.7}
        opacity={bright ? 0.55 : 0.7}
      />,
    );
  }
  return out;
}

/** A small brass slotted screw. */
function Screw({ cx, cy, r, slot }: { cx: number; cy: number; r: number; slot: number }): JSX.Element {
  const a = polar(cx, cy, r * 0.72, slot);
  const b = polar(cx, cy, r * 0.72, slot + 180);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="url(#ziel_brass)" stroke="#2c2009" strokeWidth={0.6} />
      <circle cx={r2(cx - r * 0.28)} cy={r2(cy - r * 0.28)} r={r2(r * 0.3)} fill="#fff2c4" opacity={0.5} />
      <line x1={r2(a.x)} y1={r2(a.y)} x2={r2(b.x)} y2={r2(b.y)} stroke="#201706" strokeWidth={0.9} strokeLinecap="round" />
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame + shared bits
// ─────────────────────────────────────────────────────────────────────────────

/** A brass mounting screw for a panel corner. */
function TileScrew({ pos }: { pos: CSSProperties }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 34% 32%, #f6df9a, #9c7a33 55%, #4a3714)',
        boxShadow: '0 1px 1px rgba(0,0,0,0.6), inset 0 0 1px rgba(0,0,0,0.4)',
        zIndex: 3,
        ...pos,
      }}
    >
      <span style={{ position: 'absolute', left: 1, right: 1, top: '50%', height: 0.8, transform: 'translateY(-50%) rotate(38deg)', background: 'rgba(28,18,6,0.75)' }} />
    </span>
  );
}

function WidgetFrame({ title, zielText, children, footer }: { title: string; zielText: string; children: ReactNode; footer: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(180deg, #211c13, #141109)',
        borderRadius: 'var(--w14-radius-card)',
        border: `1px solid ${C.edge}`,
        borderTopColor: C.edgeTop,
        borderBottomColor: C.edgeBottom,
        padding: '14px 12px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,240,200,0.07), inset 0 0 30px rgba(0,0,0,0.3), 0 3px 9px rgba(0,0,0,0.4)',
      }}
    >
      {/* top-light sheen + four mounting screws */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--w14-radius-card)', background: 'radial-gradient(120% 80% at 50% -10%, rgba(255,240,205,0.05), transparent 55%)', pointerEvents: 'none' }} />
      <TileScrew pos={{ top: 7, left: 7 }} />
      <TileScrew pos={{ top: 7, right: 7 }} />
      <TileScrew pos={{ bottom: 7, left: 7 }} />
      <TileScrew pos={{ bottom: 7, right: 7 }} />
      <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div
          style={{
            color: C.giltBright,
            fontSize: title.length > 14 ? 11 : 12.5,
            fontWeight: 800,
            letterSpacing: title.length > 14 ? '0.055em' : '0.1em',
            textShadow: '0 1px 1px #000',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        <div style={{ color: C.inkMuted, fontSize: 10, marginTop: 1 }}>{zielText}</div>
      </div>
      {/* recessed instrument well */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          display: 'grid',
          placeItems: 'center',
          minHeight: 120,
          borderRadius: 10,
          background: 'radial-gradient(90% 70% at 50% 34%, rgba(0,0,0,0.28), transparent 72%)',
          boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.4)',
        }}
      >
        {children}
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>{footer}</div>
    </div>
  );
}

/** A uniform engraved value line for every tile. */
function ValueLine({ value, pct, tone }: { value: string; pct: string | null; tone: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ color: C.ink, fontSize: 17, fontWeight: 800, textShadow: '0 1px 1px #000' }}>{value}</span>
      {pct != null && <span style={{ color: tone, fontSize: 12, fontWeight: 800 }}>{pct}</span>}
    </div>
  );
}

function LockedFace(): JSX.Element {
  return (
    <svg width="100%" viewBox="0 0 156 118" style={{ maxWidth: 176 }} role="img" aria-label="gleich verfügbar">
      <defs>
        <radialGradient id="lk_glass" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#181510" />
          <stop offset="1" stopColor="#060504" />
        </radialGradient>
        <linearGradient id="lk_rim" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#565c66" />
          <stop offset="1" stopColor="#17191d" />
        </linearGradient>
      </defs>
      <circle cx={78} cy={56} r={32} fill="url(#lk_glass)" stroke="url(#lk_rim)" strokeWidth={4} />
      <text x={78} y={60} fontSize={9} fontWeight={700} fill={C.inkFaint} textAnchor="middle">
        gleich verfügbar
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruments
// ─────────────────────────────────────────────────────────────────────────────

/** 180° brass sector speedometer with a blued-steel needle. */
function ArcGauge({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 200, H = 122, cx = 100, cy = 106, R = 80, a0 = 180, a1 = 360;
  const vlen = Math.PI * (R - 25);
  const tone = toneFor(ratio);
  const uid = useId().replace(/:/g, '');
  const clip = `arc_${uid}`;
  const dashTrans = reduced ? 'none' : `stroke-dashoffset var(--w14-dur-instrument) ${EASE}`;
  const needleTrans = reduced ? 'none' : `transform var(--w14-dur-instrument) ${EASE}`;
  const ticks: JSX.Element[] = [];
  const nums: JSX.Element[] = [];
  const numLabels = ['0', '25', '50', '75', '100'];
  for (let i = 0; i <= 20; i++) {
    const a = a0 + (i / 20) * 180;
    const major = i % 5 === 0;
    const p = polar(cx, cy, R - (major ? 12 : 7), a);
    const q = polar(cx, cy, R - 1, a);
    ticks.push(
      <line key={i} x1={r2(p.x)} y1={r2(p.y)} x2={r2(q.x)} y2={r2(q.y)} stroke={major ? '#e7cd84' : '#9c7f42'} strokeWidth={major ? 1.5 : 0.8} opacity={major ? 0.9 : 0.6} />,
    );
    if (major) {
      const t = polar(cx, cy, R - 20, a);
      nums.push(
        <text key={`n${i}`} x={r2(t.x)} y={r2(t.y + 2.4)} fontSize={6.5} fontWeight={700} fill="#c7a866" textAnchor="middle" fontFamily="Georgia, serif" opacity={0.85}>
          {numLabels[i / 5]}
        </text>,
      );
    }
  }
  const facePath = `${arcPath(cx, cy, R + 3.5, a0, a1)} L ${cx + R + 3.5} ${cy} L ${cx - R - 3.5} ${cy} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      <clipPath id={clip}>
        <path d={facePath} />
      </clipPath>
      {/* case plate + milled edge */}
      <path d={`${arcPath(cx, cy, R + 13, a0, a1)} L ${cx + R + 13} ${cy + 6} L ${cx - R - 13} ${cy + 6} Z`} fill="url(#ziel_bezel_lo)" filter="url(#ziel_shadow)" />
      {knurl(cx, cy, R + 13, R + 8, a0, a1, 76)}
      {/* bezel ring + groove + inner turned highlight */}
      <path d={arcPath(cx, cy, R + 7, a0, a1)} fill="none" stroke="url(#ziel_bezel)" strokeWidth={7} />
      <path d={arcPath(cx, cy, R + 10.5, a0, a1)} fill="none" stroke="#2a1e0b" strokeWidth={1} />
      <path d={arcPath(cx, cy, R + 4.4, a0 + 4, a0 + 90)} fill="none" stroke="#fff6d8" strokeWidth={1} opacity={0.4} />
      <path d={arcPath(cx, cy, R + 4.4, a0, a1)} fill="none" stroke="#1c1206" strokeWidth={0.8} opacity={0.5} />
      {/* dark glass face + guilloché */}
      <path d={facePath} fill="url(#ziel_face)" />
      <Guilloche cx={cx} cy={cy} rO={R - 2} rI={16} clip={clip} />
      {/* coloured target zones */}
      <path d={arcPath(cx, cy, R - 16, a0, a0 + 72)} fill="none" stroke={C.red} strokeWidth={3} opacity={0.28} />
      <path d={arcPath(cx, cy, R - 16, a0 + 72, a0 + 135)} fill="none" stroke={C.amber} strokeWidth={3} opacity={0.28} />
      <path d={arcPath(cx, cy, R - 16, a0 + 135, a1)} fill="none" stroke={C.green} strokeWidth={3} opacity={0.32} />
      {ticks}
      {nums}
      {/* value arc: groove, soft bloom, crisp core */}
      <path d={arcPath(cx, cy, R - 25, a0, a1)} fill="none" stroke="#000" strokeWidth={8} opacity={0.6} />
      <path
        d={arcPath(cx, cy, R - 25, a0, a1)}
        fill="none"
        stroke={tone}
        strokeWidth={7.5}
        strokeLinecap="round"
        strokeDasharray={vlen}
        strokeDashoffset={vlen * (1 - Math.max(0.004, ratio))}
        opacity={0.55}
        filter="url(#ziel_glow)"
        style={{ transition: dashTrans }}
      />
      <path
        d={arcPath(cx, cy, R - 25, a0, a1)}
        fill="none"
        stroke={tone}
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeDasharray={vlen}
        strokeDashoffset={vlen * (1 - Math.max(0.004, ratio))}
        style={{ transition: dashTrans }}
      />
      <text x={cx} y={cy - 24} fontSize={7} fontWeight={700} letterSpacing={1.5} fill="#8a6d33" textAnchor="middle" fontFamily="Georgia, serif" opacity={0.8}>
        W·14
      </text>
      {/* needle (points left at rest, rotates with the ratio) */}
      <g style={{ transform: `rotate(${ratio * 180}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: needleTrans }} filter="url(#ziel_shadow)">
        <path d={`M ${cx - (R - 14)} ${cy} L ${cx - 4} ${cy - 3.4} L ${cx + 16} ${cy} L ${cx - 4} ${cy + 3.4} Z`} fill="url(#ziel_steel)" stroke="#0e1622" strokeWidth={0.6} />
        <line x1={cx + 10} y1={cy} x2={cx - (R - 16)} y2={cy} stroke="#eaf3ff" strokeWidth={0.7} opacity={0.65} />
        <circle cx={cx + 16} cy={cy} r={2.2} fill="url(#ziel_brass)" stroke="#2c2009" strokeWidth={0.4} />
      </g>
      {/* hub: brass cap, garnet jewel, specular pip */}
      <circle cx={cx} cy={cy} r={11} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={6.5} fill="url(#ziel_brass)" />
      <circle cx={cx} cy={cy} r={3.4} fill={C.coral} />
      <circle cx={cx - 1.3} cy={cy - 1.6} r={1.3} fill="#ffe0d5" opacity={0.9} />
      {/* glass gloss */}
      <path d={facePath} fill="url(#ziel_spec)" opacity={0.9} />
      <path d={arcPath(cx, cy, R - 6, a0 + 8, a0 + 74)} fill="none" stroke="#fff" strokeWidth={2.4} opacity={0.14} strokeLinecap="round" />
    </svg>
  );
}

/** Segmented brass vault dial in a milled case. */
function VaultRing({ ratio, pct, reduced }: { ratio: number; pct: string; reduced: boolean }): JSX.Element {
  const W = 152, H = 152, cx = 76, cy = 76, R = 54, N = 32, seg = 360 / N;
  const circ = 2 * Math.PI * R;
  const uid = useId().replace(/:/g, '');
  const clip = `ring_${uid}`;
  const segments: JSX.Element[] = [];
  for (let i = 0; i < N; i++) {
    const filled = i / N < ratio || ratio >= 0.999;
    const a = -90 + i * seg;
    segments.push(
      <path
        key={i}
        d={arcPath(cx, cy, R, a + 1.1, a + seg - 1.1)}
        fill="none"
        stroke={bandColor((i + 0.5) / N)}
        strokeWidth={8.5}
        strokeLinecap="round"
        opacity={filled ? 1 : 0.12}
        style={{ transition: reduced ? 'none' : 'opacity var(--w14-dur-slow) linear' }}
      />,
    );
  }
  const screws = [45, 135, 225, 315].map((a) => {
    const p = polar(cx, cy, R + 15, a);
    return <Screw key={a} cx={p.x} cy={p.y} r={2.6} slot={a} />;
  });
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 150 }}>
      {brassDefs}
      <clipPath id={clip}>
        <circle cx={cx} cy={cy} r={R - 6} />
      </clipPath>
      <circle cx={cx} cy={cy} r={R + 18} fill="url(#ziel_bezel_lo)" filter="url(#ziel_shadow)" />
      {knurl(cx, cy, R + 18, R + 13, 0, 360, 120)}
      <circle cx={cx} cy={cy} r={R + 11} fill="url(#ziel_face)" stroke="#2a1e0b" strokeWidth={1} />
      <Guilloche cx={cx} cy={cy} rO={R - 8} rI={12} clip={clip} />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth={10} opacity={0.35} />
      {/* single soft bloom behind the segments, driven by dashoffset */}
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={toneFor(ratio)}
        strokeWidth={8.5}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - Math.max(0.001, ratio))}
        transform={`rotate(-90 ${cx} ${cy})`}
        opacity={0.5}
        filter="url(#ziel_glow)"
        style={{ transition: reduced ? 'none' : `stroke-dashoffset var(--w14-dur-instrument) ${EASE}` }}
      />
      {segments}
      {screws}
      <circle cx={cx} cy={cy} r={R - 12} fill="none" stroke="#000" strokeWidth={0.8} opacity={0.4} />
      <text x={cx} y={cy + 8} fontSize={25} fontWeight={800} fill={C.ink} textAnchor="middle" fontFamily="Georgia, serif">
        {pct}
      </text>
      <circle cx={cx} cy={cy} r={R + 11} fill="url(#ziel_spec)" opacity={0.7} />
    </svg>
  );
}

/** Brass-mounted mercury thermometer. */
function Thermometer({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 122, H = 140, tx = 60, ty0 = 12, ty1 = 104, tubeH = ty1 - ty0;
  const trans = reduced ? 'none' : `transform var(--w14-dur-instrument) ${EASE}`;
  const ticks: JSX.Element[] = [];
  const tnums: JSX.Element[] = [];
  for (let i = 0; i <= 10; i++) {
    const major = i % 2 === 0;
    const y = ty0 + (i / 10) * tubeH;
    ticks.push(<line key={i} x1={tx + 12} y1={r2(y)} x2={tx + (major ? 20 : 16)} y2={r2(y)} stroke="#b79a5e" strokeWidth={major ? 1.2 : 0.7} opacity={0.75} />);
    if (i === 0 || i === 5 || i === 10) {
      tnums.push(
        <text key={`t${i}`} x={tx + 23} y={r2(y + 2.2)} fontSize={6} fontWeight={700} fill="#c0a465" textAnchor="start" fontFamily="Georgia, serif" opacity={0.85}>
          {100 - i * 10}
        </text>,
      );
    }
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 120 }}>
      {brassDefs}
      {/* brass mount plate */}
      <rect x={tx - 16} y={4} width={32} height={ty1 + 30} rx={16} fill="url(#ziel_bezel_lo)" filter="url(#ziel_shadow)" />
      <rect x={tx - 13} y={7} width={26} height={ty1 + 24} rx={13} fill="#120d07" stroke="#2a1e0b" strokeWidth={0.8} />
      <Screw cx={tx} cy={14} r={2.4} slot={40} />
      {/* glass tube */}
      <rect x={tx - 8} y={ty0} width={16} height={tubeH} rx={8} fill="url(#ziel_glasscol)" stroke="#33291b" strokeWidth={1.4} />
      {/* mercury — a full column scaled from the bottom (WebKit-safe) */}
      <g style={{ transform: `scaleY(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'bottom', transition: trans }}>
        <rect x={tx - 5} y={ty0} width={10} height={tubeH} rx={5} fill="url(#ziel_merc)" />
      </g>
      <rect x={tx - 4.5} y={ty0} width={2.4} height={tubeH} rx={1.2} fill="#fff" opacity={0.32} />
      {/* bulb */}
      <circle cx={tx} cy={ty1 + 14} r={15} fill="url(#ziel_merc)" stroke="#6d1a0d" strokeWidth={1.6} />
      <circle cx={tx} cy={ty1 + 14} r={15} fill="none" stroke="#000" strokeWidth={0.6} opacity={0.5} />
      <ellipse cx={tx - 5} cy={ty1 + 9} rx={4.4} ry={3} fill="#ffb49c" opacity={0.7} />
      {ticks}
      {tnums}
    </svg>
  );
}

/** Vertical assayer's jar filling with molten gold or silver. */
function GlassTank({ ratio, metal, reduced }: { ratio: number; metal: 'gold' | 'silver'; reduced: boolean }): JSX.Element {
  const W = 132, H = 132, cx = 66;
  const grad = metal === 'gold' ? 'url(#ziel_gold)' : 'url(#ziel_silver)';
  const uid = useId().replace(/:/g, '');
  const clip = `jar_${uid}`;
  const trans = reduced ? 'none' : `transform var(--w14-dur-instrument) ${EASE}`;
  const jar = (inset: number): string => {
    const nx = 16 - inset, bx = 30 - inset, top = 26 + inset * 0.5, sh = 48, bot = 104 - inset * 0.4, tip = 114 - inset;
    return `M ${cx - nx} ${top} L ${cx - nx} 34 Q ${cx - bx} 40 ${cx - bx} ${sh} L ${cx - bx} ${bot} Q ${cx - bx} ${tip} ${cx} ${tip} Q ${cx + bx} ${tip} ${cx + bx} ${bot} L ${cx + bx} ${sh} Q ${cx + bx} 40 ${cx + nx} 34 L ${cx + nx} ${top} Z`;
  };
  const bx = 27, yBottom = 108, yTopMax = 50, fullH = yBottom - yTopMax;
  // The molten column runs past the rounded jar bottom; the jar clip trims it,
  // so scaleY(ratio) from the box bottom fills the base cleanly at full.
  const colH = 113 - yTopMax;
  const grads: JSX.Element[] = [];
  for (let i = 1; i <= 4; i++) {
    const gy = yBottom - (i / 4) * fullH;
    grads.push(<line key={i} x1={cx + bx - 1} y1={r2(gy)} x2={cx + bx + (i === 4 || i === 2 ? 8 : 5)} y2={r2(gy)} stroke="#b79a5e" strokeWidth={0.8} opacity={0.6} />);
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 146 }}>
      {brassDefs}
      <clipPath id={clip}>
        <path d={jar(3)} />
      </clipPath>
      <ellipse cx={cx} cy={119} rx={30} ry={5} fill="#000" opacity={0.32} />
      <path d={`M ${cx - 24} 110 Q ${cx} 121 ${cx + 24} 110 L ${cx + 20} 116 Q ${cx} 123 ${cx - 20} 116 Z`} fill="url(#ziel_bezel_lo)" stroke="#2c2009" strokeWidth={0.6} />
      <path d={jar(0)} fill="url(#ziel_glasscol)" stroke="#33291b" strokeWidth={1.6} />
      {grads}
      {/* molten metal — full column scaled from the bottom (WebKit-safe) */}
      <g clipPath={`url(#${clip})`}>
        <g style={{ transform: `scaleY(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'bottom', transition: trans }}>
          <rect x={cx - bx - 2} y={yTopMax} width={(bx + 2) * 2} height={colH} fill={grad} />
          <ellipse cx={cx} cy={yTopMax} rx={bx} ry={4} fill={grad} />
          <ellipse cx={cx} cy={yTopMax} rx={bx - 3} ry={2.4} fill="#fff" opacity={0.32} />
          <rect x={cx - bx + 3} y={yTopMax} width={4} height={colH} rx={2} fill="#fff" opacity={0.16} />
          {/* horizontal reflection band — reads as polished molten metal */}
          <rect x={cx - bx - 2} y={r2(yTopMax + colH * 0.4)} width={(bx + 2) * 2} height={2.4} fill="#fff" opacity={0.14} />
          <rect x={cx - bx - 2} y={r2(yTopMax + colH * 0.62)} width={(bx + 2) * 2} height={1.4} fill="#000" opacity={0.12} />
        </g>
      </g>
      {/* brass screw lid */}
      <rect x={cx - 19} y={18} width={38} height={12} rx={3} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={0.7} />
      <rect x={cx - 14} y={14} width={28} height={7} rx={2.5} fill="url(#ziel_brass)" stroke="#2c2009" strokeWidth={0.5} />
      <rect x={cx - 4} y={9} width={8} height={6} rx={1.5} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={0.5} />
      {/* glass highlights */}
      <path d={`M ${cx - 20} 52 Q ${cx - 26} 78 ${cx - 18} 100`} fill="none" stroke="#fff" strokeWidth={2.4} opacity={0.16} strokeLinecap="round" />
      <path d={`M ${cx - 13} 54 Q ${cx - 17} 76 ${cx - 12} 96`} fill="none" stroke="#fff" strokeWidth={1} opacity={0.1} strokeLinecap="round" />
    </svg>
  );
}

/** A wood-and-iron treasure chest with brass straps, a hasp lock and a live fill. */
function Rivet({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <circle cx={r2(x)} cy={r2(y)} r={1.4} fill="#211d16" />
      <circle cx={r2(x - 0.5)} cy={r2(y - 0.5)} r={0.55} fill="#6a6150" />
    </g>
  );
}
function TreasureChest({ ratio, tone, reduced }: { ratio: number; tone: string; reduced: boolean }): JSX.Element {
  const W = 200, H = 118, cxc = 100, bx = 44, bw = 112, by = 46, bh = 50, lidTop = 24;
  const trans = reduced ? 'none' : `transform var(--w14-dur-instrument) ${EASE}`;
  const uid = useId().replace(/:/g, '');
  const clip = `chest_${uid}`, lidClip = `chestlid_${uid}`;
  const innX = cxc - (bw - 40) / 2, innW = bw - 40;
  const lid = `M ${bx} ${by} Q ${bx} ${lidTop} ${cxc} ${lidTop} Q ${bx + bw} ${lidTop} ${bx + bw} ${by} Z`;
  const bracket = (X: number, Y: number, sx: number, sy: number, key: string): JSX.Element => {
    const a = 15, t = 4.5;
    return (
      <g key={key}>
        <path d={`M ${X} ${Y} h ${sx * a} v ${sy * t} h ${-sx * (a - t)} v ${sy * (a - t)} h ${-sx * t} Z`} fill="#28231b" stroke="#120f0a" strokeWidth={0.5} />
        <path d={`M ${X} ${Y} h ${sx * a}`} stroke="#5a5241" strokeWidth={0.6} opacity={0.6} />
        <Rivet x={X + sx * 4} y={Y + sy * 4} />
        <Rivet x={X + sx * 10.5} y={Y + sy * 2.4} />
        <Rivet x={X + sx * 2.4} y={Y + sy * 10.5} />
      </g>
    );
  };
  const strapEl = (sx: number, key: string): JSX.Element => (
    <g key={key}>
      <rect x={sx - 4.5} y={lidTop + 2} width={9} height={by + bh - lidTop - 2} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={0.5} clipPath={`url(#${lidClip})`} />
      <rect x={sx - 4.5} y={by} width={9} height={bh} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={0.5} />
      <rect x={sx - 2.6} y={by} width={1.4} height={bh} fill="#fff3c4" opacity={0.3} />
      <Rivet x={sx} y={by + 8} />
      <Rivet x={sx} y={by + bh - 8} />
      <Rivet x={sx} y={lidTop + 8} />
    </g>
  );
  const grain: JSX.Element[] = [];
  [by + 9, by + 22, by + 35].forEach((gy, i) =>
    grain.push(<path key={`g${i}`} d={`M ${bx + 4} ${gy} q ${bw * 0.3} -2 ${bw * 0.5} 0 t ${bw * 0.44} 0`} fill="none" stroke="#2c1d0d" strokeWidth={0.8} opacity={0.45} />),
  );
  [by + 16, by + 29].forEach((gy, i) =>
    grain.push(<line key={`gl${i}`} x1={bx + 3} y1={gy} x2={bx + bw - 3} y2={gy} stroke="#2a1c0d" strokeWidth={1.1} opacity={0.5} />),
  );
  const lidGrain: JSX.Element[] = [];
  for (let sx = bx + 12, i = 0; sx < bx + bw - 6; sx += 13, i++) {
    lidGrain.push(<path key={i} d={`M ${sx} ${by} Q ${r2(sx + (cxc - sx) * 0.14)} ${lidTop + 2} ${r2(sx + (cxc - sx) * 0.22)} ${lidTop + 3}`} fill="none" stroke="#2c1d0d" strokeWidth={0.7} opacity={0.4} />);
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      <clipPath id={clip}>
        <rect x={innX} y={by + 26} width={innW} height={9} rx={4.5} />
      </clipPath>
      <clipPath id={lidClip}>
        <path d={lid} />
      </clipPath>
      <ellipse cx={cxc} cy={102} rx={bw / 2 + 4} ry={6} fill="#000" opacity={0.34} />
      {/* lid */}
      <path d={lid} fill="url(#ziel_woodlid)" stroke="#1c1207" strokeWidth={1.6} filter="url(#ziel_shadow)" />
      {lidGrain}
      <path d={`M ${bx + 6} ${by - 2} Q ${bx + 6} ${lidTop + 3} ${cxc} ${lidTop + 3}`} fill="none" stroke="#fff" strokeWidth={1.4} opacity={0.16} />
      {/* body */}
      <rect x={bx} y={by} width={bw} height={bh} rx={3} fill="url(#ziel_wood)" stroke="#1c1207" strokeWidth={1.6} />
      {grain}
      <rect x={bx + 2} y={by + 1.5} width={bw - 4} height={4} rx={2} fill="#fff" opacity={0.08} />
      {/* iron corner brackets */}
      {bracket(bx + 1, by + 1, 1, 1, 'tl')}
      {bracket(bx + bw - 1, by + 1, -1, 1, 'tr')}
      {bracket(bx + 1, by + bh - 1, 1, -1, 'bl')}
      {bracket(bx + bw - 1, by + bh - 1, -1, -1, 'br')}
      {/* brass straps */}
      {strapEl(bx + bw * 0.28, 's1')}
      {strapEl(bx + bw * 0.72, 's2')}
      {/* glowing fill inset (progress, scaleX from the left, WebKit-safe) */}
      <rect x={innX - 2} y={by + 24} width={innW + 4} height={13} rx={6.5} fill="url(#ziel_bezel_lo)" stroke="#2c2009" strokeWidth={0.6} />
      <rect x={innX} y={by + 26} width={innW} height={9} rx={4.5} fill="#0b0906" />
      <g clipPath={`url(#${clip})`}>
        <g style={{ transform: `scaleX(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'left', transition: trans }}>
          <rect x={innX} y={by + 26} width={innW} height={9} fill={tone} />
          <rect x={innX} y={by + 26.5} width={innW} height={2} fill="#fff" opacity={0.25} />
        </g>
      </g>
      {/* brass hasp lock over the seam */}
      <path d={`M ${cxc - 6} ${by} q 0 -7 6 -7 q 6 0 6 7`} fill="none" stroke="url(#ziel_brass)" strokeWidth={2.2} />
      <rect x={cxc - 9} y={by - 3} width={18} height={17} rx={2.5} fill="url(#ziel_bezel)" stroke="#1c1207" strokeWidth={0.8} />
      <rect x={cxc - 7} y={by - 1.6} width={14} height={6} rx={1.5} fill="url(#ziel_brass)" opacity={0.8} />
      <circle cx={cxc} cy={by + 6} r={2.2} fill="#120d07" />
      <rect x={cxc - 0.9} y={by + 6} width={1.8} height={5} fill="#120d07" />
    </svg>
  );
}

/** A brass balance whose beam tilts toward the heavier pan as the ratio climbs. */
function BalanceScale({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 200, H = 118, cx = 100, pivotY = 30, armL = 74;
  const tilt = (ratio - 0.5) * 24;
  const trans = reduced ? 'none' : `transform var(--w14-dur-instrument) ${EASE}`;
  const pan = (px: number, gradId: string): JSX.Element => (
    <g>
      <line x1={px} y1={pivotY} x2={px - 15} y2={pivotY + 27} stroke="#8a6d33" strokeWidth={0.9} />
      <line x1={px} y1={pivotY} x2={px} y2={pivotY + 27} stroke="#8a6d33" strokeWidth={0.9} />
      <line x1={px} y1={pivotY} x2={px + 15} y2={pivotY + 27} stroke="#8a6d33" strokeWidth={0.9} />
      <path d={`M ${px - 19} ${pivotY + 27} A 19 8 0 0 0 ${px + 19} ${pivotY + 27} Z`} fill={`url(#${gradId})`} stroke="#1c1207" strokeWidth={1} />
      <path d={`M ${px - 17} ${pivotY + 27} A 17 5 0 0 0 ${px + 17} ${pivotY + 27}`} fill="none" stroke="#000" strokeWidth={1.4} opacity={0.22} />
      <ellipse cx={px} cy={pivotY + 26} rx={19} ry={3.4} fill={`url(#${gradId})`} />
      <ellipse cx={px} cy={pivotY + 26} rx={19} ry={3.4} fill="none" stroke="#fff6d8" strokeWidth={0.8} opacity={0.45} />
      <ellipse cx={px - 5} cy={pivotY + 25} rx={6} ry={1.6} fill="#fff" opacity={0.28} />
    </g>
  );
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      <ellipse cx={cx} cy={106} rx={42} ry={6} fill="#000" opacity={0.35} />
      <rect x={cx - 34} y={98} width={68} height={8} rx={4} fill="url(#ziel_bezel)" stroke="#1c1207" strokeWidth={1} />
      <ellipse cx={cx} cy={99} rx={30} ry={3} fill="#fff6d8" opacity={0.25} />
      <rect x={cx - 3.5} y={pivotY} width={7} height={70} fill="url(#ziel_brass)" stroke="#2c2009" strokeWidth={0.5} />
      <rect x={cx - 1.6} y={pivotY} width={1.4} height={70} fill="#fff3c4" opacity={0.35} />
      {/* finial atop the column (fixed, does not tilt) */}
      <line x1={cx} y1={pivotY - 4} x2={cx} y2={pivotY - 12} stroke="url(#ziel_brass)" strokeWidth={2.4} />
      <circle cx={cx} cy={pivotY - 14} r={3.2} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={0.6} />
      <circle cx={cx - 0.9} cy={pivotY - 15} r={1} fill="#fff2c4" opacity={0.7} />
      <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: `${cx}px ${pivotY}px`, transition: trans }} filter="url(#ziel_shadow)">
        <rect x={cx - armL} y={pivotY - 3} width={armL * 2} height={6} rx={3} fill="url(#ziel_brass)" stroke="#1c1207" strokeWidth={0.7} />
        <rect x={cx - armL} y={pivotY - 2} width={armL * 2} height={1.4} fill="#fff3c4" opacity={0.3} />
        <circle cx={cx - armL} cy={pivotY} r={2.4} fill="#3a2b1a" />
        <circle cx={cx + armL} cy={pivotY} r={2.4} fill="#3a2b1a" />
        {pan(cx - armL, 'ziel_gold')}
        {pan(cx + armL, 'ziel_silver')}
      </g>
      <circle cx={cx} cy={pivotY} r={6.5} fill="url(#ziel_bezel)" stroke="#2c2009" strokeWidth={1} />
      <circle cx={cx - 1.4} cy={pivotY - 1.6} r={1.5} fill="#fff2c4" opacity={0.7} />
      <path d={`M ${cx} ${pivotY + 4} L ${cx - 3} ${pivotY + 16} L ${cx + 3} ${pivotY + 16} Z`} fill={toneFor(ratio)} />
    </svg>
  );
}

/** A jeweller's loupe whose lens rim fills as a circular progress ring. */
function MagnifierLens({ ratio, pct, tone, reduced }: { ratio: number; pct: string; tone: string; reduced: boolean }): JSX.Element {
  const W = 152, H = 152, cx = 64, cy = 60, R = 44;
  const circ = 2 * Math.PI * R;
  const off = circ * (1 - Math.max(0.012, ratio));
  const trans = reduced ? 'none' : `stroke-dashoffset var(--w14-dur-instrument) ${EASE}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 150 }}>
      {brassDefs}
      {/* handle */}
      <line x1={cx + 28} y1={cy + 32} x2={W - 14} y2={H - 12} stroke="url(#ziel_bezel_lo)" strokeWidth={12} strokeLinecap="round" />
      <line x1={cx + 28} y1={cy + 32} x2={W - 14} y2={H - 12} stroke="url(#ziel_brass)" strokeWidth={6} strokeLinecap="round" />
      {/* lens body */}
      <circle cx={cx} cy={cy} r={R + 8} fill="url(#ziel_bezel)" filter="url(#ziel_shadow)" />
      {knurl(cx, cy, R + 8, R + 4, 0, 360, 90)}
      <circle cx={cx} cy={cy} r={R + 2} fill="url(#ziel_glasscol)" stroke="#2a1e0b" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={R - 2} fill="url(#ziel_face)" />
      <circle cx={cx} cy={cy} r={R - 2} fill="#8fb7d6" opacity={0.06} />
      {/* progress ring: groove, bloom, crisp core */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth={5.5} opacity={0.45} />
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={tone}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform={`rotate(-90 ${cx} ${cy})`}
        opacity={0.5}
        filter="url(#ziel_glow)"
        style={{ transition: trans }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={tone}
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: trans }}
      />
      <text x={cx} y={cy + 8} fontSize={21} fontWeight={800} fill={C.ink} textAnchor="middle" fontFamily="Georgia, serif">
        {pct}
      </text>
      <ellipse cx={cx - 12} cy={cy - 16} rx={20} ry={12} fill="#fff" opacity={0.1} />
      <circle cx={cx} cy={cy} r={R - 2} fill="url(#ziel_spec)" opacity={0.5} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function GoalTile({ metric }: { metric: GoalMetric }): JSX.Element {
  const reduced = useReducedMotion();
  const tone = toneFor(metric.ratio);
  let face: ReactNode;
  if (!metric.available) {
    face = <LockedFace />;
  } else {
    switch (metric.kind) {
      case 'arc':
        face = <ArcGauge ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'ring':
        face = <VaultRing ratio={metric.ratio} pct={metric.pctText ?? ''} reduced={reduced} />;
        break;
      case 'thermo':
        face = <Thermometer ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'tank':
        face = <GlassTank ratio={metric.ratio} metal={metric.metal ?? 'gold'} reduced={reduced} />;
        break;
      case 'chest':
        face = <TreasureChest ratio={metric.ratio} tone={tone} reduced={reduced} />;
        break;
      case 'scale':
        face = <BalanceScale ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'lens':
        face = <MagnifierLens ratio={metric.ratio} pct={metric.pctText ?? ''} tone={tone} reduced={reduced} />;
        break;
      default:
        face = <LockedFace />;
    }
  }
  return (
    <WidgetFrame title={metric.title} zielText={metric.zielText} footer={<ValueLine value={metric.valueText} pct={metric.pctText} tone={tone} />}>
      {face}
    </WidgetFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature panels — aged parchment
// ─────────────────────────────────────────────────────────────────────────────

/** A faint fractal-noise paper grain, multiplied over the parchment. */
function PaperGrain({ id }: { id: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'multiply', opacity: 0.5 }}
    >
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves={3} stitchTiles="stitch" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.22  0 0 0 0 0.10  0 0 0 0.9 0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

const AGED_EDGE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  borderRadius: 'var(--w14-radius-card)',
  boxShadow: 'inset 0 0 0 1px rgba(255,248,230,0.25)',
  background: 'radial-gradient(130% 120% at 50% 45%, transparent 60%, rgba(86,58,20,0.22) 100%)',
};

/** Parchment scroll with the five month-goal bars. */
export function GoalsScroll({ bars }: { bars: MonthlyBar[] }): JSX.Element {
  const readable = bars.filter((b) => b.available);
  const avg = readable.length ? Math.round((readable.reduce((s, b) => s + b.ratio, 0) / readable.length) * 100) : 0;
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--w14-radius-card)',
        padding: '18px 24px 20px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(158deg, #efe1bd 0%, #e2d0a4 46%, #d3bf90 100%)',
        border: '1px solid #b19a68',
        boxShadow:
          'inset 0 1px 0 rgba(255,250,235,0.5), inset 0 0 44px rgba(120,86,32,0.28), inset 0 0 5px rgba(60,42,16,0.25), 0 3px 12px rgba(0,0,0,0.45)',
        minHeight: 236,
      }}
    >
      <PaperGrain id="pg_scroll" />
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 14, zIndex: 2 }}>
        <div style={{ color: '#3a2c14', fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', fontFamily: 'Georgia, serif', textShadow: '0 1px 0 rgba(255,250,235,0.5)' }}>
          MONATSZIELE
        </div>
        <div style={{ color: '#7a6330', fontSize: 10, letterSpacing: '0.04em', fontStyle: 'italic', marginTop: 2 }}>Fortschritt des Monats</div>
      </div>
      <div style={{ position: 'relative', zIndex: 2, height: 1, margin: '0 auto 14px', width: '64%', background: 'linear-gradient(90deg,transparent,#9c7f42,transparent)' }} />
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16, flex: 1 }}>
        {bars.map((b) => {
          const pct = Math.round(b.ratio * 100);
          const fill = b.ratio >= 0.75 ? '#5c7f3c' : b.ratio >= 0.4 ? '#a9761f' : '#9a4326';
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#3b2f18', fontSize: 12.5, fontWeight: 700, width: 84, fontFamily: 'Georgia, serif' }}>{b.label}</span>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 13,
                  borderRadius: 7,
                  background: 'rgba(70,48,18,0.2)',
                  boxShadow: 'inset 0 1px 2px rgba(50,34,12,0.4)',
                  border: '1px solid rgba(90,64,26,0.35)',
                  overflow: 'hidden',
                }}
              >
                {b.available && (
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 6,
                      background: fill,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28)',
                      transition: `width var(--w14-dur-instrument) ${EASE}`,
                    }}
                  />
                )}
              </div>
              <span style={{ color: '#3b2f18', fontSize: 12.5, fontWeight: 800, width: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'Georgia, serif' }}>
                {b.available ? `${pct}%` : '-'}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, color: '#6b5428', fontSize: 10.5, fontStyle: 'italic' }}>
        <span style={{ width: 7, height: 7, transform: 'rotate(45deg)', background: '#9a4326', boxShadow: '0 0 0 2px rgba(154,67,38,0.25)' }} />
        <span>{readable.length ? `Monat im Mittel bei ${avg}%` : 'Werte werden geladen'}</span>
        <span style={{ width: 7, height: 7, transform: 'rotate(45deg)', background: '#9a4326', boxShadow: '0 0 0 2px rgba(154,67,38,0.25)' }} />
      </div>
      <div style={AGED_EDGE} />
    </div>
  );
}

/** A galleon drawn at the origin (sails billowing to starboard). */
function Galleon(): JSX.Element {
  return (
    <g fill="none" strokeLinecap="round">
      <path d="M 22 12 q 10 -1 18 2 M 20 16 q 12 0 22 3" stroke="#cdb98a" strokeWidth={1.4} opacity={0.6} />
      <path d="M -19 3 Q 0 8 19 3 L 23 3 L 15 15 Q 0 19 -15 15 L -22 3 Z" fill="#5a4326" stroke="#241708" strokeWidth={1.1} />
      <path d="M -20 5.4 Q 0 10 20 5.4" stroke="#caa25c" strokeWidth={1.2} />
      <path d="M -16 9 Q 0 12.5 16 9" stroke="#2a1a0b" strokeWidth={0.7} opacity={0.6} />
      <line x1={19} y1={1} x2={30} y2={-4} stroke="#3a2a15" strokeWidth={1.4} />
      <line x1={-7} y1={4} x2={-7} y2={-23} stroke="#2e2011" strokeWidth={1.7} />
      <line x1={7} y1={4} x2={7} y2={-17} stroke="#2e2011" strokeWidth={1.5} />
      <path d="M -7 -22 Q 6 -17 8 -6 L -7 -4 Z" fill="#efe7d1" stroke="#b7a375" strokeWidth={0.6} />
      <path d="M -7 -13 Q -18 -9 -20 -2 L -7 -1 Z" fill="#e4d9bd" stroke="#b7a375" strokeWidth={0.6} />
      <path d="M 7 -16 Q 16 -12 17 -4 L 7 -3 Z" fill="#e9dfc6" stroke="#b7a375" strokeWidth={0.6} />
      <path d="M -7 -13.5 Q 3 -10 4 -5" stroke="#c3b184" strokeWidth={0.4} />
      <path d="M -7 -23.4 L 2 -21.6 L -7 -19.8 Z" fill="#a02c17" />
    </g>
  );
}

/** Treasure map: an aged chart, a galleon sailing the route to the overall goal. */
export function TreasureMapPanel({ overall, available }: { overall: number; available: boolean }): JSX.Element {
  const W = 440, H = 224;
  const p = Math.max(0, Math.min(1, overall));
  const pct = Math.round(p * 100);
  const routeLen = 560;
  const bez = (a: number, b: number, c: number, d: number, t: number): number => {
    const mt = 1 - t;
    return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
  };
  const shipX = bez(W * 0.13, W * 0.36, W * 0.52, W * 0.8, p);
  const shipY = bez(H * 0.6, H * 0.34, H * 0.82, H * 0.5, p) - H * 0.04;
  const route = `M ${W * 0.13} ${H * 0.6} C ${W * 0.36} ${H * 0.34}, ${W * 0.52} ${H * 0.82}, ${W * 0.8} ${H * 0.5}`;
  const tone = pct >= 75 ? '#4e7a3a' : pct >= 40 ? '#8a6a24' : '#9a4326';

  const grid: JSX.Element[] = [];
  for (let gx = 40; gx < W; gx += 62) grid.push(<line key={`x${gx}`} x1={gx} y1={8} x2={gx} y2={H - 8} stroke="#7a5f30" strokeWidth={0.6} strokeDasharray="2 7" opacity={0.28} />);
  for (let gy = 34; gy < H - 10; gy += 46) grid.push(<line key={`y${gy}`} x1={8} y1={gy} x2={W - 8} y2={gy} stroke="#7a5f30" strokeWidth={0.6} strokeDasharray="2 7" opacity={0.28} />);

  const island = (icx: number, icy: number, s: number, key: string): JSX.Element => {
    const rings: JSX.Element[] = [];
    for (let k = 0; k < 3; k++) rings.push(<circle key={k} cx={icx} cy={icy} r={r2(s - k * s * 0.28)} fill="none" stroke="#7a5c2c" strokeWidth={1} opacity={0.32 - k * 0.06} />);
    return (
      <g key={key}>
        {rings}
        <circle cx={icx} cy={icy} r={r2(s * 0.18)} fill="#7a5c2c" opacity={0.28} />
      </g>
    );
  };

  const rays: JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45 - 90;
    const long = i % 2 === 0;
    const t = polar(0, 0, long ? 31 : 15, a);
    const bl = polar(0, 0, long ? 3 : 2, a + 90);
    const br = polar(0, 0, long ? 3 : 2, a - 90);
    if (long) {
      rays.push(<path key={`l${i}`} d={`M 0 0 L ${r2(bl.x)} ${r2(bl.y)} L ${r2(t.x)} ${r2(t.y)} Z`} fill="#d8c48f" opacity={0.5} />);
      rays.push(<path key={`d${i}`} d={`M 0 0 L ${r2(br.x)} ${r2(br.y)} L ${r2(t.x)} ${r2(t.y)} Z`} fill="#5c4522" opacity={0.55} />);
    } else {
      rays.push(<path key={`s${i}`} d={`M ${r2(bl.x)} ${r2(bl.y)} L ${r2(t.x)} ${r2(t.y)} L ${r2(br.x)} ${r2(br.y)} Z`} fill="#7a5f30" opacity={0.4} />);
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--w14-radius-card)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        padding: '18px 24px 20px',
        background: 'radial-gradient(125% 105% at 32% 16%, #f0e3c0, #ddca9c 62%, #c8b487 100%)',
        border: '1px solid #b19a68',
        boxShadow:
          'inset 0 1px 0 rgba(255,250,235,0.5), inset 0 0 44px rgba(120,86,32,0.28), inset 0 0 5px rgba(60,42,16,0.25), 0 3px 12px rgba(0,0,0,0.45)',
        minHeight: 236,
      }}
    >
      <PaperGrain id="pg_map" />
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 8, zIndex: 2 }}>
        <div style={{ color: '#3a2c14', fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', fontFamily: 'Georgia, serif', textShadow: '0 1px 0 rgba(255,250,235,0.5)' }}>
          GESAMTÜBERSICHT
        </div>
        <div style={{ color: '#7a6330', fontSize: 10, letterSpacing: '0.04em', fontStyle: 'italic', marginTop: 2 }}>Alle Ziele auf einen Blick</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'relative', zIndex: 2, flex: 1 }}>
        <g opacity={0.9}>{grid}</g>
        {island(W * 0.16, H * 0.24, 20, 'i1')}
        {island(W * 0.3, H * 0.85, 15, 'i2')}
        <g transform={`translate(${W * 0.82} ${H * 0.3})`} opacity={0.92}>
          <circle r={33} fill="none" stroke="#6b5024" strokeWidth={0.7} opacity={0.35} />
          <circle r={27} fill="none" stroke="#6b5024" strokeWidth={0.5} opacity={0.28} strokeDasharray="1.5 3" />
          {rays}
          <circle r={2.6} fill="#efe3c0" />
          <circle r={2.6} fill="none" stroke="#5c4522" strokeWidth={0.7} />
          <text x={0} y={-35} fontSize={10} fontWeight={800} fill="#8a5a2a" textAnchor="middle" fontFamily="Georgia, serif">
            N
          </text>
        </g>
        <path d={`M ${W * 0.44} ${H * 0.7} q 8 -4 16 0 t 16 0`} fill="none" stroke="#8a6d33" strokeWidth={0.8} opacity={0.25} />
        {/* route: dotted base + travelled solid */}
        <path d={route} fill="none" stroke="#5c4626" strokeWidth={4} opacity={0.35} strokeDasharray="2 9" strokeLinecap="round" />
        <path
          d={route}
          fill="none"
          stroke="#3f2f13"
          strokeWidth={4.4}
          opacity={0.92}
          strokeLinecap="round"
          strokeDasharray={routeLen}
          strokeDashoffset={routeLen * (1 - p)}
          style={{ transition: `stroke-dashoffset var(--w14-dur-instrument) ${EASE}` }}
        />
        {/* treasure X */}
        <g transform={`translate(${W * 0.8} ${H * 0.5})`}>
          <circle r={13} fill="#a02c17" opacity={0.14} />
          <line x1={-8} y1={-8} x2={8} y2={8} stroke="#a02c17" strokeWidth={3.4} strokeLinecap="round" />
          <line x1={8} y1={-8} x2={-8} y2={8} stroke="#a02c17" strokeWidth={3.4} strokeLinecap="round" />
        </g>
        <g transform={`translate(${r2(shipX)} ${r2(shipY)}) scale(1.55)`} style={{ transition: `transform var(--w14-dur-instrument) ${EASE}` }}>
          <Galleon />
        </g>
        {/* score cartouche */}
        <g transform={`translate(${W * 0.5} ${H * 0.88})`}>
          <rect x={-66} y={-22} width={132} height={42} rx={8} fill="#efe3c0" opacity={0.55} stroke="#9c7f42" strokeWidth={1} />
          <rect x={-61} y={-18} width={122} height={34} rx={6} fill="none" stroke="#b79a5e" strokeWidth={0.6} opacity={0.7} />
          <text x={0} y={4} fontSize={26} fontWeight={800} fill={available ? tone : '#8a7350'} textAnchor="middle" fontFamily="Georgia, serif">
            {available ? `${pct}%` : '-'}
          </text>
          <text x={0} y={16} fontSize={9} fontWeight={600} letterSpacing="0.12em" fill="#5a4626" textAnchor="middle">
            ZIELERREICHUNG
          </text>
        </g>
      </svg>
      <div style={AGED_EDGE} />
    </div>
  );
}

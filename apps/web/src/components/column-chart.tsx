'use client';

import { formatVnd } from '@michio/shared';
import { useMemo, useRef, useState } from 'react';

export interface ColumnDatum {
  label: string;
  /** Short tick label (e.g. "16" for a day). */
  tick: string;
  value: number;
  /** Tooltip detail lines. */
  detail?: string[];
}

const compact = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(1)} tỷ` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}tr` : n >= 1e3 ? `${+(n / 1e3).toFixed(0)}K` : String(n);

/** Clean tick step: 1/2/5 × 10^k so gridlines land on round numbers. */
function niceMax(max: number, ticks = 4) {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * Math.ceil(max / step), step };
}

/**
 * Single-series column chart (dataviz method): one validated hue (--primary, light/dark), bars ≤ 24px
 * with a 4px rounded data end and square baseline, hairline solid gridlines, compact y ticks, hover
 * tooltip with a hit target wider than the bar. The page shows the same numbers as a table.
 */
export function ColumnChart({ data, title, valueType = 'number', height = 200 }: { data: ColumnDatum[]; title: string; valueType?: 'money' | 'number'; height?: number }) {
  // A string, not a formatter function: server components pass props that must serialize.
  const format = valueType === 'money' ? (n: number) => formatVnd(n) : (n: number) => n.toLocaleString('vi-VN');
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { top, step } = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const W = Math.max(320, data.length * 22);
  const H = height;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, band * 0.6));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(data.length / 12);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);

  return (
    <figure className="relative" ref={ref}>
      <figcaption className="sr-only">{title}</figcaption>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, 640) }} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * band + (band - barW) / 2;
            const h = Math.max(0, pad.t + plotH - y(d.value));
            const r = Math.min(4, h / 2, barW / 2);
            const top0 = pad.t + plotH - h;
            // Rounded data end (top), square at the baseline.
            const path = h > 0 ? `M${x},${pad.t + plotH} V${top0 + r} Q${x},${top0} ${x + r},${top0} H${x + barW - r} Q${x + barW},${top0} ${x + barW},${top0 + r} V${pad.t + plotH} Z` : '';
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}>
                <rect x={pad.l + i * band} y={pad.t} width={band} height={plotH} fill="transparent" />
                {path && <path d={path} fill="var(--primary)" opacity={hover === null || hover === i ? 1 : 0.55} />}
                {i % labelEvery === 0 && <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{d.tick}</text>}
                {i === peak && d.value > 0 && hover === null && (
                  <text x={x + barW / 2} y={top0 - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--foreground)">{compact(d.value)}</text>
                )}
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--muted-foreground)" strokeWidth={1} />
        </svg>
      </div>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `min(calc(${((pad.l + hover * band + band / 2) / W) * 100}% + 8px), calc(100% - 11rem))` }} role="status">
          <p className="font-semibold">{data[hover].label}</p>
          <p className="tabular-nums">{format(data[hover].value)}</p>
          {data[hover].detail?.map((l) => <p key={l} className="text-muted-foreground">{l}</p>)}
        </div>
      )}
    </figure>
  );
}

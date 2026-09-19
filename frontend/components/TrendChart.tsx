'use client';

import { useEffect, useRef, useState } from 'react';

export interface TrendPoint {
  label: string; // shown in the tooltip, e.g. "3 Sep"
  value: number;
}

const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };
const LINE = 'var(--color-primary)';

function niceMax(max: number) {
  if (max <= 4) return 4;
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  return step * 4;
}

// Monotone cubic interpolation: a smooth curve that never dips below zero or overshoots a peak.
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const slope = pts.slice(1).map((p, i) => (p.y - pts[i].y) / dx[i]);
  const tan = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tan.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  tan.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tan[i] = (3 * a * slope[i]) / h;
      tan[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const w = dx[i] / 3;
    d += ` C${pts[i].x + w},${pts[i].y + tan[i] * w} ${pts[i + 1].x - w},${pts[i + 1].y - tan[i + 1] * w} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/**
 * Single-series area chart in the style of the reference dashboard's "Performance" card:
 * a 2px smooth line over a faint wash, a hairline crosshair and a dark tooltip bubble.
 */
export default function TrendChart({
  points,
  metric,
}: {
  points: TrendPoint[];
  metric: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const xAt = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const yAt = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));

  const line = smoothPath(coords);
  const baseline = PAD.top + innerH;
  const area = coords.length > 1 ? `${line} L${coords[coords.length - 1].x},${baseline} L${coords[0].x},${baseline} Z` : '';
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));

  const focus = active ?? points.length - 1;
  const focusPoint = coords[focus];

  function move(clientX: number, rect: DOMRect) {
    if (points.length === 0) return;
    const ratio = (clientX - rect.left - PAD.left) / innerW;
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    setActive(Math.min(points.length - 1, Math.max(0, focus + step)));
  }

  const tooltipLeft = focusPoint ? Math.min(Math.max(focusPoint.x, 60), Math.max(60, width - 60)) : 0;

  return (
    <div ref={wrapRef} className="relative" style={{ height: HEIGHT }}>
      {width > 0 && points.length > 0 && (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${metric} over the last ${points.length} days. Use the arrow keys to read each day.`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActive(null)}
            className="block touch-pan-y outline-none focus-visible:outline-2 focus-visible:outline-primary rounded-xl"
          >
            <defs>
              <linearGradient id="trend-wash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={LINE} stopOpacity="0.16" />
                <stop offset="1" stopColor={LINE} stopOpacity="0" />
              </linearGradient>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-line)" />
                <text x={PAD.left - 10} y={yAt(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">
                  {Math.round(t).toLocaleString('en-GB')}
                </text>
              </g>
            ))}

            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={p.label + i}
                  x={xAt(i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fill={i === focus && active !== null ? 'var(--color-ink)' : 'var(--color-muted)'}
                >
                  {p.label}
                </text>
              ) : null,
            )}

            {area && <path d={area} fill="url(#trend-wash)" />}
            <path d={line} fill="none" stroke={LINE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {active !== null && (
              <line x1={focusPoint.x} x2={focusPoint.x} y1={PAD.top} y2={baseline} stroke="#C9CED8" strokeDasharray="3 4" />
            )}
            {focusPoint && (
              <circle cx={focusPoint.x} cy={focusPoint.y} r="5" fill={LINE} stroke="var(--color-card)" strokeWidth="2" />
            )}
          </svg>

          {active !== null && focusPoint && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 bg-ink text-white rounded-xl px-4 py-3 shadow-lg whitespace-nowrap"
              style={{ left: tooltipLeft, top: Math.max(0, focusPoint.y - 78) }}
            >
              <div className="text-[13px] font-bold mb-1.5">{points[active].label}</div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="w-0.5 h-3.5 rounded" style={{ background: 'var(--color-peach)' }} />
                <span className="text-white/70">{metric}</span>
                <span className="font-extrabold ml-auto pl-3">{points[active].value.toLocaleString('en-GB')}</span>
              </div>
            </div>
          )}
        </>
      )}

      <table className="sr-only">
        <caption>{metric} per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>{metric}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

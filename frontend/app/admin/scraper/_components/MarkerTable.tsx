'use client';

import { useMemo, useState } from 'react';
import type { FingerprintMarker, MarkerCategory } from '@/lib/scraper-types';
import { btn, humanise, inputClass } from './ui';

const CATEGORIES: MarkerCategory[] = [
  'generator',
  'footer_attribution',
  'framework',
  'script',
  'stylesheet',
  'asset_host',
  'css_class',
  'element_id',
  'dom_skeleton',
  'jsonld_shape',
  'route_pattern',
  'api_endpoint',
];

// The traits of a template, grouped by kind. Required traits must be present for a confident match;
// a negative trait rules a website out.
export default function MarkerTable({ markers, onChange, editable = true }: { markers: FingerprintMarker[]; onChange: (next: FingerprintMarker[]) => void; editable?: boolean }) {
  const [draft, setDraft] = useState<{ category: MarkerCategory; value: string }>({ category: 'css_class', value: '' });
  const groups = useMemo(() => {
    const byCategory = new Map<string, number[]>();
    markers.forEach((m, i) => byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), i]));
    return [...byCategory.entries()];
  }, [markers]);
  const update = (index: number, patch: Partial<FingerprintMarker>) => onChange(markers.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([category, indexes]) => (
        <details key={category} open={['generator', 'footer_attribution', 'script', 'stylesheet'].includes(category)} className="border border-line rounded-xl px-4 py-2">
          <summary className="text-sm font-extrabold cursor-pointer">
            {humanise(category)} <span className="text-muted font-semibold">({indexes.length})</span>
          </summary>
          <div className="flex flex-col gap-1.5 mt-2">
            {indexes.map((i) => (
              <div key={`${markers[i].category}|${markers[i].value}`} className="flex items-center gap-3 text-[13px] flex-wrap">
                <code className="font-mono flex-1 min-w-0 break-all">{markers[i].value}</code>
                <label className="flex items-center gap-1 font-bold">
                  weight
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    disabled={!editable}
                    value={markers[i].weight}
                    onChange={(e) => update(i, { weight: Number(e.target.value) })}
                    className="w-16 border border-line rounded-lg px-2 py-1 bg-surface"
                  />
                </label>
                <label className="flex items-center gap-1 font-bold">
                  <input type="checkbox" disabled={!editable} className="accent-primary" checked={markers[i].required} onChange={(e) => update(i, { required: e.target.checked, negative: false })} />
                  required
                </label>
                <label className="flex items-center gap-1 font-bold">
                  <input type="checkbox" disabled={!editable} className="accent-primary" checked={markers[i].negative} onChange={(e) => update(i, { negative: e.target.checked, required: false })} />
                  negative
                </label>
                {editable && (
                  <button className="text-primary font-bold cursor-pointer" onClick={() => onChange(markers.filter((_, j) => j !== i))}>
                    remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
      {editable && (
        <div className="flex gap-2 flex-wrap items-center">
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MarkerCategory })} className={`${inputClass} py-2 text-[13px]`}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
          </select>
          <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="Trait value, e.g. sf-offer-card" className={`${inputClass} py-2 text-[13px] flex-1 min-w-48 font-mono`} />
          <button
            className={btn.outline}
            disabled={!draft.value.trim() || markers.some((m) => m.category === draft.category && m.value === draft.value.trim())}
            onClick={() => {
              onChange([...markers, { category: draft.category, value: draft.value.trim(), weight: 1, required: false, negative: false }]);
              setDraft({ ...draft, value: '' });
            }}
          >
            Add trait
          </button>
        </div>
      )}
    </div>
  );
}

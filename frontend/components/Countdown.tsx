'use client';

import { useEffect, useState } from 'react';

function pad(n: number) {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/**
 * Hours:minutes:seconds left, or days:hours:minutes once more than a day remains.
 * Starts blank so the server and the first client render agree.
 */
export default function Countdown({ endsAt, size = 'sm' }: { endsAt: string; size?: 'sm' | 'lg' }) {
  const [parts, setParts] = useState<{ labels: string[]; values: string[] } | null>(null);

  useEffect(() => {
    function tick() {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) {
        setParts({ labels: ['days', 'hrs', 'min'], values: ['00', '00', '00'] });
        return;
      }
      const totalMinutes = ms / 60_000;
      if (totalMinutes >= 24 * 60) {
        setParts({
          labels: ['days', 'hrs', 'min'],
          values: [pad(ms / 86_400_000), pad((ms / 3_600_000) % 24), pad((ms / 60_000) % 60)],
        });
      } else {
        setParts({
          labels: ['hrs', 'min', 'sec'],
          values: [pad(ms / 3_600_000), pad((ms / 60_000) % 60), pad((ms / 1000) % 60)],
        });
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const values = parts?.values ?? ['--', '--', '--'];
  const labels = parts?.labels ?? ['hrs', 'min', 'sec'];

  return (
    <div className="flex items-center gap-1.5" aria-label="Time left on this offer">
      {values.map((v, i) => (
        <span key={labels[i]} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted font-extrabold">:</span>}
          <span
            title={labels[i]}
            className={`countdown-cell rounded-lg font-extrabold ${
              size === 'lg' ? 'text-[15px] px-2.5 py-1.5' : 'text-[12px] px-2 py-1'
            }`}
          >
            {v}
          </span>
        </span>
      ))}
    </div>
  );
}


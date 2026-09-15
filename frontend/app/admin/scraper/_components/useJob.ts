'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ImportJob } from '@/lib/scraper-types';

const FINISHED = ['completed', 'failed', 'dead_lettered', 'cancelled'];

// Polls one scraper job every two seconds until it finishes, then calls onFinished once.
export function useJob(jobId: string | null | undefined, onFinished?: (job: ImportJob) => void) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const callback = useRef(onFinished);
  useEffect(() => {
    callback.current = onFinished;
  });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<ImportJob>(`/admin/scraper/jobs/${jobId}`);
        if (cancelled) return;
        setJob(next);
        if (FINISHED.includes(next.status)) {
          callback.current?.(next);
          return;
        }
      } catch {
        /* keep polling */
      }
      timer = setTimeout(poll, 2_000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const current = job && job._id === jobId ? job : null;
  return { job: current, finished: !!current && FINISHED.includes(current.status), succeeded: current?.status === 'completed' };
}

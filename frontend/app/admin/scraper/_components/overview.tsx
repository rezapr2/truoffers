'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ScraperOverview } from '@/lib/scraper-types';

const OverviewContext = createContext<{ overview: ScraperOverview | null; refresh: () => void }>({
  overview: null,
  refresh: () => {},
});

// Counters for the scraper navigation badges and the emergency-stop banner, shared by every scraper page.
export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<ScraperOverview | null>(null);

  const refresh = useCallback(() => {
    void api<ScraperOverview>('/admin/scraper/overview').then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return <OverviewContext.Provider value={{ overview, refresh }}>{children}</OverviewContext.Provider>;
}

export function useOverview() {
  return useContext(OverviewContext);
}

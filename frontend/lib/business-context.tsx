'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Business, PlanFlags, PlanLimits, Subscription } from './types';

export interface ManageData {
  business: Business;
  myRole: 'owner' | 'staff' | 'staff_override' | null;
  plan: {
    key: string;
    name: string;
    limits: PlanLimits;
    flags: PlanFlags;
    autoApprove: boolean;
    subscription: Pick<Subscription, '_id' | 'status' | 'interval' | 'price' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'pendingPlanKey' | 'comp'> | null;
  };
  usage: { liveOffers: number; photos: number };
  openClaim: {
    _id: string;
    status: string;
    kind: string;
    phoneOtpPassed: boolean;
    domainCheckPassed: boolean;
    fhrsMatch: boolean;
    submittedAt?: string;
    expiresAt?: string;
    notes?: string;
    reasonCode?: string;
    decidedAt?: string;
    userId: string;
    createdAt: string;
  } | null;
  lockedFields: string[];
  pendingChanges: { _id: string; changes: { field: string; from?: unknown; to?: unknown }[]; createdAt: string }[];
  orderLinkCheck: 'none' | 'invalid' | 'own_domain' | 'ordering_provider' | 'mismatch';
  reverificationDue: boolean;
}

interface BusinessState {
  businesses: Business[];
  business: Business | null;
  manage: ManageData | null;
  loading: boolean;
  select: (id: string) => void;
  /** Refreshes the selected business (after a change). */
  reload: () => Promise<void>;
  /** Refreshes the list (after a claim, an invitation or leaving a team). */
  reloadList: () => Promise<void>;
  isOwner: boolean;
}

const BusinessContext = createContext<BusinessState | null>(null);
const STORAGE_KEY = 'truoffers_business';

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manage, setManage] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadList = useCallback(async () => {
    const list = await api<Business[]>('/businesses/mine').catch(() => [] as Business[]);
    setBusinesses(list);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    setSelectedId((current) => {
      const keep = [current, stored].find((id) => id && list.some((b) => b._id === id));
      return keep ?? list[0]?._id ?? null;
    });
    if (list.length === 0) setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    if (!selectedId) return;
    const data = await api<ManageData>(`/businesses/${selectedId}/manage`).catch(() => null);
    setManage(data);
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the user's businesses once on mount
    void reloadList();
  }, [reloadList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the selected business whenever it changes
    void reload();
  }, [reload]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setManage(null);
    setLoading(true);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<BusinessState>(() => {
    const business = manage?.business ?? businesses.find((b) => b._id === selectedId) ?? null;
    return {
      businesses,
      business,
      manage,
      loading,
      select,
      reload,
      reloadList,
      isOwner: manage?.myRole === 'owner',
    };
  }, [businesses, selectedId, manage, loading, select, reload, reloadList]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside the dashboard');
  return ctx;
}

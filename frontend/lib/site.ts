'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface SiteSettings {
  siteName: string;
  contactEmail: string;
  contactPhone?: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  recaptchaSiteKey?: string;
  vatRatePercent: number;
  pricesIncludeVat: boolean;
}

let cached: Promise<SiteSettings | null> | null = null;

/** Public site settings (maintenance mode, reCAPTCHA key, VAT), fetched once per page load. */
export function loadSite(): Promise<SiteSettings | null> {
  cached ??= api<SiteSettings>('/site').catch(() => null);
  return cached;
}

export function useSite() {
  const [site, setSite] = useState<SiteSettings | null>(null);
  useEffect(() => {
    let live = true;
    void loadSite().then((s) => live && setSite(s));
    return () => {
      live = false;
    };
  }, []);
  return site;
}

/** A stable id for this browser, so a guest can report an offer only once a week. */
export function deviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem('truoffers_did');
    if (!id) {
      id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('truoffers_did', id);
    }
    return id;
  } catch {
    return '';
  }
}

import { api } from './api';

function sessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem('truoffers_sid');
  if (!sid) {
    sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('truoffers_sid', sid);
  }
  return sid;
}

export interface TrackPayload {
  businessId?: string;
  offerId?: string;
  supplierId?: string;
  postcodeArea?: string;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget analytics event (taxonomy per blueprint section 16.2). */
export function track(eventName: string, payload: TrackPayload = {}) {
  try {
    void api('/events', {
      method: 'POST',
      body: JSON.stringify({ eventName, sessionId: sessionId(), ...payload }),
    }).catch(() => {});
  } catch {
    /* never break the UI for analytics */
  }
}

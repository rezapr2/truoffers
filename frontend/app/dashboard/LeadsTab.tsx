'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Lead {
  _id: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  message: string;
  type: string;
  status: string;
  createdAt: string;
  supplierId?: { name: string };
}

const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

export default function LeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    void api<Lead[]>('/suppliers/leads/mine')
      .then(setLeads)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  async function setStatus(lead: Lead, status: string) {
    await api(`/suppliers/leads/${lead._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-extrabold">Lead inbox ({leads.length})</h2>
      {leads.map((lead) => (
        <div key={lead._id} className="bg-card rounded-2xl p-6">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <span className="font-extrabold">{lead.contactName}</span>
            <a href={`mailto:${lead.contactEmail}`} className="text-sm font-bold text-primary">
              {lead.contactEmail}
            </a>
            {lead.contactPhone && <span className="text-sm font-semibold text-muted">{lead.contactPhone}</span>}
            <span className="text-[11px] font-extrabold uppercase bg-page px-2.5 py-1 rounded-full text-muted">
              {lead.type}
            </span>
            <span className="ml-auto text-[13px] font-semibold text-muted">
              {new Date(lead.createdAt).toLocaleDateString('en-GB')}
            </span>
          </div>
          <p className="text-[15px] font-semibold text-ink-soft mb-4">{lead.message}</p>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(lead, s)}
                className={`text-[12px] font-bold capitalize px-3.5 py-1.5 rounded-full cursor-pointer transition-colors ${
                  lead.status === s ? 'bg-ink text-surface' : 'bg-surface border border-line hover:border-primary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
      {loaded && leads.length === 0 && (
        <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
          No leads yet. Takeaways will find you through the supplier marketplace.
        </div>
      )}
    </div>
  );
}

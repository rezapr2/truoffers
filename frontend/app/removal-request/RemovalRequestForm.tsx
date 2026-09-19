'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

// Accepts a pasted TruOffers link to an offer (/offer/<id>) or a takeaway (/takeaway/<slug>).
function parseListing(link: string): { offerId?: string; businessSlug?: string } {
  const offer = link.match(/\/offer\/([a-f0-9]{24})/i);
  if (offer) return { offerId: offer[1] };
  const takeaway = link.match(/\/takeaway\/([a-z0-9-]+)/i);
  if (takeaway) return { businessSlug: takeaway[1] };
  return {};
}

export default function RemovalRequestForm({ offerId, businessSlug }: { offerId?: string; businessSlug?: string }) {
  const [form, setForm] = useState({ link: '', name: '', email: '', reason: '', declaration: false, website: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const hasTarget = Boolean(offerId || businessSlug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = hasTarget ? { offerId, businessSlug } : parseListing(form.link);
    if (!target.offerId && !target.businessSlug) {
      setError('Paste the link to the offer or takeaway page on TruOffers.');
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      await api('/removal-requests', {
        method: 'POST',
        body: JSON.stringify({
          ...target,
          name: form.name || undefined,
          email: form.email,
          reason: form.reason,
          declaration: form.declaration,
          website: form.website || undefined,
        }),
      });
      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request');
      setStatus('idle');
    }
  }

  if (status === 'sent') {
    return (
      <div className="bg-card border border-line rounded-3xl p-8">
        <h2 className="font-display text-2xl font-extrabold mb-3">Request received</h2>
        <p className="text-[15px] font-semibold text-ink-soft leading-relaxed">
          If the listing includes offers imported from your website, they have been removed and we won’t import from
          that website again. Offers a business manages itself on TruOffers aren’t affected. We’ll reply to{' '}
          <span className="font-extrabold text-ink">{form.email}</span> if we need anything else.
        </p>
      </div>
    );
  }

  const input = 'border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface';
  return (
    <form onSubmit={submit} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
      {error && (
        <div className="bg-danger/10 border border-danger/25 text-danger-dark text-sm font-bold rounded-xl px-4 py-3">{error}</div>
      )}
      {!hasTarget && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Link to the offer or takeaway on TruOffers *</span>
          <input
            required
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
            placeholder="https://truoffers.co.uk/takeaway/your-takeaway"
            className={input}
          />
        </label>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Your name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Email *</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            maxLength={254}
            className={input}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-extrabold">What should we remove, and why? *</span>
        <textarea
          required
          minLength={5}
          maxLength={1000}
          rows={4}
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          className={input}
        />
      </label>
      {/* Left empty by people; bots that fill every field are ignored. */}
      <label className="hidden" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </label>
      <label className="flex items-start gap-3 text-sm font-semibold text-ink-soft">
        <input
          required
          type="checkbox"
          checked={form.declaration}
          onChange={(e) => setForm({ ...form, declaration: e.target.checked })}
          className="mt-1 accent-primary"
        />
        I own or am authorised to act for this business.
      </label>
      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-soft font-bold py-3.5 rounded-2xl cursor-pointer disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending…' : 'Send removal request'}
      </button>
    </form>
  );
}

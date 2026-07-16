'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import type { Supplier } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';

export default function SupplierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { user } = useAuth();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ contactName: '', contactEmail: '', contactPhone: '', message: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Supplier>(`/suppliers/${slug}`).then(setSupplier).catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, contactName: f.contactName || user.name, contactEmail: f.contactEmail || user.email }));
  }, [user]);

  if (notFound) {
    return (
      <div className="py-24 text-center">
        <h1 className="font-display text-2xl font-extrabold mb-3">Supplier not found</h1>
        <Link href="/suppliers" className="text-primary font-bold">Back to marketplace →</Link>
      </div>
    );
  }
  if (!supplier) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/suppliers/${supplier._id}/leads`, {
        method: 'POST',
        body: JSON.stringify({ ...form, type: 'quote_request' }),
      });
      track('supplier_lead_submit', { supplierId: supplier._id, metadata: { category: supplier.category } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send enquiry');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 md:px-10 py-10">
      <nav className="text-sm font-bold text-muted mb-4">
        <Link href="/suppliers" className="hover:text-primary">Suppliers</Link> / {supplier.name}
      </nav>
      <div className="bg-card rounded-3xl p-8 md:p-10 mb-5">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{supplier.name}</h1>
          <VerifiedBadge status={supplier.verificationStatus} />
        </div>
        <div className="text-sm font-bold text-muted capitalize mb-5">
          {supplier.category} · {supplier.serviceArea}
        </div>
        <p className="text-[15px] font-semibold text-ink-soft leading-relaxed max-w-2xl">
          {supplier.description}
        </p>
        {supplier.website && (
          <a
            href={supplier.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-4 text-primary font-bold"
          >
            Visit website →
          </a>
        )}
      </div>

      <div className="bg-card rounded-3xl p-8">
        <h2 className="font-display text-xl font-extrabold mb-1">Request a quote</h2>
        <p className="text-sm font-semibold text-muted mb-6">
          Your enquiry goes straight to {supplier.name}&apos;s lead inbox.
        </p>
        {sent ? (
          <div className="bg-verified/10 border border-verified/30 text-verified font-bold rounded-2xl px-6 py-5 text-center">
            ✓ Enquiry sent — {supplier.name} will get back to you soon.
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && (
              <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <input
                required
                placeholder="Your name"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              />
              <input
                required
                type="email"
                placeholder="Email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              />
            </div>
            <input
              placeholder="Phone (optional)"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
            />
            <textarea
              required
              minLength={5}
              rows={4}
              placeholder="What do you need? Quantities, timelines, your takeaway's name…"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface resize-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-primary text-cream font-bold py-3.5 rounded-full hover:bg-primary-dark transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send enquiry'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

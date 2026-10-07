'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, btn, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRecaptcha } from '@/lib/recaptcha';
import { useSite } from '@/lib/site';

export const SUPPORT_TOPICS = [
  { value: 'account', label: 'My account' },
  { value: 'claim', label: 'Claiming or verifying a business' },
  { value: 'listing', label: 'A listing is wrong' },
  { value: 'offer', label: 'An offer' },
  { value: 'billing', label: 'Plans and billing' },
  { value: 'report', label: 'Something I reported' },
  { value: 'partnership', label: 'Partnerships and press' },
  { value: 'other', label: 'Something else' },
];

/** Opens a support ticket. Guests pass reCAPTCHA; replies come by email with a private link. */
export default function ContactForm({ businessId, onSent, compact }: { businessId?: string; onSent?: (ticket: { _id: string; number: string; link: string }) => void; compact?: boolean }) {
  const { user } = useAuth();
  const site = useSite();
  const { ref: captchaRef, token: captchaToken, failed: captchaFailed, required: captchaRequired } = useRecaptcha(user ? undefined : site?.recaptchaSiteKey);
  const [form, setForm] = useState({ name: '', email: '', topic: businessId ? 'listing' : 'account', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ _id: string; number: string; link: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaRequired && !captchaToken) return setError('Please tick “I’m not a robot”');
    setBusy(true);
    setError(null);
    try {
      const ticket = await api<{ _id: string; number: string; link: string }>('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ ...form, name: user ? undefined : form.name, email: user ? undefined : form.email, businessId, recaptchaToken: captchaToken ?? undefined }),
      });
      setSent(ticket);
      onSent?.(ticket);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Alert tone="success" title={`Thanks, we got it (${sent.number})`}>
        We usually reply within one working day, by email{user ? ' and in your account' : ''}.{' '}
        <Link href={sent.link} className="underline font-bold">
          Open the conversation
        </Link>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!user && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Your name" required>
            <input className={inputClass} required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" required>
            <input type="email" className={inputClass} required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="What is it about?">
        <select className={inputClass} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
          {SUPPORT_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject" required>
        <input className={inputClass} required minLength={3} maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </Field>
      <Field label="Message" hint="Include the takeaway or offer name if it’s about one." required>
        <textarea className={inputClass} required minLength={10} rows={compact ? 4 : 6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </Field>
      {captchaRequired && <div ref={captchaRef} />}
      {captchaFailed && <Alert tone="danger">Could not load the robot check. Please try again later.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div>
        <button className={btn.primary} disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

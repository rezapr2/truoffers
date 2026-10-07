'use client';

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { deviceId, useSite } from '@/lib/site';
import { loadRecaptcha } from '@/lib/recaptcha';
import { Alert, btn, Field, inputClass, Modal } from './ui';
import { FlagIcon } from './icons';

const REASONS = [
  { value: 'not_honoured', label: 'Offer not honoured' },
  { value: 'ended', label: 'Offer has ended' },
  { value: 'wrong_terms', label: 'Wrong price or terms' },
  { value: 'closed_or_fake', label: 'Business closed or fake' },
  { value: 'misleading', label: 'Misleading or offensive' },
  { value: 'other', label: 'Other' },
];

/**
 * Spec "Offer reports": a "Report this offer" link on every offer card and offer page. Guests pass a reCAPTCHA;
 * the email is optional for guests and prefilled for signed-in people.
 */
export default function ReportOffer({ offerId, offerTitle, className = '', tone = 'light' }: { offerId: string; offerTitle?: string; className?: string; tone?: 'light' | 'dark' }) {
  const { user } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);
  const needsCaptcha = !user && !!site?.recaptchaSiteKey;

  useEffect(() => {
    if (!open || !needsCaptcha || !captchaRef.current || captchaRef.current.childElementCount) return;
    const el = captchaRef.current;
    void loadRecaptcha()
      .then(() => window.grecaptcha?.render(el, { sitekey: site!.recaptchaSiteKey!, callback: setCaptcha, 'expired-callback': () => setCaptcha(null) }))
      .catch(() => setError('Could not load the robot check. Please try again later.'));
  }, [open, needsCaptcha, site]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError('Choose a reason');
    if (needsCaptcha && !captcha) return setError('Please tick “I’m not a robot”');
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('reason', reason);
      if (note.trim()) form.append('note', note.trim());
      if (!user && email.trim()) form.append('email', email.trim());
      form.append('deviceId', deviceId());
      if (captcha) form.append('recaptchaToken', captcha);
      if (photo) form.append('photo', photo);
      await api(`/offers/${offerId}/reports`, { method: 'POST', body: form });
      track('report_offer', { offerId, metadata: { reason } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the report'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1.5 text-[12px] font-bold cursor-pointer ${tone === 'dark' ? 'text-leaf-soft/80 hover:text-white' : 'text-muted hover:text-danger'} ${className}`}
      >
        <FlagIcon className="w-3.5 h-3.5" /> Report this offer
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={sent ? 'Thanks for telling us' : 'Report this offer'}>
        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft leading-relaxed">
              Our team will look into it. Offers are only removed after a review, and we never tell the takeaway who reported.
              {(user || email) && ' We’ll email you the outcome.'}
            </p>
            <button className={btn.primary} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            {offerTitle && <p className="text-sm text-muted">“{offerTitle}”</p>}
            {error && <Alert tone="danger">{error}</Alert>}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-extrabold mb-1">
                What’s wrong? <span className="text-danger">*</span>
              </legend>
              {REASONS.map((r) => (
                <label key={r.value} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 cursor-pointer text-sm font-bold ${reason === r.value ? 'border-primary bg-tint-blue' : 'border-line'}`}>
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[var(--color-primary)]" />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <Field label="What happened?" hint={`${note.length}/500`}>
              <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} resize-none`} />
            </Field>
            <Field label="Photo of your receipt or screen (optional)">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="text-sm" />
            </Field>
            {user ? (
              <p className="text-[13px] text-muted">We’ll email the outcome to {user.email}.</p>
            ) : (
              <Field label="Your email (optional)" hint="To hear what we decide.">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </Field>
            )}
            {needsCaptcha && <div ref={captchaRef} />}
            <button type="submit" disabled={busy} className={btn.primary}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}

'use client';

import { useState } from 'react';
import { api, download, errorMessage, upload } from '@/lib/api';
import { track } from '@/lib/analytics';
import { date, dateTime } from '@/lib/format';
import { Alert, btn, Card, Field, inputClass, StatusPill } from './ui';
import { CheckIcon, UploadIcon } from './icons';

export interface ClaimView {
  _id: string;
  status: string;
  kind: 'existing' | 'new' | 'reverification';
  business: { _id: string; name: string; slug: string; address?: string; town?: string; postcode: string; phone?: string; website?: string; orderUrl?: string; verificationLevel: number; status: string };
  phoneOtpPassed: boolean;
  phoneCheck: { phoneHint: string | null; sentAt?: string; expiresAt?: string; attemptsLeft: number; sendsLeft: number; passedAt?: string; channel?: string };
  domainCheckPassed: boolean;
  domainCheck: { domain?: string; method?: string; email?: string; codeExpiresAt?: string; passedAt?: string; lastError?: string; siteToken?: string; metaTag?: string; fileUrl?: string };
  fhrsMatch: boolean;
  fhrs?: { fhrsId: string; name: string; address?: string; postcode?: string; rating?: string; nameMatches: boolean; postcodeMatches: boolean };
  shopPhotoCode?: string;
  documents: { _id: string; type: string; originalName?: string; size?: number; status: string; uploadedAt: string }[];
  evidence: { phone: boolean; domain: boolean; fhrs: boolean; documents: number; shopPhoto: boolean; additional: number; canSubmit: boolean };
  messages: { _id: string; from: string; body: string; createdAt: string }[];
  notes?: string;
  reasonCode?: string;
  expiresAt?: string;
  submittedAt?: string;
  decidedAt?: string;
}

interface FhrsResult {
  fhrsId: string;
  name: string;
  address: string;
  postcode?: string;
  rating?: string;
}

const DOC_TYPES = [
  { value: 'food_registration', label: 'Food business registration' },
  { value: 'business_rates', label: 'Business rates bill' },
  { value: 'utility_bill', label: 'Utility bill' },
  { value: 'bank_letter', label: 'Bank letter' },
  { value: 'shop_photo', label: 'Photo of the shop front with your code' },
  { value: 'other', label: 'Other document' },
];

const REASONS: Record<string, string> = {
  mismatch: 'The details or evidence did not match the listing',
  fake_document: 'A document looked altered or not genuine',
  duplicate: 'This takeaway is already listed and claimed',
  not_a_takeaway: 'This is not a takeaway we can list',
  other: 'We could not confirm you run this business',
};

function Done({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm font-bold">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-none ${ok ? 'bg-verified text-white' : 'bg-page text-muted'}`}>{ok ? <CheckIcon className="w-3.5 h-3.5" /> : null}</span>
      <span className={ok ? '' : 'text-muted'}>{children}</span>
    </li>
  );
}

/**
 * Spec flow 1 "Claim and verification": the phone check to the listing's own number, then at least one more
 * piece of evidence, then a moderator. Used on the claim page and on the dashboard's Verification page.
 */
export default function ClaimWorkspace({ claim: initial, onChange }: { claim: ClaimView; onChange?: (claim: ClaimView) => void }) {
  const [claim, setClaim] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [docType, setDocType] = useState('business_rates');
  const [domainEmail, setDomainEmail] = useState('');
  const [domainCode, setDomainCode] = useState('');
  const [domainDevCode, setDomainDevCode] = useState<string | null>(null);
  const [fhrsQuery, setFhrsQuery] = useState({ name: initial.business.name, postcode: initial.business.postcode });
  const [fhrsResults, setFhrsResults] = useState<FhrsResult[] | null>(null);
  const [message, setMessage] = useState('');
  const editable = ['draft', 'info_requested', 'pending', 'disputed'].includes(claim.status);
  const base = `/claims/${claim._id}`;

  async function run<T>(key: string, fn: () => Promise<T>, after?: (result: T) => void) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      after?.(result);
      return result;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const update = (next: ClaimView) => {
    setClaim(next);
    onChange?.(next);
  };

  const closed = ['approved', 'rejected', 'expired', 'withdrawn'].includes(claim.status);

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-extrabold uppercase tracking-wide text-muted">{claim.kind === 'new' ? 'New listing' : claim.kind === 'reverification' ? 'Re-verification' : 'Claim'}</div>
          <div className="font-display text-xl font-extrabold">{claim.business.name}</div>
          <div className="text-sm text-muted">{[claim.business.address, claim.business.town, claim.business.postcode].filter(Boolean).join(', ')}</div>
        </div>
        <StatusPill status={claim.status} label={claim.status === 'draft' ? 'In progress' : claim.status === 'pending' ? 'In review' : undefined} />
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {claim.status === 'approved' && <Alert tone="success" title="You’re verified">{claim.business.name} shows the TruOffers verified badge. Your offers can go live.</Alert>}
      {claim.status === 'rejected' && (
        <Alert tone="danger" title="This claim was not approved">
          {REASONS[claim.reasonCode ?? ''] ?? 'We could not confirm you run this business'}. {claim.notes}
        </Alert>
      )}
      {claim.status === 'expired' && <Alert tone="warning" title="This claim closed">We didn’t hear back in time. You can start again.</Alert>}
      {claim.status === 'info_requested' && (
        <Alert tone="warning" title="We need a little more information">
          Read the moderator’s message below, add what they ask for and submit again by {date(claim.expiresAt)}.
        </Alert>
      )}
      {claim.status === 'disputed' && (
        <Alert tone="danger" title="This listing is being reviewed">
          Someone else already runs this listing. Add your evidence: our team will look at both and decide. Changes to the listing are paused meanwhile.
        </Alert>
      )}
      {claim.status === 'pending' && <Alert tone="info" title="With a moderator">We usually decide within 1 working day and email you. You can still add evidence or a message.</Alert>}

      {/* Step 1: phone */}
      <Card>
        <h3 className="font-display text-lg font-extrabold mb-1">1. Prove you can answer the shop phone</h3>
        {claim.phoneOtpPassed ? (
          <p className="text-sm font-bold text-verified flex items-center gap-2">
            <CheckIcon className="w-4 h-4" /> Phone checked {claim.phoneCheck.passedAt ? `on ${dateTime(claim.phoneCheck.passedAt)}` : ''}
          </p>
        ) : !claim.phoneCheck.phoneHint ? (
          <Alert tone="warning">This listing has no valid phone number, so we can’t send a code. Please contact us to claim it.</Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">
              We’ll send a 6-digit code to the number on the listing, <strong>{claim.phoneCheck.phoneHint}</strong>. It works for 10 minutes and you have 3 tries.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                className={btn.primary}
                disabled={!!busy || !editable || claim.phoneCheck.sendsLeft < 1}
                onClick={() =>
                  run('sms', () => api<{ devCode?: string }>(`${base}/phone/send`, { method: 'POST', body: JSON.stringify({ channel: 'sms' }) }), (r) => {
                    setDevCode(r.devCode ?? null);
                    setNotice('Code sent by text.');
                    void api<ClaimView>(base).then(update);
                  })
                }
              >
                {busy === 'sms' ? 'Sending…' : claim.phoneCheck.sentAt ? 'Text me a new code' : 'Text me a code'}
              </button>
              <button
                className={btn.secondary}
                disabled={!!busy || !editable || claim.phoneCheck.sendsLeft < 1}
                onClick={() =>
                  run('call', () => api<{ devCode?: string }>(`${base}/phone/send`, { method: 'POST', body: JSON.stringify({ channel: 'call' }) }), (r) => {
                    setDevCode(r.devCode ?? null);
                    setNotice('We’re calling the shop now. The call reads out the code.');
                    void api<ClaimView>(base).then(update);
                  })
                }
              >
                {busy === 'call' ? 'Calling…' : 'Call the shop instead'}
              </button>
            </div>
            {devCode && <p className="text-[13px] bg-surface rounded-xl px-4 py-2.5 font-bold">Development mode — your code is <span className="text-primary font-display text-lg">{devCode}</span></p>}
            {claim.phoneCheck.sentAt && (
              <form
                className="flex gap-2 items-end flex-wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('verify', () => api<ClaimView>(`${base}/phone/verify`, { method: 'POST', body: JSON.stringify({ code }) }), (next) => {
                    update(next);
                    setCode('');
                    track('claim_start', { businessId: next.business._id, metadata: { step: 'phone_verified' } });
                    setNotice(next.status === 'disputed' ? 'Phone checked. Someone else already runs this listing, so our team will review it.' : 'Phone checked. Now add your evidence.');
                  });
                }}
              >
                <Field label="Code" className="w-44">
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className={`${inputClass} font-display text-xl tracking-[0.3em] text-center`} />
                </Field>
                <button type="submit" className={btn.primary} disabled={busy === 'verify' || code.length !== 6}>
                  {busy === 'verify' ? 'Checking…' : 'Check code'}
                </button>
                <span className="text-[12.5px] text-muted pb-3">{claim.phoneCheck.attemptsLeft} tries left</span>
              </form>
            )}
          </div>
        )}
      </Card>

      {/* Step 2: evidence */}
      <Card className={claim.phoneOtpPassed ? '' : 'opacity-60 pointer-events-none'}>
        <h3 className="font-display text-lg font-extrabold mb-1">2. Add at least one more piece of evidence</h3>
        <p className="text-sm text-muted mb-4">Any one of these is enough; more helps us decide faster.</p>
        <ul className="flex flex-col gap-2 mb-6">
          <Done ok={claim.evidence.documents > 0}>A business document</Done>
          <Done ok={claim.evidence.domain}>Your website or business email</Done>
          <Done ok={claim.evidence.fhrs}>Your Food Hygiene Rating listing</Done>
          <Done ok={claim.evidence.shopPhoto}>A photo of the shop front with your code</Done>
        </ul>

        <div className="flex flex-col gap-6">
          <section>
            <h4 className="font-extrabold mb-1">Documents</h4>
            <p className="text-[13px] text-muted mb-3">
              Food business registration, business rates bill, utility bill or bank letter showing the business name and address, dated within 3 months. PDF or JPG, up to 10 MB, 3 documents.
              {claim.shopPhotoCode && (
                <>
                  {' '}For a shop-front photo, write <strong className="text-ink">{claim.shopPhotoCode}</strong> on paper and hold it up in the photo.
                </>
              )}
            </p>
            {claim.documents.length > 0 && (
              <ul className="flex flex-col gap-2 mb-3">
                {claim.documents.map((doc) => (
                  <li key={doc._id} className="flex items-center gap-3 bg-surface rounded-xl px-4 py-2.5 text-sm">
                    <span className="flex-1 min-w-0 truncate font-bold">
                      {DOC_TYPES.find((t) => t.value === doc.type)?.label ?? doc.type}
                      <span className="text-muted font-semibold"> · {doc.originalName}</span>
                    </span>
                    <button className={btn.link} onClick={() => void download(`${base}/documents/${doc._id}`, doc.originalName ?? 'document', true)}>
                      View
                    </button>
                    {['draft', 'info_requested'].includes(claim.status) && (
                      <button className="text-danger font-bold cursor-pointer" onClick={() => run('rm', () => api<ClaimView>(`${base}/documents/${doc._id}`, { method: 'DELETE' }), update)}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && claim.documents.length < 3 && (
              <div className="flex gap-2 flex-wrap items-center">
                <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${inputClass} w-auto`} aria-label="Document type">
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label className={`${btn.secondary} cursor-pointer`}>
                  <UploadIcon className="w-4 h-4" /> {busy === 'upload' ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void run('upload', () => upload<ClaimView>(`${base}/documents`, file, { type: docType }), update);
                    }}
                  />
                </label>
              </div>
            )}
          </section>

          <section>
            <h4 className="font-extrabold mb-1">Website or business email</h4>
            {claim.domainCheckPassed ? (
              <p className="text-sm font-bold text-verified">✓ Checked {claim.domainCheck.method === 'email' ? `through ${claim.domainCheck.email}` : `on ${claim.domainCheck.domain}`}</p>
            ) : !claim.domainCheck.domain ? (
              <p className="text-[13px] text-muted">Add your website to the listing to use this.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-[13px] text-muted mb-2">We email a code to an address ending in @{claim.domainCheck.domain}.</p>
                  <div className="flex gap-2 flex-wrap">
                    <input type="email" value={domainEmail} onChange={(e) => setDomainEmail(e.target.value)} placeholder={`you@${claim.domainCheck.domain}`} className={`${inputClass} max-w-xs`} />
                    <button
                      className={btn.secondary}
                      disabled={!!busy || !domainEmail}
                      onClick={() => run('demail', () => api<{ devCode?: string }>(`${base}/domain/email`, { method: 'POST', body: JSON.stringify({ email: domainEmail }) }), (r) => {
                        setDomainDevCode(r.devCode ?? null);
                        setNotice(`Code sent to ${domainEmail}.`);
                      })}
                    >
                      Send code
                    </button>
                  </div>
                  {domainDevCode && <p className="text-[13px] mt-2">Development — code <strong>{domainDevCode}</strong></p>}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <input value={domainCode} onChange={(e) => setDomainCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Code" inputMode="numeric" className={`${inputClass} max-w-[140px]`} />
                    <button className={btn.secondary} disabled={!!busy || domainCode.length !== 6} onClick={() => run('dverify', () => api<ClaimView>(`${base}/domain/email/verify`, { method: 'POST', body: JSON.stringify({ code: domainCode }) }), update)}>
                      Check
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-[13px] text-muted mb-2">Or add this tag to your homepage’s &lt;head&gt;, or put the code in a file at {claim.domainCheck.fileUrl}:</p>
                  <code className="block bg-surface rounded-xl px-4 py-2.5 text-[12.5px] break-all">{claim.domainCheck.metaTag}</code>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button className={btn.small} disabled={!!busy} onClick={() => run('meta', () => api<ClaimView>(`${base}/domain/site`, { method: 'POST', body: JSON.stringify({ method: 'meta' }) }), update)}>
                      {busy === 'meta' ? 'Checking…' : 'Check the tag'}
                    </button>
                    <button className={btn.small} disabled={!!busy} onClick={() => run('file', () => api<ClaimView>(`${base}/domain/site`, { method: 'POST', body: JSON.stringify({ method: 'file' }) }), update)}>
                      {busy === 'file' ? 'Checking…' : 'Check the file'}
                    </button>
                  </div>
                  {claim.domainCheck.lastError && <p className="text-[13px] text-danger font-bold mt-2">{claim.domainCheck.lastError}</p>}
                </div>
              </div>
            )}
          </section>

          <section>
            <h4 className="font-extrabold mb-1">Food Hygiene Rating</h4>
            {claim.fhrs && (
              <p className={`text-sm font-bold mb-2 ${claim.fhrsMatch ? 'text-verified' : 'text-danger'}`}>
                {claim.fhrsMatch ? '✓ Matched' : 'Doesn’t match'}: {claim.fhrs.name}, {claim.fhrs.postcode} {claim.fhrs.rating ? `(rated ${claim.fhrs.rating})` : ''}
                {!claim.fhrsMatch && ` — ${!claim.fhrs.nameMatches ? 'the name' : 'the postcode'} is different from your listing.`}
              </p>
            )}
            {!claim.fhrsMatch && editable && (
              <>
                <div className="flex gap-2 flex-wrap">
                  <input value={fhrsQuery.name} onChange={(e) => setFhrsQuery({ ...fhrsQuery, name: e.target.value })} className={`${inputClass} max-w-xs`} aria-label="Business name" />
                  <input value={fhrsQuery.postcode} onChange={(e) => setFhrsQuery({ ...fhrsQuery, postcode: e.target.value })} className={`${inputClass} max-w-[140px]`} aria-label="Postcode" />
                  <button
                    className={btn.secondary}
                    disabled={!!busy}
                    onClick={() => run('fhrs', () => api<FhrsResult[]>(`${base}/fhrs/search?name=${encodeURIComponent(fhrsQuery.name)}&postcode=${encodeURIComponent(fhrsQuery.postcode)}`), setFhrsResults)}
                  >
                    {busy === 'fhrs' ? 'Searching…' : 'Find my rating'}
                  </button>
                </div>
                {fhrsResults && (
                  <ul className="flex flex-col gap-2 mt-3">
                    {fhrsResults.length === 0 && <li className="text-sm text-muted">Nothing found. Try a shorter name.</li>}
                    {fhrsResults.map((r) => (
                      <li key={r.fhrsId} className="flex items-center gap-3 bg-surface rounded-xl px-4 py-2.5 text-sm">
                        <span className="flex-1 min-w-0">
                          <strong>{r.name}</strong> <span className="text-muted">· {r.address} {r.postcode}</span>
                        </span>
                        <span className="font-bold">{r.rating}</span>
                        <button className={btn.small} onClick={() => run('pick', () => api<ClaimView>(`${base}/fhrs`, { method: 'POST', body: JSON.stringify({ fhrsId: r.fhrsId }) }), update)}>
                          This is us
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      </Card>

      {/* Messages */}
      {(claim.messages.length > 0 || claim.status !== 'draft') && (
        <Card>
          <h3 className="font-display text-lg font-extrabold mb-3">Messages</h3>
          <ul className="flex flex-col gap-3 mb-4">
            {claim.messages.map((m) => (
              <li key={m._id} className={`rounded-2xl px-4 py-3 text-sm ${m.from === 'moderator' ? 'bg-tint-blue' : m.from === 'system' ? 'bg-page text-muted' : 'bg-surface'}`}>
                <div className="text-[12px] font-extrabold text-muted mb-0.5">
                  {m.from === 'moderator' ? 'TruOffers moderator' : m.from === 'system' ? 'Update' : 'You'} · {dateTime(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </li>
            ))}
            {claim.messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
          </ul>
          {editable && (
            <div className="flex gap-2">
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message to the moderator" className={inputClass} />
              <button className={btn.secondary} disabled={!message.trim() || !!busy} onClick={() => run('msg', () => api<ClaimView>(`${base}/messages`, { method: 'POST', body: JSON.stringify({ body: message }) }), (next) => {
                update(next);
                setMessage('');
              })}>
                Send
              </button>
            </div>
          )}
        </Card>
      )}

      {!closed && (
        <div className="flex items-center gap-3 flex-wrap">
          {['draft', 'info_requested'].includes(claim.status) && (
            <button
              className={btn.primary}
              disabled={!claim.evidence.canSubmit || !!busy}
              onClick={() =>
                run('submit', () => api<ClaimView>(`${base}/submit`, { method: 'POST' }), (next) => {
                  update(next);
                  track('claim_complete', { businessId: next.business._id });
                  setNotice('Submitted. A moderator will check it, usually within 1 working day.');
                })
              }
            >
              {busy === 'submit' ? 'Submitting…' : claim.status === 'info_requested' ? 'Submit again' : 'Submit for review'}
            </button>
          )}
          {!claim.evidence.canSubmit && ['draft', 'info_requested'].includes(claim.status) && (
            <span className="text-[13px] text-muted">{claim.phoneOtpPassed ? 'Add one piece of evidence to submit.' : 'Finish the phone check first.'}</span>
          )}
          <button
            className="text-sm font-bold text-muted hover:text-danger ml-auto cursor-pointer"
            onClick={() => confirm('Withdraw this claim?') && run('withdraw', () => api<ClaimView>(`${base}/withdraw`, { method: 'POST' }), update)}
          >
            Withdraw claim
          </button>
        </div>
      )}
    </div>
  );
}

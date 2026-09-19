'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { InvitationPack, OutreachCandidate, Paged } from '@/lib/scraper-types';
import { btn, Card, EmptyState, ErrorNote, formatDate, inputClass, Pager, SectionTitle, StatusPill, useAction } from '../_components/ui';

const CHANNELS = ['email', 'whatsapp', 'phone', 'post', 'in_person', 'other'];

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
        <button
          className={btn.outline}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard blocked: the text is on screen to copy by hand */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="bg-surface border border-line rounded-xl p-4 text-[13px] font-semibold whitespace-pre-wrap break-words">{text}</pre>
    </div>
  );
}

function InvitationPanel({ pack, onClose }: { pack: InvitationPack; onClose: () => void }) {
  return (
    <Card className="border border-primary/30">
      <SectionTitle aside={<button className={btn.outline} onClick={onClose}>Close</button>}>
        Invitation ready — send it yourself
      </SectionTitle>
      <p className="text-[13px] font-semibold text-muted mb-4">
        This link works until {formatDate(pack.invitation.expiresAt, false)} and only for this business. It is shown once: generating another
        invitation replaces it. Claiming still goes through the usual verification.
      </p>
      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <CopyBox label="Claim link" text={pack.claimUrl} />
          <CopyBox label={`Email — ${pack.messages.email.subject}`} text={pack.messages.email.body} />
          <CopyBox label="WhatsApp or text message" text={pack.messages.whatsapp} />
          <CopyBox label="Phone script" text={pack.messages.phone} />
        </div>
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pack.qrCode} alt="QR code for the claim link" className="w-44 h-44 rounded-xl border border-line bg-white" />
          <a href={pack.qrCode} download={`claim-${pack.invitation.tokenHint}.png`} className={btn.outline}>Download QR</a>
        </div>
      </div>
    </Card>
  );
}

export default function OutreachPage() {
  const [data, setData] = useState<Paged<OutreachCandidate> | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pack, setPack] = useState<InvitationPack | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (q.trim()) params.set('q', q.trim());
    void api<Paged<OutreachCandidate>>(`/admin/scraper/outreach?${params}`).then(setData).catch(() => {});
  }, [q, page]);
  useEffect(load, [load]);

  async function invite(businessId: string) {
    const created = await run(() => api<InvitationPack>(`/admin/scraper/outreach/${businessId}/invitation`, { method: 'POST' }));
    if (created) {
      setPack(created);
      load();
    }
  }

  async function contacted(businessId: string) {
    const channel = prompt(`How did you contact them? One of: ${CHANNELS.join(', ')}`, 'phone');
    if (!channel) return;
    const note = prompt('Note (optional)') ?? undefined;
    const done = await run(() => api(`/admin/scraper/outreach/${businessId}/contacted`, { method: 'POST', body: JSON.stringify({ channel, note: note || undefined }) }));
    if (done) load();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle>Invite takeaways to claim their listing</SectionTitle>
        <p className="text-[13px] font-semibold text-muted">
          These takeaways have offers we imported from their own website, and nobody has claimed the listing. Generate an invitation, then
          send it yourself: TruOffers never contacts a business automatically.
        </p>
        <p className="text-[13px] font-bold text-danger-dark bg-danger/10 border border-danger/25 rounded-xl px-4 py-3 mt-4">
          Marketing by email, text or WhatsApp to sole traders is covered by PECR. Check you have a lawful basis and include an opt-out before
          you send anything, and record the contact here afterwards.
        </p>
      </Card>
      <ErrorNote error={error} />
      {pack && <InvitationPanel pack={pack} onClose={() => setPack(null)} />}

      <Card>
        <SectionTitle
          aside={<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search business" className={`${inputClass} text-sm`} />}
        >
          Unclaimed listings with imported offers ({data?.total ?? 0})
        </SectionTitle>
        <div className="flex flex-col divide-y divide-line">
          {data?.items.map(({ business, offers, offerTitles, domain, invitation, invitationCount }) => (
            <div key={business._id} className="py-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/takeaway/${business.slug}`} className="font-extrabold hover:text-primary">{business.name}</Link>
                  <span className="text-[12px] font-bold text-muted">{business.town ?? business.postcode} · {offers} imported offer{offers === 1 ? '' : 's'}</span>
                  {invitation?.claimedAt && <StatusPill status="approved" label="claimed" />}
                  {invitation && !invitation.claimedAt && !invitation.revokedAt && <StatusPill status="testing" label={`invited ${formatDate(invitation.createdAt, false)}`} />}
                  {invitation?.contacts?.length ? <StatusPill status="completed" label={`contacted ${invitation.contacts.length}×`} /> : null}
                </div>
                <div className="text-[13px] font-semibold text-muted">
                  {domain ?? 'no website recorded'}
                  {business.phone ? ` · ${business.phone}` : ''}
                  {offerTitles.length ? ` · ${offerTitles.join('; ')}` : ''}
                  {invitationCount > 1 ? ` · ${invitationCount} invitations generated` : ''}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} className={btn.dark} onClick={() => invite(business._id)}>
                  {invitation ? 'New invitation' : 'Generate invitation'}
                </button>
                {invitation && (
                  <button disabled={busy} className={btn.outline} onClick={() => contacted(business._id)}>
                    Record contact
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {data?.items.length === 0 && <EmptyState>Every takeaway with imported offers has claimed its listing.</EmptyState>}
        {data && <div className="mt-6"><Pager page={data.page} pages={data.pages} onChange={setPage} /></div>}
      </Card>
    </div>
  );
}

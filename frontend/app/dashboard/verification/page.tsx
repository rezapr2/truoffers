'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date } from '@/lib/format';
import ClaimWorkspace, { type ClaimView } from '@/components/ClaimWorkspace';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Alert, btn, Card, SectionTitle, Spinner } from '@/components/ui';
import { DashboardPage } from '../_components/shared';

const LEVELS = [
  { level: 0, title: 'Unclaimed', text: 'Listed, not managed by the business.' },
  { level: 1, title: 'Claim pending', text: 'Phone line proven. Profile editing and draft offers.' },
  { level: 2, title: 'TruOffers verified', text: 'Evidence approved by a moderator. Live offers, plans, promotions and a ranking boost.' },
  { level: 3, title: 'Verified plus', text: 'Hygiene rating and Companies House linked (coming later).' },
];

const FIELD_LABELS: Record<string, string> = { name: 'Name', address: 'Address', postcode: 'Postcode', town: 'Town', phone: 'Phone', orderUrl: 'Order link' };

export default function VerificationPage() {
  const { business, manage, reload } = useBusiness();
  const claimId = manage?.openClaim && ['draft', 'pending', 'info_requested', 'disputed'].includes(manage.openClaim.status) ? manage.openClaim._id : null;
  const { data: claim, setData: setClaim } = useApi<ClaimView>(claimId ? `/claims/${claimId}` : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!business || !manage) return <Spinner />;
  const level = business.verificationLevel;
  const isOwner = manage.myRole === 'owner';

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<ClaimView>('/claims/reverify', { method: 'POST', body: JSON.stringify({ businessId: business!._id }) });
      setClaim(created);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardPage title="Verification" subtitle={<VerifiedBadge level={level} />}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {LEVELS.map((l) => (
          <div key={l.level} className={`rounded-2xl p-4 border ${level === l.level ? 'border-primary bg-tint-blue' : level > l.level ? 'border-line bg-surface' : 'border-line'}`}>
            <div className="text-[12px] font-extrabold text-muted">Level {l.level}</div>
            <div className="font-extrabold">{l.title}</div>
            <div className="text-[12.5px] text-muted mt-1">{l.text}</div>
          </div>
        ))}
      </div>

      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

      {claimId && claim ? (
        <ClaimWorkspace
          claim={claim}
          onChange={(c) => {
            setClaim(c);
            void reload();
          }}
        />
      ) : claimId ? (
        <Spinner />
      ) : level >= 2 ? (
        <Card className="flex flex-col gap-3">
          <SectionTitle>{business.name} is verified</SectionTitle>
          <p className="text-sm text-ink-soft">
            Verified {business.verifiedAt ? `on ${date(business.verifiedAt)}` : ''}. We ask owners to confirm once a year, and again when the phone, address or order link changes; your badge stays meanwhile.
          </p>
          {isOwner && (
            <button className={`${btn.secondary} self-start`} disabled={busy} onClick={start}>
              Verify again now
            </button>
          )}
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <SectionTitle>Verify {business.name}</SectionTitle>
          <p className="text-sm text-ink-soft">
            We send a code to the phone number on your listing, then you add one more piece of evidence (a business document, your website or business email, or your Food Hygiene Rating). A moderator checks it, usually within 1 working day.
          </p>
          {manage.openClaim?.status === 'rejected' && <Alert tone="danger">Your last claim was not approved{manage.openClaim.notes ? `: ${manage.openClaim.notes}` : '.'}</Alert>}
          {isOwner ? (
            <button className={`${btn.primary} self-start`} disabled={busy} onClick={start}>
              {busy ? 'Starting…' : 'Start verification'}
            </button>
          ) : (
            <p className="text-sm text-muted">An owner of the business needs to do this.</p>
          )}
        </Card>
      )}

      {manage.pendingChanges.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Changes waiting for a moderator</SectionTitle>
          <div className="flex flex-col gap-3">
            {manage.pendingChanges.map((c) => (
              <Card key={c._id}>
                <div className="text-[12px] text-muted mb-2">Requested {date(c.createdAt)}</div>
                <ul className="text-sm flex flex-col gap-1">
                  {c.changes.map((f) => (
                    <li key={f.field}>
                      <strong>{FIELD_LABELS[f.field] ?? f.field}:</strong> <span className="line-through text-muted">{String(f.from ?? '—')}</span> → {String(f.to ?? '—')}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      )}
    </DashboardPage>
  );
}

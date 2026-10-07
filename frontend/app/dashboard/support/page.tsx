'use client';

import Link from 'next/link';
import { useState } from 'react';
import ContactForm from '@/components/ContactForm';
import { btn, Card, EmptyState, SectionTitle, Spinner, StatusPill } from '@/components/ui';
import { useBusiness } from '@/lib/business-context';
import { date } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { DashboardPage } from '../_components/shared';

interface Ticket {
  _id: string;
  number: string;
  subject: string;
  status: string;
  updatedAt: string;
  businessId?: { _id: string; name: string };
}

const STATUS_TEXT: Record<string, string> = { open: 'With our team', pending: 'Waiting for you', closed: 'Closed' };

export default function DashboardSupportPage() {
  const { business } = useBusiness();
  const { data, reload } = useApi<Ticket[]>('/support/tickets/mine');
  const [writing, setWriting] = useState(false);

  return (
    <DashboardPage
      title="Support"
      subtitle="Questions about your listing, verification, offers or billing go straight to our team."
      actions={
        !writing && (
          <button className={btn.primary} onClick={() => setWriting(true)}>
            New request
          </button>
        )
      }
    >
      {writing && (
        <Card className="mb-8">
          <SectionTitle>New request{business ? ` about ${business.name}` : ''}</SectionTitle>
          <ContactForm businessId={business?._id} compact onSent={() => void reload()} />
        </Card>
      )}
      <SectionTitle>Your requests</SectionTitle>
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No requests yet">
          See <Link href="/help" className="text-primary font-bold">Help</Link> for guides on verification, offers and plans.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((t) => (
            <li key={t._id}>
              <Link href={`/support/${t._id}`} className="flex items-center gap-3 bg-surface hover:bg-tint-blue/60 rounded-2xl px-5 py-4">
                <span className="flex-1 min-w-0">
                  <span className="font-extrabold block truncate">{t.subject}</span>
                  <span className="text-[12.5px] text-muted">
                    {t.number} · updated {date(t.updatedAt)}
                    {t.businessId ? ` · ${t.businessId.name}` : ''}
                  </span>
                </span>
                <StatusPill status={t.status === 'pending' ? 'info_requested' : t.status === 'open' ? 'open' : 'ended'} label={STATUS_TEXT[t.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPage>
  );
}

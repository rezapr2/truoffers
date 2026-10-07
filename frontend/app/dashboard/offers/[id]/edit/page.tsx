'use client';

import { use } from 'react';
import { Alert, btn, Spinner } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import Link from 'next/link';
import { isMirrored, type Offer } from '@/lib/types';
import { DashboardPage } from '../../../_components/shared';
import OfferEditor from '../../../_components/OfferEditor';

export default function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: offer, error } = useApi<Offer>(`/offers/${id}/manage`);
  return (
    <DashboardPage
      title="Edit offer"
      subtitle={offer && ['active', 'scheduled'].includes(offer.status) ? 'Changes to a live offer are checked again before they show.' : undefined}
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !offer ? (
        <Spinner />
      ) : isMirrored(offer) ? (
        <Alert tone="info" title="This deal comes from your Foodbell site" action={<Link href="/dashboard/foodbell" className={btn.small}>Foodbell connection</Link>}>
          Change it, or stop showing it on TruOffers, in your Foodbell dashboard. TruOffers picks up the change within a minute. You can still pause it here from My offers.
        </Alert>
      ) : (
        <OfferEditor offer={offer} />
      )}
    </DashboardPage>
  );
}

'use client';

import { use } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import type { Offer } from '@/lib/types';
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
      {error ? <Alert tone="danger">{error}</Alert> : offer ? <OfferEditor offer={offer} /> : <Spinner />}
    </DashboardPage>
  );
}

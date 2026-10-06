'use client';

import { DashboardPage } from '../../_components/shared';
import OfferEditor from '../../_components/OfferEditor';

export default function NewOfferPage() {
  return (
    <DashboardPage title="Post an offer" subtitle="Four quick steps. The preview shows how customers will see it.">
      <OfferEditor />
    </DashboardPage>
  );
}

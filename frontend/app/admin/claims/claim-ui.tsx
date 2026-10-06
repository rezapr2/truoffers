'use client';

import { Tag } from '@/components/ui';

export interface Evidence {
  phone: boolean;
  domain: boolean;
  fhrs: boolean;
  documents: number;
  shopPhoto: boolean;
  additional: number;
}

/** The evidence a claim carries, as small chips (spec T2.4: phone plus at least one more). */
export function EvidenceChips({ evidence }: { evidence: Evidence }) {
  return (
    <div className="flex gap-1 flex-wrap">
      <Tag tone={evidence.phone ? 'good' : 'bad'}>Phone</Tag>
      {evidence.domain && <Tag tone="good">Domain</Tag>}
      {evidence.fhrs && <Tag tone="good">FHRS</Tag>}
      {evidence.documents > 0 && <Tag tone="info">{evidence.documents} doc{evidence.documents === 1 ? '' : 's'}</Tag>}
      {evidence.shopPhoto && <Tag tone="info">Shop photo</Tag>}
      {!evidence.additional && <Tag tone="warn">No extra evidence</Tag>}
    </div>
  );
}


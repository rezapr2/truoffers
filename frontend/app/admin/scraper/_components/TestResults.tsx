'use client';

import type { AdapterTestResults } from '@/lib/scraper-types';
import { formatDate, StatusPill } from './ui';

// What a dry run found on each example website. No candidates were created.
export default function TestResults({ results }: { results: AdapterTestResults }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-bold">
        Ran {formatDate(results.ranAt)}: recognised {results.summary.handled} of {results.summary.domains} example websites, {results.summary.offers} offers found.
      </div>
      {results.redactedAt && (
        <div className="text-[13px] font-semibold text-muted">
          Page text was removed on {formatDate(results.redactedAt)} under the data retention policy. Run the test again to see it.
        </div>
      )}
      {results.domains.map((domain) => (
        <div key={domain.domain} className="border border-line rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold">{domain.domain}</span>
            <StatusPill status={domain.canHandle ? 'completed' : 'failed'} label={domain.canHandle ? 'recognised' : 'not recognised'} />
            {domain.templateScore !== undefined && <span className="text-[12px] font-bold text-muted">template score {domain.templateScore}</span>}
            {domain.excerptsRedacted && !results.redactedAt && <span className="text-[12px] font-bold text-muted">page text removed</span>}
          </div>
          {domain.reasons.length > 0 && <div className="text-[12px] font-semibold text-muted">{domain.reasons.join(' · ')}</div>}
          {domain.errors.map((error) => (
            <div key={error} className="text-[13px] font-bold text-primary">{error}</div>
          ))}
          {domain.offers.map((offer, i) => (
            <div key={`${offer.title}-${i}`} className="bg-surface rounded-xl px-4 py-3 text-[13px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold">{offer.title}</span>
                <StatusPill status={offer.valid ? 'completed' : 'failed'} label={offer.valid ? 'valid' : 'invalid'} />
                <span className="text-muted font-semibold">{offer.offerType.replace(/_/g, ' ')}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-2">
                {Object.entries(offer.fields).map(([field, evidence]) => (
                  <div key={field} className="min-w-0">
                    <span className="font-bold">{field}</span>:{' '}
                    {evidence.text ? <span className="italic text-ink-soft">“{evidence.text}”</span> : <span className="text-muted">text removed</span>}
                    <div className="text-[11px] text-muted font-mono truncate">{evidence.method}</div>
                  </div>
                ))}
              </div>
              {offer.errors.length > 0 && <div className="text-primary font-bold mt-1">{offer.errors.join('; ')}</div>}
            </div>
          ))}
          {domain.canHandle && domain.offers.length === 0 && <div className="text-[13px] font-semibold text-muted">No offers found with these selectors.</div>}
          {domain.businesses.length > 0 && (
            <div className="text-[12px] font-semibold text-muted">
              Business: {domain.businesses.map((b) => [b.name, b.telephone, b.postcode].filter(Boolean).join(' · ') || b.branchPath).join(' | ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

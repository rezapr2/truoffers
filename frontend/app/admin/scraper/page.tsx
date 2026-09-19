'use client';

import Link from 'next/link';
import { useOverview } from './_components/overview';
import { Card } from './_components/ui';

export default function ScraperOverviewPage() {
  const { overview } = useOverview();
  if (!overview) return <div className="py-16 text-center text-muted font-bold">Loading…</div>;

  const bands = overview.openCandidatesByBand;
  const tiles = [
    {
      label: 'Offers awaiting review',
      value: overview.candidatesAwaitingReview,
      detail: `${bands.high ?? 0} high · ${bands.review_recommended ?? 0} review · ${bands.manual_investigation ?? 0} investigate`,
      href: '/admin/scraper/candidates',
    },
    { label: 'Branches to match to a listing', value: overview.branchesAwaitingMatch, href: '/admin/scraper/candidates?tab=matches' },
    { label: 'Domains awaiting authorisation', value: overview.domainsPendingAuthorisation, href: '/admin/scraper/websites?status=pending_authorisation' },
    { label: 'Held for provider review', value: overview.websitesAwaitingProviderReview, href: '/admin/scraper/websites?status=awaiting_provider_review' },
    {
      label: 'Imported offers needing a decision',
      value: (overview.importedOffers?.revision_pending ?? 0) + (overview.importedOffers?.expiry_review ?? 0),
      detail: `${overview.importedOffers?.revision_pending ?? 0} changed terms · ${overview.importedOffers?.expiry_review ?? 0} expiry review · ${overview.importedOffers?.possibly_removed ?? 0} possibly removed`,
      href: '/admin/scraper/offers',
    },
    { label: 'Removal requests to acknowledge', value: overview.unacknowledgedRemovalRequests, href: '/admin/scraper/policies' },
    {
      label: overview.halted ? 'Emergency stop active' : 'Workers online',
      value: overview.halted ? 'Stopped' : overview.workers,
      href: '/admin/scraper/jobs',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="bg-card border border-line rounded-2xl p-5 hover:shadow-lg transition-shadow">
            <div className="font-display text-3xl font-extrabold">{tile.value}</div>
            <div className="text-[13px] font-bold text-muted">{tile.label}</div>
            {tile.detail && <div className="text-[12px] font-semibold text-muted mt-1">{tile.detail}</div>}
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="font-display text-lg font-extrabold mb-3">How imports work</h2>
        <ol className="list-decimal pl-5 text-sm font-semibold text-ink-soft space-y-1.5">
          <li>Submit takeaway websites. Only domains you submit, or approve, are ever crawled.</li>
          <li>The worker checks permissions (never-crawl list, opt-outs, provider policy, robots.txt), then reads the site’s offer, menu and contact pages.</li>
          <li>Every extracted value carries its source excerpt. Nothing is published until you approve it or the business confirms it.</li>
          <li>Published offers are rechecked on a schedule: offers that disappear are hidden, changed terms wait for you under Imported offers.</li>
          <li>Removal requests unpublish a domain’s imported offers immediately and appear under Policies &amp; opt-outs.</li>
        </ol>
      </Card>
    </div>
  );
}

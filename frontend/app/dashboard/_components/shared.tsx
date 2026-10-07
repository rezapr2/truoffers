'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, btn, PageHeader, Spinner } from '@/components/ui';
import { useBusiness, type ManageData } from '@/lib/business-context';
import { date } from '@/lib/format';

export function DashboardPage({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-5 md:px-10 py-8 max-w-6xl w-full">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </div>
  );
}

/** Pages only owners can use (plan, promotions): staff see why instead. */
export function OwnerOnly({ children, pageTitle }: { children: ReactNode; pageTitle?: string }) {
  const { isOwner, manage, loading } = useBusiness();
  if (!manage) return loading ? <Spinner /> : null;
  if (!isOwner && manage.myRole !== 'staff_override') {
    const message = <Alert tone="info" title="Owners only">Ask an owner of the business to do this. Staff can post and edit offers and the profile.</Alert>;
    // Guarding a whole page: keep the page heading around the message
    return pageTitle ? <DashboardPage title={pageTitle}>{message}</DashboardPage> : message;
  }
  return <>{children}</>;
}

/** Spec dashboard home: "verification status banner with next step". */
export function VerificationBanner({ manage, compact = false }: { manage: ManageData; compact?: boolean }) {
  const { business, openClaim, pendingChanges } = manage;
  const level = business.verificationLevel;
  const link = (label: string) => (
    <Link href="/dashboard/verification" className={btn.small}>
      {label}
    </Link>
  );

  if (business.frozen || openClaim?.status === 'disputed') {
    return (
      <Alert tone="danger" title="Changes are paused" action={link('See details')}>
        Someone else has also proved access to the shop’s phone line. Our team is reviewing who runs the business.
      </Alert>
    );
  }
  if (level >= 2) {
    if (manage.reverificationDue) return <Alert tone="warning" title="Time to re-verify" action={link('Verify again')}>It has been a year since you were verified. Your badge stays while you confirm.</Alert>;
    if (pendingChanges.length) {
      const fields = [...new Set(pendingChanges.flatMap((c) => c.changes.map((f) => f.field.replace('orderUrl', 'order link'))))].join(', ');
      return <Alert tone="info" title="A change is waiting for a moderator">Your change to {fields} goes live once a moderator approves it. Your badge stays meanwhile.</Alert>;
    }
    if (compact) return null;
    return (
      <Alert tone="success" title="✓ TruOffers verified">
        Your offers can go live{manage.plan.autoApprove ? ' straight away' : ' after a quick check by our team'}.
        {!manage.plan.autoApprove && ' Upgrade to Standard to publish without waiting.'}
      </Alert>
    );
  }
  if (!openClaim || ['rejected', 'expired', 'withdrawn'].includes(openClaim.status)) {
    return (
      <Alert tone="warning" title="Not verified yet" action={link('Start verification')}>
        {openClaim?.status === 'rejected' ? `Your last claim was not approved${openClaim.notes ? `: ${openClaim.notes}` : '.'} ` : ''}
        Verify that you run the business to put offers live, choose a plan and promote.
      </Alert>
    );
  }
  if (openClaim.status === 'info_requested') {
    return (
      <Alert tone="warning" title="We need a little more information" action={link('Add information')}>
        Please reply by {date(openClaim.expiresAt)} or the claim will close.
      </Alert>
    );
  }
  if (openClaim.status === 'pending') {
    return (
      <Alert tone="info" title="Verification in review">
        A moderator is checking your evidence, usually within 1 working day. You can edit your profile and save offers as drafts; they go live once you are verified.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={openClaim.phoneOtpPassed ? 'Add your evidence and submit' : 'Finish the phone check'} action={link('Continue')}>
      {openClaim.phoneOtpPassed
        ? 'You proved the shop phone line. Add one more piece of evidence and submit it for review.'
        : 'We send a code to the phone number on your listing to prove you run the shop.'}
    </Alert>
  );
}

/** "3 of 5 live offers", with the upgrade prompt when the limit is reached. */
export function PlanUsage({ manage }: { manage: ManageData }) {
  const max = manage.plan.limits.maxLiveOffers;
  const used = manage.usage.liveOffers;
  const unlimited = max < 0;
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-sm font-bold">
          {manage.plan.name} plan · {unlimited ? `${used} live offers (unlimited)` : `${used} of ${max} live offers used`}
        </span>
        {manage.myRole === 'owner' && (
          <Link href="/dashboard/billing" className="text-[13px] font-bold text-primary">
            {unlimited ? 'Manage plan' : 'Upgrade'}
          </Link>
        )}
      </div>
      <div className="h-2 bg-page rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${!unlimited && used >= max ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function UpgradeHint({ children }: { children: ReactNode }) {
  const { isOwner } = useBusiness();
  return (
    <Alert tone="warning" action={isOwner ? <Link href="/dashboard/billing" className={btn.small}>See plans</Link> : undefined}>
      {children}
    </Alert>
  );
}

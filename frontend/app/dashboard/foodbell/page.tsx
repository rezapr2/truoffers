'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { dateTime, money, plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { Alert, btn, Card, Feedback, Field, inputClass, SectionTitle, Spinner, StatStrip, StatusPill } from '@/components/ui';
import { CheckIcon, OffersIcon, PricingIcon, TruckIcon } from '@/components/icons';
import { DashboardPage } from '../_components/shared';

interface Summary {
  at: string;
  menuItems: number;
  offers: { created: number; updated: number; unchanged: number; ended: number };
  skipped: { id: string; title?: string; reason: string }[];
  differences: { field: string; listing: string | null; foodbell: string | null }[];
}

interface FoodbellStatus {
  configured: boolean;
  connection: {
    storeId: string;
    domain: string | null;
    status: 'connected' | 'disconnected';
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    summary: Summary | null;
  } | null;
  offers: { _id: string; title: string; displayLabel: string; status: string; moderationFlags?: string[]; submitWhenVerified?: boolean }[];
  last30Days: { orders: number; revenue: number };
}

// Why Foodbell kept a deal back (backend/services/truoffersSnapshot.js in Foodbell). Reasons from TruOffers'
// side (plan limits, coupon codes) arrive as sentences.
const SKIP_REASONS: Record<string, string> = {
  personal: 'Made for one customer (a game prize or automated offer)',
  loyalty: 'Loyalty points',
  returning_only: 'For returning customers only',
  expired: 'Expired',
  ended: 'Ended',
  used_up: 'Used up',
  inactive: 'Switched off',
  unsupported_type: 'A kind of deal TruOffers can’t show yet',
  no_discount: 'No discount set',
  not_published: 'You chose not to show it on TruOffers',
};

const FIELD_LABELS: Record<string, string> = { name: 'Name', address: 'Address', postcode: 'Postcode', town: 'Town', phone: 'Phone' };

export default function FoodbellPage() {
  const { business, manage, isOwner, reload: reloadBusiness } = useBusiness();
  const { data, reload } = useApi<FoodbellStatus>(business ? `/businesses/${business._id}/foodbell` : null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!business || !manage || !data) return <Spinner />;
  const canManage = isOwner || manage.myRole === 'staff_override';
  const connection = data.connection?.status === 'connected' ? data.connection : null;

  async function run(action: 'connect' | 'sync' | 'disconnect') {
    if (action === 'disconnect' && !confirm('Disconnect Foodbell? Your synced deals end on TruOffers. Your listing, menu and details stay.')) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await api(`/businesses/${business!._id}/foodbell/${action}`, { method: 'POST', body: JSON.stringify(action === 'connect' ? { code: code.trim() } : {}) });
      setNotice(action === 'connect' ? 'Connected. Your Foodbell menu and deals are on TruOffers.' : action === 'sync' ? 'Synced with Foodbell.' : 'Disconnected from Foodbell.');
      setCode('');
      await reload();
      await reloadBusiness();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardPage
      title="Foodbell"
      subtitle="Show your Foodbell menu, deals and opening hours on TruOffers, kept up to date for you."
      actions={
        connection && canManage ? (
          <>
            <button className={btn.secondary} disabled={!!busy} onClick={() => run('sync')}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button className={btn.danger} disabled={!!busy} onClick={() => run('disconnect')}>
              Disconnect
            </button>
          </>
        ) : undefined
      }
    >
      <Feedback error={error} notice={notice} className="mb-5" />
      {!data.configured && !connection && (
        <Alert tone="info" className="mb-5">
          Connecting to Foodbell isn’t available just yet. Please check back soon.
        </Alert>
      )}

      {connection ? <Connected status={data} connection={connection} /> : <NotConnected status={data} canManage={canManage} code={code} setCode={setCode} busy={busy === 'connect'} onConnect={() => run('connect')} />}
    </DashboardPage>
  );
}

function NotConnected({
  status,
  canManage,
  code,
  setCode,
  busy,
  onConnect,
}: {
  status: FoodbellStatus;
  canManage: boolean;
  code: string;
  setCode: (code: string) => void;
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <Card>
        {status.connection?.status === 'disconnected' && (
          <Alert tone="warning" className="mb-5">
            Foodbell was disconnected{status.connection.lastSyncAt ? ` after the last sync on ${dateTime(status.connection.lastSyncAt)}` : ''}. Connect again with a new code.
          </Alert>
        )}
        <SectionTitle>Connect your Foodbell site</SectionTitle>
        <ol className="flex flex-col gap-3 text-[15px] mb-6">
          <Step n={1}>
            In your{' '}
            <a href="https://partners.foodbell.co.uk" target="_blank" rel="noopener noreferrer" className="font-bold text-primary">
              Foodbell dashboard
            </a>
            , open <b>Site settings → TruOffers</b>.
          </Step>
          <Step n={2}>Click <b>Connect to TruOffers</b> and copy the code. It works for 30 minutes.</Step>
          <Step n={3}>Paste it here.</Step>
        </ol>
        {canManage ? (
          <form
            className="flex flex-col sm:flex-row gap-3 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              onConnect();
            }}
          >
            <Field label="Connection code" className="flex-1">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" autoComplete="off" spellCheck={false} maxLength={20} className={`${inputClass} font-mono tracking-widest`} />
            </Field>
            <button type="submit" className={btn.primary} disabled={busy || code.trim().length < 6 || !status.configured}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
        ) : (
          <Alert tone="info" title="Owners only">Ask an owner of the business to connect Foodbell.</Alert>
        )}
      </Card>
      <Card>
        <SectionTitle>What stays in sync</SectionTitle>
        <ul className="flex flex-col gap-2.5 text-[14px]">
          <Synced>Your menu and prices</Synced>
          <Synced>The deals you choose in Foodbell, as TruOffers offers</Synced>
          <Synced>Opening hours, delivery and collection</Synced>
          <Synced>Your order link, so customers order on your own site</Synced>
          <Synced>Orders customers place after finding you here, in your insights. No customer details are shared.</Synced>
        </ul>
        <p className="text-[12.5px] text-muted mt-4">Your name, address and phone stay as verified on TruOffers; we point out where Foodbell differs.</p>
      </Card>
    </div>
  );
}

function Connected({ status, connection }: { status: FoodbellStatus; connection: NonNullable<FoodbellStatus['connection']> }) {
  const summary = connection.summary;
  const live = status.offers.filter((o) => ['active', 'scheduled'].includes(o.status)).length;
  return (
    <>
      {connection.lastSyncError && (
        <Alert tone="warning" title="The last sync didn’t finish" className="mb-5">
          {connection.lastSyncError} We’ll try again shortly, or use Sync now.
        </Alert>
      )}
      <StatStrip
        stats={[
          { icon: CheckIcon, tint: 'mint', label: 'Connection', value: 'Active' },
          { icon: OffersIcon, tint: 'blue', label: 'Synced deals live', value: live },
          { icon: TruckIcon, tint: 'peach', label: 'Foodbell orders (30 days)', value: status.last30Days.orders },
          { icon: PricingIcon, tint: 'lilac', label: 'Order value (30 days)', value: money(status.last30Days.revenue) },
        ]}
      />
      <p className="text-[13px] text-muted mt-3">
        Connected{connection.domain ? ` to ${connection.domain}` : ''} {dateTime(connection.connectedAt)} · last synced {dateTime(connection.lastSyncAt)}
        {summary ? ` · ${plural(summary.menuItems, 'menu item')}` : ''}. Changes you make in Foodbell show here within a minute.
      </p>

      <section className="mt-8">
        <SectionTitle aside={<Link href="/dashboard/offers" className={btn.small}>My offers</Link>}>Deals from Foodbell</SectionTitle>
        {status.offers.length === 0 ? (
          <p className="text-sm text-muted">No deals yet. Deals you switch on in Foodbell’s TruOffers page show up here.</p>
        ) : (
          <div className="border border-line rounded-3xl overflow-hidden">
            {status.offers.map((offer) => (
              <div key={offer._id} className="flex items-center gap-3 px-5 py-3.5 border-t border-line first:border-t-0 flex-wrap">
                <span className="font-display font-extrabold text-primary">{offer.displayLabel}</span>
                <span className="font-bold flex-1 min-w-0 truncate">{offer.title}</span>
                {offer.status === 'draft' && offer.submitWhenVerified && <span className="text-[12.5px] text-muted">Goes live once you’re verified</span>}
                {offer.status === 'pending' && <span className="text-[12.5px] text-muted">A moderator is checking it</span>}
                <StatusPill status={offer.status} />
              </div>
            ))}
          </div>
        )}
        <p className="text-[12.5px] text-muted mt-3">To change a deal, or stop showing it here, edit it in Foodbell. You can pause one on TruOffers from My offers.</p>
      </section>

      {summary && summary.skipped.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Not shown on TruOffers</SectionTitle>
          <ul className="flex flex-col gap-2 text-sm">
            {summary.skipped.map((s) => (
              <li key={s.id} className="flex flex-col sm:flex-row sm:gap-2">
                <span className="font-bold">{s.title ?? 'A Foodbell deal'}:</span>
                <span className="text-muted">{SKIP_REASONS[s.reason] ?? s.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary && summary.differences.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Details that differ</SectionTitle>
          <p className="text-[13px] text-muted mb-3">Your verified details stay as they are. If Foodbell is right, change them in your profile and a moderator checks the change.</p>
          <div className="border border-line rounded-3xl overflow-hidden text-sm">
            {summary.differences.map((d) => (
              <div key={d.field} className="grid sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:gap-4 px-5 py-3 border-t border-line first:border-t-0">
                <span className="font-extrabold">{FIELD_LABELS[d.field] ?? d.field}</span>
                <span>
                  <span className="text-muted">TruOffers:</span> {d.listing ?? '—'}
                </span>
                <span>
                  <span className="text-muted">Foodbell:</span> {d.foodbell ?? '—'}
                </span>
              </div>
            ))}
          </div>
          <Link href="/dashboard/profile" className={`${btn.small} mt-3`}>
            Business profile
          </Link>
        </section>
      )}
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="w-7 h-7 rounded-full bg-tint-blue text-primary font-extrabold text-sm flex items-center justify-center flex-none">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function Synced({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <CheckIcon className="w-4 h-4 text-verified flex-none mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

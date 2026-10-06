'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import type { Notification } from '@/lib/types';
import { btn, EmptyState, Spinner } from '@/components/ui';
import { BellIcon } from '@/components/icons';
import { DashboardPage } from '../_components/shared';

export default function NotificationsPage() {
  const { data, reload } = useApi<Notification[]>('/notifications');
  if (!data) return <Spinner />;
  const unread = data.filter((n) => !n.readAt);
  return (
    <DashboardPage
      title="Notifications"
      subtitle="Offer approvals, plan renewals, promotions ending, new followers and messages from our team."
      actions={
        unread.length > 0 ? (
          <button className={btn.secondary} onClick={() => api('/notifications/read', { method: 'POST', body: JSON.stringify({}) }).then(reload)}>
            Mark all as read
          </button>
        ) : undefined
      }
    >
      {data.length === 0 ? (
        <EmptyState title="Nothing yet">We’ll let you know when offers are approved, plans renew or promotions end.</EmptyState>
      ) : (
        <ul className="border border-line rounded-3xl overflow-hidden">
          {data.map((n) => (
            <li key={n._id} className={`flex gap-4 px-5 py-4 border-t border-line first:border-t-0 ${n.readAt ? '' : 'bg-tint-blue/40'}`}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-none ${n.readAt ? 'bg-surface text-muted' : 'bg-primary text-white'}`}>
                <BellIcon className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold">{n.title}</div>
                {n.body && <div className="text-sm text-ink-soft mt-0.5">{n.body}</div>}
                <div className="text-[12px] text-muted mt-1">{dateTime(n.createdAt)}</div>
              </div>
              {n.link && (
                <Link
                  href={n.link}
                  onClick={() => !n.readAt && void api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [n._id] }) })}
                  className={`${btn.small} self-center`}
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </DashboardPage>
  );
}

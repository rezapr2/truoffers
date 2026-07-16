'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function FollowButton({ businessId }: { businessId: string }) {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const following = user?.followedBusinesses.includes(businessId) ?? false;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      router.push('/login');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await api('/users/me/follow', {
        method: 'POST',
        body: JSON.stringify({ businessId }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`text-[12px] font-extrabold px-3 py-1 rounded-full border-[1.5px] border-primary transition-colors cursor-pointer flex-none ${
        following ? 'bg-primary text-cream' : 'text-primary hover:bg-primary hover:text-cream'
      }`}
    >
      {following ? 'Following' : '+ Follow'}
    </button>
  );
}

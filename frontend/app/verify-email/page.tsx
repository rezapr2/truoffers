'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from '@/components/ui';

function VerifyInner() {
  const params = useSearchParams();
  const { user, refresh } = useAuth();
  const token = params.get('token');
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to verify without a token
      setState('failed');
      setMessage('This link is missing its code.');
      return;
    }
    api('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then(async () => {
        setState('done');
        await refresh();
      })
      .catch((err) => {
        setState('failed');
        setMessage(errorMessage(err));
      });
  }, [token, refresh]);

  if (state === 'checking') return <Spinner label="Confirming your email…" />;
  return (
    <div className="mx-auto max-w-md px-5 py-20 text-center">
      <div className="text-5xl mb-4">{state === 'done' ? '✅' : '⚠️'}</div>
      <h1 className="font-display text-2xl font-extrabold mb-2">{state === 'done' ? 'Email confirmed' : 'We couldn’t confirm your email'}</h1>
      <p className="text-muted mb-7">{state === 'done' ? 'Thanks. You can now claim your business and get offer alerts.' : message}</p>
      <Link href={user && ['business_owner', 'business_staff'].includes(user.role) ? '/claim-your-business' : '/'} className="btn-soft font-bold px-7 py-3 rounded-2xl">
        Continue
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}

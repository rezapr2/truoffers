'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function Unsubscribe() {
  const params = useSearchParams();
  const [state, setState] = useState<{ done?: boolean; error?: string }>({});
  const channel = params.get('c') === 'sms' ? 'sms' : 'email';

  useEffect(() => {
    const body = { u: params.get('u') ?? undefined, s: params.get('s') ?? undefined, c: channel };
    void api('/users/unsubscribe', { method: 'POST', body: JSON.stringify(body) })
      .then(() => setState({ done: true }))
      .catch((err) => setState({ error: errorMessage(err) }));
  }, [params, channel]);

  return (
    <div className="mx-auto max-w-xl px-5 md:px-10 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-6">Unsubscribe</h1>
      {!state.done && !state.error && <Spinner label="Updating your preferences…" />}
      {state.done && (
        <Alert tone="success" title="You’re unsubscribed">
          We won’t send you offers and news by {channel === 'sms' ? 'text' : 'email'} any more. Emails about your account, such as password resets, still arrive.
        </Alert>
      )}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <p className="text-sm text-muted mt-6">
        Changed your mind? Turn it back on from <Link href="/account" className="text-primary font-bold">your account</Link>.
      </p>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Unsubscribe />
    </Suspense>
  );
}

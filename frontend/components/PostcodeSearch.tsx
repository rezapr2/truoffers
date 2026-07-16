'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { track } from '@/lib/analytics';

export default function PostcodeSearch({
  size = 'lg',
  defaultValue = '',
}: {
  size?: 'lg' | 'sm';
  defaultValue?: string;
}) {
  const router = useRouter();
  const [postcode, setPostcode] = useState(defaultValue);
  const [locating, setLocating] = useState(false);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const pc = postcode.trim();
    if (!pc) return;
    track('postcode_search', { postcodeArea: pc.split(' ')[0].toUpperCase() });
    router.push(`/offers?postcode=${encodeURIComponent(pc)}`);
  }

  function useLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        track('postcode_search', { metadata: { method: 'geolocation' } });
        router.push(`/offers?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  return (
    <div>
      <form
        onSubmit={submit}
        className={`flex gap-2 bg-cream rounded-full items-center ${
          size === 'lg' ? 'p-1.5 pl-6 max-w-xl' : 'p-1 pl-4 max-w-md'
        }`}
      >
        <span className="w-2.5 h-2.5 border-[2.5px] border-primary rounded-full flex-none" />
        <input
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="Your postcode — e.g. M14 5TQ"
          className={`flex-1 min-w-0 border-none outline-none font-bold text-ink bg-transparent ${
            size === 'lg' ? 'text-base' : 'text-sm'
          }`}
        />
        <button
          type="submit"
          className={`bg-ink text-cream font-bold rounded-full cursor-pointer hover:bg-primary-dark transition-colors flex-none ${
            size === 'lg' ? 'text-[15px] px-6 py-3.5' : 'text-sm px-4 py-2.5'
          }`}
        >
          Find offers
        </button>
      </form>
      <button
        onClick={useLocation}
        disabled={locating}
        className="mt-3.5 text-sm font-bold text-peach-2 hover:text-cream cursor-pointer disabled:opacity-60"
      >
        {locating ? 'Locating…' : 'Use my current location'}
      </button>
    </div>
  );
}

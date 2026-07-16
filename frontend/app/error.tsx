'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <div className="text-5xl mb-4">🍕</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-3">
        Something went wrong
      </h1>
      <p className="text-muted font-semibold mb-2">
        That wasn&apos;t supposed to happen. The kitchen has been notified.
      </p>
      {error.digest && (
        <p className="text-[12px] font-semibold text-muted mb-6">Error reference: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="bg-ink text-surface font-bold px-8 py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}

export const metadata = { title: 'Privacy policy — TruOffers' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-6">Privacy policy</h1>
      <div className="text-[15px] font-semibold text-ink-soft leading-relaxed space-y-4">
        <p>
          We collect the minimum data needed to run TruOffers: account details you provide, the
          postcodes you search, and anonymous usage events (offer views, clicks) that power business
          analytics.
        </p>
        <p>
          We never sell personal data. Aggregated, anonymised trends (e.g. “demand for pizza in M14”)
          may be shared with listed businesses and suppliers.
        </p>
        <p>
          You can request deletion of your account and data at any time via
          support@truoffers.co.uk, in line with UK GDPR.
        </p>
        <p className="text-muted">
          Placeholder policy for the MVP — replace with a reviewed policy before public launch.
        </p>
      </div>
    </div>
  );
}

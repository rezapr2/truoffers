export const metadata = { title: 'Terms of use — TruOffers' };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-6">Terms of use</h1>
      <div className="text-[15px] font-semibold text-ink-soft leading-relaxed space-y-4">
        <p>
          TruOffers.co.uk is a discovery platform. Offers are created and honoured by the listed
          businesses; TruOffers does not process orders or payments for food.
        </p>
        <p>
          Businesses are responsible for the accuracy of their offers, including terms, expiry dates
          and minimum spends. Misleading offers are removed and repeat offenders suspended, in line
          with ASA guidance on promotional marketing.
        </p>
        <p>
          Business subscriptions renew automatically and can be cancelled at any time from the
          dashboard; access continues to the end of the paid period.
        </p>
        <p className="text-muted">
          This is placeholder legal copy for the MVP — replace with solicitor-reviewed terms before
          public launch.
        </p>
      </div>
    </div>
  );
}

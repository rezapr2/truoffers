export const metadata = { title: 'Contact — TruOffers' };

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-6">Contact us</h1>
      <div className="grid gap-4">
        {[
          ['💬 Support', 'Claim disputes, duplicate listings, account help', 'support@truoffers.co.uk'],
          ['📈 Sales', 'Plans, featured placement, supplier sponsorship', 'sales@truoffers.co.uk'],
          ['🤝 Partnerships', 'Foodbell integration, franchises, media', 'partners@truoffers.co.uk'],
        ].map(([title, desc, email]) => (
          <div key={email} className="bg-card rounded-3xl p-7">
            <h2 className="font-display text-lg font-extrabold mb-1">{title}</h2>
            <p className="text-sm font-semibold text-muted mb-3">{desc}</p>
            <a href={`mailto:${email}`} className="text-primary font-bold">
              {email}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { useApi, useDebounced } from '@/lib/hooks';
import { ukDateInputValue } from '@/lib/dates';
import { date, money } from '@/lib/format';
import type { Category, Offer, PromotionBooking, PromotionProduct } from '@/lib/types';
import { Alert, btn, Card, Field, inputClass, SectionTitle, Spinner, StatusPill, Toggle } from '@/components/ui';
import { DashboardPage, OwnerOnly } from '../_components/shared';

interface Data {
  items: PromotionBooking[];
  products: PromotionProduct[];
  credits: { allowance: number; used: number; left: number };
  business: { town?: string; postcodeArea?: string; categories: string[] };
}

interface Availability {
  available: boolean;
  used: number;
  slots: number;
  startsAt: string;
  endsAt: string;
  price: { amount: number; vat: number; total: number; vatRatePercent: number };
  calendar: { date: string; taken: number; free: number }[];
  nextFreeDate: string | null;
}

const UNIT_LABELS: Record<string, [string, string]> = { day: ['day', 'days'], week: ['week', 'weeks'], deal: ['deal (48 h)', 'deals'] };

function PromoteInner() {
  const { business, manage } = useBusiness();
  const params = useSearchParams();
  const { data, reload } = useApi<Data>(business ? `/businesses/${business._id}/promotions` : null);
  const { data: offerData } = useApi<{ offers: Offer[] }>(business ? `/businesses/${business._id}/offers/manage?tab=live` : null);
  const { data: scheduled } = useApi<{ offers: Offer[] }>(business ? `/businesses/${business._id}/offers/manage?tab=scheduled` : null);
  const { data: categories } = useApi<Category[]>('/categories');
  const [productKey, setProductKey] = useState<PromotionProduct['key']>('top_of_search');
  const [offerId, setOfferId] = useState(params.get('offer') ?? '');
  const [area, setArea] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [startsAt, setStartsAt] = useState(ukDateInputValue(new Date()));
  const [unit, setUnit] = useState('week');
  const [quantity, setQuantity] = useState(1);
  const [useCredit, setUseCredit] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get('checkout') === 'success' ? 'Payment received. Your promotion switches on as soon as Stripe confirms it.' : null);
  const [busy, setBusy] = useState(false);

  const offers = useMemo(() => [...(offerData?.offers ?? []), ...(scheduled?.offers ?? [])], [offerData, scheduled]);
  const product = data?.products.find((p) => p.key === productKey);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- defaults come from the loaded business
    if (data && !area) setArea(data.business.postcodeArea ?? '');
    if (data && !categoryId && data.business.categories[0]) setCategoryId(String(data.business.categories[0]));
  }, [data, area, categoryId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the unit valid for the chosen product
    if (product && !product.prices.some((p) => p.unit === unit)) setUnit(product.prices[0].unit);
  }, [product, unit]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first live offer is the default
    if (!offerId && offers[0]) setOfferId(offers[0]._id);
  }, [offers, offerId]);

  const query = useDebounced(
    product
      ? new URLSearchParams({
          productKey,
          startsAt,
          unit,
          quantity: String(quantity),
          ...(product.scope === 'area' ? { area } : {}),
          ...(product.scope === 'category_city' ? { categoryId, city: data?.business.town ?? '' } : {}),
        }).toString()
      : '',
    350,
  );

  useEffect(() => {
    if (!query) return;
    let live = true;
    api<Availability>(`/promotions/availability?${query}`)
      .then((a) => {
        if (!live) return;
        setAvailability(a);
        setCheckError(null);
      })
      .catch((err) => {
        if (!live) return;
        setAvailability(null);
        setCheckError(errorMessage(err));
      });
    return () => {
      live = false;
    };
  }, [query]);

  if (!business || !manage || !data) return <Spinner />;
  const verified = business.verificationLevel >= 2;
  const canUseCredit = data.credits.left > 0 && productKey === 'top_of_search' && unit === 'week' && quantity === 1;
  const myCategories = (categories ?? []).filter((c) => data.business.categories.map(String).includes(c._id));

  async function book() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ mode: string; url?: string }>(`/businesses/${business!._id}/promotions`, {
        method: 'POST',
        body: JSON.stringify({
          offerId,
          productKey,
          startsAt,
          unit,
          quantity,
          useCredit: useCredit && canUseCredit,
          ...(product?.scope === 'area' ? { area } : {}),
          ...(product?.scope === 'category_city' ? { categoryId, city: data!.business.town } : {}),
        }),
      });
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      setNotice(res.mode === 'credit' ? 'Booked with your free Top-of-search week.' : 'Booked and paid (demo mode). Your promotion is labelled “Promoted” on the site.');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardPage title="Promote" subtitle="Put a live offer in front of more customers. Promoted offers are labelled “Promoted”.">
      <OwnerOnly>
        <div className="flex flex-col gap-6">
          {!verified && <Alert tone="warning" title="Promotions are for verified takeaways" action={<Link className={btn.small} href="/dashboard/verification">Verification</Link>}>Verify your business first.</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          {data.credits.allowance > 0 && (
            <Alert tone="info">
              Your {manage.plan.name} plan includes {data.credits.allowance} free Top-of-search week a month. {data.credits.left > 0 ? 'You have one to use this month.' : 'You’ve used this month’s.'}
            </Alert>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.products.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setProductKey(p.key)}
                className={`text-left rounded-2xl border p-4 cursor-pointer transition-colors ${productKey === p.key ? 'border-primary bg-tint-blue' : 'border-line hover:border-primary'}`}
              >
                <div className="font-extrabold">{p.name}</div>
                <div className="text-[12.5px] text-muted mb-2">{p.description}</div>
                <div className="text-sm font-bold">{p.prices.map((pr) => `${money(pr.price)}/${UNIT_LABELS[pr.unit]?.[0] ?? pr.unit}`).join(' or ')}</div>
                <div className="text-[12px] text-muted">{p.slots} slot{p.slots === 1 ? '' : 's'} {p.scope === 'area' ? 'per area' : p.scope === 'category_city' ? 'per cuisine per city' : 'site-wide'}</div>
              </button>
            ))}
          </div>

          {offers.length === 0 ? (
            <Alert tone="info" action={<Link href="/dashboard/offers/new" className={btn.small}>Post an offer</Link>}>Promote unlocks once you have a live offer.</Alert>
          ) : (
            product && (
              <Card className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
                <div className="flex flex-col gap-4">
                  <Field label="Offer">
                    <select value={offerId} onChange={(e) => setOfferId(e.target.value)} className={inputClass}>
                      {offers.map((o) => (
                        <option key={o._id} value={o._id}>
                          {o.displayLabel} — {o.title}
                          {o.status === 'scheduled' ? ' (scheduled)' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {product.scope === 'area' && (
                    <Field label="Postcode area" hint="The first part of a postcode, e.g. M14. You show in the first 3 results for searches there.">
                      <input value={area} onChange={(e) => setArea(e.target.value.toUpperCase().replace(/\s+/g, ''))} className={`${inputClass} max-w-[160px]`} />
                    </Field>
                  )}
                  {product.scope === 'category_city' && (
                    <Field label="Cuisine" hint={`Top of the cuisine’s results in ${data.business.town ?? 'your town'}.`}>
                      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
                        {myCategories.map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Field label="Start">
                      <input type="date" value={startsAt} min={ukDateInputValue(new Date())} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Length">
                      <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
                        {product.prices.map((pr) => (
                          <option key={pr.unit} value={pr.unit}>
                            By the {UNIT_LABELS[pr.unit]?.[0] ?? pr.unit}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="How many">
                      <input type="number" min={1} max={unit === 'day' ? 30 : 8} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className={inputClass} />
                    </Field>
                  </div>
                  {data.credits.allowance > 0 && productKey === 'top_of_search' && (
                    <Toggle checked={useCredit && canUseCredit} disabled={!canUseCredit} onChange={setUseCredit} label="Use my free Top-of-search week" hint={canUseCredit ? 'One week, no charge.' : 'Available for one week of Top of search.'} />
                  )}
                </div>
                <aside className="bg-surface rounded-2xl p-5 flex flex-col gap-3">
                  {checkError ? (
                    <Alert tone="warning">{checkError}</Alert>
                  ) : availability ? (
                    <>
                      <div className={`font-extrabold ${availability.available ? 'text-verified' : 'text-danger'}`}>
                        {availability.available ? '✓ Slot free' : 'Fully booked for those dates'}
                      </div>
                      <div className="text-[13px] text-muted">
                        {date(availability.startsAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {date(availability.endsAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {availability.used} of {availability.slots} slots taken
                      </div>
                      {!availability.available && availability.nextFreeDate && (
                        <button className={btn.small} onClick={() => setStartsAt(availability.nextFreeDate!)}>
                          Try {date(availability.nextFreeDate, { day: 'numeric', month: 'short' })}
                        </button>
                      )}
                      <div className="grid grid-cols-7 gap-1 mt-1" aria-label="Free slots over the next 4 weeks">
                        {availability.calendar.map((d) => (
                          <button
                            key={d.date}
                            title={`${d.date}: ${d.free} free`}
                            onClick={() => setStartsAt(d.date)}
                            className={`h-7 rounded-md text-[10px] font-bold cursor-pointer ${d.date === startsAt ? 'ring-2 ring-primary' : ''} ${d.free === 0 ? 'bg-danger/15 text-danger' : 'bg-verified/15 text-verified'}`}
                          >
                            {Number(d.date.slice(8))}
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-line pt-3 text-sm">
                        {useCredit && canUseCredit ? (
                          <div className="font-extrabold">Free with your plan</div>
                        ) : (
                          <>
                            <div className="flex justify-between"><span>Price</span><span>{money(availability.price.amount)}</span></div>
                            <div className="flex justify-between text-muted"><span>VAT ({availability.price.vatRatePercent}%)</span><span>{money(availability.price.vat)}</span></div>
                            <div className="flex justify-between font-extrabold mt-1"><span>Total</span><span>{money(availability.price.total)}</span></div>
                          </>
                        )}
                      </div>
                      <button className={btn.primary} disabled={busy || !availability.available || !verified || !offerId} onClick={book}>
                        {busy ? 'Booking…' : useCredit && canUseCredit ? 'Book free week' : 'Pay by card'}
                      </button>
                    </>
                  ) : (
                    <Spinner label="Checking slots…" />
                  )}
                </aside>
              </Card>
            )
          )}

          <section>
            <SectionTitle>Your promotions</SectionTitle>
            {data.items.length === 0 ? (
              <p className="text-sm text-muted">No promotions yet.</p>
            ) : (
              <div className="border border-line rounded-3xl overflow-hidden">
                {data.items.map((p) => (
                  <div key={p._id} className="flex items-center gap-4 px-5 py-3 border-t border-line first:border-t-0 text-sm flex-wrap">
                    <span className="font-bold w-40">{data.products.find((x) => x.key === p.productKey)?.name ?? p.productKey}</span>
                    <span className="flex-1 min-w-0 truncate">{typeof p.offerId === 'object' ? p.offerId.title : ''}</span>
                    <span className="text-muted">{p.scope.area ?? (typeof p.scope.categoryId === 'object' ? `${p.scope.categoryId.name}, ${p.scope.city}` : '')}</span>
                    <span className="text-muted">{date(p.startsAt, { day: 'numeric', month: 'short' })} – {date(p.endsAt, { day: 'numeric', month: 'short' })}</span>
                    <span className="font-bold">{p.source === 'plan_credit' ? 'Free (plan)' : p.source === 'admin_grant' ? 'Gift' : money(p.price)}</span>
                    <StatusPill status={p.status} />
                    {p.status === 'pending_payment' && (
                      <button className={btn.small} onClick={() => api(`/promotions/${p._id}/cancel`, { method: 'POST' }).then(reload)}>
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </OwnerOnly>
    </DashboardPage>
  );
}

export default function PromotePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PromoteInner />
    </Suspense>
  );
}

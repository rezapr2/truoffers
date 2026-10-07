'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, ApiError, assetUrl, upload } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useBusiness } from '@/lib/business-context';
import { ukDateInputValue } from '@/lib/dates';
import type { Offer } from '@/lib/types';
import { Alert, btn, Card, Field, inputClass, Toggle } from '@/components/ui';
import { CheckIcon, UploadIcon } from '@/components/icons';
import VerifiedBadge from '@/components/VerifiedBadge';
import { REDEEM_LABELS, WEEKDAY_LABELS } from './offer-meta';
import { UpgradeHint } from './shared';

const TYPES = [
  { value: 'percent', label: '% off', hint: 'e.g. 20% off orders over £15', icon: '％' },
  { value: 'fixed', label: '£ off', hint: 'e.g. £5 off your first order', icon: '£' },
  { value: 'bogof', label: '2-for-1', hint: 'Buy one, get one free', icon: '2×' },
  { value: 'free_item', label: 'Freebie', hint: 'e.g. free garlic bread', icon: '🎁' },
  { value: 'meal_deal', label: 'Meal deal', hint: 'A bundle at a set price', icon: '🍱' },
  { value: 'custom', label: 'Other', hint: 'Anything else', icon: '✦' },
] as const;

const REDEEM = [
  { value: 'direct_link', hint: 'Customers tap through to your ordering page' },
  { value: 'code', hint: 'Customers copy a code to use when they order or call' },
  { value: 'phone', hint: 'Customers call and mention TruOffers' },
  { value: 'show_in_store', hint: 'Customers show the offer on their phone in the shop' },
] as const;

const STEPS = ['Offer type', 'Details', 'How to redeem', 'Schedule'] as const;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface FormState {
  discountType: string;
  value: string;
  title: string;
  description: string;
  terms: string;
  minOrder: string;
  imageUrl: string;
  displayLabel: string;
  redemptionType: string;
  code: string;
  redemptionUrl: string;
  startsAt: string;
  endsAt: string;
  ongoing: boolean;
  eligibleWeekdays: string[];
  dailyStartTime: string;
  dailyEndTime: string;
  maxRedemptions: string;
  delivery: boolean;
  collection: boolean;
  newCustomersOnly: boolean;
}

function fromOffer(offer?: Offer): FormState {
  return {
    discountType: offer?.discountType ?? 'percent',
    value: offer?.value ? String(offer.value) : '',
    title: offer?.title ?? '',
    description: offer?.description ?? '',
    terms: offer?.terms ?? '',
    minOrder: offer?.minOrder ? String(offer.minOrder) : '',
    imageUrl: offer?.imageUrl ?? '',
    displayLabel: offer?.displayLabel ?? '',
    redemptionType: offer?.redemptionType ?? 'direct_link',
    code: offer?.code ?? '',
    redemptionUrl: offer?.redemptionUrl ?? '',
    startsAt: offer?.startsAt && new Date(offer.startsAt).getTime() > Date.now() ? ukDateInputValue(offer.startsAt) : '',
    endsAt: offer?.endsAt ? ukDateInputValue(offer.endsAt) : '',
    ongoing: !offer?.endsAt,
    eligibleWeekdays: offer?.eligibleWeekdays ?? [],
    dailyStartTime: offer?.dailyStartTime ?? '',
    dailyEndTime: offer?.dailyEndTime ?? '',
    maxRedemptions: offer?.maxRedemptions ? String(offer.maxRedemptions) : '',
    delivery: offer?.delivery ?? true,
    collection: offer?.collection ?? true,
    newCustomersOnly: offer?.newCustomersOnly ?? false,
  };
}

function autoLabel(f: FormState): string {
  const v = Number(f.value) || 0;
  switch (f.discountType) {
    case 'percent':
      return v ? `${v}% off` : '% off';
    case 'fixed':
      return v ? `£${v} off` : '£ off';
    case 'bogof':
      return '2 for 1';
    case 'free_item':
      return 'Freebie';
    case 'meal_deal':
      return v ? `Deal £${v}` : 'Meal deal';
    default:
      return 'Special offer';
  }
}

/** The card as customers will see it (spec: "Live preview card on the right"). */
function Preview({ form, businessName, level, orderUrl }: { form: FormState; businessName: string; level: number; orderUrl?: string }) {
  const label = form.displayLabel || autoLabel(form);
  const ends = form.ongoing || !form.endsAt ? 'Ongoing' : `Ends ${new Date(form.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const how =
    form.redemptionType === 'code'
      ? form.code || 'YOURCODE'
      : form.redemptionType === 'direct_link'
        ? `Order online${form.redemptionUrl || orderUrl ? '' : ' (add your order link)'}`
        : form.redemptionType === 'phone'
          ? 'Call and mention TruOffers'
          : 'Show this screen in store';
  return (
    <div className="lg:sticky lg:top-8">
      <div className="text-[12px] font-extrabold uppercase tracking-wide text-muted mb-2">Preview</div>
      <div className="bg-card border border-line rounded-3xl p-3 shadow-sm">
        <div className="relative h-36 rounded-2xl bg-sun-soft flex items-center justify-center px-4 text-center overflow-hidden">
          {form.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(form.imageUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : null}
          <span className={`relative font-display text-[32px] leading-none font-extrabold ${form.imageUrl ? 'bg-card/90 px-3 py-1.5 rounded-xl' : ''} text-brand-deep`}>{label}</span>
        </div>
        <div className="pt-3.5 px-1.5 pb-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-display font-extrabold text-[16px]">{businessName}</span>
            <VerifiedBadge level={level} className="text-[11px]" />
          </div>
          <div className="text-[13px] text-ink-soft mt-0.5">{form.title || 'Your offer title'}</div>
          <div className="text-[12px] text-muted mt-2">
            {ends}
            {form.eligibleWeekdays.length ? ` · ${form.eligibleWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}` : ''}
            {Number(form.minOrder) > 0 ? ` · Min order £${form.minOrder}` : ''}
          </div>
          <div className="mt-3 bg-brand-deep text-white rounded-2xl px-4 py-3 text-[13px]">
            <div className="text-[11px] font-bold text-sun uppercase tracking-wide">How to redeem</div>
            <div className="font-extrabold mt-0.5">{how}</div>
            {form.terms && <div className="text-leaf-soft/80 mt-1 line-clamp-2">{form.terms}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OfferEditor({ offer }: { offer?: Offer }) {
  const router = useRouter();
  const { business, manage, reload } = useBusiness();
  const [form, setForm] = useState<FormState>(() => fromOffer(offer));
  const [step, setStepState] = useState(0);
  // Ticks only for steps already looked at (an existing offer has been through them all)
  const [furthest, setFurthest] = useState(offer ? 3 : 0);
  const setStep = (next: number) => {
    setStepState(next);
    setFurthest((f) => Math.max(f, next));
  };
  const [busy, setBusy] = useState<'save' | 'submit' | 'photo' | 'ai' | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const flags = manage?.plan.flags;
  const verified = (business?.verificationLevel ?? 0) >= 2;
  const editingLive = offer && ['active', 'scheduled', 'pending', 'revision_pending'].includes(offer.status);
  const submitLabel = !verified
    ? 'Save — goes live once verified'
    : editingLive
      ? 'Save changes'
      : manage?.plan.autoApprove
        ? 'Publish offer'
        : 'Submit for review';

  const stepErrors = useMemo(() => {
    const errors: Record<number, string | null> = { 0: null, 1: null, 2: null, 3: null };
    if (['percent', 'fixed'].includes(form.discountType) && !(Number(form.value) > 0)) errors[0] = form.discountType === 'percent' ? 'Enter the percentage off' : 'Enter the amount off';
    if (form.title.trim().length < 4) errors[1] = 'Give the offer a title (at least 4 characters)';
    if (form.redemptionType === 'code' && !form.code.trim()) errors[2] = 'Enter the coupon code';
    if (form.redemptionType === 'direct_link' && !form.redemptionUrl.trim() && !business?.orderUrl) errors[2] = 'Add the link to your ordering page';
    if (!form.ongoing && !form.endsAt) errors[3] = 'Pick an end date, or make it ongoing';
    if (form.startsAt && !form.ongoing && form.endsAt && form.endsAt < form.startsAt) errors[3] = 'The end date must be after the start date';
    if ((form.dailyStartTime && !form.dailyEndTime) || (!form.dailyStartTime && form.dailyEndTime)) errors[3] = 'Set both times of the time window';
    return errors;
  }, [form, business?.orderUrl]);

  if (!business || !manage) return null;

  async function uploadPhoto(file: File) {
    setBusy('photo');
    setError(null);
    try {
      const res = await upload<{ url: string }>('/uploads/image', file);
      set('imageUrl', res.url);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(null);
    }
  }

  async function writeWithAi() {
    setBusy('ai');
    setError(null);
    try {
      const res = await api<{ copy: { title: string; description: string; terms: string; displayLabel: string } }>('/ai/offer-writer', {
        method: 'POST',
        body: JSON.stringify({ businessId: business!._id, discountType: form.discountType, value: Number(form.value) || undefined, minOrder: Number(form.minOrder) || undefined, brief: form.title || undefined }),
      });
      setForm((f) => ({ ...f, ...res.copy }));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(null);
    }
  }

  async function save(submit: boolean) {
    const firstError = Object.entries(stepErrors).find(([, e]) => e);
    if (submit && firstError) {
      setStep(Number(firstError[0]));
      setError(new Error(firstError[1]!));
      return;
    }
    setBusy(submit ? 'submit' : 'save');
    setError(null);
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      discountType: form.discountType,
      value: Number(form.value) || 0,
      displayLabel: form.displayLabel.trim() || undefined,
      minOrder: Number(form.minOrder) || 0,
      redemptionType: form.redemptionType,
      code: form.redemptionType === 'code' ? form.code.trim() || undefined : undefined,
      redemptionUrl: form.redemptionType === 'direct_link' ? form.redemptionUrl.trim() || undefined : undefined,
      terms: form.terms.trim() || undefined,
      imageUrl: form.imageUrl || '',
      // Calendar days: the API starts them at 00:00 and ends them at 23:59 UK time.
      startsAt: form.startsAt || undefined,
      endsAt: form.ongoing ? undefined : form.endsAt || undefined,
      eligibleWeekdays: form.eligibleWeekdays.length && form.eligibleWeekdays.length < 7 ? form.eligibleWeekdays : [],
      dailyStartTime: form.dailyStartTime || undefined,
      dailyEndTime: form.dailyEndTime || undefined,
      maxRedemptions: Number(form.maxRedemptions) || 0,
      delivery: form.delivery,
      collection: form.collection,
      newCustomersOnly: form.newCustomersOnly,
      submit,
    };
    try {
      const res = offer
        ? await api<{ offer: Offer; decision: { status: string } }>(`/offers/${offer._id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<{ offer: Offer; decision: { status: string } }>(`/businesses/${business!._id}/offers`, { method: 'POST', body: JSON.stringify(body) });
      if (!offer) track('offer_created', { businessId: business!._id });
      await reload();
      const status = res.decision.status;
      const tab = status === 'active' ? 'live' : status;
      router.push(`/dashboard/offers?tab=${tab === 'hidden_by_reports' ? 'hidden' : tab}`);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(null);
    }
  }

  const code = error instanceof ApiError ? error.code : undefined;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
      <div className="min-w-0">
        {/* Steps */}
        <ol className="flex gap-2 flex-wrap mb-6">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 text-sm font-bold px-3.5 py-2 rounded-full cursor-pointer ${
                  step === i ? 'bg-tint-blue text-primary' : stepErrors[i] ? 'bg-card border border-line text-muted' : 'bg-card border border-line'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] ${step === i ? 'bg-primary text-white' : !stepErrors[i] && i <= furthest ? 'bg-verified/15 text-verified' : 'bg-page'}`}>
                  {!stepErrors[i] && step !== i && i <= furthest ? <CheckIcon className="w-3.5 h-3.5" /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        {error && (
          <div className="mb-5">
            {code === 'plan_limit' || code === 'plan_feature' ? (
              <UpgradeHint>{error.message}</UpgradeHint>
            ) : (
              <Alert tone="danger">{error.message}</Alert>
            )}
          </div>
        )}

        <Card className="flex flex-col gap-5">
          {step === 0 && (
            <>
              <div className="grid sm:grid-cols-3 gap-3">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('discountType', t.value)}
                    className={`text-left rounded-2xl border p-4 cursor-pointer transition-colors ${form.discountType === t.value ? 'border-primary bg-tint-blue' : 'border-line hover:border-primary'}`}
                  >
                    <div className="text-2xl mb-1">{t.icon}</div>
                    <div className="font-extrabold">{t.label}</div>
                    <div className="text-[12.5px] text-muted">{t.hint}</div>
                  </button>
                ))}
              </div>
              {['percent', 'fixed', 'meal_deal'].includes(form.discountType) && (
                <Field
                  label={form.discountType === 'percent' ? 'Percentage off' : form.discountType === 'fixed' ? 'Amount off (£)' : 'Deal price (£, optional)'}
                  hint={form.discountType === 'percent' ? 'Discounts above 70% are checked by a moderator.' : undefined}
                  required={form.discountType !== 'meal_deal'}
                >
                  <input type="number" min={0} step={form.discountType === 'percent' ? 1 : 0.5} value={form.value} onChange={(e) => set('value', e.target.value)} className={`${inputClass} max-w-[200px]`} />
                </Field>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Field label="Title" required hint="What customers get, in a few words: “20% off orders over £15”.">
                <div className="flex gap-2">
                  <input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} className={inputClass} placeholder="e.g. 20% off orders over £15" />
                  {flags?.aiOfferWriter && (
                    <button type="button" onClick={writeWithAi} disabled={busy === 'ai'} className={`${btn.secondary} whitespace-nowrap`}>
                      {busy === 'ai' ? 'Writing…' : '✨ Write it'}
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Description" hint="A sentence or two selling the offer.">
                <textarea rows={3} maxLength={600} value={form.description} onChange={(e) => set('description', e.target.value)} className={`${inputClass} resize-none`} />
              </Field>
              <Field label="Terms" hint="e.g. Not valid with other offers. One per order.">
                <textarea rows={2} maxLength={600} value={form.terms} onChange={(e) => set('terms', e.target.value)} className={`${inputClass} resize-none`} />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Minimum order (£)" hint="Leave empty for none.">
                  <input type="number" min={0} step={0.5} value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Badge text" hint={`Shown big on the card. Default: “${autoLabel(form)}”`}>
                  <input value={form.displayLabel} maxLength={20} onChange={(e) => set('displayLabel', e.target.value)} className={inputClass} placeholder={autoLabel(form)} />
                </Field>
              </div>
              <Field label="Photo" hint="JPG, PNG or WebP, up to 5 MB.">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className={`${btn.secondary} cursor-pointer`}>
                    <UploadIcon className="w-4 h-4" /> {busy === 'photo' ? 'Uploading…' : form.imageUrl ? 'Replace photo' : 'Upload photo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
                  </label>
                  {form.imageUrl && (
                    <button type="button" className={btn.link} onClick={() => set('imageUrl', '')}>
                      Remove
                    </button>
                  )}
                </div>
              </Field>
              <div className="flex flex-col gap-3">
                <Toggle checked={form.delivery} onChange={(v) => set('delivery', v)} label="Valid for delivery" />
                <Toggle checked={form.collection} onChange={(v) => set('collection', v)} label="Valid for collection" />
                <Toggle checked={form.newCustomersOnly} onChange={(v) => set('newCustomersOnly', v)} label="New customers only" />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                {REDEEM.map((r) => {
                  const locked = r.value === 'code' && !flags?.couponCodes && offer?.redemptionType !== 'code';
                  return (
                    <button
                      key={r.value}
                      type="button"
                      disabled={locked}
                      onClick={() => set('redemptionType', r.value)}
                      className={`text-left rounded-2xl border p-4 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${form.redemptionType === r.value ? 'border-primary bg-tint-blue' : 'border-line hover:border-primary'}`}
                    >
                      <div className="font-extrabold">{REDEEM_LABELS[r.value]}</div>
                      <div className="text-[12.5px] text-muted">{locked ? `Coupon codes are on Standard and above (you’re on ${manage.plan.name}).` : r.hint}</div>
                    </button>
                  );
                })}
              </div>
              {form.redemptionType === 'code' && (
                <Field label="Coupon code" required>
                  <input value={form.code} maxLength={30} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))} className={`${inputClass} max-w-xs font-display tracking-wider`} placeholder="TRU20" />
                </Field>
              )}
              {form.redemptionType === 'direct_link' && (
                <Field
                  label="Link to your ordering page"
                  hint={business.orderUrl ? `Leave empty to use your order link (${business.orderUrl}). It must be your own website or a known ordering provider, or a moderator checks it.` : 'It must be your own website or a known ordering provider (e.g. Foodbell), or a moderator checks it.'}
                >
                  <input value={form.redemptionUrl} onChange={(e) => set('redemptionUrl', e.target.value)} className={inputClass} placeholder="https://" />
                </Field>
              )}
              {form.redemptionType === 'phone' && !business.phone && <Alert tone="warning">Add your phone number to your profile so customers can call.</Alert>}
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Starts" hint={flags?.scheduledOffers ? 'Leave empty to start as soon as it’s approved.' : `Scheduling for later is on Standard and above.`}>
                  <input type="date" value={form.startsAt} min={ukDateInputValue(new Date())} disabled={!flags?.scheduledOffers} onChange={(e) => set('startsAt', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Ends">
                  <div className="flex flex-col gap-2">
                    <input type="date" value={form.endsAt} disabled={form.ongoing} min={form.startsAt || ukDateInputValue(new Date())} onChange={(e) => set('endsAt', e.target.value)} className={inputClass} />
                    <Toggle checked={form.ongoing} onChange={(v) => set('ongoing', v)} label="Ongoing (no end date)" />
                  </div>
                </Field>
              </div>
              <Field label="Days of the week" hint="Leave all off for every day.">
                <div className="flex gap-2 flex-wrap">
                  {WEEKDAYS.map((d) => {
                    const on = form.eligibleWeekdays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set('eligibleWeekdays', on ? form.eligibleWeekdays.filter((x) => x !== d) : [...form.eligibleWeekdays, d])}
                        className={`w-14 py-2 rounded-xl text-sm font-bold border cursor-pointer ${on ? 'bg-primary text-white border-primary' : 'border-line hover:border-primary'}`}
                      >
                        {WEEKDAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="From (time)">
                  <input type="time" value={form.dailyStartTime} onChange={(e) => set('dailyStartTime', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Until (time)">
                  <input type="time" value={form.dailyEndTime} onChange={(e) => set('dailyEndTime', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Usage cap" hint="Total redemptions; empty = no cap.">
                  <input type="number" min={0} value={form.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} className={inputClass} />
                </Field>
              </div>
            </>
          )}

          {stepErrors[step] && <div className="text-[13px] font-bold text-muted">{stepErrors[step]}</div>}

          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-line">
            {step > 0 && (
              <button type="button" className={btn.secondary} onClick={() => setStep(step - 1)}>
                ← Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className={btn.primary} onClick={() => setStep(step + 1)}>
                Next →
              </button>
            ) : (
              <button type="button" className={btn.primary} disabled={!!busy} onClick={() => save(true)}>
                {busy === 'submit' ? 'Saving…' : submitLabel}
              </button>
            )}
            {(!offer || ['draft', 'rejected'].includes(offer.status)) && (
              <button type="button" className={btn.secondary} disabled={!!busy || form.title.trim().length < 4} onClick={() => save(false)}>
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </button>
            )}
            <Link href="/dashboard/offers" className="text-sm font-bold text-muted ml-auto">
              Cancel
            </Link>
          </div>
          {!verified && <p className="text-[12.5px] text-muted">Your business isn’t verified yet, so offers are saved as drafts and submitted automatically once a moderator verifies you.</p>}
          {verified && !manage.plan.autoApprove && <p className="text-[12.5px] text-muted">On the {manage.plan.name} plan every offer is checked by our team before it goes live.</p>}
        </Card>
      </div>
      <Preview form={form} businessName={business.name} level={business.verificationLevel} orderUrl={business.orderUrl} />
    </div>
  );
}

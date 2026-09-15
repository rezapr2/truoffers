'use client';

import type { FieldSelectorConfig, SelectorConfig } from '@/lib/scraper-types';
import { inputClass } from './ui';

// The named parsers the API accepts. There is no way to type a regex here, by design.
const PARSERS = ['text', 'offer_text', 'money', 'percent', 'date', 'promo_code', 'phone', 'postcode', 'url'];

const OFFER_FIELDS = [
  ['title', 'Title', 'offer_text'],
  ['description', 'Description', 'offer_text'],
  ['terms', 'Terms', 'text'],
  ['promoCode', 'Promo code', 'promo_code'],
  ['minimumOrder', 'Minimum order', 'money'],
  ['expiry', 'Expiry', 'date'],
  ['orderUrl', 'Order link', 'url'],
] as const;

const BUSINESS_FIELDS = [
  ['name', 'Business name', 'text'],
  ['telephone', 'Telephone', 'phone'],
  ['address', 'Address', 'text'],
  ['postcode', 'Postcode', 'postcode'],
  ['orderUrl', 'Order link', 'url'],
] as const;

export const EMPTY_CONFIG: SelectorConfig = { offers: { container: '', fields: { title: { selector: '' } } } };

function FieldRow({
  label,
  field,
  defaultParser,
  required,
  onChange,
  disabled,
}: {
  label: string;
  field?: FieldSelectorConfig;
  defaultParser: string;
  required?: boolean;
  onChange: (value: FieldSelectorConfig | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr_150px] gap-2 items-center">
      <span className="text-[13px] font-extrabold">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        value={field?.selector ?? ''}
        disabled={disabled}
        placeholder={required ? 'CSS selector' : 'CSS selector (optional)'}
        onChange={(e) => onChange(e.target.value ? { ...field, selector: e.target.value } : required ? { selector: '' } : undefined)}
        className={`${inputClass} font-mono text-[13px] py-2`}
      />
      <select
        value={field?.parser ?? defaultParser}
        disabled={disabled || !field?.selector}
        onChange={(e) => field && onChange({ ...field, parser: e.target.value })}
        className={`${inputClass} text-[13px] py-2`}
      >
        {PARSERS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Structured editor for a selector adapter: the repeated offer card, a CSS selector and named parser per
 * field, optional business fields and the paths of offer pages. Selectors are relative to the card.
 */
export default function SelectorConfigEditor({ value, onChange, disabled }: { value: SelectorConfig; onChange: (next: SelectorConfig) => void; disabled?: boolean }) {
  const setOfferField = (key: string, field: FieldSelectorConfig | undefined) => {
    const fields = { ...value.offers.fields } as Record<string, FieldSelectorConfig | undefined>;
    if (field) fields[key] = field;
    else delete fields[key];
    onChange({ ...value, offers: { ...value.offers, fields: fields as SelectorConfig['offers']['fields'] } });
  };
  const setBusinessField = (key: string, field: FieldSelectorConfig | undefined) => {
    const business = { ...(value.business ?? {}) } as Record<string, unknown>;
    if (field) business[key] = field;
    else delete business[key];
    onChange({ ...value, business: Object.keys(business).length ? (business as SelectorConfig['business']) : undefined });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-extrabold uppercase text-muted">Offer cards</div>
        <div className="grid grid-cols-[140px_1fr] gap-2 items-center">
          <span className="text-[13px] font-extrabold">Card container *</span>
          <input
            value={value.offers.container}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, offers: { ...value.offers, container: e.target.value } })}
            placeholder="e.g. article.offer-card"
            className={`${inputClass} font-mono text-[13px] py-2`}
          />
        </div>
        {OFFER_FIELDS.map(([key, label, parser]) => (
          <FieldRow
            key={key}
            label={label}
            required={key === 'title'}
            defaultParser={parser}
            disabled={disabled}
            field={(value.offers.fields as Record<string, FieldSelectorConfig | undefined>)[key]}
            onChange={(field) => setOfferField(key, field)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-extrabold uppercase text-muted">Business details (optional; searched on the whole page)</div>
        {BUSINESS_FIELDS.map(([key, label, parser]) => (
          <FieldRow
            key={key}
            label={label}
            defaultParser={parser}
            disabled={disabled}
            field={(value.business as Record<string, FieldSelectorConfig | undefined> | undefined)?.[key]}
            onChange={(field) => setBusinessField(key, field)}
          />
        ))}
      </div>

      <label className="grid grid-cols-[140px_1fr] gap-2 items-center">
        <span className="text-[13px] font-extrabold">Offer page paths</span>
        <input
          value={(value.pages?.offers ?? []).join(', ')}
          disabled={disabled}
          placeholder="/offers, /deals/*"
          onChange={(e) => {
            const offers = e.target.value.split(',').map((p) => p.trim()).filter(Boolean);
            onChange({ ...value, pages: offers.length ? { ...value.pages, offers } : undefined });
          }}
          className={`${inputClass} font-mono text-[13px] py-2`}
        />
      </label>
    </div>
  );
}

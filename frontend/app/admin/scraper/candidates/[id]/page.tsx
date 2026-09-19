'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { OFFER_FIELDS, type Candidate, type CandidateDetail, type OfferField } from '@/lib/scraper-types';
import BranchDecision from '../../_components/BranchDecision';
import { useOverview } from '../../_components/overview';
import { btn, Card, ConfidenceBadge, ErrorNote, formatDate, humanise, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

const LABELS: Record<OfferField, string> = {
  title: 'Title',
  shortDescription: 'Description',
  terms: 'Terms',
  offerType: 'Offer type',
  discountPercentage: 'Discount %',
  discountAmount: 'Discount £',
  originalPrice: 'Original price',
  promotionalPrice: 'Promotional price',
  promoCode: 'Promo code',
  minimumOrder: 'Minimum order',
  requiredSpend: 'Required spend',
  freeItem: 'Free item',
  collectionEligible: 'Collection',
  deliveryEligible: 'Delivery',
  newCustomersOnly: 'New customers only',
  applicableProducts: 'Products',
  eligibleWeekdays: 'Days',
  dailyStartTime: 'From',
  dailyEndTime: 'Until',
  startDate: 'Starts',
  endDate: 'Ends',
};

// Flags a reviewer has to act on before approving, with what to do.
const FLAG_ACTIONS: Record<string, string> = {
  order_type_unconfirmed:
    'The platform marks this offer for one order type but doesn’t say whether that is collection or delivery. Check the website and set Collection and Delivery above before approving.',
  weekdays_unconfirmed: 'The offer applies on some days only, but the page data doesn’t say which. Check the website and set the days above.',
  single_item_unconfirmed:
    'The platform ties this discount to one menu item without naming it. Check the website and name the item in the title and terms before approving.',
};

const MONEY: OfferField[] = ['discountAmount', 'originalPrice', 'promotionalPrice', 'minimumOrder', 'requiredSpend'];
const NUMBER: OfferField[] = ['discountPercentage', ...MONEY];
const TRI_STATE: OfferField[] = ['collectionEligible', 'deliveryEligible', 'newCustomersOnly'];
const OFFER_TYPES = [
  'percentage_discount',
  'fixed_discount',
  'buy_one_get_one_free',
  'multi_buy',
  'free_item',
  'free_delivery',
  'meal_deal',
  'collection_discount',
  'delivery_discount',
  'custom',
];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const OPEN = ['pending_review', 'awaiting_merchant_confirmation', 'needs_reextraction'];

function display(field: OfferField, value: unknown): string {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (MONEY.includes(field)) return `£${Number(value).toFixed(2)}`;
  if (field === 'discountPercentage') return `${value}%`;
  if (field === 'offerType') return humanise(String(value));
  return String(value);
}

function blockers(detail: CandidateDetail): string[] {
  const { candidate, branches } = detail;
  const reasons: string[] = [];
  if (!OPEN.slice(0, 2).includes(candidate.status)) reasons.push(`It is ${candidate.status.replace(/_/g, ' ')}.`);
  if (candidate.confidenceScore < 40) reasons.push('It scored below 40, so it cannot be published. Edit it or re-extract.');
  if (candidate.duplicate?.kind === 'changed_terms') reasons.push('It updates an offer that is already live: apply it to that offer instead.');
  const unresolved = candidate.branchPaths.filter(
    (path) => !branches.some((b) => b.branchPath === path && b.businessRef && ['auto_matched', 'confirmed'].includes(b.matchStatus)),
  );
  if (unresolved.length) reasons.push(`Match ${unresolved.join(', ')} to a listing first (below).`);
  return reasons;
}

type Draft = Record<OfferField, string | string[]>;

function toDraft(candidate: Candidate): Draft {
  return Object.fromEntries(
    OFFER_FIELDS.map((field) => {
      const value = candidate[field];
      if (field === 'eligibleWeekdays') return [field, Array.isArray(value) ? (value as string[]) : []];
      if (field === 'applicableProducts') return [field, Array.isArray(value) ? (value as string[]).join(', ') : ''];
      if (TRI_STATE.includes(field)) return [field, value === true ? 'yes' : value === false ? 'no' : ''];
      return [field, value === undefined || value === null ? '' : String(value)];
    }),
  ) as Draft;
}

function fromDraft(field: OfferField, value: string | string[]): unknown {
  if (field === 'eligibleWeekdays') return (value as string[]).length ? value : null;
  const text = String(value).trim();
  if (field === 'applicableProducts') return text ? text.split(',').map((p) => p.trim()).filter(Boolean) : null;
  if (TRI_STATE.includes(field)) return text === 'yes' ? true : text === 'no' ? false : null;
  if (!text) return null;
  if (NUMBER.includes(field)) return Number(text);
  if (field === 'promoCode') return text.toUpperCase();
  return text;
}

function EditForm({ candidate, onSaved }: { candidate: Candidate; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(candidate));
  const { busy, error, run } = useAction();
  const original = toDraft(candidate);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = Object.fromEntries(
      OFFER_FIELDS.filter((f) => JSON.stringify(draft[f]) !== JSON.stringify(original[f])).map((f) => [f, fromDraft(f, draft[f])]),
    );
    if (Object.keys(patch).length === 0) return onSaved();
    const saved = await run(() => api(`/admin/scraper/candidates/${candidate._id}`, { method: 'PATCH', body: JSON.stringify(patch) }));
    if (saved) onSaved();
  }

  const set = (field: OfferField, value: string | string[]) => setDraft({ ...draft, [field]: value });

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <ErrorNote error={error} />
      <div className="grid md:grid-cols-2 gap-3">
        {OFFER_FIELDS.map((field) => (
          <label key={field} className={`flex flex-col gap-1 ${['title', 'shortDescription', 'terms'].includes(field) ? 'md:col-span-2' : ''}`}>
            <span className="text-[12px] font-extrabold">{LABELS[field]}</span>
            {field === 'offerType' ? (
              <select value={draft[field] as string} onChange={(e) => set(field, e.target.value)} className={inputClass}>
                {OFFER_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
              </select>
            ) : TRI_STATE.includes(field) ? (
              <select value={draft[field] as string} onChange={(e) => set(field, e.target.value)} className={inputClass}>
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : field === 'eligibleWeekdays' ? (
              <div className="flex gap-2 flex-wrap">
                {WEEKDAYS.map((day) => {
                  const days = draft[field] as string[];
                  return (
                    <label key={day} className="flex items-center gap-1 text-sm font-bold">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={days.includes(day)}
                        onChange={(e) => set(field, e.target.checked ? [...days, day] : days.filter((d) => d !== day))}
                      />
                      {humanise(day)}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input
                type={NUMBER.includes(field) ? 'number' : field.endsWith('Date') ? 'date' : field.endsWith('Time') ? 'time' : 'text'}
                step={NUMBER.includes(field) ? '0.01' : undefined}
                value={draft[field] as string}
                onChange={(e) => set(field, e.target.value)}
                className={inputClass}
              />
            )}
          </label>
        ))}
      </div>
      <p className="text-[12px] font-semibold text-muted">
        Changed fields are logged with before and after values, and their evidence becomes your edit.
      </p>
      <div className="flex gap-2">
        <button disabled={busy} className={btn.dark}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={btn.outline} onClick={onSaved}>Cancel</button>
      </div>
    </form>
  );
}

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { refresh } = useOverview();
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [selectedBranches, setSelectedBranches] = useState<string[] | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    void api<CandidateDetail>(`/admin/scraper/candidates/${id}`).then(setDetail).catch(() => setNotFound(true));
  }, [id]);
  useEffect(load, [load]);

  if (notFound) return <Card>Candidate not found.</Card>;
  if (!detail) return <div className="py-16 text-center text-muted font-bold">Loading…</div>;
  const { candidate, branches, previous } = detail;
  const reasons = blockers(detail);
  const isOpen = OPEN.includes(candidate.status);
  const branchesToApprove = selectedBranches ?? candidate.branchPaths;

  async function act(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const done = await run(() => api(`/admin/scraper/candidates/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }));
    if (done !== undefined) {
      load();
      refresh();
    }
  }

  const sourcePath = candidate.sources[0] ? new URL(candidate.sources[0].url).pathname : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-start gap-4 flex-wrap">
          <ConfidenceBadge score={candidate.confidenceScore} band={candidate.confidenceBand} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-2xl font-extrabold">{candidate.title}</h2>
              <StatusPill status={candidate.status} />
            </div>
            <div className="text-[13px] font-semibold text-muted mt-1">
              {detail.website ? (
                <Link href={`/admin/scraper/websites/${detail.website._id}`} className="font-bold hover:text-primary">{candidate.domain}</Link>
              ) : candidate.domain}
              {' · '}{candidate.adapterId} {candidate.adapterVersion} · {candidate.extractionMethod} extraction · found {formatDate(candidate.createdAt)} · checked {formatDate(candidate.lastCheckedAt)}
            </div>
            {candidate.reviewNote && <div className="text-[13px] font-bold text-ink-soft mt-1">Review note: {candidate.reviewNote}</div>}
          </div>
          {isOpen && !editing && (
            <button className={btn.outline} onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
      </Card>

      <ErrorNote error={error} />

      {editing ? (
        <Card>
          <SectionTitle>Edit before approving</SectionTitle>
          <EditForm candidate={candidate} onSaved={() => { setEditing(false); load(); }} />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
          <div className="flex flex-col gap-6">
            <Card>
              <SectionTitle>Extracted offer and evidence</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {OFFER_FIELDS.filter((f) => display(f, candidate[f]) !== '—' || candidate.evidence[f]).map((field) => {
                      const evidence = candidate.evidence[field];
                      return (
                        <tr key={field} className="border-t border-line align-top">
                          <th className="py-2.5 pr-4 text-left text-[12px] font-extrabold uppercase text-muted whitespace-nowrap">{LABELS[field]}</th>
                          <td className="py-2.5 pr-4 font-extrabold">{display(field, candidate[field])}</td>
                          <td className="py-2.5 text-[13px] font-semibold text-ink-soft">
                            {evidence ? (
                              <>
                                <span className="italic">“{evidence.text}”</span>
                                <div className="text-[11px] font-bold text-muted mt-0.5">
                                  {evidence.method}
                                  {evidence.sourceUrl?.startsWith('http') && (
                                    <> · <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{new URL(evidence.sourceUrl).pathname}</a></>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-primary font-bold">No evidence</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(candidate.flags.length > 0 || candidate.conflicts.length > 0) && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {candidate.conflicts.map((c) => <StatusPill key={c} status="failed" label={`conflict: ${c}`} />)}
                  {candidate.flags.map((f) => <StatusPill key={f} status="delayed" label={f.replace(/_/g, ' ')} />)}
                </div>
              )}
              {candidate.flags.filter((f) => FLAG_ACTIONS[f]).map((f) => (
                <p key={f} className="mt-3 text-[13px] font-bold text-[#9a6210] bg-star/15 rounded-xl px-4 py-3">{FLAG_ACTIONS[f]}</p>
              ))}
            </Card>

            <Card>
              <SectionTitle>Where it was found</SectionTitle>
              <div className="flex flex-col gap-3">
                {candidate.sources.map((source) => (
                  <div key={source.url} className="border border-line rounded-xl px-4 py-3">
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-extrabold hover:text-primary break-all">
                      {source.pageTitle || source.url}
                    </a>
                    <div className="text-[12px] font-semibold text-muted break-all">{source.url} · checked {formatDate(source.checkedAt)}</div>
                    {source.excerpt ? (
                      <p className="text-[13px] font-semibold text-ink-soft mt-2 italic">“{source.excerpt}”</p>
                    ) : (
                      <p className="text-[12px] font-bold text-muted mt-2">Excerpt deleted under the retention policy.</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {(candidate.duplicate || previous) && (
              <Card>
                <SectionTitle>
                  {candidate.duplicate?.kind === 'changed_terms' ? 'Changes to a live offer' : `Possible duplicate: ${candidate.duplicate?.kind.replace(/_/g, ' ')}`}
                </SectionTitle>
                {previous && (
                  <p className="text-sm font-semibold mb-3">
                    Existing offer:{' '}
                    <Link href={`/offer/${previous._id}`} target="_blank" className="font-extrabold hover:text-primary">{previous.title}</Link>{' '}
                    <StatusPill status={previous.status} /> {previous.managedBy === 'merchant_managed' && <StatusPill status="info" label="managed by the business" />}
                  </p>
                )}
                {candidate.duplicate?.diff && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-muted">
                        <th className="py-2">Field</th>
                        <th className="py-2">Live now</th>
                        <th className="py-2">On the website</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(candidate.duplicate.diff).map(([field, change]) => (
                        <tr key={field} className="border-t border-line">
                          <td className="py-2 font-bold">{LABELS[field as OfferField] ?? field}</td>
                          <td className="py-2 font-semibold text-muted line-through">{String(change.previous ?? '—')}</td>
                          <td className="py-2 font-extrabold">{String(change.proposed ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            )}

            <Card>
              <SectionTitle>Branches this offer applies to</SectionTitle>
              <div className="flex flex-col gap-3">
                {candidate.branchPaths.map((path) => {
                  const branch = branches.find((b) => b.branchPath === path);
                  return branch ? (
                    <BranchDecision key={path} websiteId={candidate.scrapedWebsiteRef} branch={branch} onDone={() => { load(); refresh(); }} />
                  ) : (
                    <div key={path} className="text-sm font-semibold text-muted">{path}: no business details found on the website yet.</div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-6 lg:sticky lg:top-6">
            <Card>
              <SectionTitle>Decision</SectionTitle>
              {reasons.length > 0 && (
                <ul className="text-[13px] font-semibold text-ink-soft list-disc pl-5 mb-4 space-y-1">
                  {reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {detail.approvedOffers.length > 0 && (
                <div className="mb-4 flex flex-col gap-1">
                  {detail.approvedOffers.map((o) => (
                    <Link key={o._id} href={`/offer/${o._id}`} target="_blank" className="text-sm font-bold hover:text-primary">
                      Published: {o.title} · {o.status} · {o.verification.replace(/_/g, ' ')}
                    </Link>
                  ))}
                </div>
              )}

              {isOpen && (
                <div className="flex flex-col gap-3">
                  {candidate.branchPaths.length > 1 && detail.canApprove && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[12px] font-extrabold">Publish for</span>
                      {candidate.branchPaths.map((path) => (
                        <label key={path} className="flex items-center gap-2 text-sm font-semibold">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={branchesToApprove.includes(path)}
                            onChange={(e) =>
                              setSelectedBranches(e.target.checked ? [...branchesToApprove, path] : branchesToApprove.filter((p) => p !== path))
                            }
                          />
                          {path}
                        </label>
                      ))}
                    </div>
                  )}
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)" className={inputClass} />
                  <button
                    disabled={busy || !detail.canApprove}
                    className={btn.good}
                    onClick={() => act('approve', { verification: 'admin_verified', note: note || undefined, branchPaths: branchesToApprove })}
                  >
                    Approve as admin-verified
                  </button>
                  <button
                    disabled={busy || !detail.canApprove}
                    className={btn.dark}
                    onClick={() => act('approve', { verification: 'unverified', note: note || undefined, branchPaths: branchesToApprove })}
                  >
                    Approve as unverified
                  </button>
                  {candidate.duplicate?.kind === 'changed_terms' && candidate.duplicate.offerRef && (
                    <>
                      <button disabled={busy} className={btn.good} onClick={() => act('merge', { verification: 'admin_verified' })}>
                        Apply changes to the live offer (admin-verified)
                      </button>
                      <button disabled={busy} className={btn.outline} onClick={() => act('merge', { verification: 'unverified' })}>
                        Apply changes (unverified)
                      </button>
                    </>
                  )}
                  {candidate.status === 'pending_review' && (
                    <button disabled={busy} className={btn.outline} onClick={() => act('request-merchant-confirmation')}>
                      Ask the business to confirm
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className={btn.danger}
                    onClick={() => {
                      const reason = prompt('Why reject this offer? (optional)');
                      if (reason !== null) void act('reject', { reason: reason || undefined });
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
              {candidate.status === 'failed_extraction' && (
                <button disabled={busy} className={`${btn.danger} mt-3`} onClick={() => act('reject', { reason: 'Failed extraction' })}>
                  Dismiss
                </button>
              )}
            </Card>

            {isOpen && (
              <Card>
                <SectionTitle>Merge into another candidate</SectionTitle>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act('merge', { candidateId: mergeTarget.trim() }, 'Merge this candidate into the other one? Its sources and branches move across.');
                  }}
                  className="flex gap-2"
                >
                  <input required value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} placeholder={candidate.duplicate?.candidateRef ?? 'Candidate id'} className={`${inputClass} flex-1 min-w-0`} />
                  <button disabled={busy} className={btn.outline}>Merge</button>
                </form>
              </Card>
            )}

            <Card>
              <SectionTitle>Confidence {candidate.confidenceScore}/100</SectionTitle>
              <table className="w-full text-sm">
                <tbody>
                  {candidate.confidenceSignals.map((signal) => (
                    <tr key={signal.name} className="border-t border-line">
                      <td className="py-1.5 font-semibold">{humanise(signal.name)}</td>
                      <td className={`py-1.5 text-right font-extrabold ${signal.points < 0 ? 'text-primary' : ''}`}>
                        {signal.points > 0 ? `+${signal.points}` : signal.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <SectionTitle>Source controls</SectionTitle>
              <div className="flex flex-col gap-2">
                <button disabled={busy} className={btn.outline} onClick={() => act('reextract')}>
                  Re-extract the website
                </button>
                {sourcePath && (
                  <button
                    disabled={busy}
                    className={btn.danger}
                    onClick={() => act('block-source', { scope: 'url' }, `Stop crawling ${sourcePath} on ${candidate.domain} and reject this candidate?`)}
                  >
                    Block this page ({sourcePath})
                  </button>
                )}
                <button
                  disabled={busy}
                  className={btn.danger}
                  onClick={() => act('block-source', { scope: 'domain' }, `Opt out ${candidate.domain}? Its imported offers are removed immediately.`)}
                >
                  Block the whole domain
                </button>
              </div>
            </Card>

            {detail.history.length > 0 && (
              <Card>
                <SectionTitle>History</SectionTitle>
                <div className="flex flex-col gap-2 text-[13px] font-semibold">
                  {detail.history.map((entry) => (
                    <div key={entry._id}>
                      <span className="font-extrabold">{humanise(entry.action.split('.').pop() ?? entry.action)}</span>{' '}
                      <span className="text-muted">by {entry.actor.userId?.name ?? entry.actor.kind} · {formatDate(entry.createdAt)}</span>
                      {entry.note && <div className="text-ink-soft">{entry.note}</div>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

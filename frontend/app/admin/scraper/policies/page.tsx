'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { OptOut, PolicyStatus, ProviderPolicy, ScraperSettings } from '@/lib/scraper-types';
import { useOverview } from '../_components/overview';
import { btn, Card, EmptyState, ErrorNote, formatDate, inputClass, SectionTitle, StatusPill, Tabs, useAction } from '../_components/ui';

const DETECTION_FIELDS = [
  ['hostSuffixes', 'Host suffixes', 'e.g. ordernest.co.uk'],
  ['cnameSuffixes', 'CNAME suffixes', 'e.g. sites.ordernest.net'],
  ['footerPatterns', 'Footer attribution', 'e.g. Powered by OrderNest'],
  ['generatorPatterns', 'Generator meta', 'e.g. OrderNest Sites'],
  ['assetHosts', 'Asset hosts', 'e.g. cdn.ordernest.net'],
] as const;

type PolicyDraft = {
  name: string;
  status: PolicyStatus;
  basis: '' | 'written_agreement' | 'terms_review';
  agreementReference: string;
  basisNotes: string;
} & Record<(typeof DETECTION_FIELDS)[number][0], string>;

function toDraft(policy?: ProviderPolicy): PolicyDraft {
  return {
    name: policy?.name ?? '',
    status: policy?.status ?? 'unknown',
    basis: policy?.basis ?? '',
    agreementReference: policy?.agreementReference ?? '',
    basisNotes: policy?.basisNotes ?? '',
    ...(Object.fromEntries(DETECTION_FIELDS.map(([key]) => [key, (policy?.detection[key] ?? []).join('\n')])) as Record<(typeof DETECTION_FIELDS)[number][0], string>),
  };
}

function PolicyForm({ policy, reviewRequired, onDone }: { policy?: ProviderPolicy; reviewRequired: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState<PolicyDraft>(() => toDraft(policy));
  const { busy, error, run } = useAction();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: draft.name,
      status: draft.status,
      basis: draft.basis || null,
      agreementReference: draft.agreementReference || null,
      basisNotes: draft.basisNotes || null,
      detection: Object.fromEntries(DETECTION_FIELDS.map(([key]) => [key, draft[key].split('\n').map((v) => v.trim()).filter(Boolean)])),
    };
    const saved = await run(() =>
      api(policy ? `/admin/scraper/provider-policies/${policy._id}` : '/admin/scraper/provider-policies', {
        method: policy ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    );
    if (saved) onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 border border-line rounded-2xl p-5">
      <ErrorNote error={error} />
      <div className="grid md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-extrabold">Provider name</span>
          <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-extrabold">Policy</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as PolicyStatus })} className={inputClass}>
            <option value="unknown">{reviewRequired ? 'Unknown: hold its websites' : 'Unknown: crawl its websites'}</option>
            <option value="allowed">Allowed</option>
            <option value="blocked">Blocked: never crawl</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-extrabold">Basis {draft.status === 'allowed' && '*'}</span>
          <select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as PolicyDraft['basis'] })} className={inputClass}>
            <option value="">None</option>
            <option value="written_agreement">Written agreement</option>
            <option value="terms_review">Reviewed terms of service</option>
          </select>
        </label>
        {draft.basis === 'written_agreement' && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Agreement reference *</span>
            <input value={draft.agreementReference} onChange={(e) => setDraft({ ...draft, agreementReference: e.target.value })} className={inputClass} />
          </label>
        )}
        <label className={`flex flex-col gap-1 ${draft.basis === 'written_agreement' ? 'md:col-span-2' : 'md:col-span-3'}`}>
          <span className="text-[12px] font-extrabold">Notes {draft.basis === 'terms_review' && '* (what the terms allow)'}</span>
          <input value={draft.basisNotes} onChange={(e) => setDraft({ ...draft, basisNotes: e.target.value })} className={inputClass} />
        </label>
      </div>
      <div className="grid md:grid-cols-5 gap-3">
        {DETECTION_FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">{label}</span>
            <textarea rows={3} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} placeholder={placeholder} className={`${inputClass} text-sm`} />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button disabled={busy} className={btn.dark}>{policy ? 'Save policy' : 'Add provider'}</button>
        <button type="button" className={btn.outline} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

// A robots.txt exception needs the provider's own written agreement, with its reference.
const coversRobots = (policy: ProviderPolicy) => policy.status === 'allowed' && policy.basis === 'written_agreement' && !!policy.agreementReference;

function Providers() {
  const [policies, setPolicies] = useState<ProviderPolicy[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [exceptionFor, setExceptionFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const { user } = useAuth();
  const { error, run } = useAction();
  const load = useCallback(() => {
    void api<ProviderPolicy[]>('/admin/scraper/provider-policies').then(setPolicies).catch(() => {});
    void api<ScraperSettings>('/admin/scraper/settings').then((s) => setReviewRequired(!!s.providerReviewRequired)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <Card>
      <SectionTitle aside={editing !== 'new' && <button className={btn.outline} onClick={() => setEditing('new')}>Add provider</button>}>
        Ordering providers
      </SectionTitle>
      <p className="text-[13px] font-semibold text-muted mb-4">
        {reviewRequired
          ? 'Provider review is on: websites hosted by a provider are crawled only while its policy is allowed, with a recorded basis. Providers are added automatically when a website uses one, and their websites wait here.'
          : 'Websites hosted by a provider are crawled unless you block it here. Providers are added automatically when a website uses one. To hold their websites until you allow each provider, turn on provider review in Settings.'}
      </p>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-3">
        {editing === 'new' && <PolicyForm reviewRequired={reviewRequired} onDone={() => { setEditing(null); load(); }} />}
        {policies?.map((policy) =>
          editing === policy._id ? (
            <PolicyForm key={policy._id} policy={policy} reviewRequired={reviewRequired} onDone={() => { setEditing(null); load(); }} />
          ) : (
            <div key={policy._id} className="border border-line rounded-2xl px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold">{policy.name}</span>
                  <StatusPill status={policy.status} />
                  {policy.autoCreated && <StatusPill status="delayed" label={reviewRequired ? 'detected, not reviewed' : 'detected'} />}
                </div>
                <div className="text-[13px] font-semibold text-muted mt-1">
                  {policy.basis ? `${policy.basis.replace(/_/g, ' ')}${policy.agreementReference ? ` (${policy.agreementReference})` : ''}` : 'No basis recorded'}
                  {' · '}
                  {Object.entries(policy.websites).map(([status, n]) => `${n} ${status.replace(/_/g, ' ')}`).join(' · ') || 'no websites'}
                </div>
                {policy.robotsOverride && coversRobots(policy) && (
                  <div className="mt-2 text-[13px] font-semibold text-ink-soft">
                    <StatusPill status="delayed" label="reads despite robots.txt" /> {policy.robotsOverride.note}
                    <span className="block text-[12px] text-muted">
                      Recorded {formatDate(policy.robotsOverride.recordedAt)} · covers the {Object.values(policy.websites).reduce((a, b) => a + (b ?? 0), 0)} website(s) linked to this provider
                    </span>
                    {user?.role === 'super_admin' && (
                      <button
                        className={`${btn.outline} mt-2`}
                        onClick={async () => {
                          await run(() => api(`/admin/scraper/provider-policies/${policy._id}/robots-override`, { method: 'DELETE' }));
                          load();
                        }}
                      >
                        Apply robots.txt again
                      </button>
                    )}
                  </div>
                )}
                {!policy.robotsOverride && coversRobots(policy) && user?.role === 'super_admin' && (
                  exceptionFor === policy._id ? (
                    <form
                      className="mt-2 flex flex-col gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!confirm(`Read every ${policy.name} website even though its robots.txt asks bots to stay away? Only if the agreement (${policy.agreementReference}) says we may.`)) return;
                        const saved = await run(() => api(`/admin/scraper/provider-policies/${policy._id}/robots-override`, { method: 'PUT', body: JSON.stringify({ note }) }));
                        if (saved) {
                          setExceptionFor(null);
                          setNote('');
                          load();
                        }
                      }}
                    >
                      <span className="text-[12px] font-semibold text-muted">
                        Only if the agreement says we may read this provider’s websites automatically. It covers every website linked to it, ends if the policy
                        or agreement changes, and doesn’t change the rate limit or any other check.
                      </span>
                      <textarea
                        required
                        minLength={10}
                        maxLength={500}
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Section 4 of the agreement lets us read client websites automatically"
                        className={inputClass}
                      />
                      <div className="flex gap-2">
                        <button className={btn.dark} disabled={note.trim().length < 10}>Read despite robots.txt</button>
                        <button type="button" className={btn.outline} onClick={() => setExceptionFor(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button className={`${btn.outline} mt-2`} onClick={() => { setExceptionFor(policy._id); setNote(''); }}>
                      Read its websites despite robots.txt…
                    </button>
                  )
                )}
              </div>
              <div className="flex gap-2">
                <button className={btn.outline} onClick={() => setEditing(policy._id)}>Edit</button>
                <button
                  className={btn.danger}
                  onClick={async () => {
                    if (!confirm(`Delete ${policy.name}?`)) return;
                    await run(() => api(`/admin/scraper/provider-policies/${policy._id}`, { method: 'DELETE' }));
                    load();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
        {policies && policies.length === 0 && editing !== 'new' && <EmptyState>No providers recorded yet.</EmptyState>}
      </div>
    </Card>
  );
}

const OPT_OUT_VIEWS = [
  { value: 'unacknowledged', label: 'Removal requests to acknowledge' },
  { value: 'active', label: 'Active opt-outs' },
  { value: 'all', label: 'All' },
] as const;

function OptOuts() {
  const { refresh } = useOverview();
  const [view, setView] = useState<'unacknowledged' | 'active' | 'all'>('unacknowledged');
  const [items, setItems] = useState<OptOut[] | null>(null);
  const [draft, setDraft] = useState({ domain: '', reason: '' });
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    const query = view === 'all' ? '' : `?${view}=true`;
    void api<OptOut[]>(`/admin/scraper/opt-outs${query}`).then(setItems).catch(() => {});
  }, [view]);
  useEffect(load, [load]);

  async function act(path: string, method: string, body?: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const done = await run(() => api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (done !== undefined) {
      load();
      refresh();
    }
  }

  return (
    <Card>
      <SectionTitle>Opt-outs and removal requests</SectionTitle>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act('/admin/scraper/opt-outs', 'POST', { domain: draft.domain, reason: draft.reason || undefined }, `Opt out ${draft.domain} and its subdomains? Imported offers are removed immediately.`);
          setDraft({ domain: '', reason: '' });
        }}
        className="flex gap-2 flex-wrap mb-4"
      >
        <input required value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} placeholder="example.co.uk" className={inputClass} />
        <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="Reason" className={`${inputClass} flex-1 min-w-48`} />
        <button disabled={busy} className={btn.danger}>Add opt-out</button>
      </form>
      <ErrorNote error={error} />
      <div className="mb-4"><Tabs tabs={OPT_OUT_VIEWS} active={view} onChange={setView} /></div>
      <div className="flex flex-col gap-3">
        {items?.map((o) => (
          <div key={o._id} className="border border-line rounded-2xl px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold">{o.domain}</span>
                <StatusPill status={o.source === 'public_form' ? 'delayed' : 'neutral'} label={o.source === 'public_form' ? 'removal request' : 'admin'} />
                {o.activeKey ? <StatusPill status="opted_out" label="active" /> : <StatusPill status="cancelled" label="lifted" />}
              </div>
              <div className="text-[13px] font-semibold text-muted mt-1">
                {formatDate(o.createdAt)}
                {o.requestedBy?.email && ` · from ${o.requestedBy.name ? `${o.requestedBy.name} ` : ''}<${o.requestedBy.email}>`}
                {o.createdBy && ` · by ${o.createdBy.name}`}
                {o.relatedListing?.offerId && ` · offer ${o.relatedListing.offerId.slice(-6)}`}
                {o.acknowledgedAt && ` · acknowledged ${formatDate(o.acknowledgedAt)}${o.acknowledgedBy ? ` by ${o.acknowledgedBy.name}` : ''}`}
                {o.liftedAt && ` · lifted ${formatDate(o.liftedAt)}`}
              </div>
              {o.reason && <div className="text-[13px] font-semibold text-ink-soft mt-1">“{o.reason}”</div>}
            </div>
            <div className="flex gap-2">
              {o.source === 'public_form' && !o.acknowledgedAt && (
                <button disabled={busy} className={btn.good} onClick={() => act(`/admin/scraper/opt-outs/${o._id}/acknowledge`, 'PATCH')}>
                  Acknowledge
                </button>
              )}
              {o.activeKey && (
                <button
                  disabled={busy}
                  className={btn.outline}
                  onClick={() => act(`/admin/scraper/opt-outs/${o._id}`, 'DELETE', undefined, `Lift the opt-out for ${o.domain}? Nothing is republished, and the website has to be authorised again before it is crawled.`)}
                >
                  Lift
                </button>
              )}
            </div>
          </div>
        ))}
        {items && items.length === 0 && <EmptyState>{view === 'unacknowledged' ? 'No removal requests waiting.' : 'Nothing here.'}</EmptyState>}
      </div>
    </Card>
  );
}

export default function PoliciesPage() {
  return (
    <div className="flex flex-col gap-6">
      <OptOuts />
      <Providers />
    </div>
  );
}

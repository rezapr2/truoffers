'use client';

import { useState } from 'react';
import { btn, Card, EmptyState, Feedback, Field, inputClass, Modal, SectionTitle, Spinner, Tabs, Tag, Toggle } from '@/components/ui';
import { PlusIcon, TrashIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { AdminPage, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

type BlockKey = 'featuredTakeaways' | 'topPicks' | 'flashDeals';
interface Block {
  mode: 'auto' | 'manual';
  ids: string[];
}
type HomeConfig = Record<BlockKey, Block>;
interface Banner {
  id?: string;
  text: string;
  link?: string;
  tone?: 'sun' | 'leaf' | 'tomato';
  active: boolean;
}
interface Faq {
  question: string;
  answer: string;
}
interface HelpPage {
  _id: string;
  slug: string;
  title: string;
  body: string;
  published: boolean;
  sortOrder: number;
}

const TABS = [
  { value: 'home', label: 'Homepage' },
  { value: 'banners', label: 'Banners' },
  { value: 'faqs', label: 'FAQs' },
  { value: 'help', label: 'Help pages' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const BLOCKS: { key: BlockKey; title: string; kind: 'business' | 'offer'; auto: string }[] = [
  { key: 'featuredTakeaways', title: 'Featured takeaways', kind: 'business', auto: 'Automatic: businesses marked Featured, then the best-rated verified ones.' },
  { key: 'topPicks', title: 'Our top picks', kind: 'offer', auto: 'Automatic: featured offers, then the most clicked. Paid homepage spots always come first.' },
  { key: 'flashDeals', title: 'Ending soon', kind: 'offer', auto: 'Automatic: offers ending in the next 7 days. Paid flash deals always come first.' },
];

function Picker({ kind, onPick }: { kind: 'business' | 'offer'; onPick: (id: string, label: string) => void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const path = q.length < 2 ? null : kind === 'business' ? `/admin/businesses?status=active&q=${encodeURIComponent(q)}` : `/admin/offers?status=active,scheduled&q=${encodeURIComponent(q)}`;
  const { data } = useApi<{ items: { _id: string; name?: string; title?: string; town?: string; businessId?: { name: string } }[] }>(path);
  return (
    <div>
      <input className={inputClass} placeholder={kind === 'business' ? 'Search takeaways to add' : 'Search live offers to add'} value={query} onChange={(e) => setQuery(e.target.value)} />
      {data && q.length >= 2 && (
        <div className="flex flex-col gap-1 mt-1">
          {data.items.slice(0, 6).map((item) => {
            const label = kind === 'business' ? `${item.name}${item.town ? ` · ${item.town}` : ''}` : `${item.title} · ${item.businessId?.name ?? ''}`;
            return (
              <button
                key={item._id}
                type="button"
                className="text-left text-sm font-bold rounded-xl px-3 py-2 hover:bg-tint-blue cursor-pointer"
                onClick={() => {
                  onPick(item._id, label);
                  setQuery('');
                }}
              >
                + {label}
              </button>
            );
          })}
          {data.items.length === 0 && <p className="text-sm text-muted px-3">Nothing found.</p>}
        </div>
      )}
    </div>
  );
}

function HomeBlocks() {
  const config = useApi<HomeConfig>('/admin/content/home');
  const live = useApi<{ featured: { _id: string; name: string; town?: string }[]; topPicks: { _id: string; title: string }[]; flashDeals: { _id: string; title: string }[] }>('/content/home');
  const action = useAction();
  const [draft, setDraft] = useState<HomeConfig | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});

  if (!config.data) return config.error ? <Feedback error={config.error} /> : <Spinner />;
  const home = draft ?? config.data;
  const known: Record<string, string> = {
    ...Object.fromEntries((live.data?.featured ?? []).map((b) => [b._id, b.name])),
    ...Object.fromEntries([...(live.data?.topPicks ?? []), ...(live.data?.flashDeals ?? [])].map((o) => [o._id, o.title])),
    ...labels,
  };

  const setBlock = (key: BlockKey, block: Block) => setDraft({ ...home, [key]: block });
  const move = (key: BlockKey, i: number, d: number) => {
    const ids = [...home[key].ids];
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    setBlock(key, { ...home[key], ids });
  };

  const save = async () => {
    const result = await action.run('save', () => api<HomeConfig>('/admin/content/home', { method: 'PUT', body: JSON.stringify(home) }), 'Homepage saved');
    if (result) {
      config.setData(result);
      setDraft(null);
      await live.reload();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Feedback error={action.error} notice={action.notice} />
      <div className="grid xl:grid-cols-3 gap-6">
        {BLOCKS.map((b) => {
          const block = home[b.key];
          return (
            <Card key={b.key}>
              <SectionTitle>{b.title}</SectionTitle>
              <div className="flex gap-2 mb-4">
                <button className={block.mode === 'auto' ? btn.smallPrimary : btn.small} onClick={() => setBlock(b.key, { ...block, mode: 'auto' })}>
                  Automatic
                </button>
                <button className={block.mode === 'manual' ? btn.smallPrimary : btn.small} onClick={() => setBlock(b.key, { ...block, mode: 'manual' })}>
                  Hand-picked
                </button>
              </div>
              {block.mode === 'auto' ? (
                <p className="text-sm text-muted">{b.auto}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <ol className="flex flex-col gap-1.5">
                    {block.ids.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 bg-surface rounded-xl px-3 py-2 text-sm">
                        <span className="text-muted w-5">{i + 1}</span>
                        <span className="flex-1 font-bold truncate">{known[id] ?? id}</span>
                        <button className="cursor-pointer text-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(b.key, i, -1)} aria-label="Move up">
                          ↑
                        </button>
                        <button className="cursor-pointer text-muted disabled:opacity-30" disabled={i === block.ids.length - 1} onClick={() => move(b.key, i, 1)} aria-label="Move down">
                          ↓
                        </button>
                        <button className="cursor-pointer text-danger" onClick={() => setBlock(b.key, { ...block, ids: block.ids.filter((x) => x !== id) })} aria-label="Remove">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  {block.ids.length === 0 && <p className="text-sm text-muted">Nothing picked: the automatic list shows until you add some.</p>}
                  {block.ids.length < 12 && (
                    <Picker
                      kind={b.kind}
                      onPick={(id, label) => {
                        setLabels({ ...labels, [id]: label });
                        if (!block.ids.includes(id)) setBlock(b.key, { ...block, ids: [...block.ids, id] });
                      }}
                    />
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <div>
        <button className={btn.primary} disabled={!draft || !!action.busy} onClick={save}>
          Save homepage
        </button>
      </div>
    </div>
  );
}

function Banners() {
  const { data, error, setData } = useApi<Banner[]>('/admin/content/banners');
  const action = useAction();
  const [draft, setDraft] = useState<Banner[] | null>(null);
  if (!data) return error ? <Feedback error={error} /> : <Spinner />;
  const banners = draft ?? data;
  const update = (i: number, patch: Partial<Banner>) => setDraft(banners.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const save = async () => {
    const result = await action.run('save', () => api<Banner[]>('/admin/content/banners', { method: 'PUT', body: JSON.stringify({ banners: banners.filter((b) => b.text.trim()) }) }), 'Banners saved');
    if (result) {
      setData(result);
      setDraft(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Short messages across the top of the homepage, for news or campaigns.</p>
      <Feedback error={action.error} notice={action.notice} />
      {banners.map((b, i) => (
        <Card key={b.id ?? i}>
          <div className="grid md:grid-cols-[2fr_1.4fr_140px] gap-4 items-end">
            <Field label="Text">
              <input className={inputClass} value={b.text} onChange={(e) => update(i, { text: e.target.value })} />
            </Field>
            <Field label="Link">
              <input className={inputClass} placeholder="/pricing" value={b.link ?? ''} onChange={(e) => update(i, { link: e.target.value })} />
            </Field>
            <Field label="Colour">
              <select className={inputClass} value={b.tone ?? 'sun'} onChange={(e) => update(i, { tone: e.target.value as Banner['tone'] })}>
                <option value="sun">Yellow</option>
                <option value="leaf">Green</option>
                <option value="tomato">Red</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <Toggle checked={b.active} onChange={(v) => update(i, { active: v })} label="Showing" />
            <button className={`${btn.smallDanger} ml-auto`} onClick={() => setDraft(banners.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </Card>
      ))}
      <div className="flex gap-3">
        <button className={btn.secondary} onClick={() => setDraft([...banners, { text: '', tone: 'sun', active: true }])}>
          <PlusIcon className="w-4 h-4" /> Add banner
        </button>
        <button className={btn.primary} disabled={!draft || !!action.busy} onClick={save}>
          Save banners
        </button>
      </div>
    </div>
  );
}

function Faqs() {
  const { data, error, setData } = useApi<Faq[]>('/admin/content/faqs');
  const action = useAction();
  const [draft, setDraft] = useState<Faq[] | null>(null);
  if (!data) return error ? <Feedback error={error} /> : <Spinner />;
  const faqs = draft ?? data;
  const update = (i: number, patch: Partial<Faq>) => setDraft(faqs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const save = async () => {
    const result = await action.run('save', () => api<Faq[]>('/admin/content/faqs', { method: 'PUT', body: JSON.stringify({ faqs }) }), 'FAQs saved');
    if (result) {
      setData(result);
      setDraft(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Shown on the pricing and help pages.</p>
      <Feedback error={action.error} notice={action.notice} />
      {faqs.map((f, i) => (
        <Card key={i}>
          <div className="flex flex-col gap-3">
            <Field label="Question">
              <input className={inputClass} value={f.question} onChange={(e) => update(i, { question: e.target.value })} />
            </Field>
            <Field label="Answer">
              <textarea rows={3} className={inputClass} value={f.answer} onChange={(e) => update(i, { answer: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <button className={btn.small} disabled={i === 0} onClick={() => setDraft(faqs.map((x, j) => (j === i - 1 ? faqs[i] : j === i ? faqs[i - 1] : x)))}>
                ↑ Up
              </button>
              <button className={btn.small} disabled={i === faqs.length - 1} onClick={() => setDraft(faqs.map((x, j) => (j === i + 1 ? faqs[i] : j === i ? faqs[i + 1] : x)))}>
                ↓ Down
              </button>
              <button className={`${btn.smallDanger} ml-auto`} onClick={() => setDraft(faqs.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        </Card>
      ))}
      <div className="flex gap-3">
        <button className={btn.secondary} onClick={() => setDraft([...faqs, { question: '', answer: '' }])}>
          <PlusIcon className="w-4 h-4" /> Add question
        </button>
        <button className={btn.primary} disabled={!draft || !!action.busy} onClick={save}>
          Save FAQs
        </button>
      </div>
    </div>
  );
}

function HelpPages() {
  const { data, error, reload } = useApi<HelpPage[]>('/admin/content/help');
  const action = useAction();
  const [editing, setEditing] = useState<{ id: string | null; form: Omit<HelpPage, '_id'> } | null>(null);

  const save = async () => {
    if (!editing) return;
    const body = { ...editing.form, sortOrder: Number(editing.form.sortOrder) };
    const r = await action.run('save', () => (editing.id ? api(`/admin/content/help/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/admin/content/help', { method: 'POST', body: JSON.stringify(body) })), 'Page saved');
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  };
  const remove = async (p: HelpPage) => {
    if (!window.confirm(`Delete “${p.title}”?`)) return;
    await action.run(p._id, () => api(`/admin/content/help/${p._id}`, { method: 'DELETE' }), 'Deleted');
    await reload();
  };

  return (
    <>
      <div className="flex justify-between items-center gap-3 mb-4">
        <p className="text-sm text-muted">Pages under /help, such as how verification works or how to remove a listing.</p>
        <button className={btn.primary} onClick={() => setEditing({ id: null, form: { slug: '', title: '', body: '', published: false, sortOrder: 0 } })}>
          <PlusIcon className="w-4 h-4" /> New page
        </button>
      </div>
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No help pages yet" />
      ) : (
        <Table minWidth={640}>
          <thead className="bg-surface">
            <tr>
              <Th>Title</Th>
              <Th>Address</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setEditing({ id: p._id, form: { slug: p.slug, title: p.title, body: p.body, published: p.published, sortOrder: p.sortOrder } })}>
                <Td className="font-extrabold">{p.title}</Td>
                <Td className="font-mono text-[12.5px]">/help/{p.slug}</Td>
                <Td>{p.published ? <Tag tone="good">Published</Tag> : <Tag>Draft</Tag>}</Td>
                <Td>
                  <button
                    className={btn.smallDanger}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(p);
                    }}
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? 'Edit help page' : 'New help page'}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className={btn.primary} disabled={!editing?.form.title || !!action.busy} onClick={save}>
              Save
            </button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <Field label="Title" required>
              <input className={inputClass} value={editing.form.title} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, title: e.target.value } })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Address" hint="Empty = from the title">
                <input className={inputClass} value={editing.form.slug} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, slug: e.target.value } })} />
              </Field>
              <Field label="Sort order">
                <input type="number" className={inputClass} value={editing.form.sortOrder} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sortOrder: Number(e.target.value) } })} />
              </Field>
            </div>
            <Field label="Body" hint="Plain text. A blank line starts a new paragraph; lines starting with ## become headings.">
              <textarea rows={14} className={`${inputClass} font-mono text-sm`} value={editing.form.body} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, body: e.target.value } })} />
            </Field>
            <Toggle checked={editing.form.published} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, published: v } })} label="Published" />
          </div>
        )}
      </Modal>
    </>
  );
}

export default function AdminContentPage() {
  const [tab, setTab] = useState<Tab>('home');
  return (
    <RequireCapability capability="content.manage">
      <AdminPage title="Content" subtitle="The homepage blocks, banners, FAQs and help pages.">
        <div className="mb-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
        {tab === 'home' && <HomeBlocks />}
        {tab === 'banners' && <Banners />}
        {tab === 'faqs' && <Faqs />}
        {tab === 'help' && <HelpPages />}
      </AdminPage>
    </RequireCapability>
  );
}

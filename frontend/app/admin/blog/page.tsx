'use client';

import Link from 'next/link';
import { useState } from 'react';
import BlogCover from '@/components/BlogCover';
import { btn, Drawer, EmptyState, Feedback, Field, inputClass, Spinner, Tabs, Tag } from '@/components/ui';
import { PlusIcon, UploadIcon } from '@/components/icons';
import { api, upload } from '@/lib/api';
import { date } from '@/lib/format';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Post {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverUrl?: string;
  tags: string[];
  status: 'draft' | 'published';
  publishedAt?: string;
  updatedAt: string;
  authorName?: string;
  seoTitle?: string;
  seoDescription?: string;
}

type Form = Pick<Post, 'title' | 'slug' | 'excerpt' | 'body' | 'coverUrl' | 'status' | 'seoTitle' | 'seoDescription'> & { tags: string };

const EMPTY: Form = { title: '', slug: '', excerpt: '', body: '', coverUrl: '', status: 'draft', seoTitle: '', seoDescription: '', tags: '' };
const TABS = [
  { value: '', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
] as const;

function Editor({ post, onClose, onSaved }: { post: Post | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(post ? { ...post, tags: post.tags.join(', '), seoTitle: post.seoTitle ?? '', seoDescription: post.seoDescription ?? '', coverUrl: post.coverUrl ?? '' } : EMPTY);
  const action = useAction();
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  const save = async (status?: 'draft' | 'published') => {
    const body = { ...form, status: status ?? form.status, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), slug: form.slug || undefined };
    const r = await action.run('save', () => (post ? api(`/admin/blog/${post._id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/admin/blog', { method: 'POST', body: JSON.stringify(body) })));
    if (r !== undefined) onSaved();
  };

  const remove = async () => {
    if (!post || !window.confirm(`Delete “${post.title}”? This can’t be undone.`)) return;
    const r = await action.run('delete', () => api(`/admin/blog/${post._id}`, { method: 'DELETE' }));
    if (r !== undefined) onSaved();
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    const r = await action.run('cover', () => upload<{ url: string }>('/uploads/image', file));
    if (r) set({ coverUrl: r.url });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={post ? 'Edit post' : 'New post'}
      subtitle={post?.status === 'published' ? (
        <Link href={`/blog/${post.slug}`} target="_blank" className="text-primary font-bold">
          View on the site ↗
        </Link>
      ) : 'Drafts are only visible here.'}
      footer={
        <>
          {form.status === 'published' ? (
            <>
              <button className={btn.primary} disabled={!form.title || !!action.busy} onClick={() => save()}>
                Save
              </button>
              <button className={btn.secondary} disabled={!!action.busy} onClick={() => save('draft')}>
                Unpublish
              </button>
            </>
          ) : (
            <>
              <button className={btn.primary} disabled={!form.title || !!action.busy} onClick={() => save('published')}>
                Publish
              </button>
              <button className={btn.secondary} disabled={!form.title || !!action.busy} onClick={() => save('draft')}>
                Save draft
              </button>
            </>
          )}
          {post && (
            <button className={`${btn.danger} ml-auto`} disabled={!!action.busy} onClick={remove}>
              Delete
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Feedback error={action.error} />
        <Field label="Title" required>
          <input className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Address" hint={`/blog/${form.slug || 'from-the-title'}`}>
          <input className={inputClass} value={form.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="Leave empty to use the title" />
        </Field>
        <Field label="Summary" hint="Shown on the blog page and in search results.">
          <textarea className={inputClass} rows={2} value={form.excerpt} onChange={(e) => set({ excerpt: e.target.value })} maxLength={400} />
        </Field>
        <Field label="Cover image">
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl overflow-hidden max-w-sm">
              <BlogCover url={form.coverUrl || undefined} title={form.title || 'Your post'} label={form.tags.split(',')[0]?.trim() || undefined} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <label className={`${btn.small} cursor-pointer`}>
                <UploadIcon className="w-4 h-4" /> {form.coverUrl ? 'Replace' : 'Upload'} image
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => uploadCover(e.target.files?.[0])} />
              </label>
              {form.coverUrl && (
                <button type="button" className={btn.small} onClick={() => set({ coverUrl: '' })}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </Field>
        <Field label="Body" hint="Plain text. A blank line starts a new paragraph, ## starts a heading and - starts a list item.">
          <textarea className={`${inputClass} font-mono text-sm`} rows={16} value={form.body} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. City guides, For owners">
          <input className={inputClass} value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Search title" hint="Up to 70 characters. Empty = the title.">
            <input className={inputClass} maxLength={70} value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
          </Field>
          <Field label="Search description" hint="Up to 170 characters. Empty = the summary.">
            <input className={inputClass} maxLength={170} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}

function BlogAdmin() {
  const [status, setStatus] = useState<'' | 'published' | 'draft'>('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const { data, error, reload } = useApi<Post[]>(`/admin/blog${qs({ status, q })}`);
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AdminPage
      title="Blog"
      subtitle="Guides and news on /blog."
      actions={
        <button className={btn.primary} onClick={() => setEditing('new')}>
          <PlusIcon className="w-4 h-4" /> New post
        </button>
      }
    >
      <div className="mb-5">
        <Tabs tabs={TABS} active={status} onChange={setStatus} />
      </div>
      <ListToolbar search={search} onSearch={setSearch} placeholder="Search titles" />
      <Feedback error={error} notice={notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No posts">Write the first one with “New post”.</EmptyState>
      ) : (
        <Table minWidth={760}>
          <thead className="bg-surface">
            <tr>
              <Th>Post</Th>
              <Th>Tags</Th>
              <Th>Published</Th>
              <Th>Updated</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setEditing(p)}>
                <Td>
                  <div className="font-extrabold">{p.title}</div>
                  <div className="text-[12.5px] text-muted font-mono">/blog/{p.slug}</div>
                </Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    {p.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                </Td>
                <Td className="text-[13px]">{p.publishedAt ? date(p.publishedAt) : '—'}</Td>
                <Td className="text-[13px]">{date(p.updatedAt)}</Td>
                <Td>{p.status === 'published' ? <Tag tone="good">Published</Tag> : <Tag>Draft</Tag>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <Editor
          post={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice('Saved');
            void reload();
          }}
        />
      )}
    </AdminPage>
  );
}

export default function AdminBlogPage() {
  return (
    <RequireCapability capability="content.manage">
      <BlogAdmin />
    </RequireCapability>
  );
}

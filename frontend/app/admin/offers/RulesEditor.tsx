'use client';

import { useState } from 'react';
import { btn, Feedback, Field, inputClass, Modal, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';

interface Rules {
  moderation: { bannedWords: string[]; maxDiscountPercent: number; checkLinkDomain: boolean };
  knownOrderingDomains: string[];
}

/** Spec "Moderation rules": banned words, a maximum discount, and the link-domain check. */
export function RulesEditor({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const { data, setData } = useApi<Rules>(open ? '/admin/settings/moderation' : null);
  const action = useAction();
  const [words, setWords] = useState<string | null>(null);

  if (!open) return null;
  const rules = data?.moderation;
  const wordText = words ?? rules?.bannedWords.join('\n') ?? '';

  const save = async () => {
    if (!rules || !data) return;
    const bannedWords = wordText.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
    const result = await action.run(
      'save',
      () => api<{ moderation: Rules['moderation'] }>('/admin/settings/moderation', { method: 'PUT', body: JSON.stringify({ ...rules, bannedWords }) }),
      'Rules saved. They apply to offers submitted from now on.',
    );
    if (result) {
      setData({ ...data, moderation: result.moderation });
      setWords(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Moderation rules"
      footer={
        canEdit ? (
          <>
            <button className={btn.secondary} onClick={onClose}>
              Close
            </button>
            <button className={btn.primary} disabled={!rules || !!action.busy} onClick={save}>
              Save rules
            </button>
          </>
        ) : undefined
      }
    >
      {!rules || !data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted">An offer that breaks a rule goes to the review queue instead of going live, even on a plan with auto-approve.</p>
          <Field label="Banned words" hint="One per line. Matched as whole words in the title, label, description and terms.">
            <textarea rows={6} className={inputClass} value={wordText} disabled={!canEdit} onChange={(e) => setWords(e.target.value)} />
          </Field>
          <Field label="Maximum discount (%)" hint="A percentage discount above this is held for review.">
            <input
              type="number"
              min={1}
              max={100}
              className={inputClass}
              disabled={!canEdit}
              value={rules.maxDiscountPercent}
              onChange={(e) => setData({ ...data, moderation: { ...rules, maxDiscountPercent: Number(e.target.value) } })}
            />
          </Field>
          <Toggle
            checked={rules.checkLinkDomain}
            disabled={!canEdit}
            onChange={(v) => setData({ ...data, moderation: { ...rules, checkLinkDomain: v } })}
            label="Check the offer link’s domain"
            hint={`The link must go to the business’s own website or a known ordering provider (${data.knownOrderingDomains.slice(0, 4).join(', ')}…). Edit providers in Settings.`}
          />
          {!canEdit && <p className="text-sm text-muted font-semibold">Only admins can change the rules.</p>}
          <Feedback error={action.error} notice={action.notice} />
        </div>
      )}
    </Modal>
  );
}

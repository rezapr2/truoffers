/**
 * Built-in transactional emails. Admins can edit the subject and body of each one in /admin/notifications;
 * an edit is stored as an EmailTemplate document and wins over the default here. Bodies are plain text with
 * {{variable}} placeholders; links on their own line become buttons in the HTML version.
 */
export interface TemplateDefinition {
  key: string;
  name: string;
  // Who receives it, shown in the admin editor
  audience: 'customer' | 'business' | 'staff' | 'reporter';
  variables: string[];
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: TemplateDefinition[] = [
  {
    key: 'email_verification',
    name: 'Verify your email',
    audience: 'customer',
    variables: ['name', 'link'],
    subject: 'Confirm your email for {{siteName}}',
    body: 'Hi {{name}},\n\nPlease confirm your email address to finish setting up your account:\n\n{{link}}\n\nThe link works for 48 hours. If you did not create an account, ignore this email.',
  },
  {
    key: 'password_reset',
    name: 'Reset your password',
    audience: 'customer',
    variables: ['name', 'link'],
    subject: 'Reset your {{siteName}} password',
    body: 'Hi {{name}},\n\nUse this link to choose a new password:\n\n{{link}}\n\nThe link works for 1 hour. If you did not ask for this, you can ignore this email.',
  },
  {
    key: 'team_invite',
    name: 'Invitation to a business team',
    audience: 'business',
    variables: ['businessName', 'inviterName', 'role', 'link'],
    subject: '{{inviterName}} invited you to manage {{businessName}} on {{siteName}}',
    body: 'Hi,\n\n{{inviterName}} has invited you to join {{businessName}} on {{siteName}} as {{role}}.\n\n{{link}}\n\nThe invitation works for 7 days.',
  },
  {
    key: 'staff_invite',
    name: 'Invitation to the admin team',
    audience: 'staff',
    variables: ['name', 'role', 'link'],
    subject: 'You have been added to the {{siteName}} admin team',
    body: 'Hi {{name}},\n\nYou now have {{role}} access to {{siteName}}. Set your password here, then set up two-factor sign-in when you first log in:\n\n{{link}}',
  },
  {
    key: 'claim_submitted',
    name: 'Claim submitted',
    audience: 'business',
    variables: ['businessName'],
    subject: 'We have your verification for {{businessName}}',
    body: 'Thanks. A moderator will check the evidence for {{businessName}}, usually within 1 working day. We will email you as soon as it is done.',
  },
  {
    key: 'claim_approved',
    name: 'Claim approved',
    audience: 'business',
    variables: ['businessName', 'link'],
    subject: '{{businessName}} is now TruOffers verified',
    body: 'Good news: {{businessName}} is verified. Your listing shows the TruOffers verified badge, your offers can go live and you can choose a plan or promote an offer.\n\n{{link}}',
  },
  {
    key: 'claim_rejected',
    name: 'Claim rejected',
    audience: 'business',
    variables: ['businessName', 'reason', 'note'],
    subject: 'We could not verify {{businessName}}',
    body: 'We were unable to verify {{businessName}}.\n\nReason: {{reason}}\n{{note}}\n\nIf you think this is a mistake, reply to this email.',
  },
  {
    key: 'claim_info_requested',
    name: 'More information needed',
    audience: 'business',
    variables: ['businessName', 'message', 'expiresOn', 'link'],
    subject: 'We need a little more to verify {{businessName}}',
    body: 'A moderator looked at your verification for {{businessName}} and needs more information:\n\n{{message}}\n\nPlease add it by {{expiresOn}}, or the claim will close:\n\n{{link}}',
  },
  {
    key: 'claim_expired',
    name: 'Claim expired',
    audience: 'business',
    variables: ['businessName', 'link'],
    subject: 'Your claim for {{businessName}} has closed',
    body: 'We did not hear back within 14 days, so the claim for {{businessName}} has closed. You can start again at any time:\n\n{{link}}',
  },
  {
    key: 'claim_disputed',
    name: 'Listing disputed',
    audience: 'business',
    variables: ['businessName'],
    subject: 'Someone else has claimed {{businessName}}',
    body: 'Another person has also proved access to the phone line of {{businessName}}. While our team looks into it, changes to the listing are paused. We may contact you for evidence.',
  },
  {
    key: 'domain_verification_code',
    name: 'Website email check code',
    audience: 'business',
    variables: ['businessName', 'code'],
    subject: 'Your {{siteName}} verification code: {{code}}',
    body: 'Enter this code to confirm that {{businessName}} uses this email address:\n\n{{code}}\n\nIt expires in 30 minutes.',
  },
  {
    key: 'change_request_decided',
    name: 'Profile change reviewed',
    audience: 'business',
    variables: ['businessName', 'outcome', 'fields', 'note'],
    subject: 'Your change to {{businessName}} was {{outcome}}',
    body: 'A moderator has {{outcome}} your change to {{fields}} for {{businessName}}.\n{{note}}',
  },
  {
    key: 'reverification_due',
    name: 'Yearly re-verification',
    audience: 'business',
    variables: ['businessName', 'link'],
    subject: 'Time to re-verify {{businessName}}',
    body: 'It has been a year since {{businessName}} was verified. Please confirm you still run it; your badge stays while you do.\n\n{{link}}',
  },
  {
    key: 'offer_approved',
    name: 'Offer approved',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'link'],
    subject: 'Your offer "{{offerTitle}}" is approved',
    body: '"{{offerTitle}}" for {{businessName}} has been approved and is live (or will go live at its start time).\n\n{{link}}',
  },
  {
    key: 'offer_rejected',
    name: 'Offer rejected',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'reason'],
    subject: 'Your offer "{{offerTitle}}" needs changes',
    body: 'A moderator could not approve "{{offerTitle}}" for {{businessName}}.\n\nReason: {{reason}}\n\nEdit the offer and submit it again from your dashboard.',
  },
  {
    key: 'offer_expiring',
    name: 'Offer ending in 2 days',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'endsOn', 'link'],
    subject: '"{{offerTitle}}" ends on {{endsOn}}',
    body: 'Your offer "{{offerTitle}}" for {{businessName}} ends on {{endsOn}}. Extend it or post a new one to stay visible:\n\n{{link}}',
  },
  {
    key: 'follower_offer_alert',
    name: 'New offer from a takeaway you follow',
    audience: 'customer',
    variables: ['businessName', 'offerTitle', 'link'],
    subject: 'New at {{businessName}}: {{offerTitle}}',
    body: '{{businessName}} has a new offer: {{offerTitle}}\n\n{{link}}\n\nYou get this because you follow {{businessName}}. Unfollow on their page to stop these emails.',
  },
  {
    key: 'report_info_requested',
    name: 'Report: business asked to respond',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'message', 'deadline', 'link'],
    subject: 'Please check your offer "{{offerTitle}}"',
    body: 'Customers have reported a problem with "{{offerTitle}}" ({{businessName}}).\n\n{{message}}\n\nPlease reply or edit the offer by {{deadline}}:\n\n{{link}}',
  },
  {
    key: 'report_upheld_business',
    name: 'Report upheld: offer removed',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'reason', 'note', 'link'],
    subject: 'Your offer "{{offerTitle}}" has been removed',
    body: 'After reviewing customer reports we removed "{{offerTitle}}" ({{businessName}}).\n\nReason: {{reason}}\n{{note}}\n\nYou can appeal once from your dashboard:\n\n{{link}}',
  },
  {
    key: 'report_outcome_action',
    name: 'Report outcome: action taken',
    audience: 'reporter',
    variables: ['offerTitle'],
    subject: 'Thanks for your report',
    body: 'Thanks for reporting "{{offerTitle}}". We looked into it and have taken action.',
  },
  {
    key: 'report_outcome_no_action',
    name: 'Report outcome: no action',
    audience: 'reporter',
    variables: ['offerTitle'],
    subject: 'Thanks for your report',
    body: 'Thanks for reporting "{{offerTitle}}". We looked into it and the offer meets our rules, so it stays up.',
  },
  {
    key: 'subscription_started',
    name: 'Plan started',
    audience: 'business',
    variables: ['businessName', 'planName', 'link'],
    subject: '{{businessName}} is now on {{planName}}',
    body: 'Thanks! {{businessName}} is on the {{planName}} plan and your new limits apply straight away.\n\n{{link}}',
  },
  {
    key: 'subscription_renewal',
    name: 'Plan renewal reminder',
    audience: 'business',
    variables: ['businessName', 'planName', 'renewsOn', 'amount', 'link'],
    subject: 'Your {{planName}} plan renews on {{renewsOn}}',
    body: 'Your {{planName}} plan for {{businessName}} renews on {{renewsOn}} for {{amount}}. Manage it here:\n\n{{link}}',
  },
  {
    key: 'payment_failed',
    name: 'Payment failed',
    audience: 'business',
    variables: ['businessName', 'planName', 'attempt', 'downgradeOn', 'link'],
    subject: 'Payment failed for {{businessName}} ({{attempt}} of 3)',
    body: 'We could not take payment for the {{planName}} plan of {{businessName}}. Please update your card; if payment still fails, the plan moves to Free on {{downgradeOn}}.\n\n{{link}}',
  },
  {
    key: 'plan_downgraded',
    name: 'Moved to the Free plan',
    audience: 'business',
    variables: ['businessName', 'link'],
    subject: '{{businessName}} is now on the Free plan',
    body: 'Your paid plan for {{businessName}} has ended and the listing is on the Free plan. Upgrade again any time:\n\n{{link}}',
  },
  {
    key: 'promotion_live',
    name: 'Promotion live',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'productName', 'endsOn'],
    subject: 'Your {{productName}} promotion is live',
    body: '"{{offerTitle}}" is now promoted as {{productName}} until {{endsOn}}.',
  },
  {
    key: 'promotion_ended',
    name: 'Promotion ended (renewal)',
    audience: 'business',
    variables: ['businessName', 'offerTitle', 'productName', 'link'],
    subject: 'Your {{productName}} promotion has ended',
    body: 'Your {{productName}} promotion for "{{offerTitle}}" has ended. Book it again to keep the spot:\n\n{{link}}',
  },
  {
    key: 'business_suspended',
    name: 'Business suspended',
    audience: 'business',
    variables: ['businessName', 'reason'],
    subject: '{{businessName}} has been suspended',
    body: '{{businessName}} has been suspended from {{siteName}} and is hidden from the site.\n\nReason: {{reason}}\n\nReply to this email if you would like to discuss it.',
  },
  {
    key: 'monthly_report',
    name: 'Monthly performance report',
    audience: 'business',
    variables: ['businessName', 'month', 'impressions', 'profileViews', 'redeemTaps', 'orderClicks', 'calls', 'link'],
    subject: '{{businessName}} on {{siteName}}: your {{month}} report',
    body: 'Here is how {{businessName}} did in {{month}}:\n\nImpressions: {{impressions}}\nProfile views: {{profileViews}}\nRedeem taps: {{redeemTaps}}\nOrder clicks: {{orderClicks}}\nCalls: {{calls}}\n\nSee the details:\n\n{{link}}',
  },
];

export const TEMPLATE_BY_KEY = new Map(EMAIL_TEMPLATES.map((t) => [t.key, t]));

export function renderTemplate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Plain text to a simple branded HTML email: paragraphs, and a URL on its own line as a button.
export function textToHtml(body: string, siteName: string): string {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^https?:\/\/\S+$/.test(block)) {
        const url = escapeHtml(block);
        return `<p style="margin:24px 0"><a href="${url}" style="background:#0F7048;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Open</a></p><p style="font-size:12px;color:#737888;word-break:break-all">${url}</p>`;
      }
      return `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#F6F5EF;font-family:Helvetica,Arial,sans-serif;color:#161821"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="font-weight:700;font-size:20px;color:#0F7048;margin-bottom:24px">${escapeHtml(siteName)}</div><div style="background:#fff;border-radius:20px;padding:28px;font-size:15px">${blocks}</div></div></body></html>`;
}

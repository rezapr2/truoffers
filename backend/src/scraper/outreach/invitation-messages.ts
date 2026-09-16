/**
 * Spec §14 wording, for an administrator to copy. Nothing here sends anything: these are strings the admin
 * pastes into their own email, WhatsApp or phone call, having checked PECR applies (see the admin page).
 */

export interface InvitationContext {
  businessName: string;
  claimUrl: string;
  offerTitle?: string;
  expiresAt: Date;
}

// The wording the spec asks for, used unchanged in every channel.
export const CLAIM_PITCH =
  'We found and listed your current offer on TruOffers so nearby customers can discover it and order directly from you. ' +
  'Claim your free business page to verify the offer, update the details and track website and telephone clicks. ' +
  'TruOffers does not take orders or charge commission.';

const ukDate = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export interface InvitationMessages {
  email: { subject: string; body: string };
  whatsapp: string;
  phone: string;
}

export function invitationMessages({ businessName, claimUrl, offerTitle, expiresAt }: InvitationContext): InvitationMessages {
  const offer = offerTitle ? `“${offerTitle}”` : 'your current offer';
  return {
    email: {
      subject: `${businessName}: your offer is listed on TruOffers`,
      body: [
        `Hello ${businessName},`,
        '',
        CLAIM_PITCH,
        '',
        `We are showing ${offer} from your website. Claim your page here:`,
        claimUrl,
        '',
        `This link is for ${businessName} and works until ${ukDate(expiresAt)}.`,
        'If you would rather we did not list your offers at all, reply to this email and we will remove them.',
      ].join('\n'),
    },
    whatsapp: [
      `Hello ${businessName} — ${CLAIM_PITCH}`,
      '',
      `Claim your page: ${claimUrl}`,
      `(The link works until ${ukDate(expiresAt)}. Tell us if you would rather not be listed.)`,
    ].join('\n'),
    phone: [
      `Calling ${businessName}, ask for the owner or manager.`,
      '',
      `1. "${CLAIM_PITCH}"`,
      `2. We found ${offer} on your own website. It is live now, and you can correct or remove it once you claim the page.`,
      '3. Offer to send the claim link by text or email:',
      `   ${claimUrl}`,
      `4. The link works until ${ukDate(expiresAt)}.`,
      '5. If they would rather not be listed, tell them we will remove it today, and record an opt-out.',
    ].join('\n'),
  };
}

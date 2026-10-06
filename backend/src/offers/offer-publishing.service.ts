import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BusinessStatus,
  DiscountType,
  isVerifiedLevel,
  OfferStatus,
  PLAN_COUNTED_OFFER_STATUSES,
  PUBLIC_OFFER_STATUSES,
} from '../common/enums';
import { recountActiveOffers } from '../common/offer-counts';
import { checkLink } from '../common/order-link';
import { offerSlug } from '../common/public-offer';
import { OfferOrigin } from '../common/scraper.enums';
import { siteUrl } from '../platform/email.service';
import { EmailService } from '../platform/email.service';
import { SettingsService } from '../platform/settings.service';
import { PlanLean, PlansService } from '../plans/plans.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { ModerationRules } from '../schemas/site-settings.schema';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';

type ModeratedFields = Pick<Offer, 'title' | 'description' | 'terms' | 'displayLabel' | 'discountType' | 'value' | 'redemptionUrl'>;

export const MODERATION_FLAG_LABELS: Record<string, string> = {
  banned_word: 'Contains a banned word',
  discount_too_high: 'Discount above the limit',
  link_domain_mismatch: "Link is not the business's website or a known ordering provider",
};

/**
 * Spec "Moderation rules": banned words, a maximum discount, and the offer link's domain. An offer that trips
 * one goes to the moderator queue instead of publishing itself.
 */
export function moderationFlags(
  offer: ModeratedFields,
  business: { website?: string | null; orderUrl?: string | null },
  rules: ModerationRules,
  knownProviders: readonly string[],
): string[] {
  const flags: string[] = [];
  const text = [offer.title, offer.description, offer.terms, offer.displayLabel].filter(Boolean).join(' ').toLowerCase();
  const hit = (rules.bannedWords ?? []).find((word) => {
    const w = word.trim().toLowerCase();
    return w && new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  });
  if (hit) flags.push(`banned_word:${hit}`);
  if (offer.discountType === DiscountType.PERCENT && (offer.value ?? 0) > (rules.maxDiscountPercent ?? 70)) flags.push('discount_too_high');
  if (rules.checkLinkDomain !== false && offer.redemptionUrl) {
    const result = checkLink(offer.redemptionUrl, business, knownProviders, { againstOrderUrl: true });
    if (result === 'mismatch' || result === 'invalid') flags.push('link_domain_mismatch');
  }
  return flags;
}

export interface PublishDecision {
  status: OfferStatus;
  flags: string[];
  // Why it didn't publish straight away, for the owner
  reason?: 'not_verified' | 'business_not_active' | 'plan_review' | 'moderation_rules';
}

/** Where a submitted offer goes, per the spec's offer lifecycle. */
@Injectable()
export class OfferPublishingService {
  private readonly logger = new Logger(OfferPublishingService.name);

  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * - Not verified yet (level 0/1) or a hidden listing: saved as a draft, submitted automatically on verification.
   * - Verified on a plan with auto-approve and no moderation flag: live, or scheduled when it starts later.
   * - Otherwise (Free plan, or a flag): the moderator queue.
   */
  async decide(business: BusinessDocument | Business, offer: ModeratedFields & Pick<Offer, 'startsAt'>, plan?: PlanLean): Promise<PublishDecision> {
    if (!isVerifiedLevel(business.verificationLevel)) return { status: OfferStatus.DRAFT, flags: [], reason: 'not_verified' };
    if (business.status !== BusinessStatus.ACTIVE) return { status: OfferStatus.DRAFT, flags: [], reason: 'business_not_active' };
    const settings = await this.settings.get();
    const flags = moderationFlags(offer, business, settings.moderation, settings.knownOrderingDomains);
    const effectivePlan = plan ?? (await this.plans.planFor((business as BusinessDocument)._id));
    if (!effectivePlan.autoApprove) return { status: OfferStatus.PENDING, flags, reason: 'plan_review' };
    if (flags.length) return { status: OfferStatus.PENDING, flags, reason: 'moderation_rules' };
    return { status: this.liveStatus(offer), flags };
  }

  liveStatus(offer: Pick<Offer, 'startsAt'>): OfferStatus {
    return offer.startsAt && offer.startsAt.getTime() > Date.now() ? OfferStatus.SCHEDULED : OfferStatus.ACTIVE;
  }

  /** Spec T3.5: live offers capped per plan. Imported offers from the business's own website don't count. */
  async assertWithinLimit(business: BusinessDocument, plan: PlanLean, excludeOfferId?: Types.ObjectId) {
    const max = plan.limits?.maxLiveOffers ?? 2;
    if (max < 0) return;
    const count = await this.offers.countDocuments({
      businessId: business._id,
      status: { $in: PLAN_COUNTED_OFFER_STATUSES },
      origin: { $ne: OfferOrigin.SCRAPER },
      ...(excludeOfferId ? { _id: { $ne: excludeOfferId } } : {}),
    });
    if (count >= max) {
      throw new ForbiddenException({
        message: `Your ${plan.name} plan allows ${max} live offer${max === 1 ? '' : 's'}. Pause one, or upgrade to post more.`,
        code: 'plan_limit',
        limit: max,
      });
    }
  }

  /** After a status change: denormalised counts, the first-publish date and follower alerts. */
  async afterStatusChange(offer: OfferDocument, previous: OfferStatus | undefined) {
    if (offer.status === OfferStatus.ACTIVE && previous !== OfferStatus.ACTIVE) {
      if (!offer.publishedAt) {
        await this.offers.updateOne({ _id: offer._id }, { $set: { publishedAt: new Date() } });
        await this.alertFollowers(offer);
      }
    }
    await recountActiveOffers(this.offers, this.businesses, offer.businessId);
  }

  /**
   * Spec: followers get an email when a takeaway they follow posts an offer (email alerts only, no push). Sent
   * once per offer, the first time it goes live.
   */
  async alertFollowers(offer: Pick<Offer, 'title' | 'businessId'> & { _id: Types.ObjectId }) {
    try {
      const business = await this.businesses.findById(offer.businessId).select('name slug').lean();
      if (!business) return;
      const followers = await this.users
        .find({ followedBusinesses: String(offer.businessId), offerAlerts: { $ne: false }, status: UserStatus.ACTIVE })
        .select('email')
        .limit(2000)
        .lean();
      const link = siteUrl(`/offer/${offer._id}-${offerSlug(offer.title, business.name)}`);
      for (const follower of followers) {
        await this.email.send({ to: follower.email, template: 'follower_offer_alert', vars: { businessName: business.name, offerTitle: offer.title, link } });
      }
    } catch (err) {
      this.logger.warn(`Follower alerts for ${String(offer._id)} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Spec: "Offers from a Level 1 business are saved as drafts and go live only after verification." When the
   * claim is approved, the drafts the owner submitted go through the normal decision.
   */
  async submitHeldDrafts(businessId: Types.ObjectId) {
    const business = await this.businesses.findById(businessId);
    if (!business) return { submitted: 0 };
    const drafts = await this.offers.find({ businessId, status: OfferStatus.DRAFT, submitWhenVerified: true });
    const plan = await this.plans.planFor(businessId);
    let submitted = 0;
    for (const offer of drafts) {
      try {
        await this.assertWithinLimit(business, plan, offer._id);
      } catch {
        // Over the plan's limit: it stays a draft; the owner sees the upgrade prompt when they submit it.
        continue;
      }
      const decision = await this.decide(business, offer, plan);
      const previous = offer.status;
      offer.set({ status: decision.status, moderationFlags: decision.flags.length ? decision.flags : undefined, submitWhenVerified: false });
      await offer.save();
      await this.afterStatusChange(offer, previous);
      await this.audit.record({ action: 'offer.submitted_on_verification', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: decision.status, flags: decision.flags } });
      submitted++;
    }
    return { submitted };
  }

  isPublic(status: OfferStatus) {
    return PUBLIC_OFFER_STATUSES.includes(status);
  }
}

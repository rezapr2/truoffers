import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PLAN_GRANTING_STATUSES, PlanKey } from '../common/enums';
import { Plan, PlanDocument, PlanSchema } from '../schemas/plan.schema';
import { Subscription, SubscriptionDocument, SubscriptionSchema } from '../schemas/subscription.schema';

export type PlanLean = Plan & { _id: Types.ObjectId };

// Used only if the Free plan document is missing (a fresh database before the seed or migration ran).
export const FALLBACK_FREE_PLAN: PlanLean = {
  _id: new Types.ObjectId('000000000000000000000000'),
  key: PlanKey.FREE,
  name: 'Free',
  audience: 'takeaway',
  monthlyPrice: 0,
  annualPrice: 0,
  trialDays: 0,
  limits: { maxLiveOffers: 2, maxPhotos: 5, maxBranches: 1 },
  flags: {
    scheduledOffers: false,
    couponCodes: false,
    analytics: 'views',
    aiOfferWriter: false,
    qrCodes: false,
    rankingBoost: 0,
    prioritySupport: false,
    freeTopOfSearchWeeksPerMonth: 0,
  },
  features: [],
  autoApprove: false,
  isPublic: true,
  archived: false,
  sortOrder: 0,
  stripe: {},
};

/** Which plan a business is on, for limits, auto-approval, insights detail and ranking. */
@Injectable()
export class PlansService {
  constructor(
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
  ) {}

  activeSubscription(businessId: Types.ObjectId | string) {
    return this.subscriptions
      .findOne({ businessId: new Types.ObjectId(String(businessId)), status: { $in: PLAN_GRANTING_STATUSES } })
      .sort({ createdAt: -1 });
  }

  async byKey(key: string): Promise<PlanLean | null> {
    return (await this.plans.findOne({ key }).lean()) as PlanLean | null;
  }

  async freePlan(): Promise<PlanLean> {
    return (await this.byKey(PlanKey.FREE)) ?? FALLBACK_FREE_PLAN;
  }

  async planFor(businessId: Types.ObjectId | string): Promise<PlanLean> {
    const sub = await this.activeSubscription(businessId).lean();
    if (sub) {
      const plan = await this.byKey(sub.planKey);
      if (plan) return plan;
    }
    return this.freePlan();
  }

  /** Plans for many businesses at once (search ranking). */
  async plansFor(businessIds: Types.ObjectId[]): Promise<Map<string, PlanLean>> {
    const subs = await this.subscriptions
      .find({ businessId: { $in: businessIds }, status: { $in: PLAN_GRANTING_STATUSES } })
      .select('businessId planKey')
      .lean();
    const keys = [...new Set(subs.map((s) => s.planKey))];
    const plans = (await this.plans.find({ key: { $in: keys } }).lean()) as PlanLean[];
    const byKey = new Map(plans.map((p) => [p.key, p]));
    const result = new Map<string, PlanLean>();
    for (const sub of subs) {
      const plan = byKey.get(sub.planKey);
      if (plan && sub.businessId) result.set(String(sub.businessId), plan);
    }
    return result;
  }

  list(filter: { audience?: string; publicOnly?: boolean; includeArchived?: boolean } = {}) {
    const query: Record<string, unknown> = {};
    if (filter.audience) query.audience = filter.audience;
    if (filter.publicOnly) {
      query.isPublic = true;
      query.archived = { $ne: true };
    } else if (!filter.includeArchived) {
      query.archived = { $ne: true };
    }
    return this.plans.find(query).sort({ sortOrder: 1, monthlyPrice: 1 }).lean();
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}

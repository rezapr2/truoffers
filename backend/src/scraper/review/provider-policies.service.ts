import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditAction, ProviderPolicyBasis, ProviderPolicyStatus } from '../../common/scraper.enums';
import { ProviderDetection, ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import { canHoldRobotsException, releaseHeldWebsites } from '../safety/provider-permission';
import { ScraperSettingsService } from './scraper-settings.service';

export interface ProviderPolicyInput {
  name?: string;
  status?: ProviderPolicyStatus;
  basis?: ProviderPolicyBasis | null;
  agreementReference?: string | null;
  basisNotes?: string | null;
  detection?: Partial<ProviderDetection>;
}

const cleanList = (values?: string[]) => [...new Set((values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean))];

@Injectable()
export class ProviderPoliciesService {
  constructor(
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    private readonly audit: AuditService,
    private readonly settings: ScraperSettingsService,
  ) {}

  async list() {
    const [policies, counts] = await Promise.all([
      this.policies.find().sort({ status: 1, name: 1 }).populate('reviewedBy', 'name email').lean(),
      this.sites.aggregate([
        { $match: { providerRef: { $exists: true } } },
        { $group: { _id: { provider: '$providerRef', status: '$authorisationStatus' }, count: { $sum: 1 } } },
      ]),
    ]);
    return policies.map((policy) => ({
      ...policy,
      websites: Object.fromEntries(counts.filter((c) => String(c._id.provider) === String(policy._id)).map((c) => [c._id.status, c.count])),
    }));
  }

  async create(input: ProviderPolicyInput, userId: string) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    const policy = new this.policies({
      name: input.name.trim(),
      status: input.status ?? ProviderPolicyStatus.UNKNOWN,
      basis: input.basis ?? undefined,
      agreementReference: input.agreementReference ?? undefined,
      basisNotes: input.basisNotes ?? undefined,
      detection: this.detection(input.detection),
      reviewedBy: new Types.ObjectId(userId),
      reviewedAt: new Date(),
    });
    await this.save(policy);
    await this.audit.record({ action: AuditAction.PROVIDER_POLICY_CREATED, targetType: 'ProviderPolicy', targetId: policy._id, after: this.snapshot(policy) });
    return policy;
  }

  async update(id: string, input: ProviderPolicyInput, userId: string) {
    const policy = await this.find(id);
    const before = this.snapshot(policy);
    if (input.name !== undefined) policy.name = input.name.trim();
    if (input.status !== undefined) policy.status = input.status;
    if (input.basis !== undefined) policy.basis = input.basis ?? undefined;
    if (input.agreementReference !== undefined) policy.agreementReference = input.agreementReference ?? undefined;
    if (input.basisNotes !== undefined) policy.basisNotes = input.basisNotes ?? undefined;
    if (input.detection) policy.detection = this.detection({ ...policy.detection, ...input.detection });
    policy.set({ reviewedBy: new Types.ObjectId(userId), reviewedAt: new Date(), autoCreated: false });
    await this.save(policy);

    // Sites held only because of this provider can proceed once it permits crawling (the policy change is the admin action).
    const released = before.status !== policy.status ? await this.releaseHeldWebsites(policy._id) : 0;
    // The robots.txt exception rests on the written agreement: change what it rests on and it goes, to be recorded
    // again deliberately.
    const exceptionCleared = !!policy.robotsOverride && !canHoldRobotsException(policy);
    if (exceptionCleared) {
      policy.set('robotsOverride', undefined);
      await this.save(policy);
    }
    await this.audit.record({
      action: AuditAction.PROVIDER_POLICY_UPDATED,
      targetType: 'ProviderPolicy',
      targetId: policy._id,
      before,
      after: { ...this.snapshot(policy), websitesReleased: released, ...(exceptionCleared ? { robotsExceptionCleared: true } : {}) },
    });
    return policy;
  }

  /**
   * Reads every website on this provider despite its robots.txt, because the provider agreed to that in writing.
   * Needs an allowed policy on a written agreement with its reference, and goes if that changes. Websites are
   * covered only once they are linked to the provider (a client-list import, detection, or a super admin's link).
   */
  async setRobotsOverride(id: string, note: string, userId: string) {
    const policy = await this.find(id);
    if (!canHoldRobotsException(policy)) {
      throw new BadRequestException(`${policy.name} needs an allowed policy on a written agreement, with its reference, before its websites can be read despite robots.txt`);
    }
    const before = policy.robotsOverride ? { note: policy.robotsOverride.note } : undefined;
    policy.set('robotsOverride', { note: note.trim(), recordedBy: new Types.ObjectId(userId), recordedAt: new Date() });
    await this.save(policy);
    const websites = await this.sites.countDocuments({ providerRef: policy._id });
    await this.audit.record({
      action: AuditAction.PROVIDER_ROBOTS_OVERRIDE_SET,
      targetType: 'ProviderPolicy',
      targetId: policy._id,
      before,
      after: { name: policy.name, agreementReference: policy.agreementReference, note: note.trim(), websites },
      note: note.trim(),
    });
    return policy.robotsOverride;
  }

  async clearRobotsOverride(id: string, userId: string) {
    const policy = await this.find(id);
    if (!policy.robotsOverride) throw new BadRequestException(`${policy.name} has no robots.txt exception to remove`);
    const before = { note: policy.robotsOverride.note };
    policy.set('robotsOverride', undefined);
    await this.save(policy);
    await this.audit.record({
      action: AuditAction.PROVIDER_ROBOTS_OVERRIDE_REMOVED,
      targetType: 'ProviderPolicy',
      targetId: policy._id,
      before,
      after: { name: policy.name },
      note: `Removed by ${userId}`,
    });
    return { removed: true };
  }

  // Releases every held website whose provider now permits crawling, e.g. after provider review is turned off.
  async releaseHeldWebsites(providerRef?: Types.ObjectId): Promise<number> {
    const { providerReviewRequired } = await this.settings.get();
    return releaseHeldWebsites({ policies: this.policies, sites: this.sites }, !!providerReviewRequired, providerRef);
  }

  async remove(id: string) {
    const policy = await this.find(id);
    if (await this.sites.exists({ providerRef: policy._id })) {
      throw new BadRequestException('Websites reference this provider; mark it blocked instead');
    }
    await policy.deleteOne();
    await this.audit.record({ action: AuditAction.PROVIDER_POLICY_DELETED, targetType: 'ProviderPolicy', targetId: policy._id, before: this.snapshot(policy) });
    return { deleted: true };
  }

  private detection(input?: Partial<ProviderDetection>): ProviderDetection {
    return {
      hostSuffixes: cleanList(input?.hostSuffixes),
      cnameSuffixes: cleanList(input?.cnameSuffixes),
      footerPatterns: [...new Set((input?.footerPatterns ?? []).map((v) => v.trim()).filter(Boolean))],
      generatorPatterns: [...new Set((input?.generatorPatterns ?? []).map((v) => v.trim()).filter(Boolean))],
      assetHosts: cleanList(input?.assetHosts),
    };
  }

  private async save(policy: ProviderPolicyDocument) {
    try {
      await policy.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new BadRequestException('A provider with that name already exists');
      if ((err as Error).name === 'ValidationError' || /basis|agreement/i.test((err as Error).message)) {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
  }

  private snapshot(policy: ProviderPolicyDocument) {
    return {
      name: policy.name,
      status: policy.status,
      basis: policy.basis,
      agreementReference: policy.agreementReference,
      robotsException: !!policy.robotsOverride,
    };
  }

  private async find(id: string) {
    const policy = Types.ObjectId.isValid(id) ? await this.policies.findById(id) : null;
    if (!policy) throw new NotFoundException('Provider policy not found');
    return policy;
  }
}

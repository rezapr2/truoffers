import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuditAction,
  AuthorisationSource,
  DomainAuthorisationStatus,
  ProviderPolicyBasis,
  ProviderPolicyStatus,
} from '../../common/scraper.enums';
import { ProviderDetection, ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';

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

    // Sites held only because of this provider can proceed once it is allowed (the policy change is the admin action).
    let released = 0;
    if (before.status !== ProviderPolicyStatus.ALLOWED && policy.status === ProviderPolicyStatus.ALLOWED) {
      const result = await this.sites.updateMany(
        {
          providerRef: policy._id,
          authorisationStatus: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW,
          authorisationSource: { $ne: AuthorisationSource.DISCOVERED_LINK },
        },
        { $set: { authorisationStatus: DomainAuthorisationStatus.AUTHORISED }, $unset: { lastError: 1 } },
      );
      released = result.modifiedCount;
    }
    await this.audit.record({
      action: AuditAction.PROVIDER_POLICY_UPDATED,
      targetType: 'ProviderPolicy',
      targetId: policy._id,
      before,
      after: { ...this.snapshot(policy), websitesReleased: released },
    });
    return policy;
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
    return { name: policy.name, status: policy.status, basis: policy.basis, agreementReference: policy.agreementReference };
  }

  private async find(id: string) {
    const policy = Types.ObjectId.isValid(id) ? await this.policies.findById(id) : null;
    if (!policy) throw new NotFoundException('Provider policy not found');
    return policy;
  }
}

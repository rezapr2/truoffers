import { Model, Types } from 'mongoose';
import { AuthorisationSource, DomainAuthorisationStatus, ProviderPolicyBasis, ProviderPolicyStatus } from '../../common/scraper.enums';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';

/**
 * Whether websites hosted by a provider with this policy may be crawled.
 * Blocked providers never are. Unknown providers are, unless provider review is turned on in settings,
 * in which case only an allowed policy (with its recorded basis) lets them through.
 */
export function providerPermitsCrawling(status: ProviderPolicyStatus | undefined, reviewRequired: boolean): boolean {
  if (status === ProviderPolicyStatus.BLOCKED) return false;
  return status === ProviderPolicyStatus.ALLOWED || !reviewRequired;
}

/**
 * Returns websites held for provider review to authorised once their provider permits crawling
 * (optionally only one provider's). Websites found only as links stay pending: nobody authorised them.
 */
export async function releaseHeldWebsites(
  models: { policies: Model<ProviderPolicyDocument>; sites: Model<ScrapedWebsiteDocument> },
  reviewRequired: boolean,
  providerRef?: Types.ObjectId,
): Promise<number> {
  const policies = await models.policies.find(providerRef ? { _id: providerRef } : {}, { status: 1 }).lean();
  const permitted = policies.filter((p) => providerPermitsCrawling(p.status, reviewRequired)).map((p) => p._id);
  if (permitted.length === 0) return 0;
  const result = await models.sites.updateMany(
    {
      providerRef: { $in: permitted },
      authorisationStatus: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW,
      authorisationSource: { $ne: AuthorisationSource.DISCOVERED_LINK },
    },
    { $set: { authorisationStatus: DomainAuthorisationStatus.AUTHORISED }, $unset: { lastError: 1 } },
  );
  return result.modifiedCount;
}

type PolicyAgreement = Pick<ProviderPolicy, 'status' | 'basis' | 'agreementReference'> & Partial<Pick<ProviderPolicy, 'robotsOverride'>>;

/**
 * Whether a policy could carry a robots.txt exception: allowed, on a written agreement, with its reference. A terms
 * review isn't enough: this needs the provider itself to have agreed to being read.
 */
export function canHoldRobotsException(policy: PolicyAgreement | null | undefined): boolean {
  return (
    !!policy &&
    policy.status === ProviderPolicyStatus.ALLOWED &&
    policy.basis === ProviderPolicyBasis.WRITTEN_AGREEMENT &&
    !!policy.agreementReference?.trim()
  );
}

/** Whether the provider's robots.txt exception is in force right now. */
export function agreementCoversRobots(policy: PolicyAgreement | null | undefined): boolean {
  return canHoldRobotsException(policy) && !!policy?.robotsOverride;
}

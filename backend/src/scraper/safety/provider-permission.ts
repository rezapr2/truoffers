import { Model, Types } from 'mongoose';
import { AuthorisationSource, DomainAuthorisationStatus, ProviderPolicyStatus } from '../../common/scraper.enums';
import { ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
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

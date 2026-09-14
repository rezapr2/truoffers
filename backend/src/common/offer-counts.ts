import type { Model, Types } from 'mongoose';
import type { BusinessDocument } from '../schemas/business.schema';
import type { OfferDocument } from '../schemas/offer.schema';
import { OfferStatus } from './enums';

// Business.activeOfferCount is denormalised; recount after any offer status change.
export async function recountActiveOffers(
  offers: Model<OfferDocument>,
  businesses: Model<BusinessDocument>,
  businessId: Types.ObjectId | string,
): Promise<void> {
  const count = await offers.countDocuments({ businessId, status: OfferStatus.ACTIVE });
  await businesses.findByIdAndUpdate(businessId, { activeOfferCount: count });
}

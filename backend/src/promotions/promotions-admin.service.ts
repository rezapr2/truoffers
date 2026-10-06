import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfferStatus, PromotionPlacement, PromotionStatus } from '../common/enums';
import { BillingAdminService } from '../billing/billing-admin.service';
import { PromotionPrice } from '../schemas/promotion.schema';
import { PromotionsService } from './promotions.service';

export interface ProductInput {
  name?: string;
  description?: string;
  prices?: PromotionPrice[];
  slots?: number;
  maxActivePerBusiness?: number;
  approvalRequired?: boolean;
  minVerificationLevel?: number;
  active?: boolean;
  sortOrder?: number;
}

/** /admin/promotions: products, prices and slots; the booking calendar; free grants; approvals. */
@Injectable()
export class PromotionsAdminService {
  constructor(private readonly promotions: PromotionsService, private readonly billingAdmin: BillingAdminService) {}

  products() {
    return this.promotions.catalogue(true);
  }

  async updateProduct(key: string, input: ProductInput) {
    await this.promotions.catalogue(true);
    const product = await this.promotions.products.findOne({ key });
    if (!product) throw new NotFoundException('Product not found');
    if (input.prices) {
      if (!input.prices.length) throw new BadRequestException('A product needs at least one price');
      for (const price of input.prices) {
        if (!['day', 'week', 'deal'].includes(price.unit) || price.price < 0 || price.hours < 1) throw new BadRequestException('Each price needs a unit (day, week or deal), an amount and a length in hours');
      }
    }
    const before = product.toObject();
    product.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    await product.save();
    await this.promotions.audit.record({ action: 'promotion_product.updated', targetType: 'PromotionProduct', targetId: key, before: { prices: before.prices, slots: before.slots, active: before.active, approvalRequired: before.approvalRequired }, after: { prices: product.prices, slots: product.slots, active: product.active, approvalRequired: product.approvalRequired } });
    return product;
  }

  async bookings(query: { product?: string; status?: string; from?: string; to?: string; businessId?: string }) {
    const filter: Record<string, unknown> = { productKey: { $exists: true } };
    if (query.product) filter.productKey = query.product;
    if (query.status) filter.status = { $in: query.status.split(',') };
    if (query.businessId && Types.ObjectId.isValid(query.businessId)) filter.businessId = new Types.ObjectId(query.businessId);
    if (query.from || query.to) {
      filter.endsAt = { $gt: query.from ? new Date(query.from) : new Date(0) };
      filter.startsAt = { $lt: query.to ? new Date(`${query.to}T23:59:59Z`) : new Date(8.64e15) };
    }
    return this.promotions.promotions
      .find(filter)
      .sort({ startsAt: -1 })
      .limit(500)
      .populate('businessId', 'name slug town')
      .populate('offerId', 'title displayLabel status')
      .populate('scope.categoryId', 'name')
      .populate('grantedBy', 'name')
      .lean();
  }

  /** Booked slots per product per day for the next weeks (the spec's "calendar of booked slots"). */
  async calendar(days = 35) {
    const products = await this.promotions.catalogue(true);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 24 * 3600_000);
    const bookings = await this.promotions.promotions
      .find({ productKey: { $exists: true }, status: { $in: [PromotionStatus.ACTIVE, PromotionStatus.SCHEDULED, PromotionStatus.PENDING_APPROVAL] }, startsAt: { $lt: end }, endsAt: { $gt: start } })
      .select('productKey scope startsAt endsAt businessId status')
      .populate('businessId', 'name')
      .lean();
    return {
      products: products.map((p) => ({ key: p.key, name: p.name, slots: p.slots, scope: p.scope })),
      days: Array.from({ length: days }, (_, i) => {
        const dayStart = new Date(start.getTime() + i * 24 * 3600_000);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
        const counts: Record<string, number> = {};
        for (const b of bookings) if (b.startsAt! < dayEnd && b.endsAt! > dayStart) counts[b.productKey!] = (counts[b.productKey!] ?? 0) + 1;
        return { date: dayStart.toISOString().slice(0, 10), counts };
      }),
      bookings,
    };
  }

  /** "Admin can grant a free promotion": same checks for the slot, no payment. */
  async grant(input: { businessId: string; offerId: string; productKey: PromotionPlacement; area?: string; categoryId?: string; city?: string; startsAt: string; unit: string; quantity: number; note?: string }, adminId: string) {
    const offer = Types.ObjectId.isValid(input.offerId) ? await this.promotions.offers.findOne({ _id: input.offerId, businessId: input.businessId }) : null;
    if (!offer) throw new NotFoundException('Offer not found for that business');
    if (![OfferStatus.ACTIVE, OfferStatus.SCHEDULED].includes(offer.status)) throw new BadRequestException('Only live or scheduled offers can be promoted');
    const availability = await this.promotions.availability(input);
    if (!availability.available) throw new ConflictException('That slot is taken. Pick other dates.');
    const booking = await this.promotions.promotions.create({
      businessId: new Types.ObjectId(input.businessId),
      offerId: offer._id,
      productKey: input.productKey,
      scope: { area: input.area?.toUpperCase().replace(/\s+/g, ''), categoryId: input.categoryId ? new Types.ObjectId(input.categoryId) : undefined, city: input.city?.toLowerCase() },
      startsAt: availability.startsAt,
      endsAt: availability.endsAt,
      unit: input.unit,
      quantity: input.quantity,
      price: 0,
      source: 'admin_grant',
      grantedBy: new Types.ObjectId(adminId),
      note: input.note,
      status: availability.startsAt <= new Date() ? PromotionStatus.ACTIVE : PromotionStatus.SCHEDULED,
    });
    await this.promotions.audit.record({ action: 'promotion.granted', targetType: 'Promotion', targetId: booking._id, after: { business: input.businessId, product: input.productKey, startsAt: booking.startsAt, endsAt: booking.endsAt }, note: input.note });
    if (booking.status === PromotionStatus.ACTIVE) await this.promotions.announceLive(booking);
    return booking;
  }

  async approve(id: string) {
    const booking = await this.load(id);
    if (booking.status !== PromotionStatus.PENDING_APPROVAL) throw new BadRequestException('This booking is not waiting for approval');
    booking.status = booking.startsAt! <= new Date() ? PromotionStatus.ACTIVE : PromotionStatus.SCHEDULED;
    await booking.save();
    await this.promotions.audit.record({ action: 'promotion.approved', targetType: 'Promotion', targetId: booking._id, after: { status: booking.status } });
    if (booking.status === PromotionStatus.ACTIVE) await this.promotions.announceLive(booking);
    return booking;
  }

  /** Reject a booking waiting for approval, or cancel any booking; a paid one is refunded in full. */
  async cancel(id: string, reject: boolean, note?: string) {
    const booking = await this.load(id);
    if ([PromotionStatus.ENDED, PromotionStatus.CANCELLED, PromotionStatus.REJECTED].includes(booking.status)) throw new BadRequestException(`This booking is already ${booking.status}`);
    if (reject && booking.status !== PromotionStatus.PENDING_APPROVAL) throw new BadRequestException('Only bookings waiting for approval can be rejected');
    let refunded = false;
    if (booking.paymentId && booking.price > 0) {
      await this.billingAdmin.refund(String(booking.paymentId), { reason: note ?? (reject ? 'Promotion rejected' : 'Promotion cancelled') });
      refunded = true;
    }
    const before = booking.status;
    booking.set({ status: reject ? PromotionStatus.REJECTED : PromotionStatus.CANCELLED, cancelledAt: new Date(), note });
    await booking.save();
    await this.promotions.audit.record({ action: reject ? 'promotion.rejected' : 'promotion.cancelled_by_admin', targetType: 'Promotion', targetId: booking._id, before: { status: before }, after: { status: booking.status, refunded }, note });
    await this.promotions.notifications.notifyBusiness(booking.businessId, {
      type: 'promotion_cancelled',
      title: reject ? 'Your promotion was not approved' : 'Your promotion was cancelled',
      body: [note, refunded ? 'You have been refunded in full.' : undefined].filter(Boolean).join(' '),
      link: '/dashboard/promote',
    }, 'owners');
    return booking;
  }

  private async load(id: string) {
    const booking = Types.ObjectId.isValid(id) ? await this.promotions.promotions.findById(id) : null;
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}

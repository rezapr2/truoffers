import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthUser } from '../common/decorators';
import { BusinessAccessService } from '../common/business-access';
import {
  BusinessStatus,
  OfferStatus,
  PromotionPlacement,
  PromotionStatus,
  PUBLIC_OFFER_STATUSES,
  SLOT_HOLDING_PROMOTION_STATUSES,
} from '../common/enums';
import { offerSlug, PUBLIC_OFFER_PROJECTION } from '../common/public-offer';
import { BillingService } from '../billing/billing.service';
import { siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { PlansService } from '../plans/plans.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Promotion, PromotionDocument, PromotionProduct, PromotionProductDocument } from '../schemas/promotion.schema';

const HOUR = 3600_000;
// An unpaid booking holds its slot while the owner is on the payment page.
const PAYMENT_HOLD_MINUTES = 30;
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/;

export const DEFAULT_PROMOTION_PRODUCTS: Array<Omit<PromotionProduct, 'active'> & { active?: boolean }> = [
  {
    key: PromotionPlacement.TOP_OF_SEARCH,
    name: 'Top of search',
    description: 'First 3 results for a postcode area (e.g. M14)',
    prices: [
      { unit: 'day', price: 4.99, hours: 24 },
      { unit: 'week', price: 24.99, hours: 168 },
    ],
    scope: 'area',
    slots: 3,
    maxActivePerBusiness: 3,
    approvalRequired: false,
    minVerificationLevel: 2,
    sortOrder: 0,
  },
  {
    key: PromotionPlacement.CATEGORY_FEATURE,
    name: 'Category feature',
    description: 'Top of a cuisine page in a city',
    prices: [{ unit: 'week', price: 19.99, hours: 168 }],
    scope: 'category_city',
    slots: 2,
    maxActivePerBusiness: 2,
    approvalRequired: false,
    minVerificationLevel: 2,
    sortOrder: 1,
  },
  {
    key: PromotionPlacement.FLASH_DEAL,
    name: 'Flash deal',
    description: '“Ending soon” strip on the homepage and offers page',
    prices: [{ unit: 'deal', price: 9.99, hours: 48 }],
    scope: 'site',
    slots: 6,
    maxActivePerBusiness: 1,
    approvalRequired: false,
    minVerificationLevel: 2,
    sortOrder: 2,
  },
  {
    key: PromotionPlacement.HOMEPAGE_SPOT,
    name: 'Homepage spot',
    description: '“Our top picks” on the homepage',
    prices: [{ unit: 'week', price: 49.99, hours: 168 }],
    scope: 'site',
    slots: 5,
    maxActivePerBusiness: 1,
    approvalRequired: false,
    minVerificationLevel: 2,
    sortOrder: 3,
  },
];

export interface BookingInput {
  offerId: string;
  productKey: PromotionPlacement;
  area?: string;
  categoryId?: string;
  city?: string;
  startsAt: string;
  unit: string;
  quantity: number;
  useCredit?: boolean;
}

/** Spec "Promote an offer": pick offer → placement (type, area, dates) → slot free? → pay → live, labelled Promoted. */
@Injectable()
export class PromotionsService implements OnModuleInit {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    @InjectModel(Promotion.name) readonly promotions: Model<PromotionDocument>,
    @InjectModel(PromotionProduct.name) readonly products: Model<PromotionProductDocument>,
    @InjectModel(Offer.name) readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
    private readonly billing: BillingService,
    private readonly plans: PlansService,
    private readonly access: BusinessAccessService,
    readonly notifications: NotificationsService,
    readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.billing.registerCheckoutHandler('promotion', (session) => this.paid(session));
  }

  /** The product catalogue, creating the spec's defaults on a fresh database. */
  async catalogue(includeInactive = false) {
    if ((await this.products.estimatedDocumentCount()) === 0) {
      await this.products.insertMany(DEFAULT_PROMOTION_PRODUCTS.map((p) => ({ active: true, ...p }))).catch(() => undefined);
    }
    return this.products.find(includeInactive ? {} : { active: true }).sort({ sortOrder: 1 }).lean();
  }

  private async product(key: string) {
    await this.catalogue();
    const product = await this.products.findOne({ key });
    if (!product) throw new NotFoundException('Promotion product not found');
    return product;
  }

  private normaliseScope(product: PromotionProductDocument, input: { area?: string; categoryId?: string; city?: string }) {
    if (product.scope === 'area') {
      const area = input.area?.trim().toUpperCase().replace(/\s+/g, '');
      if (!area || !DISTRICT.test(area)) throw new BadRequestException('Choose a postcode area such as M14');
      return { area };
    }
    if (product.scope === 'category_city') {
      if (!input.categoryId || !Types.ObjectId.isValid(input.categoryId)) throw new BadRequestException('Choose a cuisine');
      const city = input.city?.trim().toLowerCase();
      if (!city) throw new BadRequestException('Choose a city');
      return { categoryId: new Types.ObjectId(input.categoryId), city };
    }
    return {};
  }

  private scopeFilter(scope: { area?: string; categoryId?: Types.ObjectId; city?: string }) {
    const filter: Record<string, unknown> = {};
    if (scope.area) filter['scope.area'] = scope.area;
    if (scope.categoryId) filter['scope.categoryId'] = scope.categoryId;
    if (scope.city) filter['scope.city'] = scope.city;
    return filter;
  }

  private holdingFilter() {
    return {
      $or: [
        { status: { $in: SLOT_HOLDING_PROMOTION_STATUSES } },
        { status: PromotionStatus.PENDING_PAYMENT, createdAt: { $gte: new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60_000) } },
      ],
    };
  }

  private window(product: PromotionProductDocument, startsAt: string, unit: string, quantity: number) {
    const price = product.prices.find((p) => p.unit === unit);
    if (!price) throw new BadRequestException(`${product.name} is not sold by the ${unit}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > (unit === 'day' ? 30 : unit === 'week' ? 8 : 4)) throw new BadRequestException('Choose a shorter booking');
    const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startsAt) ? `${startsAt}T00:00:00Z` : startsAt);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Choose a start date');
    // "Today" starts now; a later day starts at midnight UK time (stored as UTC midnight for simplicity of slots).
    const begin = start.getTime() < Date.now() ? new Date() : start;
    if (begin.getTime() > Date.now() + 180 * 24 * HOUR) throw new BadRequestException('Bookings open up to 6 months ahead');
    const end = new Date(begin.getTime() + price.hours * quantity * HOUR);
    return { startsAt: begin, endsAt: end, price: Math.round(price.price * quantity * 100) / 100, unitPrice: price };
  }

  async usedSlots(product: PromotionProductDocument, scope: Record<string, unknown>, from: Date, to: Date, excludeId?: Types.ObjectId) {
    return this.promotions.countDocuments({
      productKey: product.key,
      ...this.scopeFilter(scope),
      ...this.holdingFilter(),
      startsAt: { $lt: to },
      endsAt: { $gt: from },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
  }

  /** "Slot free?" plus a 4-week calendar of free slots, so the owner can pick other dates. */
  async availability(input: Omit<BookingInput, 'offerId' | 'useCredit'>) {
    const product = await this.product(input.productKey);
    const scope = this.normaliseScope(product, input);
    const window = this.window(product, input.startsAt, input.unit, input.quantity);
    const used = await this.usedSlots(product, scope, window.startsAt, window.endsAt);
    const calendarStart = new Date();
    calendarStart.setUTCHours(0, 0, 0, 0);
    const bookings = await this.promotions
      .find({
        productKey: product.key,
        ...this.scopeFilter(scope),
        ...this.holdingFilter(),
        startsAt: { $lt: new Date(calendarStart.getTime() + 28 * 24 * HOUR) },
        endsAt: { $gt: calendarStart },
      })
      .select('startsAt endsAt')
      .lean();
    const calendar = Array.from({ length: 28 }, (_, i) => {
      const dayStart = new Date(calendarStart.getTime() + i * 24 * HOUR);
      const dayEnd = new Date(dayStart.getTime() + 24 * HOUR);
      const taken = bookings.filter((b) => b.startsAt! < dayEnd && b.endsAt! > dayStart).length;
      return { date: dayStart.toISOString().slice(0, 10), taken, free: Math.max(0, product.slots - taken) };
    });
    const breakdown = await this.billing.breakdown(window.price);
    return {
      available: used < product.slots,
      used,
      slots: product.slots,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      price: breakdown,
      calendar,
      nextFreeDate: calendar.find((d) => d.free > 0 && d.date >= window.startsAt.toISOString().slice(0, 10))?.date ?? null,
    };
  }

  /** Professional plan: one free Top-of-search week per calendar month. */
  async creditsLeft(businessId: Types.ObjectId) {
    const plan = await this.plans.planFor(businessId);
    const allowance = plan.flags?.freeTopOfSearchWeeksPerMonth ?? 0;
    if (!allowance) return { allowance: 0, used: 0, left: 0 };
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const used = await this.promotions.countDocuments({
      businessId,
      source: 'plan_credit',
      createdAt: { $gte: monthStart },
      status: { $nin: [PromotionStatus.CANCELLED, PromotionStatus.REJECTED] },
    });
    return { allowance, used, left: Math.max(0, allowance - used) };
  }

  async businessPromotions(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const [items, products, credits] = await Promise.all([
      this.promotions
        .find({ businessId: business._id, productKey: { $exists: true } })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('offerId', 'title displayLabel status')
        .populate('scope.categoryId', 'name')
        .lean(),
      this.catalogue(),
      this.creditsLeft(business._id),
    ]);
    return { items, products, credits, business: { town: business.town, postcodeArea: business.postcodeArea, categories: business.categories } };
  }

  async book(businessId: string, input: BookingInput, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    if (business.status !== BusinessStatus.ACTIVE) throw new ForbiddenException('Your listing is not live, so it cannot be promoted');
    const product = await this.product(input.productKey);
    if (!product.active) throw new BadRequestException('That promotion is not available right now');
    if (business.verificationLevel < product.minVerificationLevel) {
      throw new ForbiddenException({ message: 'Promotions are for verified businesses. Finish verification first.', code: 'not_verified' });
    }
    const offer = Types.ObjectId.isValid(input.offerId) ? await this.offers.findOne({ _id: input.offerId, businessId: business._id }) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    if (![OfferStatus.ACTIVE, OfferStatus.SCHEDULED].includes(offer.status)) throw new BadRequestException('Promote an offer once it is live');
    const scope = this.normaliseScope(product, input);
    if ('categoryId' in scope && !business.categories.some((c) => String(c) === String(scope.categoryId))) {
      throw new BadRequestException('Choose one of your own cuisines');
    }
    const window = this.window(product, input.startsAt, input.unit, input.quantity);
    if (offer.endsAt && offer.endsAt < window.startsAt) throw new BadRequestException('The offer ends before this promotion would start');
    const mine = await this.promotions.countDocuments({
      businessId: business._id,
      productKey: product.key,
      ...this.holdingFilter(),
      startsAt: { $lt: window.endsAt },
      endsAt: { $gt: window.startsAt },
    });
    if (mine >= product.maxActivePerBusiness) throw new ConflictException(`You already have ${mine} ${product.name} booking${mine === 1 ? '' : 's'} at that time`);
    if ((await this.usedSlots(product, scope, window.startsAt, window.endsAt)) >= product.slots) {
      throw new ConflictException({ message: 'That slot is taken. Pick other dates.', code: 'slot_taken' });
    }

    const useCredit = !!input.useCredit && product.key === PromotionPlacement.TOP_OF_SEARCH && input.unit === 'week' && input.quantity === 1;
    if (input.useCredit && !useCredit) throw new BadRequestException('Your free promotion covers one Top-of-search week');
    if (useCredit && (await this.creditsLeft(business._id)).left < 1) throw new BadRequestException('You have used this month’s free Top-of-search week');

    const booking = await this.promotions.create({
      businessId: business._id,
      offerId: offer._id,
      productKey: product.key,
      scope,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      unit: input.unit,
      quantity: input.quantity,
      price: useCredit ? 0 : window.price,
      source: useCredit ? 'plan_credit' : 'purchase',
      status: PromotionStatus.PENDING_PAYMENT,
      createdBy: new Types.ObjectId(user.userId),
    });
    await this.audit.record({ action: 'promotion.booked', targetType: 'Promotion', targetId: booking._id, after: { product: product.key, offer: String(offer._id), scope, startsAt: window.startsAt, endsAt: window.endsAt, price: booking.price, source: booking.source } });

    if (useCredit) {
      await this.confirm(booking, product);
      return { mode: 'credit', promotion: booking };
    }
    const description = `${product.name}: ${offer.title}`.slice(0, 120);
    const session = await this.billing.oneOffCheckout({
      business,
      email: user.email,
      description,
      net: window.price,
      metadata: { type: 'promotion', promotionId: String(booking._id), businessId: String(business._id) },
      successPath: '/dashboard/promote?checkout=success',
      cancelPath: '/dashboard/promote?checkout=cancelled',
    });
    if (session) {
      booking.stripeCheckoutSessionId = session.id;
      await booking.save();
      return { mode: 'stripe', url: session.url, promotion: booking };
    }
    // Mock mode: paid at once.
    const payment = await this.billing.recordMockPayment(business._id, null, description, window.price, undefined, undefined, booking._id);
    booking.paymentId = payment._id;
    await this.confirm(booking, product);
    return { mode: 'mock', promotion: booking };
  }

  /** The Stripe webhook confirmed payment for a booking. */
  async paid(session: Stripe.Checkout.Session) {
    const id = session.metadata?.promotionId;
    const booking = id && Types.ObjectId.isValid(id) ? await this.promotions.findById(id) : null;
    if (!booking) return;
    if (booking.status !== PromotionStatus.PENDING_PAYMENT && booking.status !== PromotionStatus.CANCELLED) return;
    const product = await this.product(booking.productKey!);
    const payment = await this.billing.recordCheckoutPayment(session, 'promotion', `${product.name} promotion`, booking.businessId, booking._id);
    booking.paymentId = payment?._id;
    await this.confirm(booking, product);
  }

  private async confirm(booking: PromotionDocument, product: PromotionProductDocument) {
    booking.status = product.approvalRequired
      ? PromotionStatus.PENDING_APPROVAL
      : booking.startsAt! <= new Date()
        ? PromotionStatus.ACTIVE
        : PromotionStatus.SCHEDULED;
    await booking.save();
    await this.audit.record({ action: 'promotion.confirmed', targetType: 'Promotion', targetId: booking._id, after: { status: booking.status } });
    if (booking.status === PromotionStatus.ACTIVE) await this.announceLive(booking);
  }

  async announceLive(booking: PromotionDocument) {
    if (booking.liveNotifiedAt) return;
    const [offer, product, business] = await Promise.all([
      this.offers.findById(booking.offerId).select('title').lean(),
      this.products.findOne({ key: booking.productKey }).lean(),
      this.businesses.findById(booking.businessId).select('name').lean(),
    ]);
    const endsOn = booking.endsAt!.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
    await this.notifications.notifyBusiness(booking.businessId, {
      type: 'promotion_live',
      title: `${product?.name ?? 'Your promotion'} is live`,
      body: `“${offer?.title ?? 'Your offer'}” is promoted until ${endsOn}.`,
      link: '/dashboard/promote',
      email: { template: 'promotion_live', vars: { businessName: business?.name, offerTitle: offer?.title, productName: product?.name, endsOn } },
    }, 'owners');
    booking.liveNotifiedAt = new Date();
    await booking.save();
  }

  async announceEnded(booking: PromotionDocument) {
    if (booking.endedNotifiedAt) return;
    const [offer, product, business] = await Promise.all([
      this.offers.findById(booking.offerId).select('title').lean(),
      this.products.findOne({ key: booking.productKey }).lean(),
      this.businesses.findById(booking.businessId).select('name').lean(),
    ]);
    await this.notifications.notifyBusiness(booking.businessId, {
      type: 'promotion_ended',
      title: `${product?.name ?? 'Your promotion'} has ended`,
      body: 'Book it again to keep the spot.',
      link: '/dashboard/promote',
      email: { template: 'promotion_ended', vars: { businessName: business?.name, offerTitle: offer?.title, productName: product?.name, link: siteUrl('/dashboard/promote') } },
    }, 'owners');
    booking.endedNotifiedAt = new Date();
    await booking.save();
  }

  /** The owner abandons an unpaid booking. Paid bookings are cancelled by an admin (with a refund). */
  async cancelUnpaid(id: string, user: AuthUser) {
    const booking = Types.ObjectId.isValid(id) ? await this.promotions.findById(id) : null;
    if (!booking) throw new NotFoundException('Promotion not found');
    await this.access.load(String(booking.businessId), user, 'owner', { write: true });
    if (booking.status !== PromotionStatus.PENDING_PAYMENT) throw new BadRequestException('Paid promotions can only be cancelled by our team; contact us');
    booking.set({ status: PromotionStatus.CANCELLED, cancelledAt: new Date() });
    await booking.save();
    await this.audit.record({ action: 'promotion.cancelled', targetType: 'Promotion', targetId: booking._id });
    return booking;
  }

  // ---------------------------------------------------------------------------------------------------
  // Placements (spec T5.3)
  // ---------------------------------------------------------------------------------------------------

  private liveFilter(productKey: PromotionPlacement) {
    const now = new Date();
    return { productKey, status: PromotionStatus.ACTIVE, startsAt: { $lte: now }, endsAt: { $gt: now } };
  }

  /** Offer ids promoted in a placement, oldest booking first (first come, first served within the slots). */
  async promotedOfferIds(productKey: PromotionPlacement, scope: { area?: string; categoryId?: string; cities?: string[] } = {}) {
    const filter: Record<string, unknown> = this.liveFilter(productKey);
    if (scope.area) filter['scope.area'] = scope.area.toUpperCase();
    if (scope.categoryId && Types.ObjectId.isValid(scope.categoryId)) filter['scope.categoryId'] = new Types.ObjectId(scope.categoryId);
    if (scope.cities?.length) filter['scope.city'] = { $in: scope.cities.map((c) => c.toLowerCase()) };
    const product = await this.products.findOne({ key: productKey }).select('slots').lean();
    const bookings = await this.promotions.find(filter).sort({ createdAt: 1 }).limit(product?.slots ?? 10).select('offerId').lean();
    return bookings.map((b) => String(b.offerId));
  }

  /** The offers in a site-wide placement, live and public, for the homepage and offers page. */
  async placementOffers(productKey: PromotionPlacement.FLASH_DEAL | PromotionPlacement.HOMEPAGE_SPOT) {
    const ids = await this.promotedOfferIds(productKey);
    if (!ids.length) return [];
    const activeBusinesses = await this.businesses.distinct('_id', { status: BusinessStatus.ACTIVE });
    const offers = await this.offers
      .find({ _id: { $in: ids }, status: { $in: PUBLIC_OFFER_STATUSES }, businessId: { $in: activeBusinesses } })
      .select(PUBLIC_OFFER_PROJECTION)
      .populate({ path: 'businessId', select: 'name slug town postcodeArea verificationLevel isFoodbellClient reviews logoUrl orderUrl phone categories', populate: { path: 'categories', select: 'name slug emoji' } })
      .lean();
    const order = new Map(ids.map((id, i) => [id, i]));
    return offers
      .sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
      .map((o) => ({ ...o, promoted: true, slug: offerSlug(o.title, (o.businessId as unknown as { name?: string })?.name) }));
  }

  categoryList() {
    return this.categories.find().select('name slug').sort({ name: 1 }).lean();
  }
}

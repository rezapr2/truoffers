import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Model, Types } from 'mongoose';
import { BusinessesService } from '../businesses/businesses.service';
import { ActorContext } from '../common/actor-context';
import { BusinessAccessService } from '../common/business-access';
import { AuthUser } from '../common/decorators';
import { BusinessMemberRole, OfferStatus, Role, VerificationLevel } from '../common/enums';
import { ActorKind } from '../common/scraper.enums';
import { CreateOfferDto } from '../offers/offers.dto';
import { OfferPublishingService } from '../offers/offer-publishing.service';
import { OffersService } from '../offers/offers.service';
import { SettingsService } from '../platform/settings.service';
import { AuditService } from '../scraper/audit/audit.service';
import { AnalyticsEvent, AnalyticsEventDocument } from '../schemas/analytics-event.schema';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { MenuItem, MenuItemDocument } from '../schemas/menu.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';
import { dealToOffer, FoodbellSnapshot, offerHash, openingHoursFrom } from './foodbell.mapping';
import { SIGNATURE_HEADER, signRequest, verifyRequest } from './foodbell.signature';

const PROVIDER = 'foodbell';
const DAY = 24 * 3600_000;
// The periodic re-sync is a safety net for changes Foodbell couldn't announce.
const RESYNC_AFTER_MS = 6 * 3600_000;
// Offer statuses a sync leaves alone: ended, removed, or turned down by a moderator.
const FINAL = [OfferStatus.EXPIRED, OfferStatus.REMOVED];

interface FoodbellEvent {
  id: string;
  type: 'store.updated' | 'store.disconnected' | 'order.completed';
  storeId: string;
  data?: Record<string, unknown>;
}

export interface SyncSummary {
  at: string;
  menuItems: number;
  offers: { created: number; updated: number; unchanged: number; ended: number };
  // Deals that didn't become offers, and why (plan limits, coupon codes on Free, Foodbell-side reasons)
  skipped: { id: string; title?: string; reason: string }[];
  // Identity fields Foodbell has that differ from the listing: changed by the owner, not by a sync
  differences: { field: string; listing: string | null; foodbell: string | null }[];
}

/**
 * Blueprint §27, the Foodbell integration. An owner connects their Foodbell store with a one-time code from the
 * Foodbell dashboard; from then on the listing mirrors the store's profile, hours, menu and the deals the owner
 * publishes there. Foodbell tells us when something changes (webhook) and when an order we sent is done, so the
 * owner sees orders and revenue from TruOffers.
 *
 * Synced deals become offers through OffersService, as the owner: they obey the same plan limits, coupon-code
 * rules, moderation rules and verification holds as offers typed into the editor.
 */
@Injectable()
export class FoodbellService {
  private readonly logger = new Logger(FoodbellService.name);

  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(MenuItem.name) private readonly menu: Model<MenuItemDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AnalyticsEvent.name) private readonly events: Model<AnalyticsEventDocument>,
    private readonly settings: SettingsService,
    private readonly access: BusinessAccessService,
    private readonly businessesService: BusinessesService,
    private readonly offersService: OffersService,
    private readonly publishing: OfferPublishingService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Talking to Foodbell
  // ---------------------------------------------------------------------------------------------------

  private async config() {
    const settings = await this.settings.get();
    const url = (process.env.FOODBELL_API_URL || settings.foodbellApiUrl || '').replace(/\/+$/, '');
    const secret = await this.settings.secret('foodbellSharedSecret');
    return url && secret ? { url, secret } : null;
  }

  async configured(): Promise<boolean> {
    return (await this.config()) !== null;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const config = await this.config();
    if (!config) throw new ServiceUnavailableException('The Foodbell connection is not set up yet. Please try again later.');
    const url = new URL(`${config.url}${path}`);
    const raw = body === undefined ? '' : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TruOffers-Foodbell/1.0',
          [SIGNATURE_HEADER]: signRequest(config.secret, method, url.pathname + url.search, raw),
        },
        body: raw || undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.warn(`Foodbell ${method} ${path} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('We could not reach Foodbell. Please try again in a few minutes.');
    }
    const payload = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok) {
      const error = Object.assign(new Error(payload.message || `Foodbell answered ${res.status}`), { status: res.status, code: payload.code });
      throw error;
    }
    return payload as T;
  }

  // ---------------------------------------------------------------------------------------------------
  // Owner actions
  // ---------------------------------------------------------------------------------------------------

  private publicConnection(business: Pick<Business, 'foodbell'>) {
    const fb = business.foodbell;
    if (!fb) return null;
    return {
      storeId: fb.storeId,
      domain: fb.domain ?? null,
      status: fb.status,
      connectedAt: fb.connectedAt ?? null,
      lastSyncAt: fb.lastSyncAt ?? null,
      lastSyncError: fb.lastSyncError ?? null,
      summary: fb.lastSyncSummary ?? null,
    };
  }

  /** The owner's Foodbell page: the connection, what the last sync did, and orders Foodbell reported. */
  async status(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    const since = new Date(Date.now() - 30 * DAY);
    const [offers, orders] = await Promise.all([
      this.offers
        .find({ businessId: business._id, 'external.provider': PROVIDER })
        .select('title displayLabel status moderationFlags submitWhenVerified createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      this.events.aggregate([
        { $match: { businessId: business._id, eventName: 'partner_order', createdAt: { $gte: since } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$metadata.total' } } },
      ]),
    ]);
    return {
      configured: await this.configured(),
      connection: this.publicConnection(business),
      offers,
      last30Days: { orders: orders[0]?.count ?? 0, revenue: Math.round((orders[0]?.revenue ?? 0) * 100) / 100 },
    };
  }

  async connect(businessId: string, code: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    if (business.foodbell?.status === 'connected') throw new ConflictException('This business is already connected to Foodbell. Disconnect it first.');
    let snapshot: FoodbellSnapshot;
    try {
      snapshot = await this.call<FoodbellSnapshot>('POST', '/partners/truoffers/connect', {
        code: code.trim(),
        businessId: String(business._id),
        businessName: business.name,
      });
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (e.status === 404) throw new BadRequestException('That code is not valid or has expired. Create a new one in your Foodbell dashboard.');
      throw err;
    }
    // One Foodbell store mirrors into one listing. Foodbell only issues a code while the store isn't connected, so
    // another listing still marked connected here missed its disconnection: the code's owner chose this one.
    const others = await this.businesses.find({ _id: { $ne: business._id }, 'foodbell.storeId': snapshot.store.id, 'foodbell.status': 'connected' });
    for (const other of others) await this.markDisconnected(other, `Foodbell store connected to ${business.name} instead`);

    business.set({
      foodbell: {
        storeId: snapshot.store.id,
        domain: snapshot.store.domain ?? undefined,
        status: 'connected',
        connectedBy: new Types.ObjectId(user.userId),
        connectedAt: new Date(),
      },
      isFoodbellClient: true,
    });
    await business.save();
    await this.audit.record({ action: 'business.foodbell_connected', targetType: 'Business', targetId: business._id, after: { storeId: snapshot.store.id, domain: snapshot.store.domain } });
    await this.apply(business, snapshot);
    return this.status(businessId, user);
  }

  /** "Sync now" on the owner's page, and the admin's. */
  async syncNow(businessId: string, user?: AuthUser) {
    const business = user ? await this.access.load(businessId, user, 'owner', { write: true }) : await this.businesses.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    if (business.foodbell?.status !== 'connected') throw new BadRequestException('This business is not connected to Foodbell');
    await this.sync(business, true);
    const fresh = await this.businesses.findById(business._id).lean();
    return this.publicConnection(fresh!);
  }

  async disconnect(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    if (business.foodbell?.status !== 'connected') throw new BadRequestException('This business is not connected to Foodbell');
    // Tell Foodbell; disconnect here either way, so a Foodbell outage can't keep the owner connected.
    await this.call('POST', `/partners/truoffers/stores/${business.foodbell.storeId}/disconnect`, { businessId: String(business._id) }).catch((err: Error) =>
      this.logger.warn(`Foodbell disconnect for ${String(business._id)} failed: ${err.message}`),
    );
    await this.markDisconnected(business, 'Disconnected by the owner');
    return this.status(businessId, user);
  }

  // ---------------------------------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------------------------------

  private async sync(business: BusinessDocument, rethrow = false) {
    const storeId = business.foodbell!.storeId;
    try {
      const snapshot = await this.call<FoodbellSnapshot>('GET', `/partners/truoffers/stores/${storeId}/snapshot?businessId=${business._id}`);
      await this.apply(business, snapshot);
    } catch (err) {
      const e = err as { status?: number; code?: string; message: string };
      if (e.status === 404 && e.code === 'NOT_CONNECTED') {
        await this.markDisconnected(business, 'Disconnected in Foodbell');
        if (rethrow) throw new BadRequestException('Foodbell says this store is no longer connected.');
        return;
      }
      await this.businesses.updateOne({ _id: business._id }, { $set: { 'foodbell.lastSyncError': e.message.slice(0, 300) } });
      this.logger.warn(`Foodbell sync for ${String(business._id)} failed: ${e.message}`);
      if (rethrow) throw err;
    }
  }

  /** An owner of the business, to act as: the one who connected it while they still own it. */
  private async actingOwner(business: BusinessDocument): Promise<AuthUser> {
    const owners = (business.members ?? []).filter((m) => m.role === BusinessMemberRole.OWNER).map((m) => String(m.userId));
    const preferred = business.foodbell?.connectedBy && owners.includes(String(business.foodbell.connectedBy)) ? String(business.foodbell.connectedBy) : owners[0];
    const user = preferred ? await this.users.findOne({ _id: preferred, status: UserStatus.ACTIVE }).select('name email role').lean() : null;
    if (!user) throw new BadRequestException('The business has no active owner to sync for');
    return { userId: String(user._id), email: user.email, role: user.role as Role, name: user.name };
  }

  /** Mirrors one snapshot into the listing, as its owner. */
  private async apply(business: BusinessDocument, snapshot: FoodbellSnapshot) {
    const owner = await this.actingOwner(business);
    const summary: SyncSummary = { at: new Date().toISOString(), menuItems: 0, offers: { created: 0, updated: 0, unchanged: 0, ended: 0 }, skipped: [], differences: [] };
    await ActorContext.run({ kind: ActorKind.MERCHANT, userId: owner.userId, role: owner.role }, async () => {
      await this.applyProfile(business, snapshot, owner, summary);
      summary.menuItems = await this.applyMenu(business._id, snapshot);
      await this.applyDeals(business, snapshot, owner, summary);
    });
    for (const s of snapshot.skipped ?? []) summary.skipped.push({ id: s.id, ...(typeof s.title === 'string' && { title: s.title.slice(0, 120) }), reason: s.reason });
    await this.businesses.updateOne(
      { _id: business._id },
      { $set: { 'foodbell.lastSyncAt': new Date(), 'foodbell.lastSyncSummary': summary, 'foodbell.domain': snapshot.store.domain ?? undefined }, $unset: { 'foodbell.lastSyncError': 1 } },
    );
    return summary;
  }

  private async applyProfile(business: BusinessDocument, snapshot: FoodbellSnapshot, owner: AuthUser, summary: SyncSummary) {
    const s = snapshot.store;
    const fields: Record<string, unknown> = { delivery: s.delivery, collection: s.collection };
    const hours = openingHoursFrom(s.openingHours);
    if (hours) fields.openingHours = hours;
    if (!business.description && s.description) fields.description = s.description.slice(0, 1500);
    if (!business.email && s.email) fields.email = s.email;
    if (!business.logoUrl && s.logo?.startsWith('https://')) fields.logoUrl = s.logo;
    const social = { ...(business.socialLinks ?? {}) } as Record<string, string | undefined>;
    let socialChanged = false;
    for (const key of ['facebook', 'instagram', 'x'] as const) {
      if (!social[key] && s.socialLinks?.[key]) {
        social[key] = s.socialLinks[key]!;
        socialChanged = true;
      }
    }
    if (socialChanged) fields.socialLinks = social;
    // Name, address and phone are the listing's identity, checked when it was verified: filled in when empty,
    // never overwritten. A difference is shown to the owner, who changes it the usual way.
    const identity: [keyof Business, string | null][] = [
      ['name', s.name],
      ['address', s.address],
      ['town', s.town],
      ['postcode', s.postcode],
      ['phone', s.phone],
    ];
    for (const [field, value] of identity) {
      const current = business[field] as string | undefined;
      if (!value) continue;
      if (!current) {
        if (business.verificationLevel < VerificationLevel.VERIFIED && field !== 'phone') fields[field] = value;
      } else if (current.replace(/\s+/g, '').toLowerCase() !== value.replace(/\s+/g, '').toLowerCase()) {
        summary.differences.push({ field, listing: current, foodbell: value });
      }
    }
    try {
      await this.businessesService.update(String(business._id), fields as never, owner);
    } catch (err) {
      // One bad value (an email Foodbell accepts and we don't, say) must not stop the menu and deals syncing.
      summary.skipped.push({ id: 'profile', title: 'Profile', reason: (err as Error).message });
    }

    // The order link is the store's own Foodbell site. The connection itself proved the owner runs that store
    // (the code came from its dashboard), so it is set directly rather than waiting for a moderator.
    if (s.orderUrl && business.orderUrl !== s.orderUrl) {
      const before = business.orderUrl;
      await this.businesses.updateOne({ _id: business._id }, { $set: { orderUrl: s.orderUrl, ...(business.website ? {} : { website: s.orderUrl }) } });
      business.orderUrl = s.orderUrl;
      await this.audit.record({ action: 'business.order_link_from_foodbell', targetType: 'Business', targetId: business._id, before: { orderUrl: before }, after: { orderUrl: s.orderUrl } });
    }
  }

  /** The Foodbell menu replaces the items that came from Foodbell; the owner's own items stay. */
  private async applyMenu(businessId: Types.ObjectId, snapshot: FoodbellSnapshot) {
    const items = (snapshot.menu?.items ?? []).slice(0, 1000).flatMap((item, i) => {
      const base = { businessId, section: item.category || 'Menu', source: PROVIDER, imageUrl: item.image?.startsWith('https://') ? item.image : undefined };
      // A sized dish ("Margherita" 10"/12") lists from its cheapest size, with the sizes in its description.
      const sizes = (item.sizes ?? []).filter((s) => s.price > 0);
      const price = sizes.length ? Math.min(...sizes.map((s) => s.price)) : item.price;
      const sizeText = sizes.length > 1 ? sizes.map((s) => `${s.label} £${s.price.toFixed(2)}`).join(' · ') : '';
      const description = [item.description, sizeText].filter(Boolean).join(' — ').slice(0, 400) || undefined;
      return price > 0 || item.mealDeal ? [{ ...base, name: item.name.slice(0, 120), description, price: Math.max(0, price), sortOrder: i }] : [];
    });
    await this.menu.deleteMany({ businessId, source: PROVIDER });
    if (items.length) await this.menu.insertMany(items);
    return items.length;
  }

  private async applyDeals(business: BusinessDocument, snapshot: FoodbellSnapshot, owner: AuthUser, summary: SyncSummary) {
    const existing = await this.offers.find({ businessId: business._id, 'external.provider': PROVIDER });
    const byDeal = new Map(existing.map((o) => [o.external!.id, o]));
    const seen = new Set<string>();

    for (const deal of snapshot.deals ?? []) {
      seen.add(deal.id);
      const dto = dealToOffer(deal, snapshot.store.orderUrl);
      const hash = offerHash(dto);
      const current = byDeal.get(deal.id);
      try {
        const problems = await validate(plainToInstance(CreateOfferDto, dto));
        if (problems.length) throw new BadRequestException(Object.values(problems[0].constraints ?? {})[0] ?? 'Not a valid offer');
        if (current && !FINAL.includes(current.status)) {
          if (current.external?.hash === hash) {
            summary.offers.unchanged++;
            continue;
          }
          // A paused offer stays paused (the owner paused it on TruOffers); one a moderator rejected is resubmitted.
          const { offer } = await this.offersService.update(String(current._id), { ...dto, submit: current.status === OfferStatus.REJECTED } as CreateOfferDto, owner, { fromSource: true });
          await this.offers.updateOne({ _id: offer._id }, { $set: { 'external.hash': hash } });
          summary.offers.updated++;
        } else {
          if (current) await this.offers.updateOne({ _id: current._id }, { $unset: { external: 1 } });
          const { offer } = await this.offersService.create(String(business._id), { ...dto, submit: true } as CreateOfferDto, owner);
          await this.offers.updateOne({ _id: offer._id }, { $set: { external: { provider: PROVIDER, id: deal.id, hash } } });
          summary.offers.created++;
        }
      } catch (err) {
        summary.skipped.push({ id: deal.id, title: deal.title, reason: (err as Error).message });
      }
    }

    // Deals no longer published in Foodbell end here too.
    for (const offer of existing) {
      if (seen.has(offer.external!.id) || FINAL.includes(offer.status)) continue;
      await this.endOffer(offer, 'No longer published in Foodbell');
      summary.offers.ended++;
    }
  }

  private async endOffer(offer: OfferDocument, reason: string) {
    const previous = offer.status;
    offer.set({ status: OfferStatus.EXPIRED, endsAt: new Date() });
    await offer.save();
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.ended_at_source', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status }, note: reason });
  }

  private async markDisconnected(business: BusinessDocument, reason: string) {
    const owner = await this.actingOwner(business).catch(() => null);
    const end = async () => {
      const offers = await this.offers.find({ businessId: business._id, 'external.provider': PROVIDER, status: { $nin: FINAL } });
      for (const offer of offers) await this.endOffer(offer, reason);
      return offers.length;
    };
    const ended = owner ? await ActorContext.run({ kind: ActorKind.MERCHANT, userId: owner.userId, role: owner.role }, end) : await end();
    // The menu stays: the Foodbell copy becomes the owner's own, unless they have items of their own to show again.
    if (await this.menu.exists({ businessId: business._id, source: { $ne: PROVIDER } })) await this.menu.deleteMany({ businessId: business._id, source: PROVIDER });
    else await this.menu.updateMany({ businessId: business._id, source: PROVIDER }, { $unset: { source: 1 } });
    await this.businesses.updateOne({ _id: business._id }, { $set: { 'foodbell.status': 'disconnected', isFoodbellClient: false } });
    await this.audit.record({ action: 'business.foodbell_disconnected', targetType: 'Business', targetId: business._id, after: { offersEnded: ended }, note: reason });
  }

  // ---------------------------------------------------------------------------------------------------
  // Webhook and orders
  // ---------------------------------------------------------------------------------------------------

  /** Events from Foodbell. Answered quickly; a sync it asks for runs after the reply. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, path: string) {
    const config = await this.config();
    const reason = verifyRequest(config?.secret ?? '', signature, 'POST', path, rawBody?.toString('utf8') ?? '');
    if (reason) {
      this.logger.warn(`Rejected Foodbell webhook: ${reason}`);
      throw new BadRequestException('Invalid signature');
    }
    let event: FoodbellEvent;
    try {
      event = JSON.parse(rawBody!.toString('utf8')) as FoodbellEvent;
    } catch {
      throw new BadRequestException('Invalid payload');
    }
    const business = await this.businesses.findOne({ 'foodbell.storeId': String(event.storeId), 'foodbell.status': 'connected' });
    // Not (or no longer) connected here: acknowledged, so Foodbell stops retrying.
    if (!business) return { received: true, ignored: true };

    switch (event.type) {
      case 'store.updated':
        setImmediate(() => void this.sync(business));
        break;
      case 'store.disconnected':
        await this.markDisconnected(business, 'Disconnected in Foodbell');
        break;
      case 'order.completed':
        await this.recordOrder(business, event.data ?? {});
        break;
      default:
        return { received: true, ignored: true };
    }
    return { received: true };
  }

  /** An order TruOffers sent to the store's Foodbell site, now done: counted in the owner's insights. */
  private async recordOrder(business: BusinessDocument, data: Record<string, unknown>) {
    const orderId = typeof data.orderId === 'string' ? data.orderId : null;
    if (!orderId) return;
    if (await this.events.exists({ businessId: business._id, eventName: 'partner_order', 'metadata.orderId': orderId })) return;
    const campaign = typeof data.campaign === 'string' && Types.ObjectId.isValid(data.campaign) ? new Types.ObjectId(data.campaign) : undefined;
    const offer = campaign ? await this.offers.exists({ _id: campaign, businessId: business._id }) : null;
    const total = Number(data.total);
    await this.events.create({
      eventName: 'partner_order',
      businessId: business._id,
      offerId: offer ? campaign : undefined,
      metadata: {
        provider: PROVIDER,
        orderId,
        clickId: typeof data.clickId === 'string' ? data.clickId.slice(0, 64) : undefined,
        orderType: typeof data.orderType === 'string' ? data.orderType : undefined,
        total: Number.isFinite(total) && total >= 0 ? Math.round(total * 100) / 100 : 0,
      },
    });
  }

  /** Safety net: re-sync connected stores whose last sync is old (changes Foodbell couldn't announce). */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async resync() {
    if (process.env.NODE_ENV === 'test' || !(await this.configured())) return;
    const stale = await this.businesses
      .find({ 'foodbell.status': 'connected', $or: [{ 'foodbell.lastSyncAt': { $exists: false } }, { 'foodbell.lastSyncAt': { $lt: new Date(Date.now() - RESYNC_AFTER_MS) } }] })
      .limit(100);
    for (const business of stale) await this.sync(business);
  }
}

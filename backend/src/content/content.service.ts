import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import { BusinessStatus, DiscountType, PromotionPlacement, PUBLIC_OFFER_STATUSES } from '../common/enums';
import { offerSlug, PUBLIC_BUSINESS_PROJECTION, PUBLIC_OFFER_PROJECTION } from '../common/public-offer';
import { BusinessesService, claimState } from '../businesses/businesses.service';
import { PromotionsService } from '../promotions/promotions.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import {
  Area,
  AreaDocument,
  HelpPage,
  HelpPageDocument,
  OfferTypeConfig,
  OfferTypeConfigDocument,
  SiteContent,
  SiteContentDocument,
} from '../schemas/taxonomy.schema';

export const DEFAULT_OFFER_TYPES: { key: DiscountType; label: string; icon: string; sortOrder: number; active: boolean }[] = [
  { key: DiscountType.PERCENT, label: '% off', icon: '％', sortOrder: 0, active: true },
  { key: DiscountType.FIXED, label: '£ off', icon: '£', sortOrder: 1, active: true },
  { key: DiscountType.BOGOF, label: '2-for-1', icon: '2×', sortOrder: 2, active: true },
  { key: DiscountType.FREE_ITEM, label: 'Freebie', icon: '🎁', sortOrder: 3, active: true },
  { key: DiscountType.MEAL_DEAL, label: 'Meal deal', icon: '🍱', sortOrder: 4, active: true },
  { key: DiscountType.CUSTOM, label: 'Other', icon: '✦', sortOrder: 5, active: true },
  { key: DiscountType.FREE_DELIVERY, label: 'Free delivery', icon: '🛵', sortOrder: 6, active: false },
  { key: DiscountType.MULTI_BUY, label: 'Multi-buy', icon: '×3', sortOrder: 7, active: false },
  { key: DiscountType.COLLECTION_DISCOUNT, label: 'Collection discount', icon: '🛍', sortOrder: 8, active: false },
  { key: DiscountType.DELIVERY_DISCOUNT, label: 'Delivery discount', icon: '🚚', sortOrder: 9, active: false },
];

export interface BlockConfig {
  mode: 'auto' | 'manual';
  ids: string[];
}

export interface HomeContent {
  featuredTakeaways: BlockConfig;
  topPicks: BlockConfig;
  flashDeals: BlockConfig;
}

export interface Banner {
  id: string;
  text: string;
  link?: string;
  tone?: 'sun' | 'leaf' | 'tomato';
  active: boolean;
}

export interface Faq {
  question: string;
  answer: string;
}

const DEFAULT_HOME: HomeContent = {
  featuredTakeaways: { mode: 'auto', ids: [] },
  topPicks: { mode: 'auto', ids: [] },
  flashDeals: { mode: 'auto', ids: [] },
};

const OFFER_BUSINESS = { path: 'businessId', select: 'name slug town postcodeArea verificationLevel isFoodbellClient reviews logoUrl orderUrl phone status categories', populate: { path: 'categories', select: 'name slug emoji' } };

/** Taxonomy (spec /admin/taxonomy) and site content (/admin/content), with what the public pages read. */
@Injectable()
export class ContentService {
  constructor(
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
    @InjectModel(Area.name) private readonly areas: Model<AreaDocument>,
    @InjectModel(OfferTypeConfig.name) private readonly offerTypes: Model<OfferTypeConfigDocument>,
    @InjectModel(SiteContent.name) private readonly content: Model<SiteContentDocument>,
    @InjectModel(HelpPage.name) private readonly help: Model<HelpPageDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    private readonly businessesService: BusinessesService,
    private readonly promotions: PromotionsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Taxonomy
  // ---------------------------------------------------------------------------------------------------

  publicCategories() {
    return this.categories.find({ active: { $ne: false } }).sort({ sortOrder: 1, businessCount: -1, name: 1 }).lean();
  }

  allCategories() {
    return this.categories.find().sort({ sortOrder: 1, name: 1 }).lean();
  }

  async saveCategory(id: string | null, input: { name?: string; slug?: string; emoji?: string; sortOrder?: number; seoText?: string; active?: boolean }) {
    if (id) {
      const category = await this.categories.findById(id);
      if (!category) throw new NotFoundException('Cuisine not found');
      const before = category.toObject();
      category.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
      await category.save().catch((err) => {
        throw err?.code === 11000 ? new ConflictException('That slug is taken') : err;
      });
      await this.audit.record({ action: 'taxonomy.cuisine_updated', targetType: 'Category', targetId: category._id, before: { name: before.name, slug: before.slug, active: before.active }, after: { name: category.name, slug: category.slug, active: category.active } });
      return category;
    }
    if (!input.name) throw new BadRequestException('Give the cuisine a name');
    const slug = (input.slug || slugify(input.name, { lower: true, strict: true })).toLowerCase();
    if (await this.categories.exists({ slug })) throw new ConflictException('That slug is taken');
    const category = await this.categories.create({ ...input, slug, businessCount: 0 });
    await this.audit.record({ action: 'taxonomy.cuisine_created', targetType: 'Category', targetId: category._id, after: { name: category.name, slug } });
    return category;
  }

  async deleteCategory(id: string) {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundException('Cuisine not found');
    const used = await this.businesses.countDocuments({ categories: category._id });
    if (used > 0) throw new BadRequestException(`${used} business${used === 1 ? ' uses' : 'es use'} this cuisine. Hide it instead.`);
    await category.deleteOne();
    await this.audit.record({ action: 'taxonomy.cuisine_deleted', targetType: 'Category', targetId: id, before: { name: category.name } });
    return { deleted: true };
  }

  publicAreas() {
    return this.areas.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  }

  allAreas() {
    return this.areas.find().sort({ sortOrder: 1, name: 1 }).lean();
  }

  areaBySlug(slug: string) {
    return this.areas.findOne({ slug: slug.toLowerCase(), active: true }).lean();
  }

  async saveArea(id: string | null, input: { name?: string; slug?: string; icon?: string; sortOrder?: number; seoText?: string; postcodeDistricts?: string[]; active?: boolean }) {
    const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (fields.postcodeDistricts) fields.postcodeDistricts = (fields.postcodeDistricts as string[]).map((d) => d.trim().toUpperCase()).filter(Boolean);
    if (id) {
      const area = await this.areas.findById(id);
      if (!area) throw new NotFoundException('Area not found');
      const before = area.toObject();
      area.set(fields);
      await area.save();
      await this.audit.record({ action: 'taxonomy.area_updated', targetType: 'Area', targetId: area._id, before: { name: before.name, active: before.active }, after: { name: area.name, active: area.active } });
      return area;
    }
    if (!input.name) throw new BadRequestException('Give the area a name');
    const slug = (input.slug || input.name).trim().toLowerCase();
    if (await this.areas.exists({ slug })) throw new ConflictException('That area already exists');
    const area = await this.areas.create({ ...fields, slug });
    await this.audit.record({ action: 'taxonomy.area_created', targetType: 'Area', targetId: area._id, after: { name: area.name } });
    return area;
  }

  async deleteArea(id: string) {
    const area = await this.areas.findByIdAndDelete(id);
    if (!area) throw new NotFoundException('Area not found');
    await this.audit.record({ action: 'taxonomy.area_deleted', targetType: 'Area', targetId: id, before: { name: area.name } });
    return { deleted: true };
  }

  /** The offer types, creating the defaults the first time. */
  async allOfferTypes() {
    const count = await this.offerTypes.estimatedDocumentCount();
    if (count === 0) await this.offerTypes.insertMany(DEFAULT_OFFER_TYPES).catch(() => undefined);
    return this.offerTypes.find().sort({ sortOrder: 1 }).lean();
  }

  async publicOfferTypes() {
    return (await this.allOfferTypes()).filter((t) => t.active);
  }

  async saveOfferType(key: string, input: { label?: string; icon?: string; sortOrder?: number; active?: boolean }) {
    await this.allOfferTypes();
    const type = await this.offerTypes.findOne({ key });
    if (!type) throw new NotFoundException('Offer type not found');
    const before = type.toObject();
    type.set(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    await type.save();
    await this.audit.record({ action: 'taxonomy.offer_type_updated', targetType: 'OfferType', targetId: key, before: { label: before.label, active: before.active }, after: { label: type.label, active: type.active } });
    return type;
  }

  // ---------------------------------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------------------------------

  private async value<T>(key: string, fallback: T): Promise<T> {
    const doc = await this.content.findOne({ key }).lean();
    return (doc?.value as T) ?? fallback;
  }

  private async setValue(key: string, value: unknown) {
    const before = await this.content.findOne({ key }).lean();
    await this.content.updateOne({ key }, { $set: { value } }, { upsert: true });
    await this.audit.record({ action: `content.${key}_updated`, targetType: 'SiteContent', targetId: key, before: (before?.value as Record<string, unknown>) ?? undefined, after: value as Record<string, unknown> });
  }

  async homeConfig(): Promise<HomeContent> {
    return { ...DEFAULT_HOME, ...(await this.value<Partial<HomeContent>>('home', {})) };
  }

  async saveHomeConfig(config: HomeContent) {
    for (const block of Object.values(config)) {
      if (!['auto', 'manual'].includes(block.mode)) throw new BadRequestException('Each block is auto or manual');
      block.ids = (block.ids ?? []).filter((id) => Types.ObjectId.isValid(id)).slice(0, 12);
    }
    await this.setValue('home', config);
    return this.homeConfig();
  }

  faqs() {
    return this.value<Faq[]>('faqs', []);
  }

  async saveFaqs(faqs: Faq[]) {
    await this.setValue('faqs', faqs.filter((f) => f.question?.trim() && f.answer?.trim()));
    return this.faqs();
  }

  banners() {
    return this.value<Banner[]>('banners', []);
  }

  async saveBanners(banners: Banner[]) {
    await this.setValue('banners', banners.map((b) => ({ ...b, id: b.id || new Types.ObjectId().toHexString() })));
    return this.banners();
  }

  helpPages(publishedOnly: boolean) {
    return this.help.find(publishedOnly ? { published: true } : {}).sort({ sortOrder: 1, title: 1 }).lean();
  }

  async helpPage(slug: string) {
    const page = await this.help.findOne({ slug: slug.toLowerCase(), published: true }).lean();
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async saveHelpPage(id: string | null, input: { slug?: string; title?: string; body?: string; published?: boolean; sortOrder?: number }) {
    const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (fields.slug) fields.slug = slugify(String(fields.slug), { lower: true, strict: true });
    if (id) {
      const page = await this.help.findByIdAndUpdate(id, { $set: fields }, { new: true });
      if (!page) throw new NotFoundException('Page not found');
      await this.audit.record({ action: 'content.help_page_updated', targetType: 'HelpPage', targetId: id, after: { slug: page.slug, title: page.title, published: page.published } });
      return page;
    }
    if (!input.title) throw new BadRequestException('Give the page a title');
    const slug = (fields.slug as string) || slugify(input.title, { lower: true, strict: true });
    if (await this.help.exists({ slug })) throw new ConflictException('A page with that address exists');
    const page = await this.help.create({ ...fields, slug });
    await this.audit.record({ action: 'content.help_page_created', targetType: 'HelpPage', targetId: page._id, after: { slug, title: page.title } });
    return page;
  }

  async deleteHelpPage(id: string) {
    const page = await this.help.findByIdAndDelete(id);
    if (!page) throw new NotFoundException('Page not found');
    await this.audit.record({ action: 'content.help_page_deleted', targetType: 'HelpPage', targetId: id, before: { slug: page.slug } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------------------------------
  // The homepage, resolved
  // ---------------------------------------------------------------------------------------------------

  private async liveOffers(filter: Record<string, unknown>, limit: number, sort: Record<string, 1 | -1>) {
    const activeBusinesses = await this.businesses.distinct('_id', { status: BusinessStatus.ACTIVE });
    const now = new Date();
    const offers = await this.offers
      .find({ status: { $in: PUBLIC_OFFER_STATUSES }, businessId: { $in: activeBusinesses }, $or: [{ endsAt: null }, { endsAt: { $gte: now } }], ...filter })
      .select(PUBLIC_OFFER_PROJECTION)
      .sort(sort)
      .limit(limit)
      .populate(OFFER_BUSINESS)
      .lean();
    return offers.map((o) => ({ ...o, slug: offerSlug(o.title, (o.businessId as unknown as { name?: string })?.name) }));
  }

  private inOrder<T extends { _id: Types.ObjectId }>(items: T[], ids: string[]) {
    const position = new Map(ids.map((id, i) => [id, i]));
    return items.sort((a, b) => (position.get(String(a._id)) ?? 99) - (position.get(String(b._id)) ?? 99));
  }

  /**
   * Everything the homepage shows: live stats, featured takeaways, "Our top picks" (homepage spots first, labelled
   * Promoted), the "Ending soon" flash deals (flash-deal promotions first) and banners.
   */
  async home() {
    const config = await this.homeConfig();
    const [stats, homepageSpots, flashPromotions, banners] = await Promise.all([
      this.businessesService.publicStats(),
      this.promotions.placementOffers(PromotionPlacement.HOMEPAGE_SPOT),
      this.promotions.placementOffers(PromotionPlacement.FLASH_DEAL),
      this.banners(),
    ]);

    const featured =
      config.featuredTakeaways.mode === 'manual' && config.featuredTakeaways.ids.length
        ? this.inOrder(
            await this.businesses
              .find({ _id: { $in: config.featuredTakeaways.ids }, status: BusinessStatus.ACTIVE })
              .select(PUBLIC_BUSINESS_PROJECTION)
              .populate('categories', 'name slug emoji')
              .lean(),
            config.featuredTakeaways.ids,
          )
        : await this.businesses
            .find({ status: BusinessStatus.ACTIVE, featured: true })
            .select(PUBLIC_BUSINESS_PROJECTION)
            .sort({ verificationLevel: -1, 'reviews.rating': -1 })
            .limit(6)
            .populate('categories', 'name slug emoji')
            .lean();

    const promotedTop = new Set(homepageSpots.map((o) => String(o._id)));
    const picks =
      config.topPicks.mode === 'manual' && config.topPicks.ids.length
        ? this.inOrder(await this.liveOffers({ _id: { $in: config.topPicks.ids } }, 12, { createdAt: -1 }), config.topPicks.ids)
        : await this.liveOffers({}, 16, { featured: -1, impressions: -1, createdAt: -1 });
    const topPicks = [...homepageSpots, ...picks.filter((o) => !promotedTop.has(String(o._id)))].slice(0, 8);

    const promotedFlash = new Set(flashPromotions.map((o) => String(o._id)));
    const flashPool =
      config.flashDeals.mode === 'manual' && config.flashDeals.ids.length
        ? this.inOrder(await this.liveOffers({ _id: { $in: config.flashDeals.ids } }, 12, { endsAt: 1 }), config.flashDeals.ids)
        : await this.liveOffers({ endsAt: { $ne: null, $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 3600_000) } }, 12, { endsAt: 1 });
    const flashDeals = [...flashPromotions, ...flashPool.filter((o) => !promotedFlash.has(String(o._id)))].slice(0, 6);

    return {
      stats,
      featured: featured.map((b) => ({ ...b, claimState: claimState(b.verificationLevel) })),
      topPicks,
      flashDeals,
      banners: banners.filter((b) => b.active),
    };
  }
}

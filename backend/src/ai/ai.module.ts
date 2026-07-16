import {
  Body,
  Controller,
  ForbiddenException,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsIn, IsMongoId, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Category, CategoryDocument, CategorySchema } from '../schemas/category.schema';
import { Plan, PlanDocument, PlanSchema } from '../schemas/plan.schema';
import {
  Subscription,
  SubscriptionDocument,
  SubscriptionSchema,
} from '../schemas/subscription.schema';
import { CurrentUser } from '../common/decorators';
import { DiscountType, PlanKey, Role, SubscriptionStatus } from '../common/enums';

export class OfferWriterDto {
  @IsMongoId()
  businessId: string;

  @IsIn(Object.values(DiscountType))
  discountType: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrder?: number;

  // Free-text hints, e.g. "family feast deal, weekends only"
  @IsOptional()
  @IsString()
  @MaxLength(500)
  brief?: string;
}

export interface OfferCopy {
  title: string;
  description: string;
  terms: string;
  displayLabel: string;
}

const OFFER_COPY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Punchy offer title, max 60 chars' },
    description: {
      type: 'string',
      description: 'One or two enticing sentences selling the offer, max 200 chars',
    },
    terms: { type: 'string', description: 'Short fair-use terms, max 140 chars' },
    displayLabel: {
      type: 'string',
      description: 'Very short badge label, max 12 chars, e.g. "20% off", "2 for 1"',
    },
  },
  required: ['title', 'description', 'terms', 'displayLabel'],
  additionalProperties: false,
} as const;

// AI offer writer: drafts offer copy with Claude when ANTHROPIC_API_KEY is set;
// falls back to solid templates otherwise (same key-gated pattern as billing).
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
    @InjectModel(Subscription.name) private subModel: Model<SubscriptionDocument>,
  ) {
    this.anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }

  async writeOfferCopy(dto: OfferWriterDto, user: { userId: string; role: Role }) {
    const business = await this.businessModel.findById(dto.businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    await this.assertPlanAllows(business);

    const categories = await this.categoryModel.find({ _id: { $in: business.categories } });
    const cuisine = categories.map((c) => c.name).join(', ') || 'takeaway';

    if (this.anthropic) {
      try {
        const copy = await this.generateWithClaude(business.name, cuisine, business.town, dto);
        return { mode: 'ai', copy };
      } catch (err) {
        this.logger.warn(`Claude generation failed, using template: ${(err as Error).message}`);
      }
    }
    return { mode: 'template', copy: this.generateFromTemplate(business.name, cuisine, dto) };
  }

  private async generateWithClaude(
    name: string,
    cuisine: string,
    town: string | undefined,
    dto: OfferWriterDto,
  ): Promise<OfferCopy> {
    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system:
        'You write short, appetising promotional copy for UK takeaway offers. ' +
        'British English, warm and direct, no exclamation-mark spam, no emoji. ' +
        'Titles must be concrete and specific to the deal, not generic slogans.',
      output_config: {
        format: { type: 'json_schema', schema: OFFER_COPY_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content:
            `Write offer copy for "${name}" (${cuisine}${town ? `, ${town}` : ''}).\n` +
            `Deal type: ${dto.discountType}` +
            (dto.value ? `, value: ${dto.discountType === 'fixed' ? '£' : ''}${dto.value}${dto.discountType === 'percent' ? '%' : ''}` : '') +
            (dto.minOrder ? `, minimum order £${dto.minOrder}` : '') +
            (dto.brief ? `\nOwner notes: ${dto.brief}` : ''),
        },
      ],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No text block in response');
    return JSON.parse(text.text) as OfferCopy;
  }

  private generateFromTemplate(name: string, cuisine: string, dto: OfferWriterDto): OfferCopy {
    const min = dto.minOrder ? ` on orders over £${dto.minOrder}` : '';
    const byType: Record<DiscountType, OfferCopy> = {
      [DiscountType.PERCENT]: {
        title: `${dto.value || 10}% off your order${min}`,
        description: `Enjoy ${dto.value || 10}% off freshly made ${cuisine} from ${name}. Order direct and save.`,
        terms: `Valid${min || ' on all orders'}. Not valid with other offers.`,
        displayLabel: `${dto.value || 10}% off`,
      },
      [DiscountType.FIXED]: {
        title: `£${dto.value || 5} off your order${min}`,
        description: `Get £${dto.value || 5} off your next ${cuisine} order from ${name}. Order direct and save.`,
        terms: `Valid${min || ' on all orders'}. Not valid with other offers.`,
        displayLabel: `£${dto.value || 5} off`,
      },
      [DiscountType.FREE_DELIVERY]: {
        title: `Free delivery${min}`,
        description: `${name} delivers your favourite ${cuisine} to your door — delivery is on us.`,
        terms: `Free delivery${min || ''} within our delivery area.`,
        displayLabel: 'Free del.',
      },
      [DiscountType.BOGOF]: {
        title: `2 for 1${min}`,
        description: `Double up at ${name}: buy one, get one free on selected ${cuisine} dishes.`,
        terms: 'Cheapest item free. Selected items only. Not valid with other offers.',
        displayLabel: '2 for 1',
      },
      [DiscountType.MEAL_DEAL]: {
        title: `Meal deal special${min}`,
        description: `Feast for less with ${name}'s meal deal — great ${cuisine} at a bundled price.`,
        terms: 'Meal deal items only. Not valid with other offers.',
        displayLabel: 'Meal deal',
      },
    };
    const copy = byType[dto.discountType];
    if (dto.brief) copy.description = `${copy.description} ${dto.brief}`.slice(0, 200);
    return copy;
  }

  private async assertPlanAllows(business: BusinessDocument) {
    const sub = await this.subModel.findOne({
      businessId: business._id,
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
    });
    const key = sub?.planKey || PlanKey.FREE;
    const plan = await this.planModel.findOne({ key });
    if (!plan?.limits?.aiOfferWriter) {
      throw new ForbiddenException(
        'The AI offer writer is available on Professional and Premium plans. Upgrade to use it.',
      );
    }
  }
}

@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Post('offer-writer')
  writeOffer(@Body() dto: OfferWriterDto, @CurrentUser() user: { userId: string; role: Role }) {
    return this.service.writeOfferCopy(dto, user);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}

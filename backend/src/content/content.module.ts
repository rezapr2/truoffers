import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Public } from '../common/decorators';
import { Capability, RequireCapability } from '../common/permissions';
import { BusinessesModule } from '../businesses/businesses.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import {
  Area,
  AreaSchema,
  HelpPage,
  HelpPageSchema,
  OfferTypeConfig,
  OfferTypeConfigSchema,
  SiteContent,
  SiteContentSchema,
} from '../schemas/taxonomy.schema';
import { ContentService } from './content.service';

class CategoryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(2000) seoText?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class AreaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(2000) seoText?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) postcodeDistricts?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

class OfferTypeDto {
  @IsOptional() @IsString() @MaxLength(30) label?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class BlockDto {
  @IsIn(['auto', 'manual']) mode: 'auto' | 'manual';
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) ids: string[];
}

class HomeDto {
  @ValidateNested() @Type(() => BlockDto) featuredTakeaways: BlockDto;
  @ValidateNested() @Type(() => BlockDto) topPicks: BlockDto;
  @ValidateNested() @Type(() => BlockDto) flashDeals: BlockDto;
}

class FaqDto {
  @IsString() @MaxLength(300) question: string;
  @IsString() @MaxLength(3000) answer: string;
}

class FaqsDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => FaqDto) faqs: FaqDto[];
}

class BannerDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(200) text: string;
  @IsOptional() @IsString() @MaxLength(300) link?: string;
  @IsOptional() @IsIn(['sun', 'leaf', 'tomato']) tone?: 'sun' | 'leaf' | 'tomato';
  @IsBoolean() active: boolean;
}

class BannersDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BannerDto) banners: BannerDto[];
}

class HelpPageDto {
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

@Controller()
export class PublicContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.content.publicCategories();
  }

  @Public()
  @Get('taxonomy/areas')
  areas() {
    return this.content.publicAreas();
  }

  @Public()
  @Get('taxonomy/areas/:slug')
  area(@Param('slug') slug: string) {
    return this.content.areaBySlug(slug).then((area) => area ?? {});
  }

  @Public()
  @Get('taxonomy/offer-types')
  offerTypes() {
    return this.content.publicOfferTypes();
  }

  @Public()
  @Get('content/home')
  home() {
    return this.content.home();
  }

  @Public()
  @Get('content/faqs')
  faqs() {
    return this.content.faqs();
  }

  @Public()
  @Get('content/help')
  help() {
    return this.content.helpPages(true);
  }

  @Public()
  @Get('content/help/:slug')
  helpPage(@Param('slug') slug: string) {
    return this.content.helpPage(slug);
  }
}

@Controller('admin/taxonomy')
@RequireCapability(Capability.TAXONOMY_MANAGE)
export class AdminTaxonomyController {
  constructor(private readonly content: ContentService) {}

  @Get('categories')
  categories() {
    return this.content.allCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.content.saveCategory(null, dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: CategoryDto) {
    return this.content.saveCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.content.deleteCategory(id);
  }

  @Get('areas')
  areas() {
    return this.content.allAreas();
  }

  @Post('areas')
  createArea(@Body() dto: AreaDto) {
    return this.content.saveArea(null, dto);
  }

  @Patch('areas/:id')
  updateArea(@Param('id') id: string, @Body() dto: AreaDto) {
    return this.content.saveArea(id, dto);
  }

  @Delete('areas/:id')
  deleteArea(@Param('id') id: string) {
    return this.content.deleteArea(id);
  }

  @Get('offer-types')
  offerTypes() {
    return this.content.allOfferTypes();
  }

  @Patch('offer-types/:key')
  updateOfferType(@Param('key') key: string, @Body() dto: OfferTypeDto) {
    return this.content.saveOfferType(key, dto);
  }
}

@Controller('admin/content')
@RequireCapability(Capability.CONTENT_MANAGE)
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get('home')
  home() {
    return this.content.homeConfig();
  }

  @Put('home')
  saveHome(@Body() dto: HomeDto) {
    return this.content.saveHomeConfig(dto);
  }

  @Get('faqs')
  faqs() {
    return this.content.faqs();
  }

  @Put('faqs')
  saveFaqs(@Body() dto: FaqsDto) {
    return this.content.saveFaqs(dto.faqs);
  }

  @Get('banners')
  banners() {
    return this.content.banners();
  }

  @Put('banners')
  saveBanners(@Body() dto: BannersDto) {
    return this.content.saveBanners(dto.banners.map((b) => ({ ...b, id: b.id ?? '' })));
  }

  @Get('help')
  help() {
    return this.content.helpPages(false);
  }

  @Post('help')
  createHelp(@Body() dto: HelpPageDto) {
    return this.content.saveHelpPage(null, dto);
  }

  @Patch('help/:id')
  updateHelp(@Param('id') id: string, @Body() dto: HelpPageDto) {
    return this.content.saveHelpPage(id, dto);
  }

  @Delete('help/:id')
  deleteHelp(@Param('id') id: string) {
    return this.content.deleteHelpPage(id);
  }
}

@Module({
  imports: [
    BusinessesModule,
    PromotionsModule,
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Area.name, schema: AreaSchema },
      { name: OfferTypeConfig.name, schema: OfferTypeConfigSchema },
      { name: SiteContent.name, schema: SiteContentSchema },
      { name: HelpPage.name, schema: HelpPageSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [PublicContentController, AdminTaxonomyController, AdminContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}

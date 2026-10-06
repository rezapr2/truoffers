import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DiscountType, OfferRejectReason, RedemptionType } from '../common/enums';
import { WEEKDAYS } from '../common/scraper.enums';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateOfferDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsEnum(DiscountType)
  discountType: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  displayLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrder?: number;

  @IsEnum(RedemptionType)
  redemptionType: RedemptionType;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  redemptionUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  terms?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\/api\/files\/public\/\S+|https:\/\/\S+|)$/, { message: 'Upload the photo again' })
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  collection?: boolean;

  @IsOptional()
  @IsBoolean()
  delivery?: boolean;

  @IsOptional()
  @IsBoolean()
  newCustomersOnly?: boolean;

  // A calendar day (YYYY-MM-DD, the whole day in UK time) or a full timestamp
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  // Absent = ongoing
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(WEEKDAYS as unknown as string[], { each: true })
  eligibleWeekdays?: string[];

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Use a time like 17:00' })
  dailyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME, { message: 'Use a time like 22:00' })
  dailyEndTime?: string;

  // Usage cap: 0 = unlimited
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  maxRedemptions?: number;

  // Send it for publishing now; otherwise it is saved as a draft
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdateOfferDto extends CreateOfferDto {}

export class RedeemOfferDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  channel?: string;
}

// ---- Admin ----

export class RejectOfferDto {
  @IsEnum(OfferRejectReason)
  reasonCode: OfferRejectReason;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}

export class AdminOfferEditDto extends CreateOfferDto {
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export class FeatureOfferDto {
  @IsBoolean()
  featured: boolean;
}

export class OfferExpiryDto {
  // Empty string = ongoing
  @IsOptional()
  @IsString()
  endsAt?: string;
}

export class BulkOfferActionDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids: string[];

  @IsIn(['approve', 'reject', 'pause'])
  action: 'approve' | 'reject' | 'pause';

  @IsOptional()
  @IsEnum(OfferRejectReason)
  reasonCode?: OfferRejectReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AdminOfferQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() businessId?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsIn(['merchant', 'scraper']) source?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

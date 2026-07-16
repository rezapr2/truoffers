import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DiscountType, RedemptionType } from '../common/enums';

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
  value?: number;

  @IsString()
  @MaxLength(20)
  displayLabel: string;

  @IsOptional()
  @IsNumber()
  minOrder?: number;

  @IsEnum(RedemptionType)
  redemptionType: RedemptionType;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  redemptionUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  terms?: string;

  @IsOptional()
  @IsBoolean()
  collection?: boolean;

  @IsOptional()
  @IsBoolean()
  delivery?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsNumber()
  maxRedemptions?: number;
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

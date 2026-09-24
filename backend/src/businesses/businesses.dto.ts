import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ClaimMethod } from '../common/enums';
import { IsWebUrl } from '../common/validators';

export class CreateBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsString()
  postcode: string;

  @IsOptional()
  @IsString()
  town?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @IsWebUrl()
  website?: string;

  @IsOptional()
  @IsString()
  @IsWebUrl()
  orderUrl?: string;

  @IsOptional()
  @IsMongoId({ each: true })
  categories?: string[];

  @IsOptional()
  @IsBoolean()
  isFoodbellClient?: boolean;
}

export class UpdateBusinessDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() postcode?: string;
  @IsOptional() @IsString() town?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() @IsWebUrl() website?: string;
  @IsOptional() @IsString() @IsWebUrl() orderUrl?: string;
  @IsOptional() @IsMongoId({ each: true }) categories?: string[];
  @IsOptional() @IsObject() openingHours?: Record<string, string>;
  @IsOptional() @IsString() @IsWebUrl() logoUrl?: string;
  @IsOptional() @IsString() @IsWebUrl() coverUrl?: string;
  @IsOptional() @IsString({ each: true }) @IsWebUrl({ each: true }) photos?: string[];
}

export class StartClaimDto {
  @IsEnum(ClaimMethod)
  method: ClaimMethod;

  @IsOptional()
  @IsString()
  evidence?: string;
}

export class VerifyClaimOtpDto {
  @IsString()
  otp: string;
}

export class CreateMenuItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsString()
  section?: string;
}

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BusinessMemberRole } from '../common/enums';

// Our own uploads (/api/files/public/...) or an https image elsewhere.
const IMAGE_URL = /^(\/api\/files\/public\/\S+|https:\/\/\S+)$/;

export class CreateBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsString()
  @MaxLength(10)
  postcode: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  town?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  orderUrl?: string;

  @IsOptional()
  @IsMongoId({ each: true })
  categories?: string[];

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  delivery?: boolean;

  @IsOptional()
  @IsBoolean()
  collection?: boolean;

  @IsOptional()
  @IsBoolean()
  isFoodbellClient?: boolean;
}

export class SocialLinksDto {
  @IsOptional() @IsString() @MaxLength(300) facebook?: string;
  @IsOptional() @IsString() @MaxLength(300) instagram?: string;
  @IsOptional() @IsString() @MaxLength(300) tiktok?: string;
  @IsOptional() @IsString() @MaxLength(300) x?: string;
}

export class UpdateBusinessDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1500) description?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsString() @MaxLength(80) town?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(500) orderUrl?: string;
  @IsOptional() @IsMongoId({ each: true }) @ArrayMaxSize(5) categories?: string[];
  @IsOptional() @IsObject() openingHours?: Record<string, string>;
  @IsOptional() @IsString() @Matches(IMAGE_URL, { message: 'Upload the logo again' }) logoUrl?: string;
  @IsOptional() @IsString() @Matches(IMAGE_URL, { message: 'Upload the cover photo again' }) coverUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @Matches(IMAGE_URL, { each: true, message: 'Upload the photos again' }) photos?: string[];
  @IsOptional() @IsBoolean() delivery?: boolean;
  @IsOptional() @IsBoolean() collection?: boolean;
  @IsOptional() @ValidateNested() @Type(() => SocialLinksDto) socialLinks?: SocialLinksDto;
  @IsOptional() @IsString() @Matches(/^(\/api\/files\/public\/\S+\.pdf|)$/, { message: 'Upload the menu PDF again' }) menuPdfUrl?: string;
}

export class CreateMenuItemDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  section?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateMenuItemDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() @MaxLength(60) section?: string;
  @IsOptional() @IsNumber() sortOrder?: number;
}

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(BusinessMemberRole)
  role: BusinessMemberRole;
}

export class UpdateMemberDto {
  @IsEnum(BusinessMemberRole)
  role: BusinessMemberRole;
}

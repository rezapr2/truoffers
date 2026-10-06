import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClaimDocumentType, ClaimRejectReason } from '../common/enums';
import { CreateBusinessDto } from '../businesses/businesses.dto';

export class StartClaimDto {
  @IsMongoId()
  businessId: string;

  // A claim invitation link from the import robot
  @IsOptional()
  @IsString()
  invite?: string;
}

export class NewBusinessClaimDto {
  @ValidateNested()
  @Type(() => CreateBusinessDto)
  business: CreateBusinessDto;

  // The owner looked at the possible duplicates and none of them is theirs
  @IsOptional()
  @IsBoolean()
  confirmNotDuplicate?: boolean;
}

export class ReverifyDto {
  @IsMongoId()
  businessId: string;
}

export class SendCodeDto {
  @IsIn(['sms', 'call'])
  channel: 'sms' | 'call';
}

export class CodeDto {
  @IsString()
  @Length(4, 8)
  code: string;
}

export class UploadDocumentDto {
  @IsEnum(ClaimDocumentType)
  type: ClaimDocumentType;
}

export class DomainEmailDto {
  @IsEmail()
  email: string;
}

export class SiteCheckDto {
  @IsIn(['meta', 'file'])
  method: 'meta' | 'file';
}

export class FhrsPickDto {
  @IsString()
  @MaxLength(20)
  fhrsId: string;
}

export class MessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}

// ---- Admin ----

export class AssignDto {
  @IsOptional()
  @IsMongoId()
  userId?: string | null;
}

export class ChecklistDto {
  @IsOptional() @IsBoolean() detailsMatch?: boolean;
  @IsOptional() @IsBoolean() documentValid?: boolean;
  @IsOptional() @IsBoolean() orderLinkOk?: boolean;
  @IsOptional() @IsBoolean() noOtherOwner?: boolean;
  @IsOptional() @IsBoolean() notLinkedToSuspended?: boolean;
}

export class ApproveClaimDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RequestInfoDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message: string;
}

export class RejectClaimDto {
  @IsEnum(ClaimRejectReason)
  reasonCode: ClaimRejectReason;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;
}

export class DocumentStatusDto {
  @IsIn(['pending', 'accepted', 'rejected'])
  status: string;
}

export class DecideChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ClaimListQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assigned?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { Capability, RequireCapability } from '../common/permissions';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Campaign, CampaignSchema } from '../schemas/campaign.schema';
import { Notification, NotificationSchema } from '../schemas/notification.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { CAMPAIGN_ROLES, CampaignsService } from './campaigns.service';

class ChannelsDto {
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsBoolean() inApp?: boolean;
}

class AudienceDto {
  @IsOptional() @IsArray() @IsIn(CAMPAIGN_ROLES, { each: true }) roles?: string[];
  @IsOptional() @IsArray() @IsInt({ each: true }) verificationLevels?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) plans?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true }) towns?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(8, { each: true }) postcodeAreas?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsMongoId() followersOf?: string | null;
}

class CampaignDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['marketing', 'service']) kind?: 'marketing' | 'service';
  @IsOptional() @ValidateNested() @Type(() => ChannelsDto) channels?: ChannelsDto;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsString() @MaxLength(459) smsBody?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
}

class ScheduleDto {
  // Empty = send now
  @IsOptional() @IsDateString() at?: string;
}

@Controller('admin/campaigns')
@RequireCapability(Capability.CAMPAIGNS_MANAGE)
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.campaigns.list(status);
  }

  @Post('preview')
  preview(@Body() dto: CampaignDto) {
    return this.campaigns.preview(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Post()
  create(@Body() dto: CampaignDto, @CurrentUser() user: AuthUser) {
    return this.campaigns.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CampaignDto) {
    return this.campaigns.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.campaigns.test(id, user);
  }

  @Post(':id/schedule')
  schedule(@Param('id') id: string, @Body() dto: ScheduleDto, @CurrentUser() user: AuthUser) {
    return this.campaigns.schedule(id, dto.at ? new Date(dto.at) : undefined, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.campaigns.cancel(id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [AdminCampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}

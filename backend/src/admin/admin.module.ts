import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthModule } from '../auth/auth.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { CreateBusinessDto, UpdateBusinessDto } from '../businesses/businesses.dto';
import { ClaimsModule } from '../claims/claims.module';
import { AuthUser, CurrentUser } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { Role } from '../common/enums';
import { Capability, RequireCapability } from '../common/permissions';
import { AnalyticsEvent, AnalyticsEventSchema } from '../schemas/analytics-event.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Claim, ClaimSchema } from '../schemas/claim.schema';
import { LoginEvent, LoginEventSchema } from '../schemas/login-event.schema';
import { MenuItem, MenuItemSchema } from '../schemas/menu.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Payment, PaymentSchema } from '../schemas/payment.schema';
import { Promotion, PromotionSchema } from '../schemas/promotion.schema';
import { BusinessStrike, BusinessStrikeSchema, Report, ReportCase, ReportCaseSchema, ReportSchema } from '../schemas/report.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AdminBusinessesService, BusinessQuery } from './admin-businesses.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminUsersService } from './admin-users.service';

// ---------------------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------------------

class ListQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() flag?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

class AdminUpdateBusinessDto extends UpdateBusinessDto {}

class LevelDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(3) level: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class FlagsDto {
  @IsOptional() @IsBoolean() isFoodbellClient?: boolean;
  @IsOptional() @IsBoolean() featured?: boolean;
}

class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

class ResolutionDto {
  @IsString() @MinLength(2) @MaxLength(500) resolution: string;
}

class ChangeOwnerDto {
  @IsEmail() email: string;
  @IsOptional() @IsBoolean() keepPreviousOwners?: boolean;
}

class MergeDto {
  @IsMongoId() intoId: string;
}

class AdminUpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() offerAlerts?: boolean;
}

class ResetLinkDto {
  @IsOptional() @IsBoolean() send?: boolean;
}

class AddStaffDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsIn([Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN]) role: Role;
}

class StaffRoleDto {
  @IsIn([Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN]) role: Role;
}

// ---------------------------------------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------------------------------------

@Controller('admin')
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get('overview')
  get() {
    return this.overview.overview();
  }

  // Older clients
  @RequireCapability(Capability.ADMIN_PANEL)
  @Get('dashboard')
  dashboard() {
    return this.overview.overview();
  }
}

@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(private readonly service: AdminBusinessesService) {}

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get()
  async list(@Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.service.list({ ...(query as BusinessQuery), page: '1' }, 5000);
      return csvResponse(
        res,
        'businesses.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'name', label: 'Name' },
          { key: 'slug', label: 'Slug' },
          { key: 'town', label: 'Town' },
          { key: 'postcode', label: 'Postcode' },
          { key: 'phone', label: 'Phone' },
          { key: 'verificationLevel', label: 'Level' },
          { key: 'status', label: 'Status' },
          { key: 'plan', label: 'Plan' },
          { key: 'source', label: 'Source' },
          { key: 'isFoodbellClient', label: 'Foodbell partner' },
          { key: 'owner', label: 'Owner', value: (b) => (b.ownerId as { email?: string } | undefined)?.email },
          { key: 'orderUrl', label: 'Order link' },
          { key: 'orderLinkCheck', label: 'Order link check' },
          { key: 'activeOfferCount', label: 'Live offers' },
          { key: 'createdAt', label: 'Created' },
        ]),
      );
    }
    return this.service.list(query as BusinessQuery);
  }

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post()
  create(@Body() dto: CreateBusinessDto) {
    return this.service.create(dto);
  }

  @RequireCapability(Capability.BUSINESS_EDIT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateBusinessDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post(':id/level')
  level(@Param('id') id: string, @Body() dto: LevelDto) {
    return this.service.setLevel(id, dto.level, dto.note);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post(':id/flags')
  flags(@Param('id') id: string, @Body() dto: FlagsDto) {
    return this.service.setFlags(id, dto);
  }

  @RequireCapability(Capability.BUSINESS_SUSPEND)
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body() dto: ReasonDto) {
    return this.service.suspend(id, dto.reason);
  }

  @RequireCapability(Capability.BUSINESS_SUSPEND)
  @Post(':id/unsuspend')
  unsuspend(@Param('id') id: string) {
    return this.service.unsuspend(id);
  }

  @RequireCapability(Capability.SUSPENSION_SUGGEST)
  @Post(':id/suspension-review')
  flagForReview(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser('userId') userId: string) {
    return this.service.flagForReview(id, dto.reason, userId);
  }

  @RequireCapability(Capability.BUSINESS_SUSPEND)
  @Post(':id/suspension-review/resolve')
  resolveReview(@Param('id') id: string, @Body() dto: ResolutionDto) {
    return this.service.resolveReview(id, dto.resolution);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post(':id/owner')
  changeOwner(@Param('id') id: string, @Body() dto: ChangeOwnerDto) {
    return this.service.changeOwner(id, dto);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post(':id/merge')
  merge(@Param('id') id: string, @Body() dto: MergeDto) {
    return this.service.merge(id, dto.intoId);
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.service.archive(id);
  }

  @RequireCapability(Capability.BUSINESS_IMPERSONATE)
  @Post(':id/impersonate')
  impersonate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.impersonate(id, user);
  }
}

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @RequireCapability(Capability.USERS_VIEW)
  @Get()
  async list(@Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.service.list({ ...query, page: '1' }, 10000);
      return csvResponse(
        res,
        'users.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'role', label: 'Role' },
          { key: 'status', label: 'Status' },
          { key: 'emailVerifiedAt', label: 'Email verified' },
          { key: 'businessCount', label: 'Businesses' },
          { key: 'lastLoginAt', label: 'Last login' },
          { key: 'createdAt', label: 'Joined' },
        ]),
      );
    }
    return this.service.list(query);
  }

  @RequireCapability(Capability.USERS_VIEW)
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Post(':id/reset-password')
  reset(@Param('id') id: string, @Body() dto: ResetLinkDto, @CurrentUser() user: AuthUser) {
    return this.service.resetPasswordLink(id, user, dto.send !== false);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Post(':id/verify-email')
  verifyEmail(@Param('id') id: string) {
    return this.service.verifyEmail(id);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Post(':id/ban')
  ban(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.service.ban(id, dto.reason, user);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Post(':id/unban')
  unban(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.unban(id, user);
  }

  @RequireCapability(Capability.USERS_MANAGE)
  @Delete(':id')
  erase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.erase(id, user);
  }
}

@Controller('admin/team')
@RequireCapability(Capability.TEAM_MANAGE)
export class AdminTeamController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list() {
    return this.service.team();
  }

  @Post()
  add(@Body() dto: AddStaffDto) {
    return this.service.addStaff(dto);
  }

  @Patch(':id')
  setRole(@Param('id') id: string, @Body() dto: StaffRoleDto, @CurrentUser() user: AuthUser) {
    return this.service.setStaffRole(id, dto.role, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeStaff(id, user);
  }

  @Post(':id/reset-2fa')
  resetTwoFactor(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resetTwoFactor(id, user);
  }
}

@Module({
  imports: [
    AuthModule,
    BusinessesModule,
    ClaimsModule,
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Claim.name, schema: ClaimSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Promotion.name, schema: PromotionSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Report.name, schema: ReportSchema },
      { name: ReportCase.name, schema: ReportCaseSchema },
      { name: BusinessStrike.name, schema: BusinessStrikeSchema },
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
      { name: LoginEvent.name, schema: LoginEventSchema },
    ]),
  ],
  controllers: [AdminOverviewController, AdminBusinessesController, AdminUsersController, AdminTeamController],
  providers: [AdminOverviewService, AdminBusinessesService, AdminUsersService],
  exports: [AdminBusinessesService],
})
export class AdminModule {}

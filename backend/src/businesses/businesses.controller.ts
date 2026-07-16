import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BusinessesService } from './businesses.service';
import {
  CreateBusinessDto,
  CreateMenuItemDto,
  StartClaimDto,
  UpdateBusinessDto,
  VerifyClaimOtpDto,
} from './businesses.dto';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { Role } from '../common/enums';

@Controller('businesses')
export class BusinessesController {
  constructor(private readonly service: BusinessesService) {}

  @Public()
  @Get()
  list(
    @Query('town') town?: string,
    @Query('category') category?: string,
    @Query('verified') verified?: string,
    @Query('featured') featured?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      town,
      category,
      q,
      verified: verified === 'true',
      featured: featured === 'true',
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('towns')
  towns() {
    return this.service.towns();
  }

  @Get('mine')
  myBusinesses(@CurrentUser('userId') userId: string) {
    return this.service.myBusinesses(userId);
  }

  // Multi-location (franchise) stats across every business the user owns
  @Get('mine/stats')
  myBusinessesStats(@CurrentUser('userId') userId: string) {
    return this.service.myBusinessesStats(userId);
  }

  @Get('claims/mine')
  myClaims(@CurrentUser('userId') userId: string) {
    return this.service.myClaims(userId);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.service.findBySlug(slug);
  }

  // Owners can add their own (unlisted) business; it starts as claimed by them
  @Roles(Role.BUSINESS_OWNER, Role.SALES_ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateBusinessDto, @CurrentUser('userId') userId: string) {
    return this.service.create(dto, userId, true);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/claim')
  startClaim(
    @Param('id') id: string,
    @Body() dto: StartClaimDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.startClaim(id, userId, dto);
  }

  @Post('claims/:claimId/verify-otp')
  verifyOtp(
    @Param('claimId') claimId: string,
    @Body() dto: VerifyClaimOtpDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.verifyClaimOtp(claimId, userId, dto.otp);
  }

  @Post(':id/menu')
  addMenuItem(
    @Param('id') id: string,
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.addMenuItem(id, dto, user);
  }

  @Delete(':id/menu/:itemId')
  removeMenuItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.removeMenuItem(id, itemId, user);
  }
}

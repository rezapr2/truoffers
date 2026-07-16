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
import { OffersService } from './offers.service';
import { CreateOfferDto, RedeemOfferDto, UpdateOfferDto } from './offers.dto';
import { CurrentUser, Public } from '../common/decorators';
import { OfferStatus, Role } from '../common/enums';

@Controller()
export class OffersController {
  constructor(private readonly service: OffersService) {}

  @Public()
  @Get('offers')
  list(@Query('businessId') businessId?: string, @Query('limit') limit?: string) {
    return this.service.listPublic({
      businessId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('offers/:id')
  get(@Param('id') id: string) {
    return this.service.getPublic(id);
  }

  @Public()
  @Post('offers/:id/redeem')
  redeem(
    @Param('id') id: string,
    @Body() dto: RedeemOfferDto,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.service.redeem(id, dto, userId);
  }

  @Get('businesses/:businessId/offers/manage')
  listForBusiness(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.listForBusiness(businessId, user);
  }

  @Post('businesses/:businessId/offers')
  create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateOfferDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.create(businessId, dto, user);
  }

  @Patch('offers/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch('offers/:id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: OfferStatus,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.setStatus(id, status, user);
  }

  @Delete('offers/:id')
  remove(@Param('id') id: string, @CurrentUser() user: { userId: string; role: Role }) {
    return this.service.remove(id, user);
  }
}

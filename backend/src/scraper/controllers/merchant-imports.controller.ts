import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/decorators';
import { Role } from '../../common/enums';
import { OfferLifecycleService } from '../lifecycle/offer-lifecycle.service';
import { MerchantImportsService } from '../review/merchant-imports.service';
import { OptOutsService } from '../review/opt-outs.service';
import { MerchantRejectDto, RemovalRequestDto } from './scraper.dto';

// Offers found on a business's own website, as the business sees them.
@Controller()
export class MerchantImportsController {
  constructor(
    private readonly imports: MerchantImportsService,
    private readonly lifecycle: OfferLifecycleService,
  ) {}

  @Get('businesses/:id/imported-offers/pending')
  pending(@Param('id') businessId: string, @CurrentUser() user: { userId: string; role: Role }) {
    return this.imports.pendingFor(businessId, user);
  }

  @Post('businesses/:id/imported-offers/:candidateId/confirm')
  confirm(@Param('id') businessId: string, @Param('candidateId') candidateId: string) {
    return this.lifecycle.confirmCandidateAsMerchant(candidateId, businessId);
  }

  @Post('businesses/:id/imported-offers/:candidateId/reject')
  @HttpCode(200)
  async reject(@Param('id') businessId: string, @Param('candidateId') candidateId: string, @Body() dto: MerchantRejectDto) {
    await this.lifecycle.rejectCandidateAsMerchant(candidateId, businessId, dto.reason);
    return { rejected: true };
  }

  @Post('offers/:id/confirm')
  confirmOffer(@Param('id') offerId: string) {
    return this.lifecycle.confirmOfferAsMerchant(offerId);
  }
}

@Controller('removal-requests')
export class RemovalRequestsController {
  constructor(private readonly optOuts: OptOutsService) {}

  // Spec §2.5. The response never reveals whether the listing exists or came from an import.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post()
  @HttpCode(202)
  async create(@Body() dto: RemovalRequestDto) {
    if (dto.website) return { received: true };
    return this.optOuts.requestRemoval({
      offerId: dto.offerId,
      businessSlug: dto.businessSlug,
      name: dto.name,
      email: dto.email,
      reason: dto.reason,
    });
  }
}

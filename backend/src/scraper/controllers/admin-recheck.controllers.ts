import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/decorators';
import { Role } from '../../common/enums';
import { OfferLifecycleService } from '../lifecycle/offer-lifecycle.service';
import { ImportedOffersService } from '../review/imported-offers.service';
import { ApplyRevisionDto, ExpiryDecisionDto, ImportedOffersQuery, ListRevisionsQuery, ReasonDto } from './scraper.dto';

/**
 * Spec §9/§13: what an admin does with imported offers after a recheck — decide expiry reviews, and apply or
 * discard the changes rechecks found. Publishing still happens only here, in an admin's request.
 */
@Controller('admin/scraper/imported-offers')
@Roles(Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN)
export class AdminImportedOffersController {
  constructor(
    private readonly importedOffers: ImportedOffersService,
    private readonly lifecycle: OfferLifecycleService,
  ) {}

  @Get()
  list(@Query() query: ImportedOffersQuery) {
    return this.importedOffers.list(query);
  }

  @Get('counts')
  counts() {
    return this.importedOffers.counts();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.importedOffers.detail(id);
  }

  @Post(':id/expiry-decision')
  decideExpiry(@Param('id') id: string, @Body() dto: ExpiryDecisionDto) {
    return this.lifecycle.decideExpiryReview(id, dto.decision, dto.note);
  }
}

@Controller('admin/scraper/revisions')
@Roles(Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN)
export class AdminRevisionsController {
  constructor(
    private readonly importedOffers: ImportedOffersService,
    private readonly lifecycle: OfferLifecycleService,
  ) {}

  @Get()
  list(@Query() query: ListRevisionsQuery) {
    return this.importedOffers.listRevisions(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.importedOffers.revision(id);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() dto: ApplyRevisionDto, @CurrentUser('userId') userId: string) {
    return this.lifecycle.applyRevision(id, dto, { userId });
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser('userId') userId: string) {
    return this.lifecycle.discardRevision(id, dto.reason, { userId });
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { Role } from '../../common/enums';
import { OutreachService } from '../outreach/outreach.service';
import { OutreachContactDto, OutreachQuery } from './scraper.dto';

/**
 * Spec §14: the businesses whose imported offers are live but unclaimed, and the invitation an admin hands
 * them. Every message is generated for the admin to send themselves.
 */
@Controller('admin/scraper/outreach')
@Roles(Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN)
export class AdminOutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get()
  list(@Query() query: OutreachQuery) {
    return this.outreach.candidates(query);
  }

  @Get(':businessId/invitations')
  invitations(@Param('businessId') businessId: string) {
    return this.outreach.listInvitations(businessId);
  }

  @Post(':businessId/invitation')
  create(@Param('businessId') businessId: string, @CurrentUser('userId') userId: string) {
    return this.outreach.createInvitation(businessId, userId);
  }

  @Post(':businessId/contacted')
  contacted(@Param('businessId') businessId: string, @Body() dto: OutreachContactDto, @CurrentUser('userId') userId: string) {
    return this.outreach.recordContact(businessId, dto, userId);
  }

  @Post('invitations/:id/revoke')
  revoke(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.outreach.revokeInvitation(id, userId);
  }
}

// The claim page follows the link in an invitation and shows which business it is for.
@Controller('claim-invitations')
export class ClaimInvitationsController {
  constructor(private readonly outreach: OutreachService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  resolve(@Param('token') token: string) {
    return this.outreach.resolve(token);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BusinessesService } from './businesses.service';
import {
  CreateMenuItemDto,
  InviteMemberDto,
  UpdateBusinessDto,
  UpdateMemberDto,
  UpdateMenuItemDto,
} from './businesses.dto';
import { AuthUser, CurrentUser, Public } from '../common/decorators';

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

  @Public()
  @Get('stats')
  stats() {
    return this.service.publicStats();
  }

  @Get('mine')
  myBusinesses(@CurrentUser('userId') userId: string) {
    return this.service.mine(userId);
  }

  // Multi-location stats across every business the user is on the team of
  @Get('mine/stats')
  myBusinessesStats(@CurrentUser('userId') userId: string) {
    return this.service.myBusinessesStats(userId);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.service.findBySlug(slug);
  }

  @Get(':id/manage')
  manage(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.manage(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBusinessDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Get(':id/change-requests')
  changeRequests(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.changeRequests(id, user);
  }

  // ---- Team ----

  @Get(':id/team')
  team(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.team(id, user);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/team/invites')
  invite(@Param('id') id: string, @Body() dto: InviteMemberDto, @CurrentUser() user: AuthUser) {
    return this.service.invite(id, dto, user);
  }

  @Delete(':id/team/invites/:inviteId')
  revokeInvite(@Param('id') id: string, @Param('inviteId') inviteId: string, @CurrentUser() user: AuthUser) {
    return this.service.revokeInvite(id, inviteId, user);
  }

  @Patch(':id/team/:userId')
  updateMember(@Param('id') id: string, @Param('userId') memberId: string, @Body() dto: UpdateMemberDto, @CurrentUser() user: AuthUser) {
    return this.service.updateMember(id, memberId, dto.role, user);
  }

  @Delete(':id/team/:userId')
  removeMember(@Param('id') id: string, @Param('userId') memberId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeMember(id, memberId, user);
  }

  // ---- Menu ----

  @Get(':id/menu')
  menu(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.menu(id, user);
  }

  @Post(':id/menu')
  addMenuItem(@Param('id') id: string, @Body() dto: CreateMenuItemDto, @CurrentUser() user: AuthUser) {
    return this.service.addMenuItem(id, dto, user);
  }

  @Patch(':id/menu/:itemId')
  updateMenuItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateMenuItemDto, @CurrentUser() user: AuthUser) {
    return this.service.updateMenuItem(id, itemId, dto, user);
  }

  @Delete(':id/menu/:itemId')
  removeMenuItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeMenuItem(id, itemId, user);
  }
}

// The link in a team invitation email.
@Controller('team-invites')
export class TeamInvitesController {
  constructor(private readonly service: BusinessesService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  resolve(@Param('token') token: string) {
    return this.service.resolveInvite(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.service.acceptInvite(token, user);
  }
}

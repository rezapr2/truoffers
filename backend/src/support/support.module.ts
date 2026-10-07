import { Body, Controller, Get, Module, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsMongoId, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { Capability, RequireCapability } from '../common/permissions';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { SUPPORT_STATUSES, SUPPORT_TOPICS, SupportStatus, SupportTicket, SupportTicketSchema, SupportTopic } from '../schemas/support.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { SupportService } from './support.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class NewTicketDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @Transform(trim) @IsEmail() email?: string;
  @IsIn(SUPPORT_TOPICS) topic: SupportTopic;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(150) subject: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(5000) message: string;
  @IsOptional() @IsMongoId() businessId?: string;
  @IsOptional() @IsString() @MaxLength(4000) recaptchaToken?: string;
}

class CustomerReplyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) body: string;
  @IsOptional() @IsString() @MaxLength(100) t?: string;
}

class StaffReplyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @IsOptional() @IsBoolean() internal?: boolean;
}

class UpdateTicketDto {
  @IsOptional() @IsIn(SUPPORT_STATUSES) status?: SupportStatus;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() assignedTo?: string | null;
  @IsOptional() @IsIn(['normal', 'high']) priority?: string;
  @IsOptional() @IsIn(SUPPORT_TOPICS) topic?: SupportTopic;
}

class ListQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() assigned?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // The contact form (guests pass reCAPTCHA) and "Get help" in the dashboards
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('tickets')
  create(@Body() dto: NewTicketDto, @CurrentUser() user: AuthUser | undefined, @Req() req: Request) {
    return this.support.create(dto, user, req.ip);
  }

  @Get('tickets/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.support.mine(user);
  }

  @Public()
  @Get('tickets/:id')
  get(@Param('id') id: string, @Query('t') token: string | undefined, @CurrentUser() user: AuthUser | undefined) {
    return this.support.getForCustomer(id, token, user);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body() dto: CustomerReplyDto, @CurrentUser() user: AuthUser | undefined) {
    return this.support.customerReply(id, dto.body, dto.t, user);
  }
}

@Controller('admin/support')
@RequireCapability(Capability.SUPPORT_MANAGE)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  async list(@Query() query: ListQuery, @CurrentUser('userId') userId: string, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.support.list({ ...query, page: '1' }, userId, 5000);
      return csvResponse(
        res,
        'support-tickets.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'number', label: 'Ticket' },
          { key: 'subject', label: 'Subject' },
          { key: 'topic', label: 'Topic' },
          { key: 'status', label: 'Status' },
          { key: 'priority', label: 'Priority' },
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'business', label: 'Business', value: (t) => (t.businessId as { name?: string } | undefined)?.name },
          { key: 'assigned', label: 'Assigned to', value: (t) => (t.assignedTo as { name?: string } | undefined)?.name },
          { key: 'createdAt', label: 'Opened' },
          { key: 'lastCustomerMessageAt', label: 'Last customer message' },
          { key: 'lastStaffReplyAt', label: 'Last reply' },
        ]),
      );
    }
    return this.support.list(query, userId);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.support.detail(id);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: StaffReplyDto, @CurrentUser() user: AuthUser) {
    return this.support.staffReply(id, dto.body, !!dto.internal, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.support.update(id, dto);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportTicket.name, schema: SupportTicketSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}

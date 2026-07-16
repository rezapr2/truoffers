import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import slugify from 'slugify';
import { Supplier, SupplierDocument, SupplierSchema } from '../schemas/supplier.schema';
import { Lead, LeadDocument, LeadSchema } from '../schemas/lead.schema';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { LeadStatus, Role } from '../common/enums';

export class CreateSupplierDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() category: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() serviceArea?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
}

export class CreateLeadDto {
  @IsString() @MinLength(2) contactName: string;
  @IsEmail() contactEmail: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsString() @MinLength(5) @MaxLength(2000) message: string;
  @IsOptional() @IsString() type?: string;
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name) private supplierModel: Model<SupplierDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
  ) {}

  list(category?: string) {
    const filter: any = {};
    if (category) filter.category = category;
    return this.supplierModel.find(filter).sort({ featured: -1, leadCount: -1 });
  }

  async bySlug(slug: string) {
    const supplier = await this.supplierModel.findOne({ slug });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(dto: CreateSupplierDto, ownerId: string) {
    const base = slugify(dto.name, { lower: true, strict: true });
    let slug = base;
    let i = 1;
    while (await this.supplierModel.exists({ slug })) slug = `${base}-${++i}`;
    return this.supplierModel.create({
      ...dto,
      slug,
      ownerId: new Types.ObjectId(ownerId),
    });
  }

  async submitLead(supplierId: string, dto: CreateLeadDto, userId?: string) {
    const supplier = await this.supplierModel.findById(supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    const lead = await this.leadModel.create({
      ...dto,
      supplierId: supplier._id,
      fromUserId: userId ? new Types.ObjectId(userId) : undefined,
    });
    supplier.leadCount += 1;
    await supplier.save();
    return { id: lead.id, status: lead.status };
  }

  async myLeads(userId: string, role: Role) {
    const filter: any = {};
    if (role === Role.SUPPLIER) {
      const suppliers = await this.supplierModel.find({ ownerId: new Types.ObjectId(userId) });
      filter.supplierId = { $in: suppliers.map((s) => s._id) };
    }
    return this.leadModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('supplierId', 'name slug category');
  }

  async updateLeadStatus(leadId: string, status: LeadStatus, userId: string, role: Role) {
    const lead = await this.leadModel.findById(leadId).populate<{ supplierId: SupplierDocument }>('supplierId');
    if (!lead) throw new NotFoundException('Lead not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SALES_ADMIN, Role.SUPPORT_ADMIN].includes(role);
    if (!isAdmin && String(lead.supplierId.ownerId) !== userId) {
      throw new ForbiddenException('Not your lead');
    }
    lead.status = status;
    await lead.save();
    return lead;
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Public()
  @Get()
  list(@Query('category') category?: string) {
    return this.service.list(category);
  }

  @Get('leads/mine')
  myLeads(@CurrentUser() user: { userId: string; role: Role }) {
    return this.service.myLeads(user.userId, user.role);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.service.bySlug(slug);
  }

  @Roles(Role.SUPPLIER, Role.SALES_ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateSupplierDto, @CurrentUser('userId') userId: string) {
    return this.service.create(dto, userId);
  }

  @Public()
  @Post(':id/leads')
  submitLead(
    @Param('id') id: string,
    @Body() dto: CreateLeadDto,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.service.submitLead(id, dto, userId);
  }

  @Patch('leads/:leadId/status')
  updateLeadStatus(
    @Param('leadId') leadId: string,
    @Body('status') status: LeadStatus,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.updateLeadStatus(leadId, status, user.userId, user.role);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Supplier.name, schema: SupplierSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}

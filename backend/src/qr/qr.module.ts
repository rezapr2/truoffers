import {
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as QRCode from 'qrcode';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { Public } from '../common/decorators';

// QR codes for print material (menus, window stickers, flyers): each code
// links to the public profile/offer page with ?src=qr for attribution.
// Public endpoints — they only encode already-public URLs.
@Injectable()
export class QrService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
  ) {}

  private get siteUrl() {
    return process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:3000';
  }

  private async render(url: string, size: number) {
    const width = Math.min(1024, Math.max(128, size || 512));
    return QRCode.toBuffer(url, {
      type: 'png',
      width,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
  }

  async businessQr(slug: string, size: number) {
    const business = await this.businessModel.findOne({ slug });
    if (!business) throw new NotFoundException('Business not found');
    return this.render(`${this.siteUrl}/takeaway/${business.slug}?src=qr`, size);
  }

  async offerQr(id: string, size: number) {
    const offer = await this.offerModel.findById(id);
    if (!offer) throw new NotFoundException('Offer not found');
    return this.render(`${this.siteUrl}/offer/${offer.id}?src=qr`, size);
  }
}

@Controller('qr')
export class QrController {
  constructor(private readonly service: QrService) {}

  @Public()
  @Get('business/:slug.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  async business(@Param('slug') slug: string, @Query('size') size?: string) {
    const png = await this.service.businessQr(slug, parseInt(size || '512', 10));
    return new StreamableFile(png);
  }

  @Public()
  @Get('offer/:id.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  async offer(@Param('id') id: string, @Query('size') size?: string) {
    const png = await this.service.offerQr(id, parseInt(size || '512', 10));
    return new StreamableFile(png);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}

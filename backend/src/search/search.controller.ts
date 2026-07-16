import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { Public } from '../common/decorators';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Public()
  @Get('offers')
  searchOffers(
    @Query('postcode') postcode?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('category') category?: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('discountType') discountType?: string,
    @Query('delivery') delivery?: string,
    @Query('collection') collection?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.searchOffers({
      postcode,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      category,
      radiusKm: radiusKm ? parseFloat(radiusKm) : undefined,
      discountType,
      delivery: delivery === 'true',
      collection: collection === 'true',
      verifiedOnly: verifiedOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusinessesModule } from '../businesses/businesses.module';
import { OffersModule } from '../offers/offers.module';
import { systemResolver } from '../scraper/safety/pinned-lookup';
import { networkPolicyFromEnv } from '../scraper/safety/fixture-hosts';
import { SafeFetchService } from '../scraper/safety/safe-fetch.service';
import { HOST_RESOLVER, NETWORK_POLICY } from '../scraper/scraper.tokens';
import { Claim, ClaimFile, ClaimFileSchema, ClaimSchema } from '../schemas/claim.schema';
import { MerchantClaimInvitation, MerchantClaimInvitationSchema } from '../schemas/merchant-claim-invitation.schema';
import { AdminClaimsController, ClaimsController } from './claims.controller';
import { ClaimsAdminService } from './claims-admin.service';
import { ClaimsJobs } from './claims.jobs';
import { ClaimsService } from './claims.service';
import { FhrsService } from './fhrs.service';

@Module({
  imports: [
    BusinessesModule,
    OffersModule,
    MongooseModule.forFeature([
      { name: Claim.name, schema: ClaimSchema },
      { name: ClaimFile.name, schema: ClaimFileSchema },
      { name: MerchantClaimInvitation.name, schema: MerchantClaimInvitationSchema },
    ]),
  ],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [
    ClaimsService,
    ClaimsAdminService,
    ClaimsJobs,
    FhrsService,
    // The website check reads one page of the business's site with the import robot's SSRF-safe fetcher.
    SafeFetchService,
    { provide: NETWORK_POLICY, useFactory: () => networkPolicyFromEnv() },
    { provide: HOST_RESOLVER, useValue: systemResolver },
  ],
  exports: [ClaimsService, ClaimsAdminService],
})
export class ClaimsModule {}

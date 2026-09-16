import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/decorators';
import { Role } from '../../common/enums';
import { AdaptersService } from '../review/adapters.service';
import { FingerprintsService } from '../review/fingerprints.service';
import { NetworksService } from '../review/networks.service';
import {
  AdapterRecheckDto,
  BulkWebsitesDto,
  CreateAdapterDto,
  CreateFingerprintDto,
  MatchFingerprintsDto,
  NetworkDto,
  NetworkWebsitesQuery,
  PauseDto,
  ReasonDto,
  RerunAdapterDto,
  UpdateAdapterVersionDto,
  UpdateFingerprintDto,
} from './scraper.dto';

const ADMIN = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN] as const;

@Roles(...ADMIN)
@Controller('admin/scraper/fingerprints')
export class AdminFingerprintsController {
  constructor(private readonly fingerprints: FingerprintsService) {}

  @Get()
  list() {
    return this.fingerprints.list();
  }

  // Registered before :id so "match" isn't read as an id.
  @Post('match')
  match(@Body() dto: MatchFingerprintsDto, @CurrentUser('userId') userId: string) {
    return this.fingerprints.requestMatch(dto, userId);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.fingerprints.detail(id);
  }

  @Post()
  create(@Body() dto: CreateFingerprintDto, @CurrentUser('userId') userId: string) {
    return this.fingerprints.create(dto, userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFingerprintDto, @CurrentUser('userId') userId: string) {
    return this.fingerprints.update(id, dto, userId);
  }

  @Post(':id/analyse')
  analyse(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.fingerprints.reanalyse(id, userId);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper/adapters')
export class AdminAdaptersController {
  constructor(private readonly adapters: AdaptersService) {}

  @Get()
  list() {
    return this.adapters.list();
  }

  @Post()
  create(@Body() dto: CreateAdapterDto, @CurrentUser('userId') userId: string) {
    return this.adapters.createDraft(dto, userId);
  }

  @Get(':key')
  detail(@Param('key') key: string) {
    return this.adapters.detail(key);
  }

  // Pause or resume the version websites are using.
  @Patch(':key')
  pause(@Param('key') key: string, @Body() dto: PauseDto) {
    return this.adapters.setPaused(key, dto.paused, dto.reason);
  }

  @Patch(':key/recheck')
  setRecheckInterval(@Param('key') key: string, @Body() dto: AdapterRecheckDto) {
    return this.adapters.setRecheckInterval(key, dto.recheckIntervalHours);
  }

  @Patch(':key/versions/:version')
  updateVersion(@Param('key') key: string, @Param('version') version: string, @Body() dto: UpdateAdapterVersionDto, @CurrentUser('userId') userId: string) {
    return this.adapters.updateVersion(key, version, dto, userId);
  }

  @Post(':key/versions/:version/new-version')
  newVersion(@Param('key') key: string, @Param('version') version: string, @CurrentUser('userId') userId: string) {
    return this.adapters.newVersion(key, version, userId);
  }

  @Post(':key/versions/:version/test')
  test(@Param('key') key: string, @Param('version') version: string, @CurrentUser('userId') userId: string) {
    return this.adapters.requestTest(key, version, userId);
  }

  @Post(':key/versions/:version/approve')
  approve(@Param('key') key: string, @Param('version') version: string, @CurrentUser('userId') userId: string) {
    return this.adapters.approve(key, version, userId);
  }

  @Post(':key/rollback')
  rollback(@Param('key') key: string, @Body() dto: ReasonDto, @CurrentUser('userId') userId: string) {
    return this.adapters.rollback(key, userId, dto.reason);
  }

  @Post(':key/rerun')
  rerun(@Param('key') key: string, @Body() dto: RerunAdapterDto, @CurrentUser('userId') userId: string) {
    return this.adapters.rerun(key, userId, dto.version);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper')
export class AdminNetworkController {
  constructor(private readonly networks: NetworksService) {}

  @Get('network')
  websites(@Query() query: NetworkWebsitesQuery) {
    return this.networks.websites(query);
  }

  @Post('network/bulk')
  bulk(@Body() dto: BulkWebsitesDto, @CurrentUser('userId') userId: string) {
    return this.networks.bulk(dto, userId);
  }

  @Get('networks')
  list() {
    return this.networks.listNetworks();
  }

  @Post('networks')
  create(@Body() dto: NetworkDto, @CurrentUser('userId') userId: string) {
    return this.networks.createNetwork(dto, userId);
  }

  @Patch('networks/:id')
  update(@Param('id') id: string, @Body() dto: NetworkDto) {
    return this.networks.updateNetwork(id, dto);
  }

  @Post('networks/:id/discover')
  discover(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.networks.discover(id, userId);
  }
}

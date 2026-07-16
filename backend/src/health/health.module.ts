import { Controller, Get, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../common/decorators';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  check() {
    const dbState = this.connection.readyState; // 1 = connected
    return {
      status: dbState === 1 ? 'ok' : 'degraded',
      db: dbState === 1 ? 'connected' : `state:${dbState}`,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScraperWorkerModule } from './scraper/scraper-worker.module';

// Composition root for the worker process: database, Redis and the crawler only.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get('MONGODB_URI') || 'mongodb://localhost:27017/truoffers',
      }),
    }),
    ScraperWorkerModule,
  ],
})
export class WorkerModule {}

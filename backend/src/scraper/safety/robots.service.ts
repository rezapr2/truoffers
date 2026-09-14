import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import robotsParser from 'robots-parser';
import { RobotsStatus } from '../../common/scraper.enums';
import { RobotsCache, RobotsCacheDocument } from '../../schemas/robots-cache.schema';
import { BOT_TOKEN, ROBOTS_LIMITS } from '../scraper.constants';
import { FetchAbortedError } from './errors';
import { SafeFetchOptions, SafeFetchService } from './safe-fetch.service';
import { siteDomainOf } from './url';

export interface RobotsRules {
  origin: string;
  status: RobotsStatus;
  rules: string;
  fetchedAt: Date;
}

type RobotsParser = ReturnType<typeof robotsParser>;

/**
 * robots.txt per RFC 9309: 2xx is parsed; 4xx means no restrictions; 5xx, 429 and network
 * failures mean "disallow everything" and are retried sooner than the 24h cache.
 */
@Injectable()
export class RobotsService {
  private readonly parsers = new Map<string, { fetchedAt: number; parser: RobotsParser }>();

  constructor(
    @InjectModel(RobotsCache.name) private readonly cache: Model<RobotsCacheDocument>,
    private readonly fetcher: SafeFetchService,
  ) {}

  // Cached rules only; never makes a request.
  async cachedRulesFor(url: URL): Promise<RobotsRules | null> {
    const origin = url.origin;
    const cached = await this.cache.findOne({ origin, expiresAt: { $gt: new Date() } }).lean();
    return cached ? { origin, status: cached.status, rules: cached.rules, fetchedAt: cached.fetchedAt } : null;
  }

  async rulesFor(url: URL, options: Pick<SafeFetchOptions, 'signal' | 'beforeRequest'> = {}): Promise<RobotsRules> {
    const origin = url.origin;
    const cached = await this.cachedRulesFor(url);
    if (cached) return cached;

    let status = RobotsStatus.UNREACHABLE;
    let rules = '';
    let httpStatus: number | undefined;
    try {
      const response = await this.fetcher.fetch(`${origin}/robots.txt`, { purpose: 'robots', ...options });
      httpStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        status = RobotsStatus.OK;
        rules = response.body;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        status = RobotsStatus.UNAVAILABLE;
      }
    } catch (err) {
      if (err instanceof FetchAbortedError) throw err;
      // Unreachable (or redirected somewhere we won't follow): assume complete disallow.
    }

    const fetchedAt = new Date();
    const ttl = status === RobotsStatus.UNREACHABLE ? ROBOTS_LIMITS.unreachableCacheMs : ROBOTS_LIMITS.cacheMs;
    await this.cache.updateOne(
      { origin },
      {
        $set: {
          domain: siteDomainOf(url.hostname),
          status,
          rules,
          httpStatus,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + ttl),
        },
      },
      { upsert: true },
    );
    return { origin, status, rules, fetchedAt };
  }

  isAllowed(robots: RobotsRules, url: string): boolean {
    if (robots.status === RobotsStatus.UNAVAILABLE) return true;
    if (robots.status === RobotsStatus.UNREACHABLE) return false;
    return this.parser(robots).isAllowed(url, BOT_TOKEN) !== false;
  }

  crawlDelayMs(robots: RobotsRules): number | undefined {
    if (robots.status !== RobotsStatus.OK) return undefined;
    const seconds = this.parser(robots).getCrawlDelay(BOT_TOKEN);
    return seconds && seconds > 0 ? Math.min(seconds, 60) * 1000 : undefined;
  }

  sitemaps(robots: RobotsRules): string[] {
    return robots.status === RobotsStatus.OK ? this.parser(robots).getSitemaps() : [];
  }

  private parser(robots: RobotsRules): RobotsParser {
    const key = robots.origin;
    const existing = this.parsers.get(key);
    if (existing && existing.fetchedAt === robots.fetchedAt.getTime()) return existing.parser;
    const parser = robotsParser(`${robots.origin}/robots.txt`, robots.rules);
    this.parsers.set(key, { fetchedAt: robots.fetchedAt.getTime(), parser });
    if (this.parsers.size > 500) this.parsers.delete(this.parsers.keys().next().value as string);
    return parser;
  }
}

import type { LoggerService } from '@nestjs/common';

type Level = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

// One JSON object per line (spec §11 structured logs), for the worker process.
export class JsonLogger implements LoggerService {
  private write(level: Level, message: unknown, rest: unknown[]) {
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      context,
    };
    if (message instanceof Error) {
      entry.msg = message.message;
      entry.stack = message.stack;
    } else if (message && typeof message === 'object') {
      Object.assign(entry, message);
    } else {
      entry.msg = String(message);
    }
    if (rest.length) entry.details = rest;
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'fatal') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, ...rest: unknown[]) {
    this.write('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.write('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.write('fatal', message, rest);
  }
}

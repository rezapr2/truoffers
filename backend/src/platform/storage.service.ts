import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, s3ConfigFromEnv } from './s3';

export type Bucket = 'public' | 'private';
export type FileKind = 'jpg' | 'png' | 'webp' | 'pdf';

export const MIME: Record<FileKind, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export const IMAGE_KINDS: FileKind[] = ['jpg', 'png', 'webp'];
export const DOCUMENT_KINDS: FileKind[] = ['pdf', 'jpg', 'png'];

const KEY_PATTERN = /^(public|private)\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(jpg|png|webp|pdf)$/;

/** What a file really is, from its first bytes; the browser's declared type is ignored. */
export function sniffKind(buffer: Buffer): FileKind | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Files on local disk under UPLOAD_DIR (a Docker volume in production), or in an S3-compatible bucket with
 * STORAGE_DRIVER=s3 (see s3.ts). Either way public files (photos, logos, menus) are served at
 * /api/files/public/... and private files (verification documents, report photos) are only ever streamed by
 * the controllers that check who is asking, so the bucket itself stays private.
 */
@Injectable()
export class StorageService {
  readonly root = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  private readonly s3 = (() => {
    const config = s3ConfigFromEnv();
    return config ? new S3Client(config) : null;
  })();

  get driver(): 'disk' | 's3' {
    return this.s3 ? 's3' : 'disk';
  }

  async save(bucket: Bucket, buffer: Buffer, allowed: FileKind[], maxBytes: number): Promise<{ key: string; kind: FileKind; size: number; url?: string }> {
    if (!buffer?.length) throw new BadRequestException('The file is empty');
    if (buffer.length > maxBytes) throw new BadRequestException(`Files must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller`);
    const kind = sniffKind(buffer);
    if (!kind || !allowed.includes(kind)) {
      throw new BadRequestException(`Upload a ${allowed.map((k) => k.toUpperCase()).join(', ')} file`);
    }
    const now = new Date();
    const key = `${bucket}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}.${kind}`;
    await this.write(key, buffer, kind);
    return { key, kind, size: buffer.length, url: bucket === 'public' ? publicUrl(key) : undefined };
  }

  /** Stores bytes under a key produced by save() (also used to copy files from disk to a bucket). */
  async write(key: string, buffer: Buffer, kind: FileKind): Promise<void> {
    if (!KEY_PATTERN.test(key)) throw new BadRequestException('Invalid file key');
    if (this.s3) return this.s3.put(key, buffer, MIME[kind]);
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buffer, { mode: 0o640 });
  }

  async read(key: string): Promise<{ buffer: Buffer; mime: string }> {
    if (!KEY_PATTERN.test(key)) throw new NotFoundException('File not found');
    if (this.s3) {
      const buffer = await this.s3.get(key);
      if (!buffer) throw new NotFoundException('File not found');
      return { buffer, mime: MIME[key.split('.').pop() as FileKind] };
    }
    const file = this.pathFor(key);
    try {
      await stat(file);
    } catch {
      throw new NotFoundException('File not found');
    }
    const kind = key.split('.').pop() as FileKind;
    return { buffer: await readFile(file), mime: MIME[kind] };
  }

  async remove(key: string | undefined | null): Promise<void> {
    if (!key || !KEY_PATTERN.test(key)) return;
    if (this.s3) return this.s3.delete(key);
    await rm(this.pathFor(key), { force: true });
  }

  /** The key behind a public URL produced by save(), or null for anything else (e.g. an external image). */
  keyFromUrl(url: string | undefined | null): string | null {
    const match = url ? /\/api\/files\/(public\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(?:jpg|png|webp|pdf))$/.exec(url) : null;
    return match ? match[1] : null;
  }

  isValidKey(key: string): boolean {
    return KEY_PATTERN.test(key);
  }

  private pathFor(key: string): string {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new NotFoundException('File not found');
    return file;
  }
}

// Same-origin in production (Caddy proxies /api); the frontend prefixes its API origin in development.
export function publicUrl(key: string): string {
  return `/api/files/${key}`;
}

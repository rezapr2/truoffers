/**
 * Copies every uploaded file from the local uploads directory into the S3-compatible bucket, keeping its key,
 * for switching an existing site to STORAGE_DRIVER=s3. Safe to run more than once (objects are overwritten
 * with the same bytes). Run it with the S3_* variables set, before restarting the API with STORAGE_DRIVER=s3:
 *
 *   STORAGE_DRIVER=s3 npm run storage:copy-to-s3
 *   docker compose exec -e STORAGE_DRIVER=s3 api npm run storage:copy-to-s3:prod
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, s3ConfigFromEnv } from '../platform/s3';
import { MIME, type FileKind } from '../platform/storage.service';
import { loadDotEnv } from '../seed/mvp-defaults';

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

async function main() {
  loadDotEnv();
  const config = s3ConfigFromEnv();
  if (!config) throw new Error('Set STORAGE_DRIVER=s3 and the S3_* variables first');
  const root = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const client = new S3Client(config);
  let copied = 0;
  for await (const file of files(root)) {
    const key = path.relative(root, file).split(path.sep).join('/');
    if (!/^(public|private)\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(key)) continue;
    await client.put(key, await readFile(file), MIME[key.split('.').pop() as FileKind]);
    copied++;
  }
  console.log(`Copied ${copied} file(s) from ${root} to bucket ${config.bucket}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

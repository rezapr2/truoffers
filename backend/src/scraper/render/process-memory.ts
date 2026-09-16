import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

/**
 * Resident memory of a process and everything it spawned, in MB. Chromium runs a process per renderer, so a
 * single process reading would miss most of it (spec §3: a 512 MB ceiling for the browser).
 */
export async function processTreeRssMb(rootPid: number, list = psList): Promise<number> {
  const processes = await list();
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of processes) children.set(ppid, [...(children.get(ppid) ?? []), pid]);

  const rssByPid = new Map(processes.map((p) => [p.pid, p.rssKb]));
  let totalKb = 0;
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    totalKb += rssByPid.get(pid) ?? 0;
    queue.push(...(children.get(pid) ?? []));
  }
  return Math.round(totalKb / 1024);
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

// `ps` is in both the Playwright image and macOS, and needs no dependency.
export async function psList(): Promise<ProcessRow[]> {
  const { stdout } = await run('ps -A -o pid=,ppid=,rss=');
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length === 3 && parts.every((n) => Number.isFinite(n)))
    .map(([pid, ppid, rssKb]) => ({ pid, ppid, rssKb }));
}

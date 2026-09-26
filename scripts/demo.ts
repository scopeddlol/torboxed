// A self-contained demo of Torboxed with realistic sample data and a fake
// TorBox backend. Used for screenshots and for exploring the UI without an
// account:   npm run demo   →   http://127.0.0.1:8090
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, type ServerHandle } from '../src/server/index';
import type { HistoryRecord, Job, JobFile, Tag } from '../src/shared/types';
import { defaultSettings } from '../src/server/store';
import { startFakeTorBox, type FakeTorBox } from '../test/fake-torbox';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

// Deterministic pseudo-random numbers so screenshots are stable.
let seed = 42;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

export interface Demo {
  url: string;
  server: ServerHandle;
  torbox: FakeTorBox;
  close: () => Promise<void>;
}

/** `mediaRoot` lets screenshots show tidy paths such as /srv/media instead of a temp dir. */
export async function startDemo(port = 8090, mediaRoot?: string): Promise<Demo> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torboxed-demo-'));
  const base = mediaRoot ?? dir;
  const dl = path.join(base, 'downloads');
  const media = path.join(base, 'media');
  const archive = path.join(base, 'archive');
  for (const d of [dl, media, archive]) fs.mkdirSync(d, { recursive: true });

  const torbox = await startFakeTorBox();
  const now = Date.now();

  const tags: Tag[] = [
    { id: 'movies', name: 'Movies', color: '#ec4899', folderId: 'media', subfolder: 'Movies' },
    { id: 'tv', name: 'tv-sonarr', color: '#06b6d4', folderId: 'media', subfolder: 'TV' },
    { id: 'linux', name: 'Linux ISOs', color: '#10b981', folderId: 'default', subfolder: 'ISOs' },
    { id: 'music', name: 'Music', color: '#f59e0b', folderId: 'media', subfolder: 'Music' },
    { id: 'books', name: 'Books', color: '#8b5cf6', folderId: 'archive', subfolder: '' },
  ];
  const folders = [
    { id: 'default', name: 'Downloads', path: dl },
    { id: 'media', name: 'Media library', path: media },
    { id: 'archive', name: 'Archive', path: archive },
  ];
  const tagPath = (id: string | null) => {
    const t = tags.find((x) => x.id === id);
    if (!t) return dl;
    const f = folders.find((x) => x.id === t.folderId)!;
    return t.subfolder ? path.join(f.path, t.subfolder) : f.path;
  };

  let order = 0;
  const job = (name: string, size: number, p: Partial<Job>): Job => {
    const h = hash(name);
    const savePath = tagPath(p.tagId ?? null);
    const added = p.addedAt ?? now - 20 * 60_000;
    const timeline = {
      addedAt: added,
      submittedAt: added + 2_000,
      readyAt: added + 14_000,
      startedAt: added + 15_000,
    };
    const tag = tags.find((t) => t.id === p.tagId);
    return {
      id: h,
      hash: h,
      name,
      size,
      downloaded: 0,
      status: 'waiting',
      paused: false,
      error: null,
      warning: null,
      origin: 'ui',
      kind: 'magnet',
      magnet: `magnet:?xt=urn:btih:${h}&dn=${encodeURIComponent(name)}`,
      tagId: null,
      category: tag?.name ?? '',
      savePath,
      contentPath: path.join(savePath, name),
      torboxId: 1000 + order,
      torboxState: 'cached',
      torboxProgress: 1,
      torboxSpeed: 0,
      torboxSeeds: 0,
      torboxEta: 0,
      cached: true,
      files: [],
      order: order++,
      attempts: 0,
      nextRetryAt: null,
      removeAt: null,
      removedFromTorbox: false,
      ...timeline,
      completedAt: null,
      speed: 0,
      eta: 0,
      ...p,
    };
  };
  const files = (names: [string, number, number][]): JobFile[] =>
    names.map(([n, size, frac], i) => ({
      id: i,
      path: n,
      size,
      downloaded: Math.round(size * frac),
      state: frac >= 1 ? 'done' : frac > 0 ? 'downloading' : 'pending',
    }));

  const jobs: Job[] = [
    job('Ubuntu 24.04.3 Desktop (amd64)', 6.1 * GB, {
      status: 'downloading',
      tagId: 'linux',
      downloaded: 3.8 * GB,
      files: files([
        ['Ubuntu 24.04.3 Desktop (amd64)/ubuntu-24.04.3-desktop-amd64.iso', 6.1 * GB - 2048, 0.62],
        ['Ubuntu 24.04.3 Desktop (amd64)/SHA256SUMS', 2048, 1],
      ]),
      addedAt: now - 7 * 60_000,
    }),
    job('Big Buck Bunny (2008) 4K 60fps', 10.4 * GB, {
      status: 'downloading',
      tagId: 'movies',
      downloaded: 2.9 * GB,
      origin: 'qbit',
      addedAt: now - 12 * 60_000,
    }),
    job('Sintel (2010) 4K HDR', 14.2 * GB, {
      status: 'torbox',
      tagId: 'movies',
      origin: 'qbit',
      torboxState: 'downloading',
      torboxProgress: 0.71,
      torboxSpeed: 86 * MB,
      torboxSeeds: 212,
      cached: false,
      readyAt: null,
      startedAt: null,
      addedAt: now - 3 * 60_000,
    }),
    job('Fedora Workstation 42 Live', 2.3 * GB, {
      status: 'torbox',
      tagId: 'linux',
      torboxState: 'downloading',
      torboxProgress: 0.18,
      torboxSpeed: 41 * MB,
      torboxSeeds: 96,
      cached: false,
      readyAt: null,
      startedAt: null,
      addedAt: now - 60_000,
    }),
    job('Tears of Steel (2012) 4K', 6.8 * GB, { status: 'waiting', tagId: 'movies', startedAt: null, addedAt: now - 4 * 60_000 }),
    job('Cosmos Laundromat (2015) 2K', 3.4 * GB, { status: 'waiting', paused: true, tagId: 'movies', downloaded: 1.36 * GB, addedAt: now - 55 * 60_000 }),
    job('Arch Linux 2026.09.01 x86_64', 1.3 * GB, {
      status: 'error',
      tagId: 'linux',
      error: 'Download server returned HTTP 503 — retried 5 times',
      downloaded: 0.4 * GB,
      addedAt: now - 2 * HOUR,
    }),
    job('The Internet Archive — Great 78 Project Vol. 3', 820 * MB, {
      status: 'queued',
      tagId: 'music',
      torboxId: null,
      torboxProgress: 0,
      cached: null,
      readyAt: null,
      startedAt: null,
      submittedAt: null,
      addedAt: now - 20_000,
    }),
    job('Night of the Living Dead (1968) 1080p', 4.4 * GB, {
      status: 'completed',
      tagId: 'movies',
      origin: 'qbit',
      downloaded: 4.4 * GB,
      completedAt: now - 25 * 60_000,
      removedFromTorbox: true,
      addedAt: now - 40 * 60_000,
    }),
    job('Debian 13.1 DVD (amd64)', 3.9 * GB, {
      status: 'completed',
      tagId: 'linux',
      downloaded: 3.9 * GB,
      completedAt: now - 2.2 * HOUR,
      addedAt: now - 2.5 * HOUR,
    }),
    job('Project Gutenberg — Top 100 eBooks (EPUB)', 612 * MB, {
      status: 'completed',
      tagId: 'books',
      downloaded: 612 * MB,
      completedAt: now - 5 * HOUR,
      addedAt: now - 5.2 * HOUR,
    }),
  ];
  const speeds: Record<string, number> = { [jobs[0].id]: 52 * MB, [jobs[1].id]: 34 * MB };
  const cloudOnly = [
    ['Blender Studio — Charge (2022) 4K', 7.2 * GB],
    ['LibreOffice 25.8 Portable Collection', 1.1 * GB],
    ['NASA Apollo 11 — Restored Footage', 22.6 * GB],
    ['Linux Mint 22.2 Cinnamon', 2.9 * GB],
  ] as const;

  // History & statistics for the analytics page.
  const history: HistoryRecord[] = [];
  const hourly: Record<string, number> = {};
  let totalBytes = 0;
  const names = [
    'Ubuntu Server 24.04', 'Big Buck Bunny', 'Elephants Dream', 'Spring', 'Agent 327', 'Caminandes Llamigos', 'Debian Netinst',
    'Linux Mint 22', 'Pop!_OS 24.04', 'Wing It!', 'Hero', 'Kubuntu 24.04', 'Sprite Fright', 'The Daily Dweebs',
    'openSUSE Tumbleweed', 'Rocky Linux 10', 'Coffee Run', 'Musopen — Chopin Collection', 'Free Music Archive Sampler', 'Standard Ebooks Bundle',
  ];
  for (let i = 0; i < 180; i++) {
    const dayOffset = Math.floor(rand() ** 1.4 * 60);
    const hour = [9, 12, 13, 18, 19, 20, 21, 22, 23, 1][Math.floor(rand() * 10)];
    const completedAt = now - dayOffset * DAY - (new Date(now).getHours() - hour) * HOUR - rand() * HOUR;
    if (completedAt > now) continue;
    const tag = tags[Math.floor(rand() ** 1.3 * tags.length)];
    const size = Math.round((tag.id === 'music' || tag.id === 'books' ? 0.3 : 1) * GB * (0.2 + rand() ** 2 * 18));
    const speed = (18 + rand() * 70) * MB;
    const downloadMs = (size / speed) * 1000;
    const cached = rand() > 0.28;
    const readyDelay = cached ? 5_000 + rand() * 20_000 : (4 + rand() * 40) * 60_000;
    history.push({
      id: hash(`h${i}`),
      name: `${names[i % names.length]}${i >= names.length ? ` · Vol. ${Math.floor(i / names.length) + 1}` : ''}`,
      size,
      fileCount: 1 + Math.floor(rand() * 8),
      tag: tag.name,
      tagColor: tag.color,
      origin: rand() > 0.55 ? 'qbit' : rand() > 0.15 ? 'ui' : 'cloud',
      cached,
      addedAt: completedAt - downloadMs - readyDelay,
      readyAt: completedAt - downloadMs,
      startedAt: completedAt - downloadMs,
      completedAt,
      downloadMs,
      avgSpeed: Math.round(speed),
    });
    const hourKey = Math.floor(completedAt / HOUR) * HOUR;
    hourly[hourKey] = (hourly[hourKey] ?? 0) + size;
    totalBytes += size;
  }
  history.sort((a, b) => b.completedAt - a.completedAt);
  const minutes: [number, number][] = [];
  for (let m = 24 * 60; m > 0; m--) {
    const ts = Math.floor((now - m * 60_000) / 60_000) * 60_000;
    const h = new Date(ts).getHours();
    const busy = h >= 18 || h <= 1 || (h >= 12 && h <= 13);
    const v = busy ? (46 + 22 * Math.sin(m / 37) + 10 * Math.sin(m / 11) + rand() * 8) * MB : rand() > 0.9 ? (10 + rand() * 25) * MB : 0;
    minutes.push([ts, Math.round(v)]);
  }

  const settings = {
    ...defaultSettings(port),
    torboxApiKey: 'test-key',
    maxConcurrentDownloads: 3,
    slowModeLimitKBps: 5120,
    autoRemoveFromTorbox: true,
    onboarded: true,
  };
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'torboxed.json'),
    JSON.stringify({
      version: 1,
      settings,
      folders,
      tags,
      jobs,
      history,
      stats: {
        totalBytes: totalBytes + 1.7 * 1024 ** 4,
        totalCompleted: history.length + 412,
        totalFailed: 9,
        peakSpeed: 118 * MB,
        peakSpeedAt: now - 3 * DAY,
        hourly,
        minutes,
        firstUseAt: now - 142 * DAY,
      },
    }),
  );

  // TorBox cloud contents (jobs + a few cloud-only torrents).
  for (const j of jobs) {
    if (j.torboxId === null || j.removedFromTorbox) continue;
    torbox.torrents.set(j.torboxId, {
      id: j.torboxId,
      hash: j.hash!,
      name: j.name,
      polls: 99,
      createdAt: new Date(j.addedAt).toISOString(),
      pending: j.status === 'torbox' ? { progress: j.torboxProgress, speed: j.torboxSpeed, seeds: j.torboxSeeds } : undefined,
      files: [{ id: 0, name: `${j.name}/${j.name}.mkv`, size: j.size, data: Buffer.alloc(0) }],
    });
  }
  cloudOnly.forEach(([name, size], i) =>
    torbox.torrents.set(2000 + i, {
      id: 2000 + i,
      hash: hash(name),
      name,
      polls: 99,
      createdAt: new Date(now - (i + 1) * 9 * HOUR).toISOString(),
      files: Array.from({ length: 1 + i * 3 }, (_, k) => ({ id: k, name: `${name}/part-${k}.bin`, size: size / (1 + i * 3), data: Buffer.alloc(0) })),
    }),
  );

  const server = await startServer({
    dataDir,
    defaultDownloadDir: dl,
    port,
    host: '127.0.0.1',
    torboxBaseUrl: torbox.url,
    webDir: path.resolve('dist/web'),
    version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
    engine: false,
  });

  // The engine is frozen; animate the live numbers instead so the demo stays put.
  const mgr = server.manager;
  for (const j of mgr.jobs) if (speeds[j.id]) j.status = 'downloading';
  mgr.torboxStatus = { configured: true, ok: true, error: null, checkedAt: now };
  mgr.speedHistory.length = 0;
  for (let i = 0; i < 180; i++) mgr.speedHistory.push(Math.round((72 + 14 * Math.sin(i / 9) + 8 * Math.sin(i / 3.3)) * MB));
  mgr.stats.sessionBytes = 38.6 * GB;
  let t = 0;
  const animate = () => {
    t++;
    let total = 0;
    for (const j of mgr.jobs) {
      const base = speeds[j.id];
      if (!base || j.status !== 'downloading') continue;
      j.speed = base * (0.9 + 0.2 * Math.sin(t / 4 + base));
      j.eta = Math.round((j.size - j.downloaded) / j.speed);
      total += j.speed;
    }
    mgr.speed = total;
    mgr.speedHistory.push(Math.round(total));
    if (mgr.speedHistory.length > 300) mgr.speedHistory.shift();
    mgr.emit('tick', mgr.snapshot());
  };
  animate();
  const timer = setInterval(animate, 1000);

  return {
    url: server.url,
    server,
    torbox,
    close: async () => {
      clearInterval(timer);
      await server.close();
      await torbox.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// `npm run demo`
if (process.argv[1] && /demo\.ts$/.test(process.argv[1])) {
  startDemo().then((d) => {
    console.log(`\n  Torboxed demo running at ${d.url}\n`);
    process.on('SIGINT', () => void d.close().then(() => process.exit(0)));
  });
}


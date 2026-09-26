import { EventEmitter, once } from 'node:events';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountInfo,
  CloudItem,
  Job,
  JobFile,
  JobKind,
  JobOrigin,
  JobSummary,
  NotifyEvent,
  Settings,
  Tag,
  Tick,
  TorBoxStatus,
} from '../shared/types';
import { errMsg, log } from './log';
import type { Store } from './store';
import type { Stats } from './stats';
import { Throttle } from './throttle';
import { TorBoxClient, TorBoxError, type TBTorrent } from './torbox';
import { fileSize, removeContent, safeRelative, sanitizeSegment } from './fsutil';
import { isMagnet, parseMagnet, parseTorrent } from './torrent';

export interface AddOptions {
  tagId?: string | null;
  category?: string;
  savePath?: string;
  paused?: boolean;
  origin: JobOrigin;
}

export interface AddOutcome {
  job: Job;
  duplicate: boolean;
}

export interface RemoveOptions {
  fromList: boolean;
  fromTorbox: boolean;
  deleteFiles: boolean;
}

export const TAG_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#ef4444', '#84cc16', '#f97316', '#14b8a6'];

const STALL_TIMEOUT_MS = 60_000;

const randomId = () => randomBytes(20).toString('hex');
const byOrder = (a: Job, b: Job) => a.order - b.order || a.addedAt - b.addedAt;
const clamp01 = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

export class Manager extends EventEmitter {
  speed = 0;
  speedHistory: number[] = [];
  torboxStatus: TorBoxStatus;

  private readonly throttle = new Throttle();
  private readonly runners = new Map<string, { ac: AbortController; promise: Promise<void> }>();
  private readonly jobBytes = new Map<string, number>();
  private readonly missing = new Map<string, number>();
  private tickBytes = 0;
  private lastTick = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private submitBusy = false;
  private nextSubmitAt = 0;
  private pollBusy = false;
  private nextPollAt = 0;
  private cloudCache: { at: number; items: TBTorrent[] } | null = null;
  private accountCache: { at: number; key: string; info: AccountInfo } | null = null;

  constructor(
    readonly store: Store,
    readonly torbox: TorBoxClient,
    readonly stats: Stats,
  ) {
    super();
    this.setMaxListeners(100);
    this.torboxStatus = { configured: !!store.settings.torboxApiKey, ok: null, error: null, checkedAt: null };
  }

  get settings(): Settings {
    return this.store.data.settings;
  }
  get jobs(): Job[] {
    return this.store.data.jobs;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
    if (this.settings.torboxApiKey) void this.account(true).catch(() => undefined);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.runners.values()) r.ac.abort();
    await Promise.allSettled([...this.runners.values()].map((r) => r.promise));
    this.store.flush();
  }

  // ───────────────────────────── tick loop ─────────────────────────────

  private tick() {
    const now = Date.now();
    const elapsed = Math.max(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const instant = this.tickBytes / elapsed;
    this.tickBytes = 0;
    this.speed = this.runners.size ? this.speed * 0.4 + instant * 0.6 : 0;
    for (const job of this.jobs) {
      if (this.runners.has(job.id)) {
        const inst = (this.jobBytes.get(job.id) ?? 0) / elapsed;
        job.speed = job.speed ? job.speed * 0.4 + inst * 0.6 : inst;
        job.eta = job.speed > 512 ? Math.round((job.size - job.downloaded) / job.speed) : 0;
      } else {
        job.speed = 0;
        job.eta = 0;
      }
    }
    this.jobBytes.clear();
    this.speedHistory.push(Math.round(this.speed));
    if (this.speedHistory.length > 300) this.speedHistory.shift();
    this.stats.recordSpeed(instant);
    this.throttle.setRate(this.currentLimit());
    this.autoRemove(now);
    this.schedule();
    void this.submitNext();
    void this.poll();
    if (this.runners.size) this.store.save();
    this.emit('tick', this.snapshot());
  }

  currentLimit(): number {
    const s = this.settings;
    const kb = s.slowMode ? s.slowModeLimitKBps : s.speedLimitKBps;
    return Math.max(0, Number(kb) || 0) * 1024;
  }

  summary(job: Job): JobSummary {
    const { files, ...rest } = job;
    return {
      ...rest,
      fileCount: files.filter((f) => f.state !== 'skipped').length,
      filesDone: files.filter((f) => f.state === 'done').length,
    };
  }

  snapshot(): Tick {
    return {
      t: Date.now(),
      speed: Math.round(this.speed),
      limit: this.currentLimit(),
      globalPaused: this.settings.globalPaused,
      slowMode: this.settings.slowMode,
      jobs: this.jobs.map((j) => this.summary(j)),
      torbox: this.torboxStatus,
      sessionBytes: this.stats.sessionBytes,
    };
  }

  private notify(ev: NotifyEvent) {
    this.emit('notify', ev);
  }

  private markTorbox(ok: boolean, error: string | null = null) {
    this.torboxStatus = { configured: !!this.settings.torboxApiKey, ok, error, checkedAt: Date.now() };
  }

  // ───────────────────────────── adding ─────────────────────────────

  defaultFolder() {
    const folders = this.store.data.folders;
    return folders.find((f) => f.id === this.settings.defaultFolderId) ?? folders[0];
  }

  resolveSavePath(o: { tagId?: string | null; savePath?: string }): string {
    if (o.savePath?.trim()) return path.resolve(o.savePath.trim());
    const tag = o.tagId ? this.store.data.tags.find((t) => t.id === o.tagId) : undefined;
    if (tag) {
      const folder = this.store.data.folders.find((f) => f.id === tag.folderId) ?? this.defaultFolder();
      const sub = safeRelative(tag.subfolder ?? '');
      return sub ? path.join(folder.path, sub) : folder.path;
    }
    return this.defaultFolder().path;
  }

  tagByCategory(category: string, create: boolean): Tag | null {
    const c = category.trim();
    if (!c) return null;
    const found = this.store.data.tags.find((t) => t.name.toLowerCase() === c.toLowerCase());
    if (found || !create) return found ?? null;
    const tag: Tag = {
      id: randomBytes(6).toString('hex'),
      name: c,
      color: TAG_COLORS[this.store.data.tags.length % TAG_COLORS.length],
      folderId: this.settings.defaultFolderId,
      subfolder: sanitizeSegment(c),
    };
    this.store.data.tags.push(tag);
    log.info(`Created tag "${c}" (from qBittorrent category)`);
    this.store.save();
    return tag;
  }

  private maxOrder() {
    return this.jobs.reduce((m, j) => Math.max(m, j.order), 0);
  }

  private createJob(id: string, hash: string | null, name: string, kind: JobKind, o: AddOptions): Job {
    const tag = o.tagId
      ? (this.store.data.tags.find((t) => t.id === o.tagId) ?? null)
      : o.category
        ? this.tagByCategory(o.category, true)
        : null;
    const savePath = this.resolveSavePath({ tagId: tag?.id, savePath: o.savePath });
    return {
      id,
      hash,
      name,
      size: 0,
      downloaded: 0,
      status: 'queued',
      paused: !!o.paused,
      error: null,
      warning: null,
      origin: o.origin,
      kind,
      magnet: null,
      tagId: tag?.id ?? null,
      category: tag?.name ?? o.category ?? '',
      savePath,
      contentPath: path.join(savePath, sanitizeSegment(name)),
      torboxId: null,
      torboxState: '',
      torboxProgress: 0,
      torboxSpeed: 0,
      torboxSeeds: 0,
      torboxEta: 0,
      cached: null,
      files: [],
      order: this.maxOrder() + 1,
      attempts: 0,
      nextRetryAt: null,
      removeAt: null,
      removedFromTorbox: false,
      addedAt: Date.now(),
      submittedAt: null,
      readyAt: null,
      startedAt: null,
      completedAt: null,
      speed: 0,
      eta: 0,
    };
  }

  private insert(job: Job): AddOutcome {
    this.jobs.push(job);
    log.info(`Added "${job.name}" (${job.kind}, via ${job.origin})`);
    this.store.save();
    this.nextSubmitAt = Math.min(this.nextSubmitAt, Date.now());
    return { job, duplicate: false };
  }

  addMagnet(magnet: string, o: AddOptions): AddOutcome {
    const m = parseMagnet(magnet);
    const id = m.hash ?? randomId();
    const existing = this.jobs.find((j) => j.id === id);
    if (existing) return { job: existing, duplicate: true };
    const job = this.createJob(id, m.hash, m.name ?? `Magnet ${id.slice(0, 8)}`, 'magnet', o);
    job.magnet = magnet.trim();
    job.size = m.size ?? 0;
    return this.insert(job);
  }

  addTorrentFile(buf: Buffer, o: AddOptions): AddOutcome {
    const t = parseTorrent(buf);
    const existing = this.jobs.find((j) => j.id === t.infoHash);
    if (existing) return { job: existing, duplicate: true };
    const job = this.createJob(t.infoHash, t.infoHash, t.name, 'torrent', o);
    job.size = t.size;
    job.magnet = `magnet:?xt=urn:btih:${t.infoHash}&dn=${encodeURIComponent(t.name)}`;
    fs.writeFileSync(this.store.torrentPath(job.id), buf);
    return this.insert(job);
  }

  async addUrl(url: string, o: AddOptions): Promise<AddOutcome> {
    if (isMagnet(url)) return this.addMagnet(url, o);
    let current = url.trim();
    if (!/^https?:\/\//i.test(current)) throw new Error('Not a magnet link or http(s) URL');
    for (let i = 0; i < 6; i++) {
      const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (isMagnet(loc)) return this.addMagnet(loc, o);
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`Could not fetch torrent (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = buf.subarray(0, 200).toString('utf8');
      if (isMagnet(text)) return this.addMagnet(buf.toString('utf8').trim(), o);
      return this.addTorrentFile(buf, o);
    }
    throw new Error('Too many redirects');
  }

  async addFromCloud(torboxId: number, o: AddOptions): Promise<AddOutcome> {
    const linked = this.jobs.find((j) => j.torboxId === torboxId);
    if (linked) return { job: linked, duplicate: true };
    const items = await this.cloudRaw();
    const t = items.find((x) => x.id === torboxId);
    if (!t) throw new Error('That torrent is no longer in your TorBox account');
    const hash = t.hash ? t.hash.toLowerCase() : null;
    const id = hash && /^[a-f0-9]{40}$/.test(hash) ? hash : randomId();
    const existing = this.jobs.find((j) => j.id === id);
    if (existing) return { job: existing, duplicate: true };
    const job = this.createJob(id, hash, t.name, 'cloud', { ...o, origin: 'cloud' });
    job.status = 'torbox';
    job.torboxId = t.id;
    job.size = t.size;
    job.submittedAt = Date.now();
    job.cached = true;
    job.magnet = hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(t.name)}` : null;
    const outcome = this.insert(job);
    this.applyList(items);
    return outcome;
  }

  // ───────────────────────────── TorBox submission ─────────────────────────────

  private async submitNext() {
    if (this.submitBusy || Date.now() < this.nextSubmitAt || !this.settings.torboxApiKey) return;
    const job = this.jobs.filter((j) => j.status === 'queued' && !j.paused).sort(byOrder)[0];
    if (!job) return;
    this.submitBusy = true;
    job.status = 'submitting';
    try {
      let input: { magnet: string } | { file: Buffer; filename: string };
      const torrentFile = this.store.torrentPath(job.id);
      if (job.kind === 'torrent' && fs.existsSync(torrentFile)) {
        input = { file: fs.readFileSync(torrentFile), filename: `${sanitizeSegment(job.name)}.torrent` };
      } else if (job.magnet) {
        input = { magnet: job.magnet };
      } else {
        throw new Error('Nothing to send: the torrent file is missing');
      }
      const res = await this.torbox.createTorrent(input, { seed: this.settings.seedMode, allowZip: this.settings.allowZip });
      if (!this.jobs.includes(job)) return;
      job.torboxId = typeof res.torrent_id === 'number' ? res.torrent_id : null;
      if (res.hash && !job.hash) job.hash = res.hash.toLowerCase();
      if (res.name && job.name.startsWith('Magnet ')) job.name = res.name;
      job.status = 'torbox';
      job.submittedAt = Date.now();
      job.torboxState = job.torboxId !== null ? 'submitted' : 'queued on TorBox';
      job.cached = /cached/i.test(res.detail) ? true : null;
      job.error = null;
      job.warning = null;
      job.attempts = 0;
      log.info(`Sent to TorBox: ${job.name}${res.detail ? ` — ${res.detail}` : ''}`);
      this.markTorbox(true);
      this.nextPollAt = Date.now() + 1500;
      this.nextSubmitAt = Date.now() + 1000;
    } catch (e) {
      if (!this.jobs.includes(job)) return;
      job.status = 'queued';
      const msg = errMsg(e);
      const now = Date.now();
      if (e instanceof TorBoxError && e.isRateLimit) {
        job.warning = 'TorBox rate limit reached — retrying shortly';
        this.nextSubmitAt = now + (e.retryAfterSec ?? 60) * 1000;
        log.warn('TorBox rate limit reached while adding torrents; backing off');
      } else if (e instanceof TorBoxError && (e.isAuth || e.code === 'NETWORK' || e.status >= 500)) {
        job.warning = msg;
        this.markTorbox(false, msg);
        this.nextSubmitAt = now + 30_000;
        log.warn(`TorBox unavailable: ${msg}`);
      } else if (e instanceof TorBoxError && /duplicate|already/i.test(`${e.code} ${msg}`) && job.hash) {
        job.status = 'torbox';
        job.submittedAt = now;
        job.torboxState = 'already on TorBox';
        this.nextPollAt = now;
      } else {
        job.attempts++;
        if (job.attempts >= 3) this.fail(job, `TorBox rejected this torrent: ${msg}`);
        else {
          job.warning = msg;
          this.nextSubmitAt = now + 10_000;
        }
      }
    } finally {
      this.submitBusy = false;
      this.store.save();
    }
  }

  // ───────────────────────────── TorBox polling ─────────────────────────────

  private async poll(force = false) {
    if (this.pollBusy || !this.settings.torboxApiKey) return;
    if (!force) {
      if (!this.jobs.some((j) => j.status === 'torbox')) return;
      if (Date.now() < this.nextPollAt) return;
    }
    this.pollBusy = true;
    try {
      const list = await this.torbox.list();
      this.cloudCache = { at: Date.now(), items: list };
      this.markTorbox(true);
      this.applyList(list);
    } catch (e) {
      const msg = errMsg(e);
      if (e instanceof TorBoxError && (e.isAuth || e.code === 'NETWORK')) this.markTorbox(false, msg);
      log.warn(`TorBox status check failed: ${msg}`);
    } finally {
      this.pollBusy = false;
      this.nextPollAt = Date.now() + Math.max(2, this.settings.pollIntervalSec) * 1000;
    }
  }

  private applyList(list: TBTorrent[]) {
    const byId = new Map(list.map((t) => [t.id, t]));
    const byHash = new Map(list.filter((t) => t.hash).map((t) => [t.hash.toLowerCase(), t]));
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.status !== 'torbox') continue;
      const t = (job.torboxId !== null ? byId.get(job.torboxId) : undefined) ?? (job.hash ? byHash.get(job.hash) : undefined);
      if (!t) {
        if (job.torboxId !== null) {
          const n = (this.missing.get(job.id) ?? 0) + 1;
          this.missing.set(job.id, n);
          if (n >= 4) {
            this.missing.delete(job.id);
            this.fail(job, 'This torrent no longer exists on TorBox');
          }
        }
        continue;
      }
      this.missing.delete(job.id);
      job.torboxId = t.id;
      if (!job.hash && t.hash) job.hash = t.hash.toLowerCase();
      job.torboxState = t.download_state || '';
      job.torboxProgress = clamp01(t.progress);
      job.torboxSpeed = Number(t.download_speed) || 0;
      job.torboxSeeds = Number(t.seeds) || 0;
      job.torboxEta = Number(t.eta) || 0;
      if (t.name && (job.name.startsWith('Magnet ') || job.kind === 'cloud')) job.name = t.name;
      if (t.size) job.size = t.size;
      const present = t.download_present ?? t.download_finished;
      if (present && t.files && t.files.length) {
        this.buildFiles(job, t);
        job.status = 'waiting';
        job.readyAt = now;
        job.torboxProgress = 1;
        if (job.cached === null && job.submittedAt) job.cached = now - job.submittedAt < 20_000;
        log.info(`Ready on TorBox: ${job.name}`);
      } else if (/^(error|failed)|dead|invalid/i.test(t.download_state || '')) {
        this.fail(job, `TorBox reported "${t.download_state}"`);
      }
    }
  }

  private buildFiles(job: Job, t: TBTorrent) {
    const skip = new Set(
      this.settings.skipExtensions
        .split(/[\s,;]+/)
        .map((s) => s.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
    );
    const raw = (t.files ?? []).map((f) => ({
      id: f.id,
      parts: (f.name || f.short_name || `file-${f.id}`).split(/[\\/]+/).filter(Boolean),
      size: Number(f.size) || 0,
    }));
    const first = raw[0]?.parts[0];
    const sharedRoot = raw.length && raw.every((f) => f.parts.length > 1 && f.parts[0] === first) ? first : null;
    const mode = this.settings.subfolderMode;
    let root: string | null;
    let mapped: { id: number; rel: string; size: number }[];
    if (raw.length === 1) {
      const base = raw[0].parts[raw[0].parts.length - 1];
      root = mode === 'always' ? (job.name || base).replace(/\.[a-z0-9]{2,4}$/i, '') : null;
      mapped = [{ id: raw[0].id, rel: root ? `${root}/${base}` : base, size: raw[0].size }];
    } else {
      root = mode === 'never' ? null : (sharedRoot ?? job.name);
      mapped = raw.map((f) => {
        const inner = sharedRoot ? f.parts.slice(1) : f.parts;
        return { id: f.id, rel: [root, ...inner].filter(Boolean).join('/'), size: f.size };
      });
    }
    const prev = new Map(job.files.map((f) => [f.id, f]));
    job.files = mapped.map((f) => {
      const ext = path.extname(f.rel).replace(/^\./, '').toLowerCase();
      const old = prev.get(f.id);
      return {
        id: f.id,
        path: safeRelative(f.rel),
        size: f.size,
        downloaded: old?.state === 'done' ? f.size : 0,
        state: old?.state === 'done' ? 'done' : skip.has(ext) ? 'skipped' : 'pending',
      } satisfies JobFile;
    });
    job.contentPath = root
      ? path.join(job.savePath, sanitizeSegment(root))
      : job.files.length === 1
        ? path.join(job.savePath, job.files[0].path)
        : job.savePath;
    job.size = job.files.filter((f) => f.state !== 'skipped').reduce((a, f) => a + f.size, 0);
    job.downloaded = job.files.reduce((a, f) => a + (f.state === 'skipped' ? 0 : f.downloaded), 0);
  }

  // ───────────────────────────── local downloads ─────────────────────────────

  private schedule() {
    if (this.settings.globalPaused) return;
    const max = Math.max(1, Math.floor(this.settings.maxConcurrentDownloads) || 1);
    if (this.runners.size >= max) return;
    const now = Date.now();
    const candidates = this.jobs
      .filter((j) => j.status === 'waiting' && !j.paused && !this.runners.has(j.id) && (!j.nextRetryAt || j.nextRetryAt <= now))
      .sort(byOrder);
    for (const job of candidates) {
      if (this.runners.size >= max) break;
      const ac = new AbortController();
      const promise = this.runJob(job, ac.signal).finally(() => {
        this.runners.delete(job.id);
        job.speed = 0;
        job.eta = 0;
      });
      this.runners.set(job.id, { ac, promise });
    }
  }

  private recount(job: Job) {
    job.downloaded = job.files.reduce((a, f) => a + (f.state === 'skipped' ? 0 : f.downloaded), 0);
  }

  private async runJob(job: Job, signal: AbortSignal) {
    job.status = 'downloading';
    job.startedAt ??= Date.now();
    job.nextRetryAt = null;
    let current: JobFile | null = null;
    try {
      if (job.torboxId === null) throw new Error('Missing TorBox torrent id');
      for (const f of job.files) {
        if (f.state === 'done' || f.state === 'skipped') continue;
        current = f;
        f.state = 'downloading';
        await this.downloadFile(job, f, signal);
        f.state = 'done';
        current = null;
        this.store.save();
      }
      if (!this.jobs.includes(job)) return;
      this.complete(job);
    } catch (e) {
      if (current && current.state === 'downloading') current.state = 'pending';
      if (!this.jobs.includes(job)) return;
      if (signal.aborted) {
        if (job.status === 'downloading') job.status = 'waiting';
        return;
      }
      const msg = errMsg(e);
      job.attempts++;
      if (job.attempts > this.settings.retryAttempts) {
        this.fail(job, msg);
      } else {
        const delay = Math.min(5 * 60_000, 5000 * 2 ** (job.attempts - 1));
        job.status = 'waiting';
        job.nextRetryAt = Date.now() + delay;
        job.warning = `${msg} — retry ${job.attempts}/${this.settings.retryAttempts} in ${Math.round(delay / 1000)}s`;
        log.warn(`Download problem for "${job.name}": ${msg}`);
      }
    } finally {
      this.recount(job);
      this.store.save();
    }
  }

  private count(job: Job, f: JobFile, n: number) {
    f.downloaded += n;
    job.downloaded += n;
    this.tickBytes += n;
    this.jobBytes.set(job.id, (this.jobBytes.get(job.id) ?? 0) + n);
    this.stats.addBytes(n);
  }

  private async downloadFile(job: Job, f: JobFile, signal: AbortSignal) {
    const dest = path.join(job.savePath, f.path);
    const part = `${dest}.part`;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });

    // Finished in an earlier run but the state wasn't saved yet.
    if (f.size > 0 && fileSize(dest) === f.size && fileSize(part) < 0) {
      f.downloaded = f.size;
      this.recount(job);
      return;
    }
    let start = Math.max(0, fileSize(part));
    if (f.size > 0 && start > f.size) {
      await fs.promises.rm(part, { force: true });
      start = 0;
    }
    f.downloaded = start;
    this.recount(job);
    if (f.size > 0 && start === f.size) {
      await fs.promises.rm(dest, { force: true });
      await fs.promises.rename(part, dest);
      return;
    }

    const url = await this.torbox.requestDownload(job.torboxId!, f.id);
    const stall = new AbortController();
    const combined = AbortSignal.any([signal, stall.signal]);
    let stallTimer = setTimeout(() => stall.abort(new Error('Connection stalled (no data for 60s)')), STALL_TIMEOUT_MS);
    const resetStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => stall.abort(new Error('Connection stalled (no data for 60s)')), STALL_TIMEOUT_MS);
    };

    try {
      const res = await fetch(url, {
        headers: start > 0 ? { Range: `bytes=${start}-` } : {},
        signal: combined,
      });
      if (res.status === 416 && start > 0) {
        await fs.promises.rm(dest, { force: true });
        await fs.promises.rename(part, dest);
        f.downloaded = f.size || start;
        return;
      }
      if (!res.ok || !res.body) throw new Error(`Download server returned HTTP ${res.status}`);
      if (start > 0 && res.status !== 206) {
        start = 0;
        f.downloaded = 0;
        this.recount(job);
      }
      const ws = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
      let wsError: Error | null = null;
      ws.on('error', (err) => (wsError = err));
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          resetStall();
          if (wsError) throw wsError;
          await this.throttle.take(chunk.byteLength, combined);
          if (!ws.write(chunk)) await once(ws, 'drain', { signal: combined });
          this.count(job, f, chunk.byteLength);
        }
      } finally {
        await new Promise<void>((resolve) => {
          if (ws.destroyed || ws.closed) return resolve();
          ws.once('error', () => resolve());
          ws.end(() => resolve());
        });
      }
      if (wsError) throw wsError;
      if (stall.signal.aborted) throw stall.signal.reason;
      if (f.size > 0 && f.downloaded < f.size) throw new Error('Connection closed before the file finished downloading');
      if (f.size === 0) f.size = f.downloaded;
      await fs.promises.rm(dest, { force: true });
      await fs.promises.rename(part, dest);
    } catch (e) {
      if (stall.signal.aborted && !signal.aborted) throw stall.signal.reason;
      throw e;
    } finally {
      clearTimeout(stallTimer);
    }
  }

  private complete(job: Job) {
    const now = Date.now();
    job.status = 'completed';
    job.completedAt = now;
    job.error = null;
    job.warning = null;
    job.paused = false;
    job.nextRetryAt = null;
    this.recount(job);
    this.stats.recordCompletion(job);
    log.info(`Completed "${job.name}"`);
    this.notify({ kind: 'completed', title: 'Download complete', body: job.name, jobId: job.id });
    if (this.settings.autoRemoveFromTorbox && job.torboxId !== null && !job.removedFromTorbox) {
      const id = job.torboxId;
      this.torbox
        .control(id, 'delete')
        .then(() => {
          job.removedFromTorbox = true;
          log.info(`Removed "${job.name}" from TorBox (auto-remove)`);
          this.store.save();
        })
        .catch((e) => log.warn(`Auto-remove from TorBox failed for "${job.name}": ${errMsg(e)}`));
    }
    if (this.settings.autoRemoveFromList && !(this.settings.autoRemoveSkipArr && job.origin === 'qbit')) {
      job.removeAt = now + Math.max(0, this.settings.autoRemoveDelayMin) * 60_000;
    }
    this.store.save();
  }

  private fail(job: Job, msg: string) {
    job.status = 'error';
    job.error = msg;
    job.warning = null;
    job.nextRetryAt = null;
    this.stats.recordFailure();
    log.error(`"${job.name}" failed: ${msg}`);
    this.notify({ kind: 'error', title: 'Download failed', body: `${job.name} — ${msg}`, jobId: job.id });
    this.store.save();
  }

  private autoRemove(now: number) {
    const due = this.jobs.filter((j) => j.status === 'completed' && j.removeAt !== null && j.removeAt <= now);
    if (due.length) void this.remove(due.map((j) => j.id), { fromList: true, fromTorbox: false, deleteFiles: false });
  }

  // ───────────────────────────── controls ─────────────────────────────

  find(id: string): Job | undefined {
    const lower = id.toLowerCase();
    return this.jobs.find((j) => j.id === lower || j.hash === lower);
  }

  private each(ids: string[], fn: (job: Job) => void) {
    for (const id of ids) {
      const job = this.find(id);
      if (job) fn(job);
    }
    this.store.save();
  }

  pause(ids: string[]) {
    this.each(ids, (job) => {
      if (job.status === 'completed') return;
      job.paused = true;
      this.runners.get(job.id)?.ac.abort();
    });
  }

  resume(ids: string[]) {
    this.each(ids, (job) => {
      job.paused = false;
      job.nextRetryAt = null;
    });
  }

  retry(ids: string[]) {
    this.each(ids, (job) => {
      if (job.status !== 'error' && !job.warning) return;
      job.error = null;
      job.warning = null;
      job.attempts = 0;
      job.nextRetryAt = null;
      if (job.status !== 'error') return;
      if (job.torboxId !== null && job.files.length && !job.removedFromTorbox) job.status = 'waiting';
      else if (job.kind === 'cloud' && !job.removedFromTorbox) job.status = 'torbox';
      else {
        job.status = 'queued';
        job.torboxId = null;
        job.removedFromTorbox = false;
        job.torboxProgress = 0;
      }
    });
  }

  prioritize(ids: string[], where: 'top' | 'bottom') {
    const orders = this.jobs.map((j) => j.order);
    let min = Math.min(0, ...orders);
    let max = Math.max(0, ...orders);
    this.each(ids, (job) => {
      job.order = where === 'top' ? --min : ++max;
    });
  }

  setTag(ids: string[], tagId: string | null) {
    const tag = tagId ? this.store.data.tags.find((t) => t.id === tagId) : undefined;
    this.each(ids, (job) => {
      job.tagId = tag?.id ?? null;
      job.category = tag?.name ?? '';
      if (job.downloaded === 0 && job.status !== 'completed' && !this.runners.has(job.id)) {
        const next = this.resolveSavePath({ tagId: job.tagId });
        job.contentPath = path.join(next, path.relative(job.savePath, job.contentPath));
        job.savePath = next;
      }
    });
  }

  async remove(ids: string[], o: RemoveOptions): Promise<{ errors: string[] }> {
    const errors: string[] = [];
    for (const id of ids) {
      const job = this.find(id);
      if (!job) continue;
      const runner = this.runners.get(job.id);
      if (runner && (o.fromList || o.deleteFiles || o.fromTorbox)) {
        runner.ac.abort();
        await runner.promise.catch(() => undefined);
      }
      if (o.fromTorbox && job.torboxId !== null && !job.removedFromTorbox) {
        try {
          await this.torbox.control(job.torboxId, 'delete');
          job.removedFromTorbox = true;
          log.info(`Removed "${job.name}" from TorBox`);
        } catch (e) {
          if (e instanceof TorBoxError && e.status === 404) job.removedFromTorbox = true;
          else errors.push(`${job.name}: ${errMsg(e)}`);
        }
      }
      if (o.deleteFiles && job.files.length) {
        await removeContent(job.savePath, job.files.map((f) => f.path));
        log.info(`Deleted files for "${job.name}"`);
      }
      if (o.fromList) {
        const idx = this.jobs.indexOf(job);
        if (idx >= 0) this.jobs.splice(idx, 1);
        this.missing.delete(job.id);
        fs.promises.rm(this.store.torrentPath(job.id), { force: true }).catch(() => undefined);
        log.info(`Removed "${job.name}" from the list`);
      } else if (o.fromTorbox && job.removedFromTorbox && job.status !== 'completed') {
        job.status = 'error';
        job.error = 'Removed from TorBox before the download finished';
      }
      if (o.deleteFiles && !o.fromList && job.status === 'completed') {
        for (const f of job.files) if (f.state === 'done') f.state = 'pending';
      }
    }
    this.store.save();
    return { errors };
  }

  setGlobalPaused(paused: boolean) {
    this.settings.globalPaused = paused;
    if (paused) for (const r of this.runners.values()) r.ac.abort();
    log.info(paused ? 'All downloads paused' : 'Downloads resumed');
    this.store.save();
  }

  setSlowMode(on: boolean) {
    this.settings.slowMode = on;
    this.throttle.setRate(this.currentLimit());
    log.info(on ? 'Slow mode enabled' : 'Slow mode disabled');
    this.store.save();
  }

  onSettingsChanged(prev: Settings) {
    const s = this.settings;
    if (prev.torboxApiKey !== s.torboxApiKey) {
      this.accountCache = null;
      this.cloudCache = null;
      this.torboxStatus = { configured: !!s.torboxApiKey, ok: null, error: null, checkedAt: null };
      this.nextSubmitAt = 0;
      this.nextPollAt = 0;
      if (s.torboxApiKey) void this.account(true).catch(() => undefined);
    }
    if (prev.globalPaused !== s.globalPaused) this.setGlobalPaused(s.globalPaused);
    this.throttle.setRate(this.currentLimit());
  }

  // ───────────────────────────── account & cloud ─────────────────────────────

  async account(force = false): Promise<AccountInfo> {
    const key = this.settings.torboxApiKey;
    if (!force && this.accountCache && this.accountCache.key === key && Date.now() - this.accountCache.at < 60_000) {
      return this.accountCache.info;
    }
    try {
      const info = await this.torbox.account();
      this.accountCache = { at: Date.now(), key, info };
      this.markTorbox(true);
      return info;
    } catch (e) {
      if (e instanceof TorBoxError && (e.isAuth || e.code === 'NETWORK')) this.markTorbox(false, errMsg(e));
      throw e;
    }
  }

  private async cloudRaw(force = false): Promise<TBTorrent[]> {
    if (!force && this.cloudCache && Date.now() - this.cloudCache.at < 4000) return this.cloudCache.items;
    const items = await this.torbox.list();
    this.cloudCache = { at: Date.now(), items };
    this.markTorbox(true);
    return items;
  }

  async cloud(force = false): Promise<CloudItem[]> {
    const items = await this.cloudRaw(force);
    return items.map((t) => {
      const hash = (t.hash ?? '').toLowerCase();
      const linked = this.jobs.find((j) => j.torboxId === t.id || (hash && j.hash === hash));
      return {
        id: t.id,
        hash,
        name: t.name,
        size: Number(t.size) || 0,
        progress: clamp01(t.progress),
        state: t.download_state || '',
        speed: Number(t.download_speed) || 0,
        seeds: Number(t.seeds) || 0,
        ready: !!(t.download_present ?? t.download_finished),
        createdAt: t.created_at ?? null,
        files: (t.files ?? []).map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0 })),
        linkedJobId: linked?.id ?? null,
      };
    });
  }

  async cloudDelete(torboxId: number) {
    await this.torbox.control(torboxId, 'delete');
    if (this.cloudCache) this.cloudCache.items = this.cloudCache.items.filter((t) => t.id !== torboxId);
    for (const job of this.jobs) if (job.torboxId === torboxId) job.removedFromTorbox = true;
    log.info(`Deleted TorBox torrent #${torboxId}`);
    this.store.save();
  }
}

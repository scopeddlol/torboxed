import type { AnalyticsData, FolderInfo, HistoryRecord, Job, JobStatus } from '../shared/types';
import type { Store } from './store';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const KEEP_HOURS = 400 * 24;
const KEEP_HISTORY = 5000;

export class Stats {
  sessionBytes = 0;
  private minuteStart = Math.floor(Date.now() / MINUTE) * MINUTE;
  private minuteSum = 0;
  private minuteCount = 0;

  constructor(private readonly store: Store) {}

  private get s() {
    return this.store.data.stats;
  }

  addBytes(n: number) {
    const hour = String(Math.floor(Date.now() / HOUR) * HOUR);
    this.s.hourly[hour] = (this.s.hourly[hour] ?? 0) + n;
    this.s.totalBytes += n;
    this.sessionBytes += n;
  }

  /** Called once per second with the current total speed. */
  recordSpeed(bps: number) {
    const now = Date.now();
    const minute = Math.floor(now / MINUTE) * MINUTE;
    if (minute !== this.minuteStart) {
      const avg = this.minuteCount ? this.minuteSum / this.minuteCount : 0;
      this.s.minutes.push([this.minuteStart, Math.round(avg)]);
      const cutoff = now - 24 * HOUR;
      while (this.s.minutes.length && this.s.minutes[0][0] < cutoff) this.s.minutes.shift();
      this.minuteStart = minute;
      this.minuteSum = 0;
      this.minuteCount = 0;
      this.prune();
    }
    this.minuteSum += bps;
    this.minuteCount++;
    if (bps > this.s.peakSpeed) {
      this.s.peakSpeed = bps;
      this.s.peakSpeedAt = now;
    }
  }

  private prune() {
    const cutoff = Date.now() - KEEP_HOURS * HOUR;
    for (const k of Object.keys(this.s.hourly)) if (Number(k) < cutoff) delete this.s.hourly[k];
  }

  recordCompletion(job: Job) {
    const tag = job.tagId ? this.store.data.tags.find((t) => t.id === job.tagId) : undefined;
    const completedAt = job.completedAt ?? Date.now();
    const downloadMs = job.startedAt ? Math.max(1, completedAt - job.startedAt) : 1;
    const rec: HistoryRecord = {
      id: job.id,
      name: job.name,
      size: job.size,
      fileCount: job.files.filter((f) => f.state !== 'skipped').length,
      tag: tag?.name ?? (job.category || null),
      tagColor: tag?.color ?? null,
      origin: job.origin,
      cached: job.cached,
      addedAt: job.addedAt,
      readyAt: job.readyAt,
      startedAt: job.startedAt,
      completedAt,
      downloadMs,
      avgSpeed: Math.round(job.size / (downloadMs / 1000)),
    };
    this.store.data.history.unshift(rec);
    if (this.store.data.history.length > KEEP_HISTORY) this.store.data.history.length = KEEP_HISTORY;
    this.s.totalCompleted++;
  }

  recordFailure() {
    this.s.totalFailed++;
  }

  reset() {
    this.store.data.history = [];
    this.store.data.stats = {
      totalBytes: 0,
      totalCompleted: 0,
      totalFailed: 0,
      peakSpeed: 0,
      peakSpeedAt: null,
      hourly: {},
      minutes: [],
      firstUseAt: Date.now(),
    };
    this.sessionBytes = 0;
  }

  analytics(days: number, jobs: Job[], folders: FolderInfo[]): AnalyticsData {
    const since = Date.now() - days * 24 * HOUR;
    const current = {
      queued: 0,
      submitting: 0,
      torbox: 0,
      waiting: 0,
      downloading: 0,
      completed: 0,
      error: 0,
      paused: 0,
    } as Record<JobStatus | 'paused', number>;
    for (const j of jobs) {
      current[j.status]++;
      if (j.paused) current.paused++;
    }
    return {
      totals: {
        bytes: this.s.totalBytes,
        completed: this.s.totalCompleted,
        failed: this.s.totalFailed,
        peakSpeed: this.s.peakSpeed,
        peakSpeedAt: this.s.peakSpeedAt,
        sessionBytes: this.sessionBytes,
        firstUseAt: this.s.firstUseAt,
      },
      hourly: Object.entries(this.s.hourly)
        .map(([k, v]) => [Number(k), v] as [number, number])
        .filter(([k]) => k >= since)
        .sort((a, b) => a[0] - b[0]),
      minutes: this.s.minutes.slice(),
      history: this.store.data.history.filter((h) => h.completedAt >= since),
      current,
      folders,
    };
  }
}

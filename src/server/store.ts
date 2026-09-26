import fs from 'node:fs';
import path from 'node:path';
import type { Folder, HistoryRecord, Job, Settings, Tag } from '../shared/types';
import { DEFAULT_THEME } from '../shared/themes';
import { log, errMsg } from './log';

// All state lives in a single JSON document inside the data directory.
// It is managed entirely by the app (there is nothing for users to edit by
// hand): writes are debounced and atomic (write temp file, then rename).

export interface StatsData {
  totalBytes: number;
  totalCompleted: number;
  totalFailed: number;
  peakSpeed: number;
  peakSpeedAt: number | null;
  hourly: Record<string, number>; // epoch ms of hour start -> bytes
  minutes: [number, number][]; // [epoch ms minute start, avg bytes/sec]
  firstUseAt: number;
}

export interface DBShape {
  version: number;
  settings: Settings;
  folders: Folder[];
  tags: Tag[];
  jobs: Job[];
  history: HistoryRecord[];
  stats: StatsData;
}

export function defaultSettings(port: number): Settings {
  return {
    torboxApiKey: '',
    port,
    pollIntervalSec: 5,
    maxConcurrentDownloads: 3,
    retryAttempts: 5,
    speedLimitKBps: 0,
    slowModeLimitKBps: 2048,
    slowMode: false,
    globalPaused: false,
    defaultFolderId: 'default',
    subfolderMode: 'auto',
    skipExtensions: '',
    seedMode: 3,
    allowZip: false,
    autoRemoveFromTorbox: false,
    autoRemoveFromList: false,
    autoRemoveDelayMin: 0,
    autoRemoveSkipArr: true,
    removeDefaults: { fromTorbox: true, deleteFiles: false },
    qbitEnabled: true,
    theme: DEFAULT_THEME,
    accent: null,
    density: 'comfortable',
    reduceMotion: false,
    customContextMenu: true,
    browserNotifications: false,
    desktop: {
      closeToTray: true,
      startMinimized: false,
      launchOnStartup: false,
      notifications: true,
      allowLan: false,
      bounds: null,
      trayHintShown: false,
    },
    onboarded: false,
  };
}

function defaultDB(defaultDownloadDir: string, port: number): DBShape {
  return {
    version: 1,
    settings: defaultSettings(port),
    folders: [{ id: 'default', name: 'Downloads', path: defaultDownloadDir }],
    tags: [],
    jobs: [],
    history: [],
    stats: {
      totalBytes: 0,
      totalCompleted: 0,
      totalFailed: 0,
      peakSpeed: 0,
      peakSpeedAt: null,
      hourly: {},
      minutes: [],
      firstUseAt: Date.now(),
    },
  };
}

/** Deep-merge saved data over defaults so new settings get sane values after upgrades. */
function mergeDefaults<T>(defaults: T, saved: unknown): T {
  if (saved === undefined || saved === null) return defaults;
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return saved as T;
  if (typeof saved !== 'object' || Array.isArray(saved)) return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k];
    out[k] = d !== undefined && d !== null && typeof d === 'object' && !Array.isArray(d) ? mergeDefaults(d, v) : v;
  }
  return out as T;
}

export class Store {
  data: DBShape;
  readonly file: string;
  readonly torrentsDir: string;
  private timer: NodeJS.Timeout | null = null;
  private lastBackup = 0;

  constructor(
    readonly dataDir: string,
    defaultDownloadDir: string,
    defaultPort: number,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'torboxed.json');
    this.torrentsDir = path.join(dataDir, 'torrents');
    fs.mkdirSync(this.torrentsDir, { recursive: true });
    const defaults = defaultDB(defaultDownloadDir, defaultPort);
    const loaded = this.read(this.file) ?? this.read(`${this.file}.bak`);
    this.data = loaded ? mergeDefaults(defaults, loaded) : defaults;
    if (!this.data.folders.length) this.data.folders = defaults.folders;
    if (!this.data.folders.some((f) => f.id === this.data.settings.defaultFolderId)) {
      this.data.settings.defaultFolderId = this.data.folders[0].id;
    }
    this.normalizeJobs();
    this.flush();
  }

  private read(file: string): DBShape | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as DBShape;
    } catch (e) {
      log.error(`Could not read ${file}: ${errMsg(e)}`);
      return null;
    }
  }

  /** Reset transient state left over from a previous run. */
  private normalizeJobs() {
    for (const job of this.data.jobs) {
      job.speed = 0;
      job.eta = 0;
      if (job.status === 'downloading') job.status = 'waiting';
      if (job.status === 'submitting') job.status = 'queued';
      for (const f of job.files) if (f.state === 'downloading') f.state = 'pending';
    }
  }

  get settings(): Settings {
    return this.data.settings;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 1500);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      const json = JSON.stringify(
        { ...this.data, jobs: this.data.jobs.map((j) => ({ ...j, speed: 0, eta: 0 })) },
        null,
        0,
      );
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, json);
      if (Date.now() - this.lastBackup > 10 * 60_000 && fs.existsSync(this.file)) {
        fs.copyFileSync(this.file, `${this.file}.bak`);
        this.lastBackup = Date.now();
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      log.error(`Failed to save state: ${errMsg(e)}`);
    }
  }

  torrentPath(id: string) {
    return path.join(this.torrentsDir, `${id}.torrent`);
  }
}

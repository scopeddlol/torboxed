// Types shared between the server, the web UI and the desktop shell.

export type JobStatus =
  | 'queued' // waiting to be sent to TorBox
  | 'submitting' // being sent to TorBox right now
  | 'torbox' // TorBox is fetching the torrent
  | 'waiting' // ready on TorBox, waiting for a local download slot
  | 'downloading' // downloading to disk
  | 'completed'
  | 'error';

export type JobOrigin = 'ui' | 'qbit' | 'cloud';
export type JobKind = 'magnet' | 'torrent' | 'cloud';

export type FileState = 'pending' | 'downloading' | 'done' | 'skipped' | 'error';

export interface JobFile {
  id: number; // TorBox file id
  path: string; // path relative to the job's save path
  size: number;
  downloaded: number;
  state: FileState;
}

export interface Job {
  id: string; // 40-char lowercase hex (the BitTorrent info hash when known)
  hash: string | null;
  name: string;
  size: number;
  downloaded: number;
  status: JobStatus;
  paused: boolean;
  error: string | null;
  warning: string | null;
  origin: JobOrigin;
  kind: JobKind;
  magnet: string | null;
  tagId: string | null;
  category: string;
  savePath: string;
  contentPath: string;
  torboxId: number | null;
  torboxState: string;
  torboxProgress: number;
  torboxSpeed: number;
  torboxSeeds: number;
  torboxEta: number;
  cached: boolean | null;
  files: JobFile[];
  order: number;
  attempts: number;
  nextRetryAt: number | null;
  removeAt: number | null;
  removedFromTorbox: boolean;
  addedAt: number;
  submittedAt: number | null;
  readyAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  // runtime only
  speed: number;
  eta: number;
}

export type JobSummary = Omit<Job, 'files'> & { fileCount: number; filesDone: number };

export interface Folder {
  id: string;
  name: string;
  path: string;
}

export interface FolderInfo extends Folder {
  free: number | null;
  total: number | null;
  exists: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  folderId: string;
  subfolder: string;
}

export type SeedMode = 1 | 2 | 3;
export type SubfolderMode = 'auto' | 'always' | 'never';

export interface DesktopSettings {
  closeToTray: boolean;
  startMinimized: boolean;
  launchOnStartup: boolean;
  notifications: boolean;
  allowLan: boolean;
  bounds: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null;
  trayHintShown: boolean;
}

export interface Settings {
  torboxApiKey: string;
  port: number;
  pollIntervalSec: number;
  maxConcurrentDownloads: number;
  retryAttempts: number;
  speedLimitKBps: number;
  slowModeLimitKBps: number;
  slowMode: boolean;
  globalPaused: boolean;
  defaultFolderId: string;
  subfolderMode: SubfolderMode;
  skipExtensions: string;
  seedMode: SeedMode;
  allowZip: boolean;
  autoRemoveFromTorbox: boolean;
  autoRemoveFromList: boolean;
  autoRemoveDelayMin: number;
  autoRemoveSkipArr: boolean;
  removeDefaults: { fromTorbox: boolean; deleteFiles: boolean };
  qbitEnabled: boolean;
  theme: string;
  accent: string | null;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  customContextMenu: boolean;
  browserNotifications: boolean;
  desktop: DesktopSettings;
  onboarded: boolean;
}

export interface HistoryRecord {
  id: string;
  name: string;
  size: number;
  fileCount: number;
  tag: string | null;
  tagColor: string | null;
  origin: JobOrigin;
  cached: boolean | null;
  addedAt: number;
  readyAt: number | null;
  startedAt: number | null;
  completedAt: number;
  downloadMs: number;
  avgSpeed: number;
}

export interface TorBoxStatus {
  configured: boolean;
  ok: boolean | null;
  error: string | null;
  checkedAt: number | null;
}

export interface Tick {
  t: number;
  speed: number;
  limit: number; // bytes/sec, 0 = unlimited
  globalPaused: boolean;
  slowMode: boolean;
  jobs: JobSummary[];
  torbox: TorBoxStatus;
  sessionBytes: number;
}

export interface NotifyEvent {
  kind: 'completed' | 'error' | 'info';
  title: string;
  body: string;
  jobId?: string;
}

export interface SystemInfo {
  version: string;
  platform: string;
  arch: string;
  node: string;
  desktop: boolean;
  docker: boolean;
  dataDir: string;
  port: number;
  portLocked: boolean;
  startedAt: number;
}

export interface AccountInfo {
  email: string | null;
  plan: number | null;
  planName: string;
  premiumExpiresAt: string | null;
  totalDownloaded: number | null;
  createdAt: string | null;
}

export interface CloudFile {
  id: number;
  name: string;
  size: number;
}

export interface CloudItem {
  id: number;
  hash: string;
  name: string;
  size: number;
  progress: number;
  state: string;
  speed: number;
  seeds: number;
  ready: boolean;
  createdAt: string | null;
  files: CloudFile[];
  linkedJobId: string | null;
}

export interface AnalyticsData {
  totals: {
    bytes: number;
    completed: number;
    failed: number;
    peakSpeed: number;
    peakSpeedAt: number | null;
    sessionBytes: number;
    firstUseAt: number;
  };
  hourly: [number, number][]; // [epoch ms of hour start, bytes]
  minutes: [number, number][]; // [epoch ms of minute start, avg bytes/sec]
  history: HistoryRecord[];
  current: Record<JobStatus | 'paused', number>;
  folders: FolderInfo[];
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  roots: string[];
}

export interface AddResult {
  added: JobSummary[];
  duplicates: string[];
  errors: { input: string; error: string }[];
}

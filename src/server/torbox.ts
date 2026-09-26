import type { AccountInfo } from '../shared/types';

export const TORBOX_API = 'https://api.torbox.app/v1/api';

export class TorBoxError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
  get isAuth() {
    return this.status === 401 || this.status === 403 || this.code === 'NO_AUTH' || this.code === 'BAD_TOKEN';
  }
  get isRateLimit() {
    return this.status === 429;
  }
}

export interface TBFile {
  id: number;
  name: string;
  size: number;
  short_name?: string;
  mimetype?: string;
}

export interface TBTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  progress: number;
  download_speed: number;
  upload_speed: number;
  eta: number;
  seeds: number;
  peers: number;
  download_state: string;
  download_finished: boolean;
  download_present: boolean;
  active: boolean;
  created_at?: string;
  files: TBFile[] | null;
}

export interface CreateResult {
  torrent_id?: number;
  queued_id?: number;
  hash?: string;
  name?: string;
  detail: string;
}

interface RequestOpts {
  query?: Record<string, string | number | boolean>;
  json?: unknown;
  form?: FormData;
  key?: string;
  timeoutMs?: number;
}

const PLAN_NAMES: Record<number, string> = { 0: 'Free', 1: 'Essential', 2: 'Pro', 3: 'Standard' };

export class TorBoxClient {
  constructor(
    private readonly getKey: () => string,
    private readonly base: string = TORBOX_API,
  ) {}

  private async request<T>(method: string, pathname: string, opts: RequestOpts = {}): Promise<{ data: T; detail: string }> {
    const key = (opts.key ?? this.getKey()).trim();
    if (!key) throw new TorBoxError('No TorBox API key configured. Add it in Settings → TorBox.', 401, 'NO_AUTH');
    const url = new URL(this.base + pathname);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'Torboxed/1.0',
    };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    } catch (e) {
      const reason = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      throw new TorBoxError(`Could not reach TorBox: ${reason}`, 0, 'NETWORK');
    }
    const text = await res.text();
    let parsed: { success?: boolean; error?: string | null; detail?: string; data?: T } | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok || parsed?.success === false || !parsed) {
      const retry = Number(res.headers.get('retry-after'));
      const msg = parsed?.detail || parsed?.error || `TorBox returned HTTP ${res.status}`;
      throw new TorBoxError(msg, res.status, parsed?.error ?? null, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    return { data: parsed.data as T, detail: parsed.detail ?? '' };
  }

  async account(key?: string): Promise<AccountInfo> {
    const { data } = await this.request<Record<string, unknown>>('GET', '/user/me', { query: { settings: 'false' }, key });
    const plan = typeof data.plan === 'number' ? data.plan : null;
    return {
      email: (data.email as string) ?? null,
      plan,
      planName: plan === null ? 'Unknown' : (PLAN_NAMES[plan] ?? `Plan ${plan}`),
      premiumExpiresAt: (data.premium_expires_at as string) ?? null,
      totalDownloaded: typeof data.total_downloaded === 'number' ? data.total_downloaded : null,
      createdAt: (data.created_at as string) ?? null,
    };
  }

  async createTorrent(
    input: { magnet: string } | { file: Buffer; filename: string },
    opts: { seed: number; allowZip: boolean; name?: string },
  ): Promise<CreateResult> {
    const form = new FormData();
    if ('magnet' in input) form.set('magnet', input.magnet);
    else form.set('file', new Blob([new Uint8Array(input.file)], { type: 'application/x-bittorrent' }), input.filename);
    form.set('seed', String(opts.seed));
    form.set('allow_zip', String(opts.allowZip));
    if (opts.name) form.set('name', opts.name);
    const { data, detail } = await this.request<Omit<CreateResult, 'detail'> | null>('POST', '/torrents/createtorrent', {
      form,
      timeoutMs: 60_000,
    });
    return { ...(data ?? {}), detail };
  }

  async list(): Promise<TBTorrent[]> {
    const { data } = await this.request<TBTorrent[] | TBTorrent | null>('GET', '/torrents/mylist', {
      query: { bypass_cache: 'true' },
    });
    if (!data) return [];
    return Array.isArray(data) ? data : [data];
  }

  async requestDownload(torrentId: number, fileId: number): Promise<string> {
    const key = this.getKey().trim();
    const { data } = await this.request<string>('GET', '/torrents/requestdl', {
      query: { token: key, torrent_id: torrentId, file_id: fileId, zip_link: 'false' },
    });
    if (typeof data !== 'string' || !data) throw new TorBoxError('TorBox did not return a download link', 502);
    return data;
  }

  async control(torrentId: number, operation: 'delete' | 'pause' | 'resume' | 'reannounce'): Promise<void> {
    await this.request('POST', '/torrents/controltorrent', { json: { torrent_id: torrentId, operation } });
  }
}

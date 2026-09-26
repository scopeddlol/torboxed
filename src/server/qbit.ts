import { randomBytes } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import type { Job } from '../shared/types';
import type { Manager } from './manager';
import { errMsg, log } from './log';
import { splitLinks } from './torrent';

// A qBittorrent Web API (v2) emulation. Sonarr, Radarr, Lidarr, Readarr,
// Prowlarr & friends talk to Torboxed exactly as if it were qBittorrent.
// Categories map 1:1 onto Torboxed tags.

const QBIT_VERSION = 'v4.6.7';
const WEBAPI_VERSION = '2.9.3';
const INFINITE_ETA = 8_640_000;

const sec = (ms: number | null) => (ms ? Math.floor(ms / 1000) : 0);

export function qbitState(job: Job, globalPaused: boolean): string {
  if (job.status === 'completed') return 'pausedUP';
  if (job.status === 'error') return 'error';
  if (job.paused) return 'pausedDL';
  switch (job.status) {
    case 'queued':
    case 'submitting':
      return 'queuedDL';
    case 'torbox':
      if (/meta/i.test(job.torboxState)) return 'metaDL';
      if (/stalled/i.test(job.torboxState)) return 'stalledDL';
      return 'downloading';
    case 'waiting':
      return globalPaused ? 'pausedDL' : 'queuedDL';
    case 'downloading':
      return globalPaused ? 'pausedDL' : 'downloading';
    default:
      return 'downloading';
  }
}

export function toQbit(job: Job, globalPaused: boolean) {
  const size = job.size || 0;
  const done = job.status === 'completed';
  const downloaded = done ? size : job.downloaded;
  const progress = done ? 1 : size > 0 ? Math.min(0.999, downloaded / size) : 0;
  let eta = INFINITE_ETA;
  if (done) eta = 0;
  else if (job.status === 'downloading' && job.eta > 0) eta = job.eta;
  else if (job.status === 'torbox' && job.torboxEta > 0) eta = job.torboxEta;
  const hash = job.id;
  return {
    added_on: sec(job.addedAt),
    amount_left: Math.max(0, size - downloaded),
    auto_tmm: false,
    availability: -1,
    category: job.category,
    completed: downloaded,
    completion_on: done ? sec(job.completedAt) : -1,
    content_path: job.contentPath,
    dl_limit: -1,
    dlspeed: job.status === 'downloading' ? Math.round(job.speed) : 0,
    download_path: '',
    downloaded,
    downloaded_session: downloaded,
    eta,
    f_l_piece_prio: false,
    force_start: false,
    hash,
    infohash_v1: hash,
    infohash_v2: '',
    last_activity: sec(job.completedAt ?? job.startedAt ?? job.addedAt),
    magnet_uri: job.magnet ?? '',
    max_ratio: -1,
    max_seeding_time: -1,
    name: job.name,
    num_complete: job.torboxSeeds,
    num_incomplete: 0,
    num_leechs: 0,
    num_seeds: job.torboxSeeds,
    priority: done ? 0 : job.order,
    progress,
    ratio: 0,
    ratio_limit: -2,
    save_path: job.savePath,
    seeding_time: 0,
    seeding_time_limit: -2,
    seen_complete: done ? sec(job.completedAt) : -1,
    seq_dl: false,
    size,
    state: qbitState(job, globalPaused),
    super_seeding: false,
    tags: '',
    time_active: sec(Date.now() - job.addedAt),
    total_size: size,
    tracker: '',
    trackers_count: 0,
    up_limit: -1,
    uploaded: 0,
    uploaded_session: 0,
    upspeed: 0,
  };
}

export function qbitRouter(m: Manager): Router {
  const r = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 500 } });

  r.use((_req, res, next) => {
    if (!m.settings.qbitEnabled) {
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    next();
  });
  r.use(express.urlencoded({ extended: false, limit: '10mb' }));

  const param = (req: Request, name: string): string => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const q = (req.query ?? {}) as Record<string, unknown>;
    const v = b[name] ?? q[name];
    return v === undefined || v === null ? '' : String(v);
  };
  const bool = (req: Request, name: string) => /^(true|1)$/i.test(param(req, name));
  const ok = (res: Response) => res.type('text/plain').send('Ok.');
  const hashesOf = (req: Request): string[] => {
    const raw = param(req, 'hashes') || param(req, 'hash');
    if (raw === 'all') return m.jobs.map((j) => j.id);
    return raw
      .split('|')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  };
  const categories = () => {
    const out: Record<string, { name: string; savePath: string }> = {};
    for (const t of m.store.data.tags) out[t.name] = { name: t.name, savePath: m.resolveSavePath({ tagId: t.id }) };
    return out;
  };

  // ── auth ──
  r.all('/auth/login', (_req, res) => {
    res.cookie('SID', randomBytes(16).toString('hex'), { httpOnly: true, sameSite: 'strict', path: '/' });
    ok(res);
  });
  r.all('/auth/logout', (_req, res) => ok(res));

  // ── app ──
  r.all('/app/version', (_req, res) => res.type('text/plain').send(QBIT_VERSION));
  r.all('/app/webapiVersion', (_req, res) => res.type('text/plain').send(WEBAPI_VERSION));
  r.all('/app/buildInfo', (_req, res) =>
    res.json({ qt: '6.5.3', libtorrent: '2.0.10.0', boost: '1.84.0', openssl: '3.2.1', zlib: '1.3.1', bitness: 64 }),
  );
  r.all('/app/defaultSavePath', (_req, res) => res.type('text/plain').send(m.defaultFolder().path));
  r.all('/app/preferences', (_req, res) => {
    const s = m.settings;
    res.json({
      save_path: m.defaultFolder().path,
      temp_path_enabled: false,
      temp_path: '',
      create_subfolder_enabled: s.subfolderMode !== 'never',
      start_paused_enabled: false,
      auto_tmm_enabled: false,
      max_ratio_enabled: true,
      max_ratio: 0,
      max_ratio_act: 0,
      max_seeding_time_enabled: false,
      max_seeding_time: -1,
      max_inactive_seeding_time_enabled: false,
      max_inactive_seeding_time: -1,
      queueing_enabled: true,
      max_active_downloads: s.maxConcurrentDownloads,
      max_active_torrents: s.maxConcurrentDownloads,
      max_active_uploads: 0,
      dht: false,
      pex: false,
      lsd: false,
      dl_limit: s.speedLimitKBps * 1024,
      up_limit: 0,
      alt_dl_limit: s.slowModeLimitKBps * 1024,
      alt_up_limit: 0,
      scheduler_enabled: false,
      web_ui_port: s.port,
      web_ui_username: 'admin',
      bypass_local_auth: true,
    });
  });
  r.all('/app/setPreferences', (_req, res) => ok(res));
  r.all('/app/shutdown', (_req, res) => ok(res));

  // ── transfer ──
  const transferInfo = () => ({
    dl_info_speed: Math.round(m.speed),
    dl_info_data: m.stats.sessionBytes,
    up_info_speed: 0,
    up_info_data: 0,
    dl_rate_limit: m.currentLimit(),
    up_rate_limit: 0,
    dht_nodes: 0,
    connection_status: m.torboxStatus.ok === false ? 'disconnected' : 'connected',
    queueing: true,
    use_alt_speed_limits: m.settings.slowMode,
    refresh_interval: 1500,
  });
  r.all('/transfer/info', (_req, res) => res.json(transferInfo()));
  r.all('/transfer/speedLimitsMode', (_req, res) => res.type('text/plain').send(m.settings.slowMode ? '1' : '0'));
  r.all('/transfer/toggleSpeedLimitsMode', (_req, res) => {
    m.setSlowMode(!m.settings.slowMode);
    ok(res);
  });
  r.all('/transfer/setSpeedLimitsMode', (req, res) => {
    m.setSlowMode(param(req, 'mode') === '1');
    ok(res);
  });
  r.all('/transfer/downloadLimit', (_req, res) => res.type('text/plain').send(String(m.currentLimit())));
  r.all('/transfer/uploadLimit', (_req, res) => res.type('text/plain').send('0'));
  r.all(['/transfer/setDownloadLimit', '/transfer/setUploadLimit'], (_req, res) => ok(res));

  // ── torrents ──
  const listTorrents = (req: Request) => {
    const filter = param(req, 'filter') || 'all';
    const category = (req.body?.category ?? req.query.category) as string | undefined;
    const hashes = param(req, 'hashes');
    const wanted = hashes ? new Set(hashes.toLowerCase().split('|')) : null;
    const list = m.jobs.filter((j) => {
      if (wanted && !wanted.has(j.id) && !(j.hash && wanted.has(j.hash))) return false;
      if (category !== undefined && j.category !== category) return false;
      switch (filter) {
        case 'downloading':
          return j.status !== 'completed' && j.status !== 'error';
        case 'seeding':
          return false;
        case 'completed':
          return j.status === 'completed';
        case 'paused':
        case 'stopped':
          return j.paused || j.status === 'completed';
        case 'active':
          return j.status === 'downloading' || j.status === 'torbox';
        case 'inactive':
          return j.status !== 'downloading' && j.status !== 'torbox';
        case 'resumed':
        case 'running':
          return !j.paused && j.status !== 'completed';
        case 'errored':
          return j.status === 'error';
        case 'stalled':
        case 'stalled_downloading':
          return /stalled/i.test(j.torboxState);
        default:
          return true;
      }
    });
    const mapped = list.map((j) => toQbit(j, m.settings.globalPaused));
    const sort = param(req, 'sort') as keyof ReturnType<typeof toQbit>;
    if (sort && mapped.length && sort in mapped[0]) {
      mapped.sort((a, b) => (a[sort] > b[sort] ? 1 : a[sort] < b[sort] ? -1 : 0));
      if (bool(req, 'reverse')) mapped.reverse();
    }
    const offset = Number(param(req, 'offset')) || 0;
    const limit = Number(param(req, 'limit')) || 0;
    return limit > 0 ? mapped.slice(offset, offset + limit) : mapped.slice(offset);
  };

  r.all('/torrents/info', (req, res) => res.json(listTorrents(req)));

  r.all('/torrents/properties', (req, res) => {
    const job = m.find(param(req, 'hash'));
    if (!job) return void res.status(404).type('text/plain').send('Not Found');
    const q = toQbit(job, m.settings.globalPaused);
    res.json({
      save_path: job.savePath,
      creation_date: q.added_on,
      piece_size: 0,
      comment: '',
      total_wasted: 0,
      total_uploaded: 0,
      total_uploaded_session: 0,
      total_downloaded: q.downloaded,
      total_downloaded_session: q.downloaded,
      up_limit: -1,
      dl_limit: -1,
      time_elapsed: q.time_active,
      seeding_time: 0,
      nb_connections: 0,
      nb_connections_limit: 0,
      share_ratio: 0,
      addition_date: q.added_on,
      completion_date: q.completion_on,
      created_by: 'Torboxed',
      dl_speed_avg: 0,
      dl_speed: q.dlspeed,
      eta: q.eta,
      last_seen: q.last_activity,
      peers: 0,
      peers_total: 0,
      pieces_have: 0,
      pieces_num: 0,
      reannounce: 0,
      seeds: q.num_seeds,
      seeds_total: q.num_seeds,
      total_size: q.size,
      up_speed_avg: 0,
      up_speed: 0,
      isPrivate: false,
      hash: job.id,
      infohash_v1: job.id,
      infohash_v2: '',
      name: job.name,
    });
  });

  r.all('/torrents/files', (req, res) => {
    const job = m.find(param(req, 'hash'));
    if (!job) return void res.status(404).type('text/plain').send('Not Found');
    const files = job.files.length
      ? job.files.map((f, index) => ({
          index,
          name: f.path.split(path.sep).join('/'),
          size: f.size,
          progress: f.size ? f.downloaded / f.size : f.state === 'done' ? 1 : 0,
          priority: f.state === 'skipped' ? 0 : 1,
          is_seed: false,
          piece_range: [0, 0],
          availability: 1,
        }))
      : [];
    res.json(files);
  });

  r.all(['/torrents/trackers', '/torrents/webseeds', '/torrents/pieceStates', '/torrents/pieceHashes'], (_req, res) => res.json([]));

  r.post('/torrents/add', upload.any(), async (req, res) => {
    const opts = {
      origin: 'qbit' as const,
      category: param(req, 'category') || undefined,
      savePath: param(req, 'savepath') || undefined,
      paused: bool(req, 'paused') || bool(req, 'stopped'),
    };
    let added = 0;
    let failed = 0;
    for (const link of splitLinks(param(req, 'urls'))) {
      try {
        await m.addUrl(link, opts);
        added++;
      } catch (e) {
        failed++;
        log.warn(`qBittorrent API: could not add ${link.slice(0, 80)}: ${errMsg(e)}`);
      }
    }
    for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) {
      try {
        m.addTorrentFile(f.buffer, opts);
        added++;
      } catch (e) {
        failed++;
        log.warn(`qBittorrent API: could not add ${f.originalname}: ${errMsg(e)}`);
      }
    }
    if (!added && failed) return void res.type('text/plain').send('Fails.');
    ok(res);
  });

  r.all('/torrents/delete', async (req, res) => {
    const deleteFiles = bool(req, 'deleteFiles');
    await m.remove(hashesOf(req), {
      fromList: true,
      fromTorbox: m.settings.removeDefaults.fromTorbox,
      deleteFiles,
    });
    ok(res);
  });

  r.all(['/torrents/pause', '/torrents/stop'], (req, res) => {
    m.pause(hashesOf(req));
    ok(res);
  });
  r.all(['/torrents/resume', '/torrents/start'], (req, res) => {
    m.resume(hashesOf(req));
    ok(res);
  });
  r.all('/torrents/recheck', (req, res) => {
    m.retry(hashesOf(req));
    ok(res);
  });
  r.all(['/torrents/topPrio', '/torrents/increasePrio'], (req, res) => {
    m.prioritize(hashesOf(req), 'top');
    ok(res);
  });
  r.all(['/torrents/bottomPrio', '/torrents/decreasePrio'], (req, res) => {
    m.prioritize(hashesOf(req), 'bottom');
    ok(res);
  });
  r.all('/torrents/setCategory', (req, res) => {
    const name = param(req, 'category');
    const tag = name ? m.tagByCategory(name, true) : null;
    m.setTag(hashesOf(req), tag?.id ?? null);
    ok(res);
  });
  r.all('/torrents/categories', (_req, res) => res.json(categories()));
  r.all(['/torrents/createCategory', '/torrents/editCategory'], (req, res) => {
    const name = param(req, 'category').trim();
    if (!name) return void res.status(400).type('text/plain').send('Invalid category name');
    const tag = m.tagByCategory(name, true)!;
    const savePath = param(req, 'savePath').trim();
    if (savePath) {
      const folder = m.store.data.folders.find((f) => path.resolve(savePath).startsWith(path.resolve(f.path)));
      if (folder) {
        tag.folderId = folder.id;
        tag.subfolder = path.relative(folder.path, path.resolve(savePath));
        m.store.save();
      }
    }
    ok(res);
  });
  r.all('/torrents/removeCategories', (req, res) => {
    const names = param(req, 'categories')
      .split(/\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const removed = m.store.data.tags.filter((t) => names.includes(t.name.toLowerCase()));
    m.store.data.tags = m.store.data.tags.filter((t) => !removed.includes(t));
    for (const j of m.jobs) if (removed.some((t) => t.id === j.tagId)) j.tagId = null;
    m.store.save();
    ok(res);
  });
  r.all('/torrents/tags', (_req, res) => res.json([]));
  r.all(
    [
      '/torrents/addTags',
      '/torrents/removeTags',
      '/torrents/createTags',
      '/torrents/deleteTags',
      '/torrents/setShareLimits',
      '/torrents/setForceStart',
      '/torrents/setSuperSeeding',
      '/torrents/setAutoManagement',
      '/torrents/toggleSequentialDownload',
      '/torrents/toggleFirstLastPiecePrio',
      '/torrents/setDownloadLimit',
      '/torrents/setUploadLimit',
      '/torrents/reannounce',
      '/torrents/setLocation',
      '/torrents/rename',
      '/torrents/filePrio',
    ],
    (_req, res) => ok(res),
  );

  // ── sync ──
  r.all('/sync/maindata', (req, res) => {
    const torrents: Record<string, ReturnType<typeof toQbit>> = {};
    for (const j of m.jobs) torrents[j.id] = toQbit(j, m.settings.globalPaused);
    res.json({
      rid: (Number(param(req, 'rid')) || 0) + 1,
      full_update: true,
      torrents,
      categories: categories(),
      tags: [],
      server_state: { ...transferInfo(), free_space_on_disk: 0 },
    });
  });

  r.use((_req, res) => {
    res.status(404).type('text/plain').send('Not Found');
  });

  return r;
}

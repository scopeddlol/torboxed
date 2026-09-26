import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import multer from 'multer';
import type { AddResult, Folder, FolderInfo, Settings, SystemInfo, Tag } from '../shared/types';
import { THEMES } from '../shared/themes';
import type { Manager, AddOptions } from './manager';
import { TAG_COLORS } from './manager';
import { browse, diskSpace, safeRelative } from './fsutil';
import { errMsg, log } from './log';
import { splitLinks, TorrentParseError } from './torrent';
import { TorBoxError } from './torbox';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Validate a settings patch against the current settings. Unknown keys are ignored. */
export function applySettingsPatch(cur: Settings, patch: Record<string, unknown>, folders: Folder[]): Settings {
  const next: Settings = structuredClone(cur);
  const p = patch ?? {};
  const bool = (k: keyof Settings) => {
    if (typeof p[k] === 'boolean') (next[k] as boolean) = p[k] as boolean;
  };
  if (typeof p.torboxApiKey === 'string') next.torboxApiKey = p.torboxApiKey.trim();
  if (p.port !== undefined) next.port = Math.round(num(p.port, 1, 65535, cur.port));
  if (p.pollIntervalSec !== undefined) next.pollIntervalSec = Math.round(num(p.pollIntervalSec, 2, 300, cur.pollIntervalSec));
  if (p.maxConcurrentDownloads !== undefined)
    next.maxConcurrentDownloads = Math.round(num(p.maxConcurrentDownloads, 1, 20, cur.maxConcurrentDownloads));
  if (p.retryAttempts !== undefined) next.retryAttempts = Math.round(num(p.retryAttempts, 0, 50, cur.retryAttempts));
  if (p.speedLimitKBps !== undefined) next.speedLimitKBps = Math.round(num(p.speedLimitKBps, 0, 10_000_000, cur.speedLimitKBps));
  if (p.slowModeLimitKBps !== undefined)
    next.slowModeLimitKBps = Math.round(num(p.slowModeLimitKBps, 1, 10_000_000, cur.slowModeLimitKBps));
  if (p.autoRemoveDelayMin !== undefined)
    next.autoRemoveDelayMin = Math.round(num(p.autoRemoveDelayMin, 0, 60 * 24 * 30, cur.autoRemoveDelayMin));
  for (const k of [
    'slowMode',
    'globalPaused',
    'allowZip',
    'autoRemoveFromTorbox',
    'autoRemoveFromList',
    'autoRemoveSkipArr',
    'qbitEnabled',
    'reduceMotion',
    'customContextMenu',
    'browserNotifications',
    'onboarded',
  ] as const)
    bool(k);
  if (typeof p.defaultFolderId === 'string' && folders.some((f) => f.id === p.defaultFolderId)) next.defaultFolderId = p.defaultFolderId;
  if (p.subfolderMode === 'auto' || p.subfolderMode === 'always' || p.subfolderMode === 'never') next.subfolderMode = p.subfolderMode;
  if (typeof p.skipExtensions === 'string') next.skipExtensions = p.skipExtensions.slice(0, 500);
  if (p.seedMode === 1 || p.seedMode === 2 || p.seedMode === 3) next.seedMode = p.seedMode;
  if (typeof p.theme === 'string' && THEMES.some((t) => t.id === p.theme)) next.theme = p.theme;
  if (p.accent === null || (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent))) next.accent = p.accent as string | null;
  if (p.density === 'comfortable' || p.density === 'compact') next.density = p.density;
  const rd = p.removeDefaults as Record<string, unknown> | undefined;
  if (rd && typeof rd === 'object') {
    if (typeof rd.fromTorbox === 'boolean') next.removeDefaults.fromTorbox = rd.fromTorbox;
    if (typeof rd.deleteFiles === 'boolean') next.removeDefaults.deleteFiles = rd.deleteFiles;
  }
  const d = p.desktop as Record<string, unknown> | undefined;
  if (d && typeof d === 'object') {
    for (const k of ['closeToTray', 'startMinimized', 'launchOnStartup', 'notifications', 'allowLan', 'trayHintShown'] as const) {
      if (typeof d[k] === 'boolean') next.desktop[k] = d[k] as boolean;
    }
    if (d.bounds === null || (d.bounds && typeof d.bounds === 'object')) next.desktop.bounds = d.bounds as Settings['desktop']['bounds'];
  }
  return next;
}

export interface ApiContext {
  manager: Manager;
  system: () => SystemInfo;
  onSettingsSaved?: (s: Settings, prev: Settings) => void;
}

export function apiRouter(ctx: ApiContext): Router {
  const m = ctx.manager;
  const store = m.store;
  const r = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 500 } });

  r.use(express.json({ limit: '10mb' }));

  const folderInfos = async (): Promise<FolderInfo[]> =>
    Promise.all(
      store.data.folders.map(async (f) => {
        const space = await diskSpace(f.path);
        return { ...f, free: space?.free ?? null, total: space?.total ?? null, exists: fs.existsSync(f.path) };
      }),
    );

  const saveSettings = (patch: Record<string, unknown>) => {
    const prev = store.data.settings;
    store.data.settings = applySettingsPatch(prev, patch, store.data.folders);
    m.onSettingsChanged(prev);
    store.save();
    ctx.onSettingsSaved?.(store.data.settings, prev);
    return store.data.settings;
  };

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/bootstrap', async (_req, res) => {
    res.json({
      settings: store.data.settings,
      folders: await folderInfos(),
      tags: store.data.tags,
      system: ctx.system(),
    });
  });

  r.get('/system', (_req, res) => res.json(ctx.system()));

  // ── live events (Server-Sent Events) ──
  r.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { speedHistory: m.speedHistory });
    send('tick', m.snapshot());
    const onTick = (t: unknown) => send('tick', t);
    const onNotify = (n: unknown) => send('notify', n);
    const onMeta = () => send('meta', {});
    m.on('tick', onTick);
    m.on('notify', onNotify);
    m.on('meta', onMeta);
    req.on('close', () => {
      m.off('tick', onTick);
      m.off('notify', onNotify);
      m.off('meta', onMeta);
    });
  });

  // ── jobs ──
  r.get('/jobs/:id', (req, res) => {
    const job = m.find(String(req.params.id));
    if (!job) throw new HttpError(404, 'Not found');
    res.json(job);
  });

  r.post('/jobs', upload.any(), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const folder = body.folderId ? store.data.folders.find((f) => f.id === body.folderId) : undefined;
    const opts: AddOptions = {
      origin: 'ui',
      tagId: body.tagId || null,
      savePath: body.savePath?.trim() || folder?.path || undefined,
      paused: body.paused === 'true',
    };
    if (folder && body.tagId) {
      const tag = store.data.tags.find((t) => t.id === body.tagId);
      if (tag?.subfolder) opts.savePath = path.join(folder.path, safeRelative(tag.subfolder));
    }
    const result: AddResult = { added: [], duplicates: [], errors: [] };
    for (const link of splitLinks(body.links ?? '')) {
      try {
        const o = await m.addUrl(link, opts);
        if (o.duplicate) result.duplicates.push(o.job.name);
        else result.added.push(m.summary(o.job));
      } catch (e) {
        result.errors.push({ input: link.length > 90 ? `${link.slice(0, 90)}…` : link, error: errMsg(e) });
      }
    }
    for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) {
      try {
        const o = m.addTorrentFile(f.buffer, opts);
        if (o.duplicate) result.duplicates.push(o.job.name);
        else result.added.push(m.summary(o.job));
      } catch (e) {
        result.errors.push({ input: f.originalname, error: errMsg(e) });
      }
    }
    res.json(result);
  });

  r.post('/jobs/action', (req, res) => {
    const { ids, action, tagId } = req.body as { ids: string[]; action: string; tagId?: string | null };
    if (!Array.isArray(ids)) throw new HttpError(400, 'ids must be an array');
    switch (action) {
      case 'pause':
        m.pause(ids);
        break;
      case 'resume':
        m.resume(ids);
        break;
      case 'retry':
        m.retry(ids);
        break;
      case 'top':
      case 'bottom':
        m.prioritize(ids, action);
        break;
      case 'tag':
        m.setTag(ids, tagId ?? null);
        break;
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
    res.json({ ok: true });
  });

  r.post('/jobs/remove', async (req, res) => {
    const b = req.body as { ids: string[]; fromList?: boolean; fromTorbox?: boolean; deleteFiles?: boolean };
    if (!Array.isArray(b.ids)) throw new HttpError(400, 'ids must be an array');
    const out = await m.remove(b.ids, {
      fromList: b.fromList !== false,
      fromTorbox: !!b.fromTorbox,
      deleteFiles: !!b.deleteFiles,
    });
    res.json(out);
  });

  r.post('/jobs/clear', async (req, res) => {
    const status = (req.body?.status as string) || 'completed';
    const ids = m.jobs.filter((j) => j.status === status).map((j) => j.id);
    await m.remove(ids, { fromList: true, fromTorbox: false, deleteFiles: false });
    res.json({ removed: ids.length });
  });

  r.post('/control', (req, res) => {
    const b = req.body as { globalPaused?: boolean; slowMode?: boolean };
    if (typeof b.globalPaused === 'boolean') m.setGlobalPaused(b.globalPaused);
    if (typeof b.slowMode === 'boolean') m.setSlowMode(b.slowMode);
    res.json(m.snapshot());
  });

  // ── settings ──
  r.get('/settings', (_req, res) => res.json(store.data.settings));
  r.put('/settings', (req, res) => res.json(saveSettings(req.body ?? {})));

  // ── TorBox ──
  r.post('/torbox/test', async (req, res) => {
    const key = String(req.body?.apiKey ?? '').trim();
    res.json(await m.torbox.account(key || undefined));
  });
  r.get('/torbox/account', async (req, res) => res.json(await m.account(req.query.force === '1')));
  r.get('/torbox/cloud', async (req, res) => res.json(await m.cloud(req.query.force === '1')));
  r.post('/torbox/cloud/:id/download', async (req, res) => {
    const folder = req.body?.folderId ? store.data.folders.find((f) => f.id === req.body.folderId) : undefined;
    const o = await m.addFromCloud(Number(req.params.id), {
      origin: 'cloud',
      tagId: req.body?.tagId || null,
      savePath: folder?.path,
    });
    res.json({ job: m.summary(o.job), duplicate: o.duplicate });
  });
  r.delete('/torbox/cloud/:id', async (req, res) => {
    await m.cloudDelete(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── folders ──
  r.get('/folders', async (_req, res) => res.json(await folderInfos()));
  const validFolder = (b: Record<string, unknown>) => {
    const name = String(b.name ?? '').trim();
    const p = String(b.path ?? '').trim();
    if (!name) throw new HttpError(400, 'Give the folder a name');
    if (!p || !path.isAbsolute(p)) throw new HttpError(400, 'The folder path must be absolute');
    try {
      fs.mkdirSync(p, { recursive: true });
    } catch (e) {
      throw new HttpError(400, `Could not create the folder: ${errMsg(e)}`);
    }
    return { name: name.slice(0, 60), path: path.resolve(p) };
  };
  r.post('/folders', async (req, res) => {
    const f: Folder = { id: randomBytes(6).toString('hex'), ...validFolder(req.body ?? {}) };
    store.data.folders.push(f);
    store.save();
    res.json(f);
  });
  r.put('/folders/:id', async (req, res) => {
    const f = store.data.folders.find((x) => x.id === req.params.id);
    if (!f) throw new HttpError(404, 'Folder not found');
    Object.assign(f, validFolder(req.body ?? {}));
    store.save();
    res.json(f);
  });
  r.delete('/folders/:id', (req, res) => {
    const id = String(req.params.id);
    if (store.data.folders.length <= 1) throw new HttpError(400, 'You need at least one download folder');
    store.data.folders = store.data.folders.filter((f) => f.id !== id);
    const fallback = store.data.folders[0].id;
    if (store.data.settings.defaultFolderId === id) store.data.settings.defaultFolderId = fallback;
    for (const t of store.data.tags) if (t.folderId === id) t.folderId = store.data.settings.defaultFolderId;
    store.save();
    res.json({ ok: true });
  });

  // ── tags ──
  r.get('/tags', (_req, res) => res.json(store.data.tags));
  const validTag = (b: Record<string, unknown>, selfId?: string) => {
    const name = String(b.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Give the tag a name');
    if (store.data.tags.some((t) => t.id !== selfId && t.name.toLowerCase() === name.toLowerCase()))
      throw new HttpError(400, 'A tag with that name already exists');
    const folderId = String(b.folderId ?? store.data.settings.defaultFolderId);
    if (!store.data.folders.some((f) => f.id === folderId)) throw new HttpError(400, 'Unknown folder');
    const color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : TAG_COLORS[0];
    return { name: name.slice(0, 40), folderId, color, subfolder: safeRelative(String(b.subfolder ?? '')) };
  };
  r.post('/tags', (req, res) => {
    const t: Tag = { id: randomBytes(6).toString('hex'), ...validTag(req.body ?? {}) };
    store.data.tags.push(t);
    store.save();
    res.json(t);
  });
  r.put('/tags/:id', (req, res) => {
    const t = store.data.tags.find((x) => x.id === req.params.id);
    if (!t) throw new HttpError(404, 'Tag not found');
    Object.assign(t, validTag(req.body ?? {}, t.id));
    for (const j of m.jobs) if (j.tagId === t.id) j.category = t.name;
    store.save();
    res.json(t);
  });
  r.delete('/tags/:id', (req, res) => {
    const id = String(req.params.id);
    store.data.tags = store.data.tags.filter((t) => t.id !== id);
    for (const j of m.jobs) if (j.tagId === id) j.tagId = null;
    store.save();
    res.json({ ok: true });
  });

  // ── filesystem ──
  r.get('/fs/browse', async (req, res) => {
    res.json(await browse(req.query.path as string | undefined, m.defaultFolder().path));
  });
  r.post('/fs/mkdir', async (req, res) => {
    const p = String(req.body?.path ?? '');
    if (!path.isAbsolute(p)) throw new HttpError(400, 'Path must be absolute');
    await fs.promises.mkdir(p, { recursive: true });
    res.json({ ok: true, path: path.resolve(p) });
  });

  // ── analytics & logs ──
  r.get('/analytics', async (req, res) => {
    const days = num(req.query.days, 1, 400, 30);
    res.json(m.stats.analytics(days, m.jobs, await folderInfos()));
  });
  r.post('/analytics/reset', (_req, res) => {
    m.stats.reset();
    store.save();
    res.json({ ok: true });
  });
  r.get('/logs', (_req, res) => res.json(log.list()));
  r.delete('/logs', (_req, res) => {
    log.clear();
    res.json({ ok: true });
  });

  // ── backup ──
  r.get('/backup', (req, res) => {
    const includeKey = req.query.includeKey === '1';
    const settings = { ...store.data.settings, desktop: { ...store.data.settings.desktop, bounds: null } };
    if (!includeKey) settings.torboxApiKey = '';
    res.setHeader('Content-Disposition', `attachment; filename="torboxed-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ app: 'torboxed', version: 1, exportedAt: new Date().toISOString(), settings, folders: store.data.folders, tags: store.data.tags });
  });
  r.post('/backup/restore', (req, res) => {
    const b = req.body as { app?: string; settings?: Record<string, unknown>; folders?: Folder[]; tags?: Tag[] };
    if (b?.app !== 'torboxed') throw new HttpError(400, 'This is not a Torboxed backup file');
    if (Array.isArray(b.folders) && b.folders.length) {
      store.data.folders = b.folders
        .filter((f) => f && typeof f.id === 'string' && typeof f.path === 'string')
        .map((f) => ({ id: f.id, name: String(f.name || 'Folder'), path: f.path }));
    }
    if (Array.isArray(b.tags)) {
      store.data.tags = b.tags
        .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string')
        .map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color || TAG_COLORS[0],
          folderId: store.data.folders.some((f) => f.id === t.folderId) ? t.folderId : store.data.folders[0].id,
          subfolder: safeRelative(t.subfolder || ''),
        }));
    }
    const patch = { ...(b.settings ?? {}) };
    if (!patch.torboxApiKey) delete patch.torboxApiKey;
    saveSettings(patch);
    res.json({ ok: true });
  });

  r.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    if (err instanceof HttpError) status = err.status;
    else if (err instanceof TorrentParseError) status = 400;
    else if (err instanceof TorBoxError) status = err.status >= 400 && err.status < 600 ? err.status : 502;
    if (status >= 500 && !(err instanceof TorBoxError)) log.error(`API error: ${errMsg(err)}`);
    res.status(status).json({ error: errMsg(err) });
  });

  return r;
}

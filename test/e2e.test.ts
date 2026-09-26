import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from '../src/server/index';
import { startFakeTorBox, type FakeTorBox } from './fake-torbox';
import { makeTorrent } from './helpers';

let tb: FakeTorBox;
let srv: ServerHandle;
let tmp: string;
let base: string;

const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, timeout = 15_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 200));
  }
};

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(base + url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
};

beforeAll(async () => {
  tb = await startFakeTorBox({ readyAfterPolls: 1 });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'torboxed-test-'));
  srv = await startServer({
    dataDir: path.join(tmp, 'data'),
    defaultDownloadDir: path.join(tmp, 'downloads'),
    port: 0,
    host: '127.0.0.1',
    torboxBaseUrl: tb.url,
    webDir: path.join(tmp, 'no-web'),
  });
  base = srv.url;
  await json('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ torboxApiKey: 'test-key', pollIntervalSec: 2, skipExtensions: 'nfo' }),
  });
});

afterAll(async () => {
  await srv?.close();
  await tb?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('end to end', () => {
  it('verifies the TorBox key', async () => {
    const acct = await json('/api/torbox/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'test-key' }),
    });
    expect(acct.email).toBe('test@example.com');
    expect(acct.planName).toBe('Pro');
  });

  it('speaks enough qBittorrent for Sonarr', async () => {
    const login = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=admin&password=whatever',
    });
    expect(await login.text()).toBe('Ok.');
    expect(login.headers.get('set-cookie')).toMatch(/SID=/);
    expect(await (await fetch(`${base}/api/v2/app/webapiVersion`)).text()).toBe('2.9.3');
    const prefs = await (await fetch(`${base}/api/v2/app/preferences`)).json();
    expect(prefs.max_ratio_enabled).toBe(true);
    const created = await fetch(`${base}/api/v2/torrents/createCategory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'category=tv-sonarr&savePath=',
    });
    expect(await created.text()).toBe('Ok.');
    const cats = await (await fetch(`${base}/api/v2/torrents/categories`)).json();
    expect(cats['tv-sonarr'].savePath).toBe(path.join(tmp, 'downloads', 'tv-sonarr'));
  });

  it('downloads a magnet added through the qBittorrent API', async () => {
    const hash = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=Show.S01E01`;
    const add = await fetch(`${base}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ urls: magnet, category: 'tv-sonarr' }).toString(),
    });
    expect(await add.text()).toBe('Ok.');

    const info = await waitFor(async () => {
      const list = await (await fetch(`${base}/api/v2/torrents/info?category=tv-sonarr`)).json();
      const t = list.find((x: { hash: string }) => x.hash === hash);
      return t?.state === 'pausedUP' ? t : null;
    });
    expect(info.progress).toBe(1);
    expect(info.save_path).toBe(path.join(tmp, 'downloads', 'tv-sonarr'));
    expect(info.content_path).toBe(path.join(tmp, 'downloads', 'tv-sonarr', 'Show.S01E01'));

    const video = path.join(info.content_path, 'Show.S01E01.mkv');
    const fake = [...tb.torrents.values()].find((t) => t.hash === hash)!;
    expect(fs.readFileSync(video).equals(fake.files[0].data)).toBe(true);
    // .nfo was skipped via skipExtensions
    expect(fs.existsSync(path.join(info.content_path, 'info.nfo'))).toBe(false);

    const files = await (await fetch(`${base}/api/v2/torrents/files?hash=${hash}`)).json();
    expect(files).toHaveLength(2);

    // Sonarr removes the torrent (and data) after import.
    const del = await fetch(`${base}/api/v2/torrents/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}&deleteFiles=true`,
    });
    expect(await del.text()).toBe('Ok.');
    expect(fs.existsSync(video)).toBe(false);
    expect(fs.existsSync(info.content_path)).toBe(false);
    expect(tb.deleted).toContain(fake.id);
    const after = await (await fetch(`${base}/api/v2/torrents/info`)).json();
    expect(after.find((x: { hash: string }) => x.hash === hash)).toBeUndefined();
  });

  it('downloads .torrent uploads from the UI into a tag folder and records analytics', async () => {
    const tag = await json('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Movies', color: '#ff0088', subfolder: 'Movies' }),
    });
    const form = new FormData();
    form.set('tagId', tag.id);
    form.append('torrents', new Blob([new Uint8Array(makeTorrent('Big Movie', [{ path: ['movie.mkv'], length: 300000 }]))]), 'a.torrent');
    form.append('torrents', new Blob([new Uint8Array(Buffer.from('not a torrent'))]), 'bad.torrent');
    const res = await json('/api/jobs', { method: 'POST', body: form });
    expect(res.added).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    const id = res.added[0].id;

    const job = await waitFor(async () => {
      const j = await json(`/api/jobs/${id}`);
      return j.status === 'completed' ? j : null;
    });
    expect(job.savePath).toBe(path.join(tmp, 'downloads', 'Movies'));
    expect(fs.existsSync(path.join(job.savePath, 'Big Movie', 'Big Movie.mkv'))).toBe(true);

    const stats = await json('/api/analytics?days=7');
    expect(stats.totals.completed).toBeGreaterThanOrEqual(2);
    expect(stats.totals.bytes).toBeGreaterThanOrEqual(600000);
    expect(stats.history[0].tag).toBe('Movies');
  });

  it('pauses and resumes globally', async () => {
    const t = await json('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globalPaused: true, slowMode: true }),
    });
    expect(t.globalPaused).toBe(true);
    expect(t.slowMode).toBe(true);
    expect(t.limit).toBe(2048 * 1024);
    const back = await json('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globalPaused: false, slowMode: false }),
    });
    expect(back.globalPaused).toBe(false);
    expect(back.limit).toBe(0);
  });
});

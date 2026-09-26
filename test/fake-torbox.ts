// A tiny fake of the TorBox API + CDN, used by the end-to-end tests.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { parseMagnet, parseTorrent } from '../src/server/torrent';

interface FakeFile {
  id: number;
  name: string;
  size: number;
  data: Buffer;
}
interface FakeTorrent {
  id: number;
  hash: string;
  name: string;
  files: FakeFile[];
  polls: number;
  /** When set, the torrent stays "downloading" on TorBox at this progress. */
  pending?: { progress: number; speed: number; seeds: number };
  createdAt?: string;
}

export interface FakeTorBox {
  url: string;
  torrents: Map<number, FakeTorrent>;
  deleted: number[];
  close: () => Promise<void>;
}

export async function startFakeTorBox(opts: { readyAfterPolls?: number } = {}): Promise<FakeTorBox> {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });
  const torrents = new Map<number, FakeTorrent>();
  const deleted: number[] = [];
  let nextId = 100;
  let base = '';

  const auth: express.RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== 'Bearer test-key' && req.query.token !== 'test-key') {
      res.status(403).json({ success: false, error: 'BAD_TOKEN', detail: 'Invalid API key', data: null });
      return;
    }
    next();
  };

  app.get('/v1/api/user/me', auth, (_req, res) =>
    res.json({ success: true, data: { email: 'test@example.com', plan: 2, total_downloaded: 42 } }),
  );

  app.post('/v1/api/torrents/createtorrent', auth, upload.any(), (req, res) => {
    let hash: string;
    let name: string;
    const file = (req.files as Express.Multer.File[] | undefined)?.[0];
    if (file) {
      const t = parseTorrent(file.buffer);
      hash = t.infoHash;
      name = t.name;
    } else {
      const m = parseMagnet(String(req.body.magnet));
      hash = m.hash!;
      name = m.name ?? 'Unnamed';
    }
    const id = nextId++;
    const a = randomBytes(300_000);
    const b = Buffer.from('release notes');
    torrents.set(id, {
      id,
      hash,
      name,
      polls: 0,
      files: [
        { id: 0, name: `${name}/${name}.mkv`, size: a.length, data: a },
        { id: 1, name: `${name}/info.nfo`, size: b.length, data: b },
      ],
    });
    res.json({ success: true, detail: 'Found Cached Torrent. Using Cached Torrent.', data: { torrent_id: id, hash, name } });
  });

  app.get('/v1/api/torrents/mylist', auth, (_req, res) => {
    const list = [...torrents.values()].map((t) => {
      t.polls++;
      const ready = !t.pending && t.polls > (opts.readyAfterPolls ?? 0);
      return {
        id: t.id,
        hash: t.hash,
        name: t.name,
        size: t.files.reduce((a, f) => a + f.size, 0),
        progress: ready ? 1 : (t.pending?.progress ?? 0.5),
        download_speed: ready ? 0 : (t.pending?.speed ?? 1_000_000),
        upload_speed: 0,
        eta: 0,
        seeds: t.pending?.seeds ?? 10,
        created_at: t.createdAt,
        peers: 0,
        download_state: ready ? 'cached' : 'downloading',
        download_finished: ready,
        download_present: ready,
        active: !ready,
        files: t.files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      };
    });
    res.json({ success: true, data: list });
  });

  app.get('/v1/api/torrents/requestdl', auth, (req, res) => {
    res.json({ success: true, data: `${base}/cdn/${req.query.torrent_id}/${req.query.file_id}` });
  });

  app.post('/v1/api/torrents/controltorrent', auth, express.json(), (req, res) => {
    const id = Number(req.body.torrent_id);
    if (req.body.operation === 'delete') {
      torrents.delete(id);
      deleted.push(id);
    }
    res.json({ success: true, data: null });
  });

  app.get('/cdn/:tid/:fid', (req, res) => {
    const t = torrents.get(Number(req.params.tid));
    const f = t?.files.find((x) => x.id === Number(req.params.fid));
    if (!f) return void res.status(404).end();
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      if (start >= f.size) return void res.status(416).end();
      res.status(206).setHeader('Content-Range', `bytes ${start}-${f.size - 1}/${f.size}`);
      return void res.end(f.data.subarray(start));
    }
    res.end(f.data);
  });

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  return {
    url: `${base}/v1/api`,
    torrents,
    deleted,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

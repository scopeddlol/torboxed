import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import type { Settings, SystemInfo } from '../shared/types';
import { apiRouter } from './api';
import { log } from './log';
import { Manager } from './manager';
import { qbitRouter } from './qbit';
import { Stats } from './stats';
import { Store } from './store';
import { TorBoxClient, TORBOX_API } from './torbox';

declare const __APP_VERSION__: string | undefined;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export interface ServerOptions {
  dataDir: string;
  defaultDownloadDir: string;
  /** Force a port (Docker/dev). When set, the in-app port setting is shown as locked. */
  port?: number;
  defaultPort?: number;
  /** Interface to bind; defaults to 0.0.0.0 (server) or the desktop LAN setting. */
  host?: string;
  desktop?: boolean;
  docker?: boolean;
  webDir?: string;
  torboxBaseUrl?: string;
  version?: string;
  /** Set to false to serve the UI/API without running the download engine (demo mode). */
  engine?: boolean;
  onSettingsSaved?: (s: Settings, prev: Settings) => void;
}

export interface ServerHandle {
  port: number;
  url: string;
  manager: Manager;
  store: Store;
  close: () => Promise<void>;
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startServer(o: ServerOptions): Promise<ServerHandle> {
  const startedAt = Date.now();
  const version = o.version ?? APP_VERSION;
  const store = new Store(o.dataDir, o.defaultDownloadDir, o.port ?? o.defaultPort ?? 8080);
  const torbox = new TorBoxClient(() => store.settings.torboxApiKey, o.torboxBaseUrl ?? TORBOX_API);
  const stats = new Stats(store);
  const manager = new Manager(store, torbox, stats);

  let boundPort = o.port ?? store.settings.port;

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use('/api/v2', qbitRouter(manager));
  app.use(
    '/api',
    apiRouter({
      manager,
      onSettingsSaved: (s, prev) => {
        if (s.theme !== prev.theme || s.accent !== prev.accent) manager.emit('meta');
        o.onSettingsSaved?.(s, prev);
      },
      system: (): SystemInfo => ({
        version,
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        desktop: !!o.desktop,
        docker: !!o.docker,
        dataDir: o.dataDir,
        port: boundPort,
        portLocked: o.port !== undefined,
        startedAt,
      }),
    }),
  );

  const here = typeof __dirname === 'string' ? __dirname : path.join(process.cwd(), 'dist', 'server');
  const webDir = o.webDir ?? path.resolve(here, '../web');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders: (res, p) => {
          if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    const indexHtml = path.join(webDir, 'index.html');
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req, res) => res.type('text/plain').send('Torboxed API is running. Web UI not built (run `npm run build:web`).'));
  }

  const host = o.host ?? (o.desktop ? (store.settings.desktop.allowLan ? '0.0.0.0' : '127.0.0.1') : '0.0.0.0');
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;

  // Desktop: if the port is taken, walk forward until we find a free one.
  const attempts = o.desktop && o.port === undefined ? 20 : 1;
  let tryPort = boundPort;
  for (let i = 0; i < attempts; i++) {
    try {
      boundPort = await listen(server, tryPort, host);
      break;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EADDRINUSE' || i === attempts - 1) throw err;
      log.warn(`Port ${tryPort} is in use, trying ${tryPort + 1}`);
      tryPort++;
    }
  }

  if (o.engine !== false) manager.start();
  const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const url = `http://${shownHost}:${boundPort}`;
  log.info(`Torboxed ${version} listening on ${host}:${boundPort}`);
  log.info(`qBittorrent-compatible API available at ${url}/api/v2`);

  return {
    port: boundPort,
    url,
    manager,
    store,
    close: async () => {
      await manager.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

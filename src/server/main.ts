// Entry point for the self-hosted server (Docker / `npm start` / `npm run dev`).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from './index';
import { log } from './log';

const inDocker = fs.existsSync('/.dockerenv') || process.env.TORBOXED_DOCKER === '1';
const dataDir = path.resolve(process.env.TORBOXED_DATA || (inDocker ? '/config' : path.join(process.cwd(), 'data')));
const downloads = path.resolve(
  process.env.TORBOXED_DOWNLOADS || (inDocker ? '/downloads' : path.join(os.homedir(), 'Downloads', 'Torboxed')),
);
const port = process.env.TORBOXED_PORT ? Number(process.env.TORBOXED_PORT) : undefined;

/**
 * In Docker we start as root, make sure the volumes are writable, then drop to
 * PUID:PGID so downloaded files belong to the same user as Sonarr/Radarr/Plex.
 */
function dropPrivileges() {
  if (process.env.UMASK) process.umask(parseInt(process.env.UMASK, 8));
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const uid = Number(process.env.PUID ?? 0);
  const gid = Number(process.env.PGID ?? uid);
  if (!uid || !Number.isInteger(uid) || !Number.isInteger(gid)) return;
  const chownTree = (p: string) => {
    try {
      fs.lchownSync(p, uid, gid);
      if (fs.lstatSync(p).isDirectory()) for (const e of fs.readdirSync(p)) chownTree(path.join(p, e));
    } catch {
      /* best effort */
    }
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  chownTree(dataDir);
  try {
    fs.chownSync(downloads, uid, gid);
  } catch {
    /* read-only or network mounts */
  }
  process.setgroups?.([gid]);
  process.setgid!(gid);
  process.setuid!(uid);
  process.env.HOME = dataDir;
  log.info(`Running as uid ${uid} / gid ${gid}`);
}

dropPrivileges();

startServer({
  dataDir,
  defaultDownloadDir: downloads,
  port,
  docker: inDocker,
  webDir: process.env.TORBOXED_WEB,
})
  .then((srv) => {
    let closing = false;
    const shutdown = async (sig: string) => {
      if (closing) return;
      closing = true;
      log.info(`Received ${sig}, shutting down…`);
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  })
  .catch((e) => {
    console.error('Failed to start Torboxed:', e);
    process.exit(1);
  });

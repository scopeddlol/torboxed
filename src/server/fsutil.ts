import fs from 'node:fs';
import path from 'node:path';
import type { BrowseResult } from '../shared/types';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Make a single path segment safe on every OS (Windows is the strictest). */
export function sanitizeSegment(s: string): string {
  let out = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (RESERVED.test(out)) out = `_${out}`;
  if (out.length > 200) {
    const ext = path.extname(out).slice(0, 20);
    out = out.slice(0, 200 - ext.length) + ext;
  }
  return out || '_';
}

/** Turn an untrusted relative path into a safe one (no traversal, no absolute parts). */
export function safeRelative(p: string): string {
  return p
    .split(/[\\/]+/)
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map(sanitizeSegment)
    .join(path.sep);
}

export async function diskSpace(p: string): Promise<{ free: number; total: number } | null> {
  let cur = path.resolve(p);
  for (;;) {
    try {
      const s = await fs.promises.statfs(cur);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
}

export function listRoots(): string[] {
  if (process.platform !== 'win32') return ['/'];
  const roots: string[] = [];
  for (let c = 67; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    try {
      fs.accessSync(drive);
      roots.push(drive);
    } catch {
      /* not present */
    }
  }
  return roots.length ? roots : ['C:\\'];
}

export async function browse(p: string | undefined, fallback: string): Promise<BrowseResult> {
  let target = path.resolve(p && p.trim() ? p : fallback);
  try {
    const st = await fs.promises.stat(target);
    if (!st.isDirectory()) target = path.dirname(target);
  } catch {
    // Walk up to the closest existing directory.
    while (!fs.existsSync(target) && path.dirname(target) !== target) target = path.dirname(target);
  }
  let entries: { name: string; path: string }[] = [];
  try {
    const dirents = await fs.promises.readdir(target, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$'))
      .map((d) => ({ name: d.name, path: path.join(target, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch {
    entries = [];
  }
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, entries, roots: listRoots() };
}

async function rmQuiet(p: string) {
  try {
    await fs.promises.rm(p, { force: true, recursive: false });
  } catch {
    /* ignore */
  }
}

/** Delete a job's files (and partials), then prune any directories left empty. */
export async function removeContent(savePath: string, relPaths: string[]) {
  const root = path.resolve(savePath);
  const dirs = new Set<string>();
  for (const rel of relPaths) {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) continue;
    await rmQuiet(full);
    await rmQuiet(`${full}.part`);
    let d = path.dirname(full);
    while (d.startsWith(root + path.sep)) {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    try {
      const left = await fs.promises.readdir(d);
      if (left.length === 0) await fs.promises.rmdir(d);
    } catch {
      /* ignore */
    }
  }
}

export function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

import { createHash } from 'node:crypto';

// Minimal bencode decoder that also records where the top-level `info`
// dictionary lives, so we can compute the info hash exactly like a
// BitTorrent client (and exactly like Sonarr/Radarr do).

type BValue = number | Buffer | BValue[] | { [key: string]: BValue };

export interface ParsedTorrent {
  infoHash: string;
  name: string;
  size: number;
  files: { path: string; size: number }[];
}

export class TorrentParseError extends Error {}

function decode(buf: Buffer): { value: BValue; infoStart: number; infoEnd: number } {
  let pos = 0;
  let infoStart = -1;
  let infoEnd = -1;

  const fail = (msg: string): never => {
    throw new TorrentParseError(`Invalid torrent file (${msg} at byte ${pos})`);
  };

  const readBytes = (): Buffer => {
    const colon = buf.indexOf(0x3a, pos);
    if (colon === -1) fail('missing string length');
    const len = Number(buf.toString('ascii', pos, colon));
    if (!Number.isInteger(len) || len < 0) fail('bad string length');
    const start = colon + 1;
    const end = start + len;
    if (end > buf.length) fail('string past end');
    pos = end;
    return buf.subarray(start, end);
  };

  const next = (depth: number): BValue => {
    if (depth > 64) fail('nesting too deep');
    if (pos >= buf.length) fail('unexpected end');
    const c = buf[pos];
    if (c === 0x64 /* d */) {
      pos++;
      const obj: Record<string, BValue> = {};
      while (buf[pos] !== 0x65 /* e */) {
        if (pos >= buf.length) fail('unterminated dictionary');
        const key = readBytes().toString('utf8');
        const start = pos;
        obj[key] = next(depth + 1);
        if (depth === 0 && key === 'info') {
          infoStart = start;
          infoEnd = pos;
        }
      }
      pos++;
      return obj;
    }
    if (c === 0x6c /* l */) {
      pos++;
      const list: BValue[] = [];
      while (buf[pos] !== 0x65) {
        if (pos >= buf.length) fail('unterminated list');
        list.push(next(depth + 1));
      }
      pos++;
      return list;
    }
    if (c === 0x69 /* i */) {
      const end = buf.indexOf(0x65, pos);
      if (end === -1) fail('unterminated integer');
      const n = Number(buf.toString('ascii', pos + 1, end));
      if (!Number.isFinite(n)) fail('bad integer');
      pos = end + 1;
      return n;
    }
    if (c >= 0x30 && c <= 0x39) return readBytes();
    return fail(`unexpected byte 0x${c.toString(16)}`);
  };

  const value = next(0);
  return { value, infoStart, infoEnd };
}

const str = (v: BValue | undefined): string | null => (Buffer.isBuffer(v) ? v.toString('utf8') : null);

export function parseTorrent(buf: Buffer): ParsedTorrent {
  const { value, infoStart, infoEnd } = decode(buf);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    throw new TorrentParseError('Invalid torrent file (root is not a dictionary)');
  }
  const info = (value as Record<string, BValue>).info as Record<string, BValue> | undefined;
  if (!info || infoStart < 0) throw new TorrentParseError('Invalid torrent file (missing info dictionary)');

  const infoHash = createHash('sha1').update(buf.subarray(infoStart, infoEnd)).digest('hex');
  const name = str(info['name.utf-8']) ?? str(info.name) ?? infoHash;
  const files: { path: string; size: number }[] = [];
  if (Array.isArray(info.files)) {
    for (const f of info.files as Record<string, BValue>[]) {
      const parts = (f['path.utf-8'] ?? f.path) as BValue[] | undefined;
      const p = Array.isArray(parts) ? parts.map((x) => str(x) ?? '').join('/') : '';
      files.push({ path: `${name}/${p}`, size: typeof f.length === 'number' ? f.length : 0 });
    }
  } else {
    files.push({ path: name, size: typeof info.length === 'number' ? info.length : 0 });
  }
  const size = files.reduce((a, f) => a + f.size, 0);
  return { infoHash, name, size, files };
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32ToHex(input: string): string | null {
  let bits = '';
  for (const ch of input.toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v === -1) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.slice(0, 40);
}

export interface ParsedMagnet {
  hash: string | null;
  name: string | null;
  size: number | null;
}

export function isMagnet(s: string): boolean {
  return /^magnet:\?/i.test(s.trim());
}

export function parseMagnet(uri: string): ParsedMagnet {
  const trimmed = uri.trim();
  if (!isMagnet(trimmed)) throw new TorrentParseError('Not a magnet link');
  const params = new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1));
  let hash: string | null = null;
  for (const xt of params.getAll('xt')) {
    const m = /^urn:btih:([a-z0-9]+)$/i.exec(xt);
    if (!m) continue;
    const raw = m[1];
    if (/^[a-f0-9]{40}$/i.test(raw)) hash = raw.toLowerCase();
    else if (raw.length === 32) hash = base32ToHex(raw);
    if (hash) break;
  }
  const hasBtmh = params.getAll('xt').some((x) => /^urn:btmh:/i.test(x));
  if (!hash && !hasBtmh) throw new TorrentParseError('Magnet link has no BitTorrent info hash');
  const xl = Number(params.get('xl'));
  return { hash, name: params.get('dn'), size: Number.isFinite(xl) && xl > 0 ? xl : null };
}

/** Split a blob of user input into individual magnet links / URLs. */
export function splitLinks(text: string): string[] {
  return text
    .split(/[\r\n]+|\s(?=magnet:\?)|\s(?=https?:\/\/)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

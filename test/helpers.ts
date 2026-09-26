// Minimal bencode encoder for building test torrents.
type BVal = number | string | Buffer | BVal[] | { [k: string]: BVal };

export function bencode(v: BVal): Buffer {
  if (typeof v === 'number') return Buffer.from(`i${Math.trunc(v)}e`);
  if (typeof v === 'string') v = Buffer.from(v);
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(k), bencode(v[k])]), Buffer.from('e')]);
}

export function makeTorrent(name: string, files: { path: string[]; length: number }[] | null, length = 0): Buffer {
  const info: Record<string, BVal> = { name, 'piece length': 16384, pieces: Buffer.alloc(20) };
  if (files) info.files = files.map((f) => ({ path: f.path, length: f.length }));
  else info.length = length;
  return bencode({ announce: 'udp://tracker.test:80', info });
}

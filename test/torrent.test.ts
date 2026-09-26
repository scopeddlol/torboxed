import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { base32ToHex, parseMagnet, parseTorrent, splitLinks } from '../src/server/torrent';
import { safeRelative, sanitizeSegment } from '../src/server/fsutil';
import { makeTorrent } from './helpers';

describe('parseTorrent', () => {
  it('computes the info hash from the raw info dictionary', () => {
    const buf = makeTorrent('My Show S01', [
      { path: ['Episode 1.mkv'], length: 1000 },
      { path: ['Sub', 'Episode 2.mkv'], length: 2000 },
    ]);
    const t = parseTorrent(buf);
    const infoStart = buf.indexOf('4:infod') + 6;
    const expected = createHash('sha1').update(buf.subarray(infoStart, buf.length - 1)).digest('hex');
    expect(t.infoHash).toBe(expected);
    expect(t.name).toBe('My Show S01');
    expect(t.size).toBe(3000);
    expect(t.files.map((f) => f.path)).toEqual(['My Show S01/Episode 1.mkv', 'My Show S01/Sub/Episode 2.mkv']);
  });

  it('handles single-file torrents', () => {
    const t = parseTorrent(makeTorrent('movie.mkv', null, 12345));
    expect(t.size).toBe(12345);
    expect(t.files).toEqual([{ path: 'movie.mkv', size: 12345 }]);
  });

  it('rejects garbage', () => {
    expect(() => parseTorrent(Buffer.from('hello world'))).toThrow(/Invalid torrent/);
    expect(() => parseTorrent(Buffer.from('d4:spam4:eggse'))).toThrow(/missing info/);
  });
});

describe('parseMagnet', () => {
  it('reads hex hashes and names', () => {
    const m = parseMagnet('magnet:?xt=urn:btih:C12FE1C06BBA254A9DC9F519B335AA7C1367A88A&dn=Ubuntu+24.04&xl=123');
    expect(m).toEqual({ hash: 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a', name: 'Ubuntu 24.04', size: 123 });
  });

  it('reads base32 hashes', () => {
    const hex = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';
    const b32 = 'YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK';
    expect(base32ToHex(b32)).toBe(hex);
    expect(parseMagnet(`magnet:?xt=urn:btih:${b32}`).hash).toBe(hex);
  });

  it('rejects links without a hash', () => {
    expect(() => parseMagnet('magnet:?dn=nothing')).toThrow();
    expect(() => parseMagnet('https://example.com')).toThrow();
  });
});

describe('splitLinks', () => {
  it('splits by lines and by concatenated links', () => {
    const text = 'magnet:?xt=urn:btih:aaa\n\n  magnet:?xt=urn:btih:bbb magnet:?xt=urn:btih:ccc\r\nhttps://x.test/a.torrent';
    expect(splitLinks(text)).toEqual([
      'magnet:?xt=urn:btih:aaa',
      'magnet:?xt=urn:btih:bbb',
      'magnet:?xt=urn:btih:ccc',
      'https://x.test/a.torrent',
    ]);
  });
});

describe('path safety', () => {
  it('sanitizes Windows-hostile names', () => {
    expect(sanitizeSegment('What? A "Movie": Part 1*')).toBe('What_ A _Movie__ Part 1_');
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('trailing. ')).toBe('trailing');
  });
  it('blocks traversal', () => {
    expect(safeRelative('../../etc/passwd').split(/[\\/]/)).toEqual(['etc', 'passwd']);
    expect(safeRelative('/abs/./x')).toBe(['abs', 'x'].join(path.sep));
  });
});

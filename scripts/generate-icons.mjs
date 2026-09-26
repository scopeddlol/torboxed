// Generates every icon the app needs from the SVG sources in /branding.
//   npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = fs.readFileSync(path.join(root, 'branding/logo.svg'), 'utf8');
const tray = fs.readFileSync(path.join(root, 'branding/tray.svg'), 'utf8');

const out = {
  build: path.join(root, 'build'),
  web: path.join(root, 'src/web/public'),
  desktop: path.join(root, 'src/desktop/assets'),
};
for (const d of Object.values(out)) fs.mkdirSync(d, { recursive: true });

const png = (svg, size) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

/** Pack PNG images into a Windows .ico container. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const write = (file, data) => {
  fs.writeFileSync(file, data);
  console.log('  ✓', path.relative(root, file));
};

// Small sizes use the simplified tray glyph so they stay crisp.
const iconFor = (size) => png(size <= 32 ? tray : logo, size);

console.log('App icons');
write(path.join(out.build, 'icon.png'), png(logo, 1024));
write(path.join(out.build, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: iconFor(size) }))));

console.log('Web icons');
write(path.join(out.web, 'favicon.svg'), logo);
write(path.join(out.web, 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, data: iconFor(size) }))));
write(path.join(out.web, 'favicon-32.png'), iconFor(32));
write(path.join(out.web, 'apple-touch-icon.png'), png(logo, 180));
write(path.join(out.web, 'icon-192.png'), png(logo, 192));
write(path.join(out.web, 'icon-512.png'), png(logo, 512));
const maskable = logo.replace(/<rect x="16" y="16" width="480" height="480" rx="116"/g, '<rect x="0" y="0" width="512" height="512" rx="0"');
write(path.join(out.web, 'icon-maskable-512.png'), png(maskable, 512));

console.log('Desktop / tray icons');
write(path.join(out.desktop, 'icon.png'), png(logo, 256));
const badges = {
  idle: '',
  active: `<circle cx="50" cy="50" r="13" fill="#0b0d17"/><circle cx="50" cy="50" r="10" fill="#34D399"/>`,
  paused: `<circle cx="50" cy="50" r="14" fill="#0b0d17"/><circle cx="50" cy="50" r="11" fill="#F59E0B"/><rect x="45" y="44" width="3.6" height="12" rx="1" fill="#0b0d17"/><rect x="51.4" y="44" width="3.6" height="12" rx="1" fill="#0b0d17"/>`,
  slow: `<circle cx="50" cy="50" r="14" fill="#0b0d17"/><circle cx="50" cy="50" r="11" fill="#38BDF8"/><path d="M44 53 Q47 46 50 50 T56 47" stroke="#0b0d17" stroke-width="3" fill="none" stroke-linecap="round"/>`,
};
for (const [name, badge] of Object.entries(badges)) {
  const svg = tray.replace('<!--BADGE-->', badge);
  write(path.join(out.desktop, `tray-${name}.png`), png(svg, 32));
  write(path.join(out.desktop, `tray-${name}@2x.png`), png(svg, 64));
  write(path.join(out.desktop, `tray-${name}.ico`), ico([16, 20, 24, 32, 48].map((size) => ({ size, data: png(svg, size) }))));
}
console.log('Done.');

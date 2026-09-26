// Bundles the server (for Docker / `npm start`) and the Electron main + preload
// scripts into self-contained CommonJS files — no node_modules needed at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  absWorkingDir: root,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
};

await build({ ...common, entryPoints: ['src/server/main.ts'], outfile: 'dist/server/index.cjs' });
await build({ ...common, entryPoints: ['src/desktop/main.ts'], outfile: 'dist/desktop/main.cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/desktop/preload.ts'], outfile: 'dist/desktop/preload.cjs', external: ['electron'] });

fs.cpSync(path.join(root, 'src/desktop/assets'), path.join(root, 'dist/desktop/assets'), { recursive: true });
console.log('✓ Build complete');

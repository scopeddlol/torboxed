// Regenerates the README screenshots from the demo data.
//   npm run build:web && npm run screenshots
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startDemo } from './demo';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// Pretend to be the desktop app so the custom title bar renders.
const DESKTOP_STUB = `
  window.torboxed = {
    isDesktop: true, platform: 'win32',
    window: { minimize(){}, toggleMaximize(){}, toggleFullScreen(){}, close(){}, quit(){},
      getState: async () => ({ maximized: false, fullscreen: false, focused: true }), onState: () => () => {} },
    clipboard: { readText: async () => '', writeText: async () => {} },
    shell: { openPath: async () => '', showItemInFolder: async () => {}, openExternal: async () => {} },
    dialog: { pickFolder: async () => null },
    app: { relaunch(){}, setThemeColors(){}, reload(){}, toggleDevTools(){} },
    onNavigate: () => () => {}, onCommand: () => () => {},
  };`;

async function main() {
  const demo = await startDemo(8091, process.env.DEMO_MEDIA_ROOT);
  const browser = await chromium.launch({ executablePath });
  const shot = async (name: string, fn: (p: Page) => Promise<void>, opts: { w?: number; h?: number; desktop?: boolean; theme?: string } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1480, height: opts.h ?? 920 }, deviceScaleFactor: 2 });
    if (opts.desktop) await ctx.addInitScript(DESKTOP_STUB);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`  ! ${name}: ${e.message}`));
    await page.goto(`${demo.url}/#/downloads`);
    await page.waitForSelector('.shell');
    if (opts.theme) {
      await page.evaluate((t) => fetch('api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: t }) }), opts.theme);
      await page.reload();
      await page.waitForSelector('.shell');
    }
    await fn(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    if (opts.theme) {
      await page.evaluate(() => fetch('api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'aurora' }) }));
    }
    await ctx.close();
    console.log(`  ✓ ${name}.png`);
  };
  const go = (hash: string) => async (p: Page) => {
    await p.evaluate((h) => (location.hash = h), hash);
    await p.waitForTimeout(1500);
  };

  await shot('desktop', go('#/downloads'), { desktop: true });
  await shot('downloads', go('#/downloads'));
  await shot(
    'context-menu',
    async (p) => {
      const row = p.locator('.job').nth(1);
      const box = (await row.boundingBox())!;
      await p.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2, { button: 'right' });
      await p.waitForTimeout(300);
      await p.locator('.ctx-item', { hasText: /^Tag/ }).hover();
      await p.waitForTimeout(500);
    },
    { desktop: true },
  );
  await shot('add-torrents', async (p) => {
    await p.keyboard.press('Control+n');
    await p.fill(
      '.modal textarea',
      [
        'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel',
        'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny',
        'magnet:?xt=urn:btih:209c8226b299b308beaf2b9cd3fb49212dbd13ec&dn=Tears+of+Steel',
        'https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.iso.torrent',
      ].join('\n'),
    );
    await p.selectOption('.modal select >> nth=0', { label: 'Movies' });
  });
  await shot('details', async (p) => {
    await p.locator('.job-name').first().click();
    await p.waitForTimeout(1200);
  });
  await shot('analytics', go('#/analytics'), { h: 1640 });
  await shot('cloud', go('#/cloud'));
  await shot('tags-folders', go('#/organize'));
  await shot('settings-appearance', go('#/settings/appearance'), { h: 1180 });
  await shot('settings-integrations', go('#/settings/integrations'), { h: 1080 });
  await shot('settings-automation', go('#/settings/automation'));
  for (const theme of ['daylight', 'nord', 'dracula', 'sunset', 'oled', 'latte']) {
    await shot(`theme-${theme}`, go('#/downloads'), { theme });
  }

  // Banner for the README.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 420 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const logo = fs.readFileSync('branding/logo.svg', 'base64');
  const font = fs.readFileSync(createRequire(import.meta.url).resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
    body { margin:0; width:1280px; height:420px; font-family: Inter; color:#eef0ff; overflow:hidden;
      background: radial-gradient(700px 400px at 10% 0%, rgba(139,92,246,.45), transparent 70%),
                  radial-gradient(700px 400px at 100% 100%, rgba(6,182,212,.35), transparent 70%), #0b0d17; display:flex; align-items:center; gap:56px; padding: 0 96px; box-sizing:border-box; }
    img { width: 220px; height: 220px; filter: drop-shadow(0 30px 60px rgba(139,92,246,.55)); }
    h1 { margin:0; font-size: 104px; letter-spacing: -0.045em; font-weight: 800; line-height: 1;
      background: linear-gradient(110deg, #fff 35%, #c4b5fd 65%, #67e8f9); -webkit-background-clip:text; color: transparent; }
    p { margin: 18px 0 26px; font-size: 27px; color:#a9afd0; font-weight: 500; letter-spacing: -0.01em; }
    .chips { display:flex; gap:10px; }
    .chip { font-size: 16px; font-weight:600; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
  </style></head><body>
    <img src="data:image/svg+xml;base64,${logo}">
    <div><h1>Torboxed</h1><p>The beautiful self-hosted downloader for TorBox.</p>
    <div class="chips"><span class="chip">⚡ Instant cloud downloads</span><span class="chip">📺 Sonarr &amp; Radarr</span><span class="chip">🐳 Docker</span><span class="chip">🪟 Windows</span></div></div>
  </body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.resolve('docs/banner.png') });
  await ctx.close();
  console.log('  ✓ banner.png');

  await browser.close();
  await demo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

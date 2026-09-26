// Electron main process: runs the Torboxed server in-process and wraps the
// web UI in a frameless window with a custom title bar and a system tray.
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { startServer, type ServerHandle } from '../server/index';
import { log, errMsg } from '../server/log';
import { getTheme } from '../shared/themes';
import type { NotifyEvent, Settings, Tick } from '../shared/types';
import { formatSpeed } from '../web/lib/format';

const ASSETS = path.join(__dirname, 'assets');
const DESKTOP_PORT = 8765;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ServerHandle | null = null;
let quitting = false;
let lastTick: Tick | null = null;
let trayKey = '';
let trayState = '';
let trayMenuAt = 0;
const startHidden = process.argv.includes('--hidden');

const settings = (): Settings => server!.store.data.settings;
const icon = (name: string) => nativeImage.createFromPath(path.join(ASSETS, name));

app.setAppUserModelId('app.torboxed.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    void handleArgs(argv);
  });
  app.whenReady().then(boot);
}

async function boot() {
  Menu.setApplicationMenu(null);
  try {
    server = await startServer({
      dataDir: app.getPath('userData'),
      defaultDownloadDir: path.join(app.getPath('downloads'), 'Torboxed'),
      defaultPort: DESKTOP_PORT,
      desktop: true,
      webDir: path.join(__dirname, '..', 'web'),
      version: app.getVersion(),
      onSettingsSaved: onSettingsSaved,
    });
  } catch (e) {
    dialog.showErrorBox('Torboxed could not start', errMsg(e));
    app.exit(1);
    return;
  }
  applyLoginItem(settings().desktop.launchOnStartup);
  createWindow();
  createTray();
  server.manager.on('tick', onTick);
  server.manager.on('notify', onNotify);
  registerIpc();
  void handleArgs(process.argv);
}

/* ─────────────────────────── Window ─────────────────────────── */

function windowState() {
  return {
    maximized: !!win?.isMaximized(),
    fullscreen: !!win?.isFullScreen(),
    focused: !!win?.isFocused(),
  };
}

function visibleBounds(b: Settings['desktop']['bounds']) {
  if (!b || b.x === undefined || b.y === undefined) return b;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! + 100 > a.x && b.y! + 50 > a.y && b.x! < a.x + a.width - 100 && b.y! < a.y + a.height - 50;
  });
  return onScreen ? b : { width: b.width, height: b.height, maximized: b.maximized };
}

let boundsTimer: NodeJS.Timeout | null = null;
function saveBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  const nb = win.getNormalBounds();
  settings().desktop.bounds = { ...nb, maximized: win.isMaximized() };
  server!.store.save();
}

function createWindow() {
  const s = settings();
  const theme = getTheme(s.theme);
  const b = visibleBounds(s.desktop.bounds);
  win = new BrowserWindow({
    width: b?.width ?? 1400,
    height: b?.height ?? 900,
    x: b?.x,
    y: b?.y,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    title: 'Torboxed',
    backgroundColor: theme.colors.bg,
    icon: icon(process.platform === 'win32' ? 'tray-idle.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (b?.maximized) win.maximize();
  void win.loadURL(server!.url);

  win.once('ready-to-show', () => {
    if (!(startHidden || s.desktop.startMinimized)) win?.show();
  });

  const sendState = () => win && !win.isDestroyed() && win.webContents.send('win:state', windowState());
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'restore'] as const) {
    win.on(ev as 'maximize', sendState);
  }
  const debounced = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 600);
  };
  win.on('resize', debounced);
  win.on('move', debounced);

  win.on('close', (e) => {
    saveBounds();
    if (!quitting && settings().desktop.closeToTray) {
      e.preventDefault();
      win?.hide();
      if (!settings().desktop.trayHintShown) {
        settings().desktop.trayHintShown = true;
        server!.store.save();
        notify('Torboxed is still running', 'Downloads continue in the background. Right-click the tray icon for options or to quit.');
      }
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server!.url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  // Block Ctrl+Shift+I etc. in production builds, allow F12 via context.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i' && app.isPackaged) e.preventDefault();
  });
}

function showWindow(page?: string) {
  if (!win) createWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (page) win.webContents.send('app:navigate', page);
}

/* ─────────────────────────── Tray ─────────────────────────── */

function trayIcon(state: string) {
  if (process.platform === 'win32') return icon(`tray-${state}.ico`);
  const img = icon(`tray-${state}.png`);
  const hi = path.join(ASSETS, `tray-${state}@2x.png`);
  if (fs.existsSync(hi)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(hi) });
  return img;
}

function createTray() {
  tray = new Tray(trayIcon('idle'));
  tray.setToolTip('Torboxed');
  tray.on('click', () => {
    if (win?.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
  tray.on('double-click', () => showWindow());
  buildTrayMenu();
}

async function clipboardMagnets(): Promise<string | null> {
  const text = String(await clipboard.readText()).trim();
  return /magnet:\?/i.test(text) ? text : null;
}

async function addTorrentFiles() {
  const res = await dialog.showOpenDialog({
    title: 'Add torrent files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Torrent files', extensions: ['torrent'] }],
  });
  if (!res.canceled) await handleArgs(res.filePaths);
}

function buildTrayMenu() {
  if (!tray || !server) return;
  const s = settings();
  const t = lastTick;
  const active = t?.jobs.filter((j) => j.status === 'downloading').length ?? 0;
  const cloud = t?.jobs.filter((j) => j.status === 'torbox' || j.status === 'submitting' || j.status === 'queued').length ?? 0;
  const status = s.globalPaused
    ? 'All downloads paused'
    : active
      ? `↓ ${formatSpeed(t?.speed ?? 0)} · ${active} downloading`
      : cloud
        ? `${cloud} waiting on TorBox`
        : 'Idle — nothing downloading';
  const go = (page: string) => () => showWindow(page);
  const template: MenuItemConstructorOptions[] = [
    { label: 'Torboxed', enabled: false, icon: icon('tray-idle.png').resize({ width: 16, height: 16 }) },
    { label: status, enabled: false },
    ...(cloud && active ? [{ label: `${cloud} waiting on TorBox`, enabled: false } as MenuItemConstructorOptions] : []),
    { type: 'separator' },
    { label: 'Open Torboxed', click: () => showWindow() },
    {
      label: 'Add magnet from clipboard',
      click: async () => {
        const m = await clipboardMagnets();
        if (!m) return notify('Nothing to add', 'Copy a magnet link first, then try again.');
        showWindow();
        win?.webContents.send('app:command', 'add', m);
      },
    },
    { label: 'Add torrent files…', click: () => void addTorrentFiles() },
    { type: 'separator' },
    {
      label: 'Pause all downloads',
      type: 'checkbox',
      checked: s.globalPaused,
      click: (item) => server!.manager.setGlobalPaused(item.checked),
    },
    {
      label: `Slow mode (${formatSpeed(s.slowModeLimitKBps * 1024)})`,
      type: 'checkbox',
      checked: s.slowMode,
      click: (item) => server!.manager.setSlowMode(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Go to',
      submenu: [
        { label: 'Downloads', click: go('downloads') },
        { label: 'TorBox Cloud', click: go('cloud') },
        { label: 'Analytics', click: go('analytics') },
        { label: 'Tags && Folders', click: go('organize') },
        { label: 'Settings', click: go('settings') },
      ],
    },
    {
      label: 'Open downloads folder',
      click: () => {
        const f = server!.manager.defaultFolder();
        fs.mkdirSync(f.path, { recursive: true });
        void shell.openPath(f.path);
      },
    },
    { type: 'separator' },
    {
      label: 'Launch on startup',
      type: 'checkbox',
      checked: s.desktop.launchOnStartup,
      click: (item) => {
        s.desktop.launchOnStartup = item.checked;
        applyLoginItem(item.checked);
        server!.store.save();
      },
    },
    { label: 'Quit Torboxed', click: () => quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  trayMenuAt = Date.now();
}

function onTick(t: Tick) {
  lastTick = t;
  if (!tray) return;
  const s = settings();
  const active = t.jobs.filter((j) => j.status === 'downloading').length;
  const state = s.globalPaused ? 'paused' : s.slowMode ? 'slow' : active ? 'active' : 'idle';
  if (state !== trayState) {
    trayState = state;
    tray.setImage(trayIcon(state));
  }
  tray.setToolTip(
    s.globalPaused ? 'Torboxed — paused' : active ? `Torboxed — ↓ ${formatSpeed(t.speed)} · ${active} active${s.slowMode ? ' (slow mode)' : ''}` : 'Torboxed',
  );
  const key = `${s.globalPaused}|${s.slowMode}|${active}|${s.desktop.launchOnStartup}|${s.slowModeLimitKBps}`;
  if (key !== trayKey || Date.now() - trayMenuAt > 5000) {
    trayKey = key;
    buildTrayMenu();
  }
}

/* ─────────────────────────── Notifications ─────────────────────────── */

function notify(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: false });
  n.on('click', () => (onClick ? onClick() : showWindow()));
  n.show();
}

function onNotify(n: NotifyEvent) {
  if (!settings().desktop.notifications || n.kind === 'info') return;
  notify(n.title, n.body, () => showWindow('downloads'));
}

/* ─────────────────────────── Settings & args ─────────────────────────── */

function applyLoginItem(on: boolean) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  } catch (e) {
    log.warn(`Could not update launch-on-startup: ${errMsg(e)}`);
  }
}

function onSettingsSaved(s: Settings, prev: Settings) {
  if (s.desktop.launchOnStartup !== prev.desktop.launchOnStartup) applyLoginItem(s.desktop.launchOnStartup);
  if (s.theme !== prev.theme) win?.setBackgroundColor(getTheme(s.theme).colors.bg);
  buildTrayMenu();
}

async function handleArgs(argv: string[]) {
  if (!server) return;
  let added = 0;
  for (const arg of argv.slice(argv === process.argv ? 1 : 0)) {
    try {
      if (/^magnet:\?/i.test(arg)) {
        if (!server.manager.addMagnet(arg, { origin: 'ui' }).duplicate) added++;
      } else if (/\.torrent$/i.test(arg) && fs.existsSync(arg)) {
        if (!server.manager.addTorrentFile(fs.readFileSync(arg), { origin: 'ui' }).duplicate) added++;
      }
    } catch (e) {
      notify('Could not add torrent', errMsg(e));
    }
  }
  if (added) notify(`Added ${added} torrent${added === 1 ? '' : 's'}`, 'Sending to TorBox…', () => showWindow('downloads'));
}

/* ─────────────────────────── IPC ─────────────────────────── */

function registerIpc() {
  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:toggleFullScreen', () => win?.setFullScreen(!win.isFullScreen()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.handle('win:state', () => windowState());
  ipcMain.on('app:quit', () => quit());
  ipcMain.on('app:relaunch', () => {
    app.relaunch();
    quit();
  });
  ipcMain.on('app:reload', () => win?.webContents.reloadIgnoringCache());
  ipcMain.on('app:devtools', () => win?.webContents.toggleDevTools());
  ipcMain.on('app:themeColors', (_e, c: { bg: string }) => {
    if (typeof c?.bg === 'string') win?.setBackgroundColor(c.bg);
  });
  ipcMain.handle('clip:read', () => clipboard.readText());
  ipcMain.handle('clip:write', (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
  });
  ipcMain.handle('shell:showItem', (_e, p: string) => {
    if (fs.existsSync(p)) shell.showItemInFolder(p);
    else void shell.openPath(path.dirname(p));
  });
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose a download folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
}

/* ─────────────────────────── Lifecycle ─────────────────────────── */

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
  saveBounds();
});

let closing = false;
app.on('will-quit', (e) => {
  if (closing || !server) return;
  e.preventDefault();
  closing = true;
  tray?.destroy();
  void server.close().finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  if (!settings().desktop.closeToTray) quit();
});

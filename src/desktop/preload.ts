import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, WindowState } from '../shared/bridge';

const listen = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    toggleFullScreen: () => ipcRenderer.send('win:toggleFullScreen'),
    close: () => ipcRenderer.send('win:close'),
    quit: () => ipcRenderer.send('app:quit'),
    getState: () => ipcRenderer.invoke('win:state') as Promise<WindowState>,
    onState: (cb) => listen<[WindowState]>('win:state', cb),
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clip:read') as Promise<string>,
    writeText: (text) => ipcRenderer.invoke('clip:write', text) as Promise<void>,
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p) as Promise<string>,
    showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p) as Promise<void>,
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath) as Promise<string | null>,
  },
  app: {
    relaunch: () => ipcRenderer.send('app:relaunch'),
    setThemeColors: (colors) => ipcRenderer.send('app:themeColors', colors),
    reload: () => ipcRenderer.send('app:reload'),
    toggleDevTools: () => ipcRenderer.send('app:devtools'),
  },
  onNavigate: (cb) => listen<[string]>('app:navigate', cb),
  onCommand: (cb) => listen<[string, unknown]>('app:command', cb),
};

contextBridge.exposeInMainWorld('torboxed', bridge);
